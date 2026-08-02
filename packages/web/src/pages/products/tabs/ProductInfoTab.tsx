import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProductImageAnalysis {
  appearance?: string;
  colors?: string;
  materials?: string;
  keyFeatures?: string;
  style?: string;
  shootingAngle?: string;
  backgroundStyle?: string;
}

interface ProductAsset {
  id: string;
  filePath: string;
  sortOrder: number;
  analysis?: string | null;
}

interface ProductDetail {
  id: string;
  name: string;
  notes: string | null;
  assets: ProductAsset[];
  specifications: Array<{
    id: string;
    label: string;
    value: string;
    sortOrder: number;
  }>;
  sellingPoints: Array<{ id: string; content: string; sortOrder: number }>;
}

interface DraftSpec {
  label: string;
  value: string;
}

interface ExtractResult {
  specs: DraftSpec[];
  sellingPoints: string[];
  notes: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProductInfoTab({
  productId,
  onNameChange,
}: {
  productId: string;
  onNameChange?: (name: string) => void;
}) {
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [assets, setAssets] = useState<ProductAsset[]>([]);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [specs, setSpecs] = useState<DraftSpec[]>([]);
  const [points, setPoints] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** Set of asset IDs currently being analysed */
  const [analysingIds, setAnalysingIds] = useState<Set<string>>(new Set());

  // Lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // AI extraction dialog
  const [extractOpen, setExtractOpen] = useState(false);
  const [extractRaw, setExtractRaw] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractResult | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  // Track whether form is dirty
  const initial = useRef({ name: "", notes: "", specs: "[]", points: "[]" });
  const dirty =
    name !== initial.current.name ||
    notes !== initial.current.notes ||
    JSON.stringify(specs) !== initial.current.specs ||
    JSON.stringify(points) !== initial.current.points;

  // Load product
  useEffect(() => {
    api
      .get<ProductDetail>(`/products/${productId}`)
      .then((p) => {
        setProduct(p);
        setAssets([...p.assets].sort((a, b) => a.sortOrder - b.sortOrder));
        const n = p.name ?? "";
        const no = p.notes ?? "";
        const sp = p.specifications.map((s) => ({ label: s.label, value: s.value }));
        const pts = p.sellingPoints.map((s) => s.content);
        setName(n);
        setNotes(no);
        setSpecs(sp);
        setPoints(pts);
        initial.current = { name: n, notes: no, specs: JSON.stringify(sp), points: JSON.stringify(pts) };
      })
      .catch(() => toast.error("加载商品资料失败"));
  }, [productId]);

  // Analyse a single asset (force=true means re-analyse even if already done)
  const handleAnalyse = useCallback(
    async (assetId: string, force = false) => {
      setAnalysingIds((prev) => new Set(prev).add(assetId));
      try {
        const updated = await api.post<ProductAsset>(
          `/products/${productId}/assets/${assetId}/analyse`,
          { force },
        );
        setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, analysis: updated.analysis } : a)));
      } catch {
        toast.error("图片分析失败，请检查视觉模型配置");
      } finally {
        setAnalysingIds((prev) => {
          const next = new Set(prev);
          next.delete(assetId);
          return next;
        });
      }
    },
    [productId],
  );

  // Image upload — auto-trigger analysis after upload
  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      setUploading(true);
      try {
        for (const file of Array.from(files)) {
          const asset = await api.upload<ProductAsset>(`/products/${productId}/assets`, file);
          setAssets((prev) => [...prev, asset]);
          // kick off analysis in background (don't await — UI stays responsive)
          void handleAnalyse(asset.id, false);
        }
      } catch {
        toast.error("上传失败，请检查文件格式（JPEG / PNG / WEBP，最大 20 MB）");
      } finally {
        setUploading(false);
      }
    },
    [productId, handleAnalyse],
  );

  // Drag-and-drop reorder
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = assets.findIndex((a) => a.id === active.id);
    const newIdx = assets.findIndex((a) => a.id === over.id);
    const reordered = arrayMove(assets, oldIdx, newIdx);
    setAssets(reordered);
    await api
      .patch(`/products/${productId}/assets/reorder`, { ids: reordered.map((a) => a.id) })
      .catch(() => toast.error("排序保存失败"));
  }

  // Delete image
  async function handleDeleteAsset(assetId: string) {
    await api.delete(`/products/${productId}/assets/${assetId}`).catch(() => {
      toast.error("删除失败");
      return;
    });
    setAssets((prev) => prev.filter((a) => a.id !== assetId));
  }

  // Save form
  async function handleSave() {
    setSaving(true);
    try {
      await Promise.all([
        api.patch(`/products/${productId}`, { name, notes: notes || undefined }),
        api.put(`/products/${productId}/specs`, { specs }),
        api.put(`/products/${productId}/selling-points`, { sellingPoints: points }),
      ]);
      initial.current = { name, notes, specs: JSON.stringify(specs), points: JSON.stringify(points) };
      onNameChange?.(name);
      toast.success("已保存");
    } catch {
      toast.error("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  // AI extract
  async function handleExtract() {
    if (!extractRaw.trim()) return;
    setExtracting(true);
    setExtracted(null);
    setExtractError(null);
    try {
      const result = await api.post<ExtractResult>(`/products/${productId}/extract-info`, { rawText: extractRaw });
      setExtracted(result);
    } catch {
      setExtractError("提取失败，请检查模型配置或稍后重试");
    } finally {
      setExtracting(false);
    }
  }

  function handleApplyExtract() {
    if (!extracted) return;
    if (extracted.specs.length > 0) setSpecs(extracted.specs);
    if (extracted.sellingPoints.length > 0) setPoints(extracted.sellingPoints);
    if (extracted.notes) setNotes(extracted.notes);
    setExtractOpen(false);
    setExtracted(null);
    setExtractRaw("");
    toast.success("已填入表单，记得保存修改");
  }

  function handleExtractDialogOpenChange(open: boolean) {
    setExtractOpen(open);
    if (!open) { setExtracted(null); setExtractError(null); }
  }

  if (!product) {
    return <div className="px-8 py-6 text-sm text-zinc-400">加载中…</div>;
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── Grid: left image area + right form ─────────────────────── */}
      <div className="grid min-h-0 flex-1 grid-cols-[40%_60%] gap-8 overflow-hidden px-8 py-6 pr-16">

        {/* Left: image grid with analysis cards */}
        <div className="overflow-y-auto">
          <Label className="mb-3 block text-zinc-700">商品参考图</Label>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={assets.map((a) => a.id)} strategy={rectSortingStrategy}>
              <div className="flex flex-col gap-3">
                {assets.map((asset) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    analysing={analysingIds.has(asset.id)}
                    onDelete={() => handleDeleteAsset(asset.id)}
                    onZoom={(src) => setLightboxSrc(src)}
                    onAnalyse={(force) => handleAnalyse(asset.id, force)}
                  />
                ))}
                <UploadCard uploading={uploading} onFiles={handleUpload} />
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {/* Right: form */}
        <div className="flex min-h-0 flex-col gap-6 overflow-y-auto pr-1">
          {/* Name + AI extract trigger */}
          <div className="flex items-end gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="pname">商品名称</Label>
              <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => setExtractOpen(true)}>
              <Sparkles size={14} /> AI 提取信息
            </Button>
          </div>

          {/* Specifications */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-zinc-700">规格参数</Label>
              <button
                onClick={() => setSpecs((s) => [...s, { label: "", value: "" }])}
                className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700"
              >
                <Plus size={12} /> 添加
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {specs.length === 0 && <p className="text-xs text-zinc-400">暂无规格参数</p>}
              {specs.map((spec, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input className="w-28 shrink-0" placeholder="参数名" value={spec.label}
                    onChange={(e) => setSpecs((s) => s.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                  <Input className="flex-1" placeholder="参数值" value={spec.value}
                    onChange={(e) => setSpecs((s) => s.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                  <button onClick={() => setSpecs((s) => s.filter((_, j) => j !== i))}
                    className="shrink-0 text-zinc-300 hover:text-red-500"><X size={14} /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Selling points */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-zinc-700">核心卖点</Label>
              <button onClick={() => setPoints((p) => [...p, ""])}
                className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700">
                <Plus size={12} /> 添加
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {points.length === 0 && <p className="text-xs text-zinc-400">暂无卖点</p>}
              {points.map((pt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input className="flex-1" placeholder={`卖点 ${i + 1}`} value={pt}
                    onChange={(e) => setPoints((p) => p.map((x, j) => j === i ? e.target.value : x))} />
                  <button onClick={() => setPoints((p) => p.filter((_, j) => j !== i))}
                    className="shrink-0 text-zinc-300 hover:text-red-500"><X size={14} /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pnotes">备注</Label>
            <Textarea id="pnotes" rows={3} placeholder="可选备注" value={notes}
              onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Save bar */}
      <div className="flex justify-end border-t border-zinc-100 px-8 py-4">
        <Button onClick={handleSave} disabled={!dirty || saving}>
          {saving ? "保存中…" : "保存修改"}
        </Button>
      </div>

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />

      <TextExtractDialog
        open={extractOpen}
        onOpenChange={handleExtractDialogOpenChange}
        rawText={extractRaw}
        onRawTextChange={setExtractRaw}
        extracting={extracting}
        extracted={extracted}
        extractError={extractError}
        onExtract={handleExtract}
        onApply={handleApplyExtract}
        onReset={() => { setExtracted(null); setExtractError(null); }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Asset card — image + analysis panel
// ---------------------------------------------------------------------------

function parseAnalysis(raw: string | null | undefined): ProductImageAnalysis | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as ProductImageAnalysis; } catch { return null; }
}

function AssetCard({
  asset,
  analysing,
  onDelete,
  onZoom,
  onAnalyse,
}: {
  asset: ProductAsset;
  analysing: boolean;
  onDelete: () => void;
  onZoom: (src: string) => void;
  onAnalyse: (force: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: asset.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const imgUrl = `/api/products/assets/file?path=${encodeURIComponent(asset.filePath)}`;
  const analysis = parseAnalysis(asset.analysis);
  const hasAnalysis = !!analysis;

  return (
    <div ref={setNodeRef} style={style}
      className="overflow-hidden rounded-xl border border-zinc-100 bg-white shadow-sm">
      {/* Image row */}
      <div className="group relative h-44 bg-zinc-50">
        <img src={imgUrl} alt="" className="h-full w-full object-contain" draggable={false} />

        {/* Drag handle */}
        <div {...listeners} {...attributes}
          className="absolute left-1.5 top-1.5 cursor-grab rounded bg-white/80 p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
          <GripVertical size={13} className="text-zinc-500" />
        </div>

        {/* Zoom */}
        <button onClick={() => onZoom(imgUrl)}
          className="absolute bottom-1.5 left-1.5 rounded bg-white/80 p-0.5 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
          aria-label="放大查看">
          <ZoomIn size={13} className="text-zinc-500" />
        </button>

        {/* Delete */}
        <button onClick={onDelete}
          className="absolute right-1.5 top-1.5 rounded bg-white/80 p-0.5 opacity-0 shadow-sm transition-opacity hover:bg-red-50 group-hover:opacity-100">
          <Trash2 size={13} className="text-zinc-500 hover:text-red-600" />
        </button>
      </div>

      {/* Analysis panel */}
      <div className="border-t border-zinc-100 px-3 py-2.5">
        {analysing ? (
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-500" />
            正在分析图片…
          </div>
        ) : hasAnalysis ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-zinc-500">图片分析</span>
              <button onClick={() => onAnalyse(true)}
                className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-700 transition-colors"
                title="重新分析">
                <RefreshCw size={11} /> 重新分析
              </button>
            </div>
            {analysis.appearance && (
              <p className="text-xs text-zinc-700 leading-relaxed">{analysis.appearance}</p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
              {analysis.colors && (
                <span><span className="text-zinc-400">颜色 </span><span className="text-zinc-600">{analysis.colors}</span></span>
              )}
              {analysis.materials && (
                <span><span className="text-zinc-400">材质 </span><span className="text-zinc-600">{analysis.materials}</span></span>
              )}
              {analysis.style && (
                <span><span className="text-zinc-400">风格 </span><span className="text-zinc-600">{analysis.style}</span></span>
              )}
            </div>
            {analysis.keyFeatures && (
              <p className="text-[11px] text-zinc-500">
                <span className="text-zinc-400">特征 </span>{analysis.keyFeatures}
              </p>
            )}
          </div>
        ) : (
          <button onClick={() => onAnalyse(false)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-200 py-2 text-xs text-zinc-400 hover:border-zinc-300 hover:text-zinc-600 transition-colors">
            <Sparkles size={12} /> 点击分析图片
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload card
// ---------------------------------------------------------------------------

function UploadCard({ uploading, onFiles }: { uploading: boolean; onFiles: (files: FileList | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
      className="flex h-20 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 text-zinc-400 transition-colors hover:border-zinc-300 hover:bg-zinc-100 disabled:opacity-50">
      {uploading
        ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700" />
        : <><Upload size={16} /><span className="text-xs">上传商品图片</span></>
      }
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple
        className="hidden" onChange={(e) => onFiles(e.target.files)} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// AI text extraction dialog
// ---------------------------------------------------------------------------

function TextExtractDialog({
  open, onOpenChange, rawText, onRawTextChange, extracting,
  extracted, extractError, onExtract, onApply, onReset,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rawText: string;
  onRawTextChange: (v: string) => void;
  extracting: boolean;
  extracted: ExtractResult | null;
  extractError: string | null;
  onExtract: () => void;
  onApply: () => void;
  onReset: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={16} className="text-zinc-500" /> AI 提取商品信息
          </DialogTitle>
        </DialogHeader>

        {!extracted && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-zinc-500">
              粘贴产品描述、规格参数、宣传文案等原始文字，AI 将自动提取规格参数、核心卖点和备注。
            </p>
            <Textarea rows={8} placeholder="粘贴原始文字内容…" value={rawText}
              onChange={(e) => onRawTextChange(e.target.value)} disabled={extracting} />
            {extractError && <p className="text-xs text-red-500">{extractError}</p>}
          </div>
        )}

        {extracted && (
          <div className="flex flex-col gap-4 text-sm">
            <p className="text-xs text-zinc-500">提取完成，确认后将覆盖对应字段（已有内容将被替换）。</p>
            {extracted.specs.length > 0 && (
              <div>
                <p className="mb-1.5 font-medium text-zinc-700">规格参数（{extracted.specs.length} 条）</p>
                <div className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 space-y-1">
                  {extracted.specs.map((s, i) => (
                    <div key={i} className="flex gap-2 text-xs">
                      <span className="w-24 shrink-0 text-zinc-400">{s.label}</span>
                      <span className="text-zinc-700">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {extracted.sellingPoints.length > 0 && (
              <div>
                <p className="mb-1.5 font-medium text-zinc-700">核心卖点（{extracted.sellingPoints.length} 条）</p>
                <ul className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 space-y-1">
                  {extracted.sellingPoints.map((pt, i) => (
                    <li key={i} className="text-xs text-zinc-700">· {pt}</li>
                  ))}
                </ul>
              </div>
            )}
            {extracted.notes && (
              <div>
                <p className="mb-1.5 font-medium text-zinc-700">备注</p>
                <p className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 whitespace-pre-wrap">{extracted.notes}</p>
              </div>
            )}
            {!extracted.specs.length && !extracted.sellingPoints.length && !extracted.notes && (
              <p className="text-xs text-zinc-400">未能从文本中提取到结构化信息，请检查输入内容。</p>
            )}
          </div>
        )}

        <DialogFooter>
          {!extracted ? (
            <>
              <DialogClose render={<Button variant="outline" type="button">取消</Button>} />
              <Button onClick={onExtract} disabled={extracting || !rawText.trim()}>
                {extracting
                  ? <><span className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> 提取中…</>
                  : <><Sparkles size={14} /> 开始提取</>}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button variant="outline" onClick={onReset}>重新输入</Button>
              <Button onClick={onApply}>填入表单</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
