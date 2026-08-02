import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  RefreshCw,
  Layers,
  ChevronRight,
  ChevronLeft,
  ChevronRight as ChevronRightNav,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Generated image strip (lazy-loaded for step-4 tasks)
// ---------------------------------------------------------------------------

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
          className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-zinc-100"
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskRow {
  id: string;
  productId: string;
  productName: string;
  name: string | null;
  description: string | null;
  outputTypes: string; // JSON array: ("main_image" | "detail_page")[]
  currentStep: number;
  createdAt: number;
  updatedAt: number;
}

type StepFilter = "all" | "active" | "done";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STEP_LABELS: Record<number, string> = {
  1: "选择配置",
  2: "生成方向",
  3: "编辑方案",
  4: "生成中 / 完成",
};

function typeLabel(outputTypes: string) {
  const types = JSON.parse(outputTypes) as string[];
  return types.map((t) => (t === "main_image" ? "主图" : "详情页")).join(" + ");
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Task card
// ---------------------------------------------------------------------------

function TaskCard({ task, onClick }: { task: TaskRow; onClick: () => void }) {
  const isDone = task.currentStep === 4;
  const stepLabel = STEP_LABELS[task.currentStep] ?? `步骤 ${task.currentStep}`;
  const title = task.name ?? task.productName;

  return (
    <button
      onClick={onClick}
      className="flex w-full flex-col rounded-lg border border-zinc-100 bg-white text-left transition-shadow hover:shadow-sm"
    >
      <div className="flex items-center gap-4 px-4 py-3">
        <Layers size={16} className="shrink-0 text-zinc-400" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-900">{title}</p>
          {task.description ? (
            <>
              <p className="mt-0.5 truncate text-xs text-zinc-500">{task.description}</p>
              <p className="mt-0.5 text-xs text-zinc-400">
                {typeLabel(task.outputTypes)} · 更新于 {fmtDate(task.updatedAt)}
              </p>
            </>
          ) : (
            <p className="mt-0.5 text-xs text-zinc-400">
              {typeLabel(task.outputTypes)} · 更新于 {fmtDate(task.updatedAt)}
            </p>
          )}
        </div>

        <Badge
          variant={isDone ? "succeeded" : "running"}
          className="shrink-0 text-xs"
        >
          {stepLabel}
        </Badge>

        <ChevronRight size={14} className="shrink-0 text-zinc-300" />
      </div>

      {isDone && <TaskImageStrip taskId={task.id} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const FILTER_TABS: { key: StepFilter; label: string }[] = [
  { key: "all",    label: "全部"   },
  { key: "active", label: "进行中" },
  { key: "done",   label: "已完成" },
];

const LIMIT = 30;

export function TaskCenterPage() {
  const navigate = useNavigate();
  const [filter, setFilter]   = useState<StepFilter>("all");
  const [page, setPage]       = useState(1);
  const [rows, setRows]       = useState<TaskRow[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (filter !== "all") params.set("step", filter);
      const res = await api.get<{ data: TaskRow[]; total: number }>(
        `/tasks?${params}`
      );
      setRows(res.data);
      setTotal(res.total);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [filter, page]);

  // Initial load + reload on filter/page change
  useEffect(() => { void load(); }, [load]);

  // Reset to page 1 when filter changes
  useEffect(() => { setPage(1); }, [filter]);

  // Poll every 5 s when there are in-progress tasks
  useEffect(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    const hasActive = rows.some((r) => r.currentStep < 4);
    if (hasActive) {
      pollRef.current = setTimeout(() => void load(true), 5000);
    }
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [rows, load]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h1 className="text-base font-semibold text-zinc-900">任务中心</h1>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => void load()}
          title="刷新"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
        {/* Toolbar: filter tabs + count */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1">
            {FILTER_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  filter === key
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-xs text-zinc-400">共 {total} 个任务</span>
        </div>

        {/* Task list */}
        {loading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[60px] animate-pulse rounded-lg border border-zinc-100 bg-zinc-50"
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-24 text-zinc-400">
            <Layers size={36} strokeWidth={1.5} />
            <p className="text-sm">暂无任务</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() =>
                  navigate(`/tasks/${task.id}/step/${task.currentStep}`)
                }
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>
              第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft size={13} />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRightNav size={13} />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
