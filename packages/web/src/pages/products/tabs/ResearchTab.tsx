import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Zap, RefreshCw, Pencil, X, Check, Loader2, ZoomIn } from "lucide-react";
import { api } from "@/lib/api";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompetitorAsset {
  id: string;
  filePath: string;
  originalName: string | null;
  createdAt: number;
}

interface AnalysisVersion {
  id: string;
  versionNumber: number;
  competitorAssetIds: string;   // JSON array
  createdAt: number;
}

interface AnalysisCard {
  id: string;
  competitorAssetId: string;
  modelOutput: string;          // JSON
  humanOverride: string | null; // JSON or null
  updatedAt: number;
}

interface SynthesisReport {
  id: string;
  content: string;              // JSON
  createdAt: number;
}

interface Job {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
  entityId: string | null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ResearchTab({ productId }: { productId: string }) {
  const [assets, setAssets]         = useState<CompetitorAsset[]>([]);
  const [versions, setVersions]     = useState<AnalysisVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cards, setCards]           = useState<AnalysisCard[]>([]);
  const [assetMap, setAssetMap]     = useState<Record<string, CompetitorAsset>>({});
  const [report, setReport]         = useState<SynthesisReport | null>(null);
  const [sheetOpen, setSheetOpen]   = useState(false);
  const [analyzing, setAnalyzing]   = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load assets + versions ──────────────────────────────────────────────
  const loadData = useCallback(async () => {
    const [assetList, versionList] = await Promise.all([
      api.get<CompetitorAsset[]>(`/research/${productId}/assets`),
      api.get<AnalysisVersion[]>(`/research/${productId}/versions`),
    ]);
    setAssets(assetList);
    setAssetMap(Object.fromEntries(assetList.map((a) => [a.id, a])));
    setVersions(versionList);
    if (versionList.length > 0 && !selectedId) {
      setSelectedId(versionList[0]!.id);
    }
  }, [productId, selectedId]);

  useEffect(() => { loadData().catch(() => {}); }, [productId]);

  // ── Load version detail ─────────────────────────────────────────────────
  const loadVersion = useCallback(async (versionId: string) => {
    const detail = await api.get<AnalysisVersion & { cards: AnalysisCard[]; report: SynthesisReport | null }>(
      `/research/versions/${versionId}`
    );
    setCards(detail.cards);
    setReport(detail.report);
  }, []);

  useEffect(() => {
    if (selectedId) loadVersion(selectedId).catch(() => {});
  }, [selectedId, loadVersion]);

