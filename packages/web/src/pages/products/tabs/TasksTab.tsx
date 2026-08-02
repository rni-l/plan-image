import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Loader2, ChevronRight, Layers } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

interface AnalysisVersion {
  id: string;
  versionNumber: number;
  createdAt: number;
  competitorAssetIds: string;
}

interface GenerationTask {
  id: string;
  name: string | null;
  description: string | null;
  outputTypes: string;   // JSON array
  currentStep: number;
  createdAt: number;
  updatedAt: number;
  analysisVersionId: string;
}

interface PreviewImage { itemId: string; filePath: string; title: string }

function TaskImageStrip({ taskId }: { taskId: string }) {
  const [images, setImages] = useState<PreviewImage[] | null>(null);

  useEffect(() => {
    api
      .get<{ images: PreviewImage[] }>(`/tasks/${taskId}/preview-images`)
      .then((res) => setImages(res.images))
      .catch(() => setImages([]));
  }, [taskId]);

  if (!images || images.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto border-t border-zinc-50 px-4 pb-3 pt-2">
      {images.slice(0, 6).map((img) => (
        <div
          key={img.itemId}
          className="h-14 w-14 shrink-0 overflow-hidden rounded bg-zinc-100"
          title={img.title}
        >
          <img
            src={`/api/products/assets/file?path=${encodeURIComponent(img.filePath)}`}
            alt={img.title}
            className="h-full w-full object-cover"
          />
        </div>
      ))}
    </div>
  );
}

const STEP_LABELS: Record<number, string> = {
  1: "选择配置",
  2: "设计方向",
  3: "编辑方案",
  4: "生成中 / 完成",
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TasksTab({ productId }: { productId: string }) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [versions, setVersions] = useState<AnalysisVersion[]>([]);

  useEffect(() => {
    Promise.all([
      api.get<GenerationTask[]>(`/products/${productId}/tasks`),
      api.get<AnalysisVersion[]>(`/research/${productId}/versions`),
    ])
      .then(([t, v]) => { setTasks(t); setVersions(v); })
      .catch(() => toast.error("加载失败"))
      .finally(() => setLoading(false));
  }, [productId]);

  function handleCreated(task: GenerationTask) {
    setTasks((prev) => [task, ...prev]);
    setDialogOpen(false);
    navigate(`/tasks/${task.id}/step/1`);
  }

  return (
    <div className="px-8 py-6">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-900">成图任务</h2>
        <Button size="sm" onClick={() => setDialogOpen(true)} disabled={versions.length === 0}>
          <Plus size={14} /> 新建任务
        </Button>
      </div>

      {versions.length === 0 && !loading && (
        <p className="mb-4 rounded-md border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          请先在「竞品研究」Tab 完成至少一次竞品分析，才能创建成图任务。
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 size={14} className="animate-spin" /> 加载中…
        </div>
      ) : tasks.length === 0 ? (
        <EmptyTasks onNew={() => setDialogOpen(true)} hasVersions={versions.length > 0} />
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onClick={() => navigate(`/tasks/${task.id}/step/${task.currentStep}`)}
            />
          ))}
        </div>
      )}

      <NewTaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        productId={productId}
        versions={versions}
        onCreated={handleCreated}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task row
// ---------------------------------------------------------------------------

