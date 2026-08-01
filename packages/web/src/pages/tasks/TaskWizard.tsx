import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate, NavLink } from "react-router-dom";
import {
  Loader2, ChevronRight, Check, Plus, X, GripVertical,
  RefreshCw, ZoomIn, AlertCircle, Zap, Pencil, Download, Rows2,
} from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { InpaintEditor } from "./InpaintEditor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GenerationTask {
  id: string;
  productId: string;
  analysisVersionId: string;
  outputTypes: string;        // JSON array
  currentStep: number;
  createdAt: number;
  updatedAt: number;
}

interface DesignDirection {
  id: string;
  label: string;
  content: string;            // JSON
}

interface DirectionContent {
  label?: string;
  positioning?: string;
  colorScheme?: string;
  layoutIntent?: string;
  copyStrategy?: string;
  imageList?: DraftItem[];
}

interface DraftItem {
  id?: string;                // present when loaded from DB
  listType: "main_image" | "detail_page";
  title: string;
  description?: string;
  sellingPoints?: string[];
  suggestedCopy?: string;
  compositionIntent?: string;
  presetId?: string;
  outputPresetSnapshot?: string;
}

interface ImageItem extends DraftItem {
  id: string;
  designPlanVersionId: string;
  sortOrder: number;
}

interface ImageVersion {
  id: string;
  imageItemId: string;
  filePath: string;
  checksum: string;
  generationType: string;
  isSelected: boolean;
  createdAt: number;
}

interface Job {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
  entityType: string | null;
  entityId: string | null;
  errorMessage: string | null;
}