  // ── Job polling ─────────────────────────────────────────────────────────
  function startPolling(versionId: string) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const jobs = await api.get<Job[]>(`/jobs?entityType=analysis_version&entityId=${versionId}`).catch(() => [] as Job[]);
      const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
      if (active.length === 0) {
        stopPolling();
        setAnalyzing(false);
        setSynthesizing(false);
        await loadVersion(versionId);
        toast.success("分析完成");
      }
    }, 2500);
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  useEffect(() => () => stopPolling(), []);

  // ── Trigger analysis ────────────────────────────────────────────────────
  async function handleAnalyze() {
    if (assets.length === 0) { toast.error("请先上传竞品素材"); return; }
    setAnalyzing(true);
    try {
      const res = await api.post<{ version: AnalysisVersion; jobIds: string[] }>(
        `/research/${productId}/analyze`, {}
      );
      const newVersion = res.version;
      setVersions((prev) => [newVersion, ...prev]);
      setSelectedId(newVersion.id);
      setCards([]);
      setReport(null);
      toast.success(`分析任务已提交 (${res.jobIds.length} 张图)`);
      startPolling(newVersion.id);
    } catch {
      setAnalyzing(false);
      toast.error("提交分析失败");
    }
  }

  // ── Trigger synthesis ───────────────────────────────────────────────────
  async function handleSynthesize() {
    if (!selectedId) return;
    setSynthesizing(true);
    try {
      await api.post(`/research/versions/${selectedId}/synthesize`, {});
      toast.success("综合报告生成任务已提交");
      startPolling(selectedId);
    } catch {
      setSynthesizing(false);
      toast.error("提交综合报告失败");
    }
  }

  // ── Version label helper ────────────────────────────────────────────────
  function versionLabel(v: AnalysisVersion) {
    const date = new Date(v.createdAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
    const count = (JSON.parse(v.competitorAssetIds) as string[]).length;
    return `v${v.versionNumber} · ${date} · ${count}张`;
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-zinc-100 px-8 py-3">
        {/* Version selector */}
        <select
          className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={versions.length === 0}
        >
          {versions.length === 0
            ? <option value="">— 暂无分析版本 —</option>
            : versions.map((v) => (
                <option key={v.id} value={v.id}>{versionLabel(v)}</option>
              ))
          }
        </select>

        <div className="flex-1" />

        <Button variant="outline" size="sm" onClick={() => setSheetOpen(true)}>
          <Upload size={14} /> 管理素材 ({assets.length})
        </Button>

        <Button size="sm" onClick={handleAnalyze} disabled={analyzing || assets.length === 0}>
          {analyzing
            ? <><Loader2 size={14} className="animate-spin" /> 分析中…</>
            : <><Zap size={14} /> 生成分析</>
          }
        </Button>
      </div>

      {/* Main area: cards + report */}
      {versions.length === 0 ? (
        <EmptyResearch onUpload={() => setSheetOpen(true)} onAnalyze={handleAnalyze} hasAssets={assets.length > 0} />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Left: analysis cards */}
          <div className="flex-1 overflow-y-auto px-8 py-6">
            {analyzing && cards.length === 0 ? (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="animate-pulse rounded-lg border border-zinc-100">
                    <div className="aspect-video w-full bg-zinc-100" />
                    <div className="p-3 space-y-2">
                      <div className="h-3 w-3/4 rounded bg-zinc-100" />
                      <div className="h-3 w-1/2 rounded bg-zinc-100" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {cards.map((card) => (
                  <AnalysisCard
                    key={card.id}
                    card={card}
                    asset={assetMap[card.competitorAssetId]}
                    onOverrideSaved={(updated) =>
                      setCards((prev) => prev.map((c) => c.id === updated.id ? updated : c))
                    }
                  />
                ))}
              </div>
            )}
          </div>

          {/* Right: synthesis report */}
          <div className="w-[38%] shrink-0 overflow-y-auto border-l border-zinc-100 px-5 py-6">
            <SynthesisPanel
              report={report}
              synthesizing={synthesizing}
              onSynthesize={handleSynthesize}
              cards={cards}
            />
          </div>
        </div>
      )}

      {/* Asset management Sheet */}
      <AssetSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        productId={productId}
        assets={assets}
        onUploaded={(a) => setAssets((prev) => [...prev, a])}
        onDeleted={(id) => setAssets((prev) => prev.filter((a) => a.id !== id))}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analysis card
// ---------------------------------------------------------------------------

function AnalysisCard({
  card,
  asset,
  onOverrideSaved,
}: {
  card: AnalysisCard;
  asset: CompetitorAsset | undefined;
  onOverrideSaved: (updated: AnalysisCard) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const effective = card.humanOverride
    ? (JSON.parse(card.humanOverride) as Record<string, string>)
    : (JSON.parse(card.modelOutput) as Record<string, string>);
  const isOverridden = !!card.humanOverride;
  const isEmpty = !effective || Object.keys(effective).length === 0 || effective["raw"];
  const imgUrl = asset
    ? `/api/products/assets/file?path=${encodeURIComponent(asset.filePath)}`
    : null;

  const FIELD_LABELS: Record<string, string> = {
    layout: "版式", colors: "配色", copy: "文案",
    selling_points: "卖点", scene: "场景", techniques: "手法",
  };

  return (
    <div className={`group overflow-hidden rounded-lg border bg-white ${
      isOverridden ? "border-zinc-300" : "border-zinc-100"
    }`}>
      {/* Thumbnail */}
      <div className="relative aspect-video w-full overflow-hidden bg-zinc-50">
        {imgUrl ? (
          <img src={imgUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-400">无图</div>
        )}
        {isOverridden && (
          <span className="absolute left-2 top-2 rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-white">
            已修正
          </span>
        )}
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-50/80">
            <Loader2 size={20} className="animate-spin text-zinc-300" />
          </div>
        )}
        {/* Zoom button */}
        {imgUrl && (
          <button
            onClick={() => setLightboxSrc(imgUrl)}
            className="absolute right-2 top-2 rounded bg-white/80 p-1 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
            aria-label="放大查看"
          >
            <ZoomIn size={12} className="text-zinc-500" />
          </button>
        )}
      </div>

      {/* Fields */}
      <div className="p-3">
        {!isEmpty && (
          <div className="mb-2 space-y-1">
            {Object.entries(FIELD_LABELS).map(([key, label]) => {
              const val = effective[key];
              if (!val) return null;
              return (
                <div key={key} className="flex gap-1.5 text-xs leading-relaxed">
                  <span className="w-8 shrink-0 text-zinc-400">{label}</span>
                  <span className="text-zinc-700 line-clamp-2">{val}</span>
                </div>
              );
            })}
          </div>
        )}
        <button
          onClick={() => setEditOpen(true)}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700"
        >
          <Pencil size={11} /> 修正
        </button>
      </div>

      {/* Override dialog */}
      <OverrideDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        card={card}
        effective={effective}
        fieldLabels={FIELD_LABELS}
        onSaved={onOverrideSaved}
      />

      {/* Lightbox */}
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Override dialog
// ---------------------------------------------------------------------------

function OverrideDialog({
  open, onOpenChange, card, effective, fieldLabels, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  card: AnalysisCard;
  effective: Record<string, string>;
  fieldLabels: Record<string, string>;
  onSaved: (c: AnalysisCard) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft({ ...effective });
  }, [open, effective]);

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.patch<AnalysisCard>(`/research/cards/${card.id}`, {
        humanOverride: draft,
      });
      onSaved(updated);
      onOpenChange(false);
      toast.success("修正已保存");
    } catch {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>修正分析卡片</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {Object.entries(fieldLabels).map(([key, label]) => (
            <div key={key} className="flex flex-col gap-1">
              <Label className="text-xs text-zinc-500">{label}</Label>
              <Textarea
                rows={2}
                value={draft[key] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button">取消</Button>} />
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "保存中…" : <><Check size={14} /> 保存修正</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Synthesis report panel
// ---------------------------------------------------------------------------

function SynthesisPanel({
  report, synthesizing, onSynthesize, cards,
}: {
  report: SynthesisReport | null;
  synthesizing: boolean;
  onSynthesize: () => void;
  cards: AnalysisCard[];
}) {
  const parsed = report ? (JSON.parse(report.content) as Record<string, unknown>) : null;
  const allDone = cards.length > 0 && cards.every((c) => c.modelOutput !== "");

  return (
    <div>
      <div className="mb-4 flex items-start justify-between">
        <h3 className="section-title text-sm text-zinc-900">综合报告</h3>
        <Button
          size="sm"
          variant="outline"
          onClick={onSynthesize}
          disabled={synthesizing || !allDone}
          className="shrink-0"
        >
          {synthesizing
            ? <><Loader2 size={12} className="animate-spin" /> 生成中</>
            : <><RefreshCw size={12} /> 基于修正重新生成</>
          }
        </Button>
      </div>

      {!report && !synthesizing && (
        <p className="text-xs text-zinc-400">
          {allDone
            ? "逐图分析已完成，点击右上角按钮生成综合报告。"
            : "等待逐图分析完成后即可生成综合报告。"}
        </p>
      )}

      {synthesizing && !report && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 size={12} className="animate-spin" /> 综合报告生成中…
        </div>
      )}

      {parsed && (
        <div className="space-y-5 text-sm">
          {(
          [
            ["行业共性规律", "industry_patterns"],
            ["差异化机会", "differentiation_opportunities"],
            ["设计建议", "design_suggestions"],
          ] as [string, string][]
        ).map(([label, key]) => (
            <div key={key}>
              <p className="mb-1.5 font-medium text-zinc-800">{label}</p>
              <p className="leading-relaxed text-zinc-600 whitespace-pre-wrap text-xs">
                {typeof parsed[key] === "string"
                  ? parsed[key] as string
                  : JSON.stringify(parsed[key], null, 2)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Asset management sheet
// ---------------------------------------------------------------------------

function AssetSheet({
  open, onClose, productId, assets, onUploaded, onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  productId: string;
  assets: CompetitorAsset[];
  onUploaded: (asset: CompetitorAsset) => void;
  onDeleted: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const asset = await api.upload<CompetitorAsset>(
          `/products/${productId}/competitor-assets`, file
        );
        onUploaded(asset);
      }
    } catch {
      toast.error("上传失败");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(id: string) {
    await api.delete(`/products/${productId}/competitor-assets/${id}`).catch(() => {
      toast.error("删除失败"); return;
    });
    onDeleted(id);
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onClose} title="竞品素材">
        <div className="p-6">
          {/* Upload zone */}
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="mb-5 flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-200 py-8 text-zinc-400 hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
          >
            {uploading
              ? <Loader2 size={20} className="animate-spin" />
              : <Upload size={20} />
            }
            <span className="text-sm">{uploading ? "上传中…" : "点击上传竞品图片"}</span>
            <span className="text-xs">JPEG / PNG / WEBP，最大 20 MB</span>
          </button>
          <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp"
            className="hidden" onChange={(e) => handleFiles(e.target.files)} />

          {/* Asset list */}
          {assets.length === 0 ? (
            <p className="text-center text-xs text-zinc-400">暂无竞品素材</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {assets.map((asset) => {
                const url = `/api/products/assets/file?path=${encodeURIComponent(asset.filePath)}`;
                return (
                  <div key={asset.id} className="group relative aspect-square overflow-hidden rounded-lg border border-zinc-100">
                    <img src={url} alt={asset.originalName ?? ""} className="h-full w-full object-cover" />
                    {/* Zoom button */}
                    <button
                      onClick={() => setLightboxSrc(url)}
                      className="absolute left-1 bottom-1 rounded bg-white/80 p-1 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
                      aria-label="放大查看"
                    >
                      <ZoomIn size={12} className="text-zinc-500" />
                    </button>
                    {/* Delete overlay */}
                    <button
                      onClick={() => handleDelete(asset.id)}
                      className="absolute right-1 top-1 rounded bg-white/80 p-1 opacity-0 shadow-sm transition-opacity hover:bg-red-50 group-hover:opacity-100"
                      aria-label="删除"
                    >
                      <X size={12} className="text-zinc-500 hover:text-red-600" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Sheet>
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyResearch({
  onUpload, onAnalyze, hasAssets,
}: {
  onUpload: () => void;
  onAnalyze: () => void;
  hasAssets: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-zinc-400">
      <Zap size={36} strokeWidth={1.5} />
      <p className="text-sm">上传竞品图片后生成分析</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onUpload}>
          <Upload size={14} /> 上传竞品图
        </Button>
        {hasAssets && (
          <Button size="sm" onClick={onAnalyze}>
            <Zap size={14} /> 生成分析
          </Button>
        )}
      </div>
    </div>
  );
}