function TaskRow({ task, onClick }: { task: GenerationTask; onClick: () => void }) {
  const types: string[] = JSON.parse(task.outputTypes);
  const typeLabel = types.map(t => t === "main_image" ? "主图" : "详情页").join(" + ");
  const date = new Date(task.createdAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  const stepLabel = STEP_LABELS[task.currentStep] ?? `步骤${task.currentStep}`;
  const isDone = task.currentStep === 4;

  return (
    <button
      onClick={onClick}
      className="flex w-full flex-col rounded-lg border border-zinc-100 bg-white text-left transition-shadow hover:shadow-sm"
    >
      <div className="flex items-center gap-4 px-4 py-3">
        <Layers size={16} className="shrink-0 text-zinc-400" />
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-zinc-900">
            {task.name ? task.name : `${typeLabel} 成图任务`}
          </p>
          {task.description && (
            <p className="mt-0.5 truncate text-xs text-zinc-500">{task.description}</p>
          )}
          <p className="mt-0.5 text-xs text-zinc-400">
            {typeLabel} · {date} 创建
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
          isDone ? "bg-green-50 text-green-700" : "bg-zinc-100 text-zinc-600"
        }`}>
          {stepLabel}
        </span>
        <ChevronRight size={14} className="shrink-0 text-zinc-300" />
      </div>

      {isDone && <TaskImageStrip taskId={task.id} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// New task dialog
// ---------------------------------------------------------------------------

function NewTaskDialog({
  open,
  onOpenChange,
  productId,
  versions,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productId: string;
  versions: AnalysisVersion[];
  onCreated: (task: GenerationTask) => void;
}) {
  const [analysisVersionId, setAnalysisVersionId] = useState(versions[0]?.id ?? "");
  const [outputTypes, setOutputTypes] = useState<string[]>(["main_image"]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      if (versions[0]) setAnalysisVersionId(versions[0].id);
      setName("");
      setDescription("");
      setOutputTypes(["main_image"]);
    }
  }, [open, versions]);

  function toggleType(t: string) {
    setOutputTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!analysisVersionId || outputTypes.length === 0) return;
    setSubmitting(true);
    try {
      const task = await api.post<GenerationTask>(`/products/${productId}/tasks`, {
        analysisVersionId,
        outputTypes,
        name: name.trim() || undefined,
        description: description.trim() || undefined,
      });
      onCreated(task);
    } catch {
      toast.error("创建失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>新建成图任务</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            {/* Task name (optional) */}
            <div className="flex flex-col gap-1.5">
              <Label>
                任务名称
                <span className="ml-1 text-zinc-400 font-normal text-xs">（选填）</span>
              </Label>
              <Input
                placeholder="如：618主推款主图"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
              />
            </div>

            {/* Task description (optional) */}
            <div className="flex flex-col gap-1.5">
              <Label>
                任务说明
                <span className="ml-1 text-zinc-400 font-normal text-xs">（选填）</span>
              </Label>
              <Textarea
                placeholder="简要描述任务目标或备注信息…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={200}
                className="text-sm"
              />
            </div>

            {/* Analysis version */}
            <div className="flex flex-col gap-1.5">
              <Label>关联竞品分析版本</Label>
              <select
                className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                value={analysisVersionId}
                onChange={(e) => setAnalysisVersionId(e.target.value)}
                required
              >
                {versions.map((v) => {
                  const date = new Date(v.createdAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
                  const count = (JSON.parse(v.competitorAssetIds) as string[]).length;
                  return (
                    <option key={v.id} value={v.id}>
                      v{v.versionNumber} · {date} · {count}张竞品
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Output types */}
            <div>
              <Label className="mb-2 block">输出类型</Label>
              <div className="flex gap-3">
                {[
                  { key: "main_image", label: "主图", desc: "800×800 等比方形" },
                  { key: "detail_page", label: "详情页", desc: "宽版长图模块" },
                ].map(({ key, label, desc }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleType(key)}
                    className={`flex flex-1 flex-col rounded-lg border px-4 py-3 text-left transition-colors ${
                      outputTypes.includes(key)
                        ? "border-zinc-900 bg-zinc-50"
                        : "border-zinc-200"
                    }`}
                  >
                    <span className="text-sm font-medium text-zinc-900">{label}</span>
                    <span className="mt-0.5 text-xs text-zinc-400">{desc}</span>
                  </button>
                ))}
              </div>
              {outputTypes.length === 0 && (
                <p className="mt-1.5 text-xs text-red-500">至少选择一种输出类型</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline">取消</Button>} />
            <Button
              type="submit"
              disabled={!analysisVersionId || outputTypes.length === 0 || submitting}
            >
              {submitting ? "创建中…" : "创建并开始"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyTasks({ onNew, hasVersions }: { onNew: () => void; hasVersions: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-zinc-400">
      <Layers size={36} strokeWidth={1.5} />
      <p className="text-sm">暂无成图任务</p>
      {hasVersions && (
        <Button variant="outline" size="sm" onClick={onNew}>
          <Plus size={14} /> 新建任务
        </Button>
      )}
    </div>
  );
}