interface OutputPreset {
  id: string;
  name: string;
  presetType: "main_image" | "detail_module";
  width: number;
  height: number;
  format: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEPS = [
  { n: 1, label: "选择配置"   },
  { n: 2, label: "设计方向"   },
  { n: 3, label: "编辑方案"   },
  { n: 4, label: "生成与导出" },
] as const;

// ---------------------------------------------------------------------------
// Step 2 — poll for directions, display cards, user selects one
// ---------------------------------------------------------------------------

function Step2({ task, onNext }: { task: GenerationTask; onNext: () => void }) {
  const [directions, setDirections] = useState<DesignDirection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadDirections = useCallback(async () => {
    const data = await api.get<{ directions: DesignDirection[] }>(`/tasks/${task.id}`);
    if (data.directions.length > 0) {
      setDirections(data.directions);
      setLoading(false);
      stopPolling();
    }
  }, [task.id]);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  useEffect(() => {
    loadDirections().catch(() => {});
    pollRef.current = setInterval(() => loadDirections().catch(() => {}), 3000);
    return () => stopPolling();
  }, [loadDirections]);

  async function handleNext() {
    if (!selectedId) return;
    setSaving(true);
    try {
      await api.patch(`/tasks/${task.id}/direction`, { directionId: selectedId });
      onNext();
    } catch {
      toast.error("保存失败，请重试");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-zinc-400">
        <Loader2 size={28} className="animate-spin" />
        <p className="text-sm">AI 正在生成设计方向，通常需要30-60秒…</p>
      </div>
    );
  }

  return (
    <div className="px-8 py-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-900">选择设计方向</h2>
        <Button size="sm" onClick={handleNext} disabled={!selectedId || saving}>
          {saving ? <><Loader2 size={13} className="animate-spin" /> 保存中</> : <>编辑方案 <ChevronRight size={13} /></>}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {directions.map((dir) => {
          const content = parseDirection(dir.content);
          const isSelected = selectedId === dir.id;
          return (
            <button
              key={dir.id}
              onClick={() => setSelectedId(dir.id)}
              className={`flex flex-col rounded-xl border p-4 text-left transition-all ${
                isSelected ? "border-zinc-900 shadow-md ring-1 ring-zinc-900" : "border-zinc-100 hover:border-zinc-300"
              }`}
            >
              <div className="mb-3 flex items-start justify-between">
                <span className="text-sm font-semibold text-zinc-900">{content.label ?? dir.label}</span>
                {isSelected && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900">
                    <Check size={10} className="text-white" />
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2 text-xs">
                {content.positioning && (
                  <div>
                    <span className="font-medium text-zinc-500">定位</span>
                    <p className="mt-0.5 text-zinc-700 line-clamp-2">{content.positioning}</p>
                  </div>
                )}
                {content.colorScheme && (
                  <div>
                    <span className="font-medium text-zinc-500">配色</span>
                    <p className="mt-0.5 text-zinc-700 line-clamp-2">{content.colorScheme}</p>
                  </div>
                )}
                {content.layoutIntent && (
                  <div>
                    <span className="font-medium text-zinc-500">版式</span>
                    <p className="mt-0.5 text-zinc-700 line-clamp-2">{content.layoutIntent}</p>
                  </div>
                )}
                {content.imageList && (
                  <p className="mt-1 text-zinc-400">{content.imageList.length} 张图片</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — editable image list, confirm dialog, create plan
// ---------------------------------------------------------------------------

function Step3({ task, onNext }: { task: GenerationTask; onNext: () => void }) {
  const [items, setItems] = useState<DraftItem[]>([]);
  const [presets, setPresets] = useState<OutputPreset[]>([]);
  const [loadingDir, setLoadingDir] = useState(true);
  const [selectedDirId, setSelectedDirId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    Promise.all([
      api.get<{ directions: Array<{ id: string; label: string; content: string }> }>(`/tasks/${task.id}`),
      api.get<OutputPreset[]>("/settings/presets"),
    ]).then(([taskData, ps]) => {
      setPresets(ps);
      const dirs = taskData.directions;
      if (dirs.length > 0) {
        const lastDir = dirs[dirs.length - 1]!;
        setSelectedDirId(lastDir.id);
        const content = parseDirection(lastDir.content);
        if (content.imageList && content.imageList.length > 0) {
          const defaultPreset = ps.find(p => p.presetType === "main_image") ?? ps[0];
          setItems(content.imageList.map((il) => ({
            ...il,
            presetId: il.presetId ?? defaultPreset?.id ?? "",
          })));
        }
      }
    }).catch(() => toast.error("加载方向数据失败"))
      .finally(() => setLoadingDir(false));
  }, [task.id]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((_, i) => String(i) === active.id);
    const newIdx = items.findIndex((_, i) => String(i) === over.id);
    setItems((prev) => arrayMove(prev, oldIdx, newIdx));
  }

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => i === index ? { ...it, ...patch } : it));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function addItem(listType: "main_image" | "detail_page") {
    const defaultPreset = presets.find(p =>
      listType === "main_image" ? p.presetType === "main_image" : p.presetType === "detail_module"
    ) ?? presets[0];
    setItems((prev) => [...prev, { listType, title: "", presetId: defaultPreset?.id ?? "" }]);
  }

  async function handleConfirm() {
    if (!selectedDirId) return;
    const invalid = items.some(it => !it.title.trim());
    if (invalid) { toast.error("所有图片项必须填写标题"); return; }
    if (items.length === 0) { toast.error("至少需要一张图片"); return; }

    setSubmitting(true);
    try {
      const res = await api.post<{ planVersionId: string; items: ImageItem[] }>(
        `/tasks/${task.id}/plan`,
        {
          directionId: selectedDirId,
          items: items.map((it) => ({
            listType: it.listType,
            title: it.title,
            description: it.description || undefined,
            sellingPoints: it.sellingPoints?.filter(Boolean),
            suggestedCopy: it.suggestedCopy || undefined,
            compositionIntent: it.compositionIntent || undefined,
            presetId: it.presetId || presets[0]?.id || "",
          })),
        }
      );
      toast.success(`方案已确认，共 ${res.items.length} 张图片`);
      setConfirmOpen(false);
      // Store planVersionId for step4 via navigation state
      onNext();
    } catch {
      toast.error("确认失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingDir) {
    return (
      <div className="flex items-center justify-center py-24 text-zinc-400">
        <Loader2 size={16} className="animate-spin mr-2" /> 加载方案数据…
      </div>
    );
  }

  const mainItems  = items.filter(it => it.listType === "main_image");
  const detailItems = items.filter(it => it.listType === "detail_page");
  const itemIds = items.map((_, i) => String(i));

  return (
    <div className="px-8 py-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-900">编辑图片清单（{items.length} 张）</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => addItem("main_image")}>
            <Plus size={13} /> 主图
          </Button>
          <Button size="sm" variant="outline" onClick={() => addItem("detail_page")}>
            <Plus size={13} /> 详情页
          </Button>
          <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={items.length === 0}>
            确认方案 <ChevronRight size={13} />
          </Button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {items.map((item, index) => (
              <SortableItemRow
                key={String(index)}
                id={String(index)}
                item={item}
                index={index}
                presets={presets}
                onChange={(patch) => updateItem(index, patch)}
                onRemove={() => removeItem(index)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {items.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-20 text-zinc-400">
          <p className="text-sm">清单为空，点击上方按钮添加图片</p>
        </div>
      )}

      {/* Confirm dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认方案</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-zinc-600 space-y-1">
            <p>即将锁定以下图片清单并进入生成阶段：</p>
            {mainItems.length  > 0 && <p>· 主图 {mainItems.length} 张</p>}
            {detailItems.length > 0 && <p>· 详情页图 {detailItems.length} 张</p>}
            <p className="mt-2 text-xs text-zinc-400">确认后图片清单不可再修改（可重新生成）。</p>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button">取消</Button>} />
            <Button onClick={handleConfirm} disabled={submitting}>
              {submitting ? <><Loader2 size={14} className="animate-spin" /> 提交中</> : "确认并生成"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — generation grid + per-item polling + retry
// ---------------------------------------------------------------------------

function Step4({ task }: { task: GenerationTask }) {
  const [planVersionId, setPlanVersionId] = useState<string | null>(null);
  const [items, setItems] = useState<ImageItem[]>([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [versions, setVersions] = useState<Record<string, ImageVersion[]>>({});
  const [generating, setGenerating] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [inpaintTarget, setInpaintTarget] = useState<{
    item: ImageItem;
    version: ImageVersion;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load latest plan version for this task
  useEffect(() => {
    api.get<{ planVersions: Array<{ id: string }> }>(`/tasks/${task.id}`)
      .then((data) => {
        const latest = data.planVersions[0];
        if (latest) setPlanVersionId(latest.id);
      })
      .catch(() => toast.error("加载方案数据失败"));
  }, [task.id]);

  // Load items once planVersionId is known
  useEffect(() => {
    if (!planVersionId) return;
    api.get<ImageItem[]>(`/tasks/${task.id}/plan/${planVersionId}/items`)
      .then(setItems)
      .catch(() => toast.error("加载图片清单失败"));
  }, [task.id, planVersionId]);

  // Load versions for all items
  const loadVersions = useCallback(async (itemList: ImageItem[]) => {
    const entries = await Promise.all(
      itemList.map(async (item) => {
        const vs = await api.get<ImageVersion[]>(`/tasks/items/${item.id}/versions`).catch(() => [] as ImageVersion[]);
        return [item.id, vs] as const;
      })
    );
    setVersions(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    if (items.length > 0) loadVersions(items);
  }, [items, loadVersions]);

  // Poll jobs for all items
  const pollJobs = useCallback(async (itemList: ImageItem[]) => {
    const allJobs = await api.get<Job[]>(
      `/jobs?entityType=image_item`
    ).catch(() => [] as Job[]);

    const itemIds = new Set(itemList.map(it => it.id));
    const relevant = allJobs.filter(j => j.entityId && itemIds.has(j.entityId));
    const byItem: Record<string, Job> = {};
    for (const j of relevant) {
      if (j.entityId) byItem[j.entityId] = j;
    }
    setJobs(byItem);

    const active = relevant.filter(j => j.status === "queued" || j.status === "running");
    if (active.length === 0) {
      stopPolling();
      setGenerating(false);
      await loadVersions(itemList);
    }
  }, [loadVersions]);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  useEffect(() => () => stopPolling(), []);

  async function handleGenerate() {
    if (!planVersionId || items.length === 0) return;
    setGenerating(true);
    try {
      await api.post(`/tasks/${task.id}/generate`, { planVersionId });
      toast.success(`已提交 ${items.length} 张图片生成任务`);
      stopPolling();
      pollRef.current = setInterval(() => pollJobs(items), 3500);
    } catch {
      toast.error("提交失败，请重试");
      setGenerating(false);
    }
  }

  async function handleRetry(itemId: string) {
    try {
      await api.post(`/tasks/items/${itemId}/retry`, {});
      toast.success("已重新提交");
      if (!pollRef.current) {
        pollRef.current = setInterval(() => pollJobs(items), 3500);
      }
    } catch {
      toast.error("重试失败");
    }
  }

  async function handleSelectVersion(itemId: string, versionId: string) {
    // Optimistic update first, then sync to server
    setVersions((prev) => ({
      ...prev,
      [itemId]: (prev[itemId] ?? []).map((v) => ({ ...v, isSelected: v.id === versionId })),
    }));
    try {
      await api.patch(`/tasks/items/${itemId}/versions/${versionId}/select`, {});
    } catch {
      toast.error("切换版本失败");
      loadVersions(items).catch(() => {});
    }
  }

  function handleInpaintSubmitted() {
    // Ensure polling is running so Step 4 auto-updates when the inpaint job finishes
    if (!pollRef.current) {
      pollRef.current = setInterval(() => pollJobs(items), 3500);
    }
  }

  const anyGenerated = Object.values(versions).some(vs => vs.length > 0);
  const allDone = items.length > 0 && items.every(it => (versions[it.id]?.length ?? 0) > 0);

  return (
    <div className="px-8 py-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-900">
          生成图片{allDone ? " — 已完成" : ""}
        </h2>
        {!allDone && (
          <Button size="sm" onClick={handleGenerate} disabled={generating || items.length === 0}>
            {generating
              ? <><Loader2 size={13} className="animate-spin" /> 生成中…</>
              : <><Zap size={13} /> {anyGenerated ? "重新全部生成" : "开始生成"}</>}
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex items-center justify-center py-24 text-zinc-400">
          <Loader2 size={16} className="animate-spin mr-2" /> 加载清单…
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {items.map((item) => {
            const job = jobs[item.id];
            const itemVersions = versions[item.id] ?? [];
            const selected = itemVersions.find(v => v.isSelected) ?? itemVersions[0];
            const isLoading    = job?.status === "queued" || job?.status === "running";
            const isFailed     = job?.status === "failed"  || job?.status === "interrupted";
            const isInpainting = job?.type === "image_edit" && isLoading;

            return (
              <div key={item.id} className="flex flex-col overflow-hidden rounded-xl border border-zinc-100 bg-white">
                {/* Image area */}
                <div className="group relative aspect-square w-full overflow-hidden bg-zinc-50">
                  {selected && selected.filePath ? (
                    <>
                      <img
                        src={`/api/products/assets/file?path=${encodeURIComponent(selected.filePath)}`}
                        alt={item.title}
                        className={`h-full w-full object-cover transition-opacity ${isInpainting ? "opacity-50" : ""}`}
                      />
                      {/* Inpaint-in-progress overlay */}
                      {isInpainting && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="flex items-center gap-1.5 rounded-full bg-zinc-900/85 px-3 py-1.5 text-xs text-white shadow-lg">
                            <Loader2 size={12} className="animate-spin" />
                            微调中…
                          </div>
                        </div>
                      )}
                      <div className="absolute right-2 top-2 flex gap-1">
                        <button
                          onClick={() => setInpaintTarget({ item, version: selected })}
                          className="rounded bg-white/80 p-1 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
                          title="局部微调"
                        >
                          <Pencil size={13} className="text-zinc-500" />
                        </button>
                        <button
                          onClick={() => setLightboxSrc(`/api/products/assets/file?path=${encodeURIComponent(selected.filePath)}`)}
                          className="rounded bg-white/80 p-1 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
                          title="放大查看"
                        >
                          <ZoomIn size={13} className="text-zinc-500" />
                        </button>
                        <a
                          href={`/api/products/assets/file?path=${encodeURIComponent(selected.filePath)}`}
                          download={`${item.title || "image"}.jpg`}
                          className="rounded bg-white/80 p-1 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
                          title="下载此图"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Download size={13} className="text-zinc-500" />
                        </a>
                      </div>
</>
                  ) : isLoading ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-400">
                      <Loader2 size={22} className="animate-spin" />
                      <span className="text-xs">{job?.status === "queued" ? "排队中…" : "生成中…"}</span>
                    </div>
                  ) : isFailed ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-red-400">
                      <AlertCircle size={22} />
                      <span className="text-xs">生成失败</span>
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-zinc-300">
                      待生成
                    </div>
                  )}
                </div>

                {/* Info + actions */}
                <div className="flex items-start justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-zinc-900">{item.title}</p>
                    <p className="text-xs text-zinc-400">{item.listType === "main_image" ? "主图" : "详情页"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {isFailed && (
                      <button
                        onClick={() => handleRetry(item.id)}
                        className="flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50"
                        title={job?.errorMessage ?? "重试"}
                      >
                        <RefreshCw size={11} /> 重试
                      </button>
                    )}
                    {selected && itemVersions.length > 1 && (
                      <div className="flex items-center gap-0.5">
                        {[...itemVersions].reverse().map((v, i) => (
                          <button
                            key={v.id}
                            title={v.generationType === "inpaint" ? `微调 v${i + 1}` : `生成 v${i + 1}`}
                            onClick={() => handleSelectVersion(item.id, v.id)}
                            className={`rounded px-1 py-0.5 text-[10px] leading-none transition-colors ${
                              v.isSelected
                                ? "bg-zinc-900 text-white"
                                : "border border-zinc-200 text-zinc-400 hover:border-zinc-400"
                            }`}
                          >
                            v{i + 1}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Export toolbar — shown when all items have at least one generated image */}
      {allDone && planVersionId && (
        <ExportToolbar taskId={task.id} planVersionId={planVersionId} items={items} />
      )}

      {inpaintTarget && (
        <InpaintEditor
          itemId={inpaintTarget.item.id}
          itemTitle={inpaintTarget.item.title}
          version={inpaintTarget.version}
          open
          onClose={() => setInpaintTarget(null)}
          onSubmitted={handleInpaintSubmitted}
        />
      )}
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}

// Helper — also used by Step2
function parseDirection(json: string): DirectionContent {
  try { return JSON.parse(json) as DirectionContent; } catch { return {}; }
}

// ---------------------------------------------------------------------------
// Export toolbar — appears below Step 4 grid when all images are generated
// ---------------------------------------------------------------------------

function ExportToolbar({
  taskId,
  planVersionId,
  items,
}: {
  taskId: string;
  planVersionId: string;
  items: ImageItem[];
}) {
  const hasDetailPages = items.some((it) => it.listType === "detail_page");
  const zipUrl    = `/api/tasks/${taskId}/export/zip?planVersionId=${planVersionId}`;
  const stitchUrl = `/api/tasks/${taskId}/export/stitch?planVersionId=${planVersionId}`;

  return (
    <div className="mt-6 flex items-center gap-3 rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3">
      <p className="text-sm font-medium text-zinc-700">导出</p>
      <div className="ml-auto flex gap-2">
        <a
          href={zipUrl}
          download="images-export.zip"
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
        >
          <Download size={13} /> 打包下载 (ZIP)
        </a>
        {hasDetailPages && (
          <a
            href={stitchUrl}
            download="detail-stitch.jpg"
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
          >
            <Rows2 size={13} /> 拼接详情页
          </a>
        )}
      </div>
    </div>
  );
}


function SortableItemRow({
  id, item, index, presets, onChange, onRemove,
}: {
  id: string;
  item: DraftItem;
  index: number;
  presets: OutputPreset[];
  onChange: (patch: Partial<DraftItem>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const [expanded, setExpanded] = useState(false);

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border border-zinc-100 bg-white">
      <div className="flex items-center gap-2 px-3 py-2">
        <div {...listeners} {...attributes} className="cursor-grab text-zinc-300 hover:text-zinc-500">
          <GripVertical size={14} />
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${
          item.listType === "main_image" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"
        }`}>
          {item.listType === "main_image" ? "主图" : "详情页"}
        </span>
        <Input
          className="flex-1 h-7 text-xs"
          placeholder={`图片标题 ${index + 1}`}
          value={item.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
        <button onClick={() => setExpanded(v => !v)} className="text-xs text-zinc-400 hover:text-zinc-700 px-1">
          {expanded ? "收起" : "展开"}
        </button>
        <button onClick={onRemove} className="text-zinc-300 hover:text-red-500">
          <X size={14} />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-zinc-50 px-3 py-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-zinc-500">内容描述</Label>
              <Textarea rows={2} className="text-xs" value={item.description ?? ""} onChange={(e) => onChange({ description: e.target.value })} placeholder="图片内容描述" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-zinc-500">构图意图</Label>
              <Textarea rows={2} className="text-xs" value={item.compositionIntent ?? ""} onChange={(e) => onChange({ compositionIntent: e.target.value })} placeholder="如：产品居中白底45度俯角" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-zinc-500">主标题文案</Label>
              <Input className="h-7 text-xs" value={item.suggestedCopy ?? ""} onChange={(e) => onChange({ suggestedCopy: e.target.value })} placeholder="建议主标题" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-zinc-500">输出预设</Label>
              <select
                className="h-7 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-900 focus:outline-none"
                value={item.presetId ?? ""}
                onChange={(e) => onChange({ presetId: e.target.value })}
              >
                <option value="">默认预设</option>
                {presets.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.width}×{p.height})</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



function Step1({ task, onNext }: { task: GenerationTask; onNext: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const outputTypes: string[] = JSON.parse(task.outputTypes);

  async function handleGenerate() {
    setSubmitting(true);
    try {
      await api.post(`/tasks/${task.id}/generate-directions`, {});
      toast.success("设计方向生成任务已提交");
      onNext();
    } catch {
      toast.error("提交失败，请重试");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-8 py-10">
      <h2 className="mb-6 text-base font-medium text-zinc-900">任务配置确认</h2>

      <div className="flex flex-col gap-4 rounded-lg border border-zinc-100 p-5 text-sm">
        <div className="flex gap-3">
          <span className="w-24 shrink-0 text-zinc-400">输出类型</span>
          <span className="text-zinc-900">
            {outputTypes.map(t => t === "main_image" ? "主图" : "详情页").join(" + ")}
          </span>
        </div>
        <div className="flex gap-3">
          <span className="w-24 shrink-0 text-zinc-400">竞品分析</span>
          <span className="text-zinc-900">已关联</span>
        </div>
        <div className="flex gap-3">
          <span className="w-24 shrink-0 text-zinc-400">下一步</span>
          <span className="text-zinc-500">AI 将基于竞品研究和商品信息生成3个差异化设计方向</span>
        </div>
      </div>

      <div className="mt-8 flex justify-end">
        <Button onClick={handleGenerate} disabled={submitting}>
          {submitting
            ? <><Loader2 size={14} className="animate-spin" /> 提交中…</>
            : <><Zap size={14} /> 生成设计方向</>}
        </Button>
      </div>
    </div>
  );
}



export function TaskWizard() {
  const { taskId, step } = useParams<{ taskId: string; step: string }>();
  const navigate = useNavigate();
  const currentStep = Math.max(1, Math.min(4, Number(step ?? 1)));

  const [task, setTask] = useState<GenerationTask | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!taskId) return;
    api.get<GenerationTask>(`/tasks/${taskId}`)
      .then(setTask)
      .catch(() => toast.error("加载任务失败"))
      .finally(() => setLoading(false));
  }, [taskId]);

  function goStep(n: number) {
    navigate(`/tasks/${taskId}/step/${n}`);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-400">
        <Loader2 size={16} className="animate-spin mr-2" /> 加载中…
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-zinc-400">
        <AlertCircle size={28} />
        <p>任务不存在</p>
        <NavLink to="/products" className="text-xs underline">返回商品库</NavLink>
      </div>
    );
  }

  const outputTypes: string[] = JSON.parse(task.outputTypes);
  const typeLabel = outputTypes.map(t => t === "main_image" ? "主图" : "详情页").join(" + ");

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb */}
      <div className="border-b border-zinc-200 px-8 pt-5 pb-4">
        <p className="mb-3 text-xs text-zinc-400">
          <NavLink to="/products" className="hover:text-zinc-700">商品库</NavLink>
          {" / "}
          <NavLink to={`/products/${task.productId}/tasks`} className="hover:text-zinc-700">成图任务</NavLink>
          {" / "}
          <span className="text-zinc-600">{typeLabel}</span>
        </p>
        {/* Step indicator */}
        <ol className="flex items-center gap-0">
          {STEPS.map(({ n, label }, i) => {
            const done   = n < currentStep;
            const active = n === currentStep;
            return (
              <li key={n} className="flex items-center">
                <div className="flex items-center gap-2">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium ${
                    active ? "bg-zinc-900 text-white" : done ? "bg-zinc-700 text-white" : "border border-zinc-300 text-zinc-400"
                  }`}>
                    {done ? <Check size={10} /> : n}
                  </span>
                  <span className={`text-sm ${active ? "font-medium text-zinc-900" : "text-zinc-400"}`}>{label}</span>
                </div>
                {i < STEPS.length - 1 && <span className="mx-4 h-px w-8 bg-zinc-200" />}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto">
        {currentStep === 1 && <Step1 task={task} onNext={() => goStep(2)} />}
        {currentStep === 2 && <Step2 task={task} onNext={() => goStep(3)} />}
        {currentStep === 3 && <Step3 task={task} onNext={() => goStep(4)} />}
        {currentStep === 4 && <Step4 task={task} />}
      </div>
    </div>
  );
}

