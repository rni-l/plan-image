import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate, NavLink } from "react-router-dom";
import {
  Loader2, ChevronRight, Check, Plus, X, GripVertical,
  RefreshCw, ZoomIn, AlertCircle, Zap, Pencil, Download, Rows2,
  MessageSquare, Send, Clock, ChevronDown, Info,
  FileText, Sparkles, Copy,
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
import { normalizeStringArray, shouldGenerateDirections } from "@/lib/task-wizard-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { Sheet } from "@/components/ui/sheet";
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
  planDefaultTemplateId: string | null;
  imageDefaultTemplateId: string | null;
  latestPlanPromptSnapshot: string | null;
  draftSelectedDirectionId: string | null;
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
  id?: string;
  listType: "main_image" | "detail_page";
  title: string;
  description?: string;
  sellingPoints?: string[];
  suggestedCopy?: string;
  compositionIntent?: string;
  lighting?: string;
  angle?: string;
  background?: string;
  mood?: string;
  visualElements?: string;
  productAssetId?: string | null;
  referenceAssetIds?: string;
  promptTemplateId?: string | null;
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
  parentVersionId: string | null;
  instruction: string | null;
  promptTemplateId: string | null;
  finalPrompt: string | null;
  polishInstruction: string | null;
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

/** Config collected in Step 1, passed through to Step 2 */
interface Step1Config {
  userIdeas: string;
  planCount: number;
  mainImageCount: number;
  detailImageCount: number;
  planTemplateId: string | null;
  planEditablePrompt?: string;
  generateRequested: boolean;
}

interface PromptTemplate {
  id: string;
  type: "design_plan" | "image_generation";
  name: string;
  description: string | null;
  body: string;
  isBuiltIn: boolean;
  isDefault: boolean;
}

interface PromptRender {
  templateId: string | null;
  templateName: string | null;
  editablePrompt: string;
  lockedSuffix: string;
  finalPrompt: string;
  contextVariables: Record<string, string>;
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
// Helper: format elapsed seconds
// ---------------------------------------------------------------------------

function fmtElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Direction Chat Sheet — inline chat with a specific design direction
// ---------------------------------------------------------------------------
function DirectionChatSheet({
  direction,
  open,
  onOpenChange,
  onUpdated,
}: {
  direction: DesignDirection;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUpdated: (id: string, newContent: string) => void;
}) {
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [proposal, setProposal] = useState<Record<string, unknown> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Reset messages when direction changes
  useEffect(() => { setMessages([]); setInput(""); setProposal(null); }, [direction.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    const userMsg = { role: "user" as const, content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setSending(true);
    try {
      const res = await api.post<{ proposal: Record<string, unknown> }>(
        `/tasks/directions/${direction.id}/polish`,
        { instruction: text }
      );
      setProposal(res.proposal);
      setMessages(prev => [...prev, { role: "assistant", content: "已生成完整修改提案。确认结构和图片清单后再应用。" }]);
    } catch {
      toast.error("发送失败，请重试");
      setMessages(prev => prev.slice(0, -1)); // remove optimistic user msg
    } finally {
      setSending(false);
    }
  }

  async function applyProposal() {
    if (!proposal) return;
    setSending(true);
    try {
      const updated = await api.patch<DesignDirection>(`/tasks/directions/${direction.id}`, { proposal });
      onUpdated(direction.id, updated.content);
      setProposal(null);
      toast.success("方向提案已应用");
    } catch {
      toast.error("该方向可能已被确认方案引用，无法修改");
    } finally {
      setSending(false);
    }
  }

  const content = parseDirection(direction.content);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`调整方向：${content.label ?? direction.label}`} className="w-[500px]">
      <div className="flex h-full flex-col">
        {/* Direction summary */}
        <div className="border-b border-zinc-100 bg-zinc-50 px-5 py-3 text-xs text-zinc-500 space-y-0.5">
          {content.positioning && <p><span className="font-medium">定位：</span>{content.positioning}</p>}
          {content.colorScheme && <p><span className="font-medium">配色：</span>{content.colorScheme}</p>}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 && (
            <p className="text-center text-xs text-zinc-400 py-8">
              描述你想调整的方向，AI 将帮你优化方案
            </p>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-100 text-zinc-800"
              }`}>
                {msg.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1.5 rounded-2xl bg-zinc-100 px-4 py-2.5 text-sm text-zinc-400">
                <Loader2 size={12} className="animate-spin" /> 思考中…
              </div>
            </div>
          )}
          {proposal && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="mb-2 text-xs font-medium text-amber-900">待确认的完整结构化提案</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-amber-950">
                {JSON.stringify(proposal, null, 2)}
              </pre>
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setProposal(null)}>取消</Button>
                <Button size="sm" onClick={applyProposal} disabled={sending}>确认应用</Button>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-zinc-100 px-4 py-3">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="描述你的想法…"
              rows={2}
              className="flex-1 resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
              }}
            />
            <Button size="sm" onClick={handleSend} disabled={!input.trim() || sending} className="self-end">
              <Send size={13} />
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — SSE: stream progress + LLM output → display direction cards
// ---------------------------------------------------------------------------

function Step2({
  task,
  config,
  onGenerationRequestConsumed,
  onNext,
}: {
  task: GenerationTask;
  config: Step1Config;
  onGenerationRequestConsumed: () => void;
  onNext: () => void;
}) {
  const [directions, setDirections] = useState<DesignDirection[]>([]);
  const [streamState, setStreamState] = useState<null | "done" | string>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [tokenBuffer, setTokenBuffer] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const sourceRef = useRef<AbortController | null>(null);
  const tokenEndRef = useRef<HTMLDivElement | null>(null);

  // Elapsed timer
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // Chat sheet state
  const [chatDir, setChatDir] = useState<DesignDirection | null>(null);

  useEffect(() => {
    tokenEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [tokenBuffer]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const startStream = useCallback(() => {
    sourceRef.current?.abort();
    setStreamState(null);
    setSteps([]);
    setTokenBuffer("");
    setDirections([]);
    setElapsedMs(0);
    stopTimer();

    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 200);

    const outputTypes: string[] = JSON.parse(task.outputTypes);
    const mainCount = outputTypes.includes("main_image") ? config.mainImageCount : 0;
    const detailCount = outputTypes.includes("detail_page") ? config.detailImageCount : 0;
    const controller = new AbortController();
    sourceRef.current = controller;
    void api.postSSE<{ type: string; text?: string; message?: string }>(
      `/tasks/${task.id}/generate-directions-stream`,
      {
        planCount: config.planCount,
        mainImageCount: mainCount,
        detailImageCount: detailCount,
        userIdeas: config.userIdeas.trim(),
        templateId: config.planTemplateId,
        ...(config.planEditablePrompt ? { editablePrompt: config.planEditablePrompt } : {}),
      },
      (payload) => {
      if (payload.type === "step" && payload.text) {
        setSteps((prev) => [...prev, payload.text!]);
      } else if (payload.type === "token" && payload.text) {
        setTokenBuffer((prev) => prev + payload.text);
      } else if (payload.type === "done") {
        sourceRef.current = null;
        stopTimer();
        setElapsedMs(Date.now() - startTimeRef.current);
        api.get<{ directions: DesignDirection[] }>(`/tasks/${task.id}`)
          .then((data) => {
            setDirections(data.directions);
            setStreamState("done");
          })
          .catch(() => setStreamState("加载设计方向失败，请刷新重试"));
      } else if (payload.type === "error") {
        sourceRef.current = null;
        stopTimer();
        setStreamState(payload.message ?? "生成失败，请重试");
      }
      },
      controller.signal,
    ).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      sourceRef.current = null;
      stopTimer();
      setStreamState(error instanceof Error ? error.message : "连接中断，请点击重试");
    });
  }, [
    task.id,
    task.outputTypes,
    config.planCount,
    config.mainImageCount,
    config.detailImageCount,
    config.userIdeas,
    config.planTemplateId,
    config.planEditablePrompt,
    stopTimer,
  ]);

  useEffect(() => {
    let cancelled = false;
    const generateRequested = config.generateRequested;
    api.get<{ directions: DesignDirection[]; draftSelectedDirectionId: string | null }>(`/tasks/${task.id}`)
      .then((data) => {
        if (cancelled) return;
        if (!shouldGenerateDirections(generateRequested, data.directions.length)) {
          setDirections(data.directions);
          setSelectedId(data.draftSelectedDirectionId ?? data.directions[0]?.id ?? null);
          setStreamState("done");
        } else {
          if (generateRequested) onGenerationRequestConsumed();
          startStream();
        }
      })
      .catch(() => {
        if (generateRequested) onGenerationRequestConsumed();
        startStream();
      });
    return () => { cancelled = true; sourceRef.current?.abort(); stopTimer(); };
  }, [task.id, startStream, stopTimer]);

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

  function handleDirectionUpdated(id: string, newContent: string) {
    setDirections(prev => prev.map(d => d.id === id ? { ...d, content: newContent } : d));
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (typeof streamState === "string" && streamState !== "done") {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-zinc-400">
        <AlertCircle size={28} className="text-red-400" />
        <p className="text-sm text-red-500">{streamState}</p>
        <Button variant="outline" size="sm" onClick={startStream}>
          <RefreshCw size={13} /> 重新生成
        </Button>
      </div>
    );
  }

  // ── Streaming / loading state ──────────────────────────────────────────────
  if (streamState === null) {
    return (
      <div className="flex flex-col gap-4 px-8 py-6">
        {/* Elapsed timer */}
        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Clock size={12} className="shrink-0" />
          <span>已用时 {fmtElapsed(elapsedMs)}</span>
        </div>
        {/* Step progress */}
        <div className="flex flex-col gap-1.5">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-zinc-500">
              <Check size={13} className="shrink-0 text-emerald-500" />
              {s}
            </div>
          ))}
          {steps.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 size={13} className="shrink-0 animate-spin" />
              {steps.length < 2 ? "等待分析完成…" : "AI 正在思考…"}
            </div>
          )}
          {steps.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 size={13} className="shrink-0 animate-spin" />
              正在初始化…
            </div>
          )}
        </div>
        {tokenBuffer && (
          <div className="max-h-56 overflow-y-auto rounded-lg bg-zinc-950 p-3">
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-emerald-400">
              {tokenBuffer}
            </pre>
            <div ref={tokenEndRef} />
          </div>
        )}
      </div>
    );
  }

  // ── Done: show direction cards ─────────────────────────────────────────────
  return (
    <div className="px-8 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-zinc-900">选择设计方向</h2>
          <span className="flex items-center gap-1 text-xs text-zinc-400">
            <Clock size={11} /> {fmtElapsed(elapsedMs)}
          </span>
          <Button variant="outline" size="sm" onClick={startStream}>
            <RefreshCw size={12} /> 重新生成
          </Button>
        </div>
        <Button size="sm" onClick={handleNext} disabled={!selectedId || saving}>
          {saving ? <><Loader2 size={13} className="animate-spin" /> 保存中</> : <>编辑方案 <ChevronRight size={13} /></>}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {directions.map((dir) => {
          const content = parseDirection(dir.content);
          const isSelected = selectedId === dir.id;
          return (
            <div
              key={dir.id}
              className={`flex flex-col rounded-xl border text-left transition-all ${
                isSelected ? "border-zinc-900 shadow-md ring-1 ring-zinc-900" : "border-zinc-100 hover:border-zinc-300"
              }`}
            >
              {/* Card header — clickable to select */}
              <button
                onClick={() => setSelectedId(dir.id)}
                className="flex w-full items-start justify-between p-4 pb-2 text-left"
              >
                <span className="text-sm font-semibold text-zinc-900">{content.label ?? dir.label}</span>
                {isSelected && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900">
                    <Check size={10} className="text-white" />
                  </span>
                )}
              </button>

              {/* Full content */}
              <div
                onClick={() => setSelectedId(dir.id)}
                className="flex flex-1 cursor-pointer flex-col gap-2.5 px-4 pb-3 text-xs"
              >
                {content.positioning && (
                  <div>
                    <span className="font-medium text-zinc-500">定位</span>
                    <p className="mt-0.5 text-zinc-700">{content.positioning}</p>
                  </div>
                )}
                {content.colorScheme && (
                  <div>
                    <span className="font-medium text-zinc-500">配色</span>
                    <p className="mt-0.5 text-zinc-700">{content.colorScheme}</p>
                  </div>
                )}
                {content.layoutIntent && (
                  <div>
                    <span className="font-medium text-zinc-500">版式</span>
                    <p className="mt-0.5 text-zinc-700">{content.layoutIntent}</p>
                  </div>
                )}
                {content.copyStrategy && (
                  <div>
                    <span className="font-medium text-zinc-500">文案策略</span>
                    <p className="mt-0.5 text-zinc-700">{content.copyStrategy}</p>
                  </div>
                )}
                {content.imageList && content.imageList.length > 0 && (
                  <div>
                    <span className="font-medium text-zinc-500">图片清单（{content.imageList.length} 张）</span>
                    <ul className="mt-1 space-y-0.5">
                      {content.imageList.map((img, i) => (
                        <li key={i} className="text-zinc-500">
                          {i + 1}. [{img.listType === "main_image" ? "主图" : "详情页"}] {img.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Chat button */}
              <div className="border-t border-zinc-100 px-4 py-2">
                <button
                  onClick={() => setChatDir(dir)}
                  className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
                >
                  <MessageSquare size={12} /> 聊天调整
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {chatDir && (
        <DirectionChatSheet
          direction={chatDir}
          open
          onOpenChange={(v) => { if (!v) setChatDir(null); }}
          onUpdated={handleDirectionUpdated}
        />
      )}
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
  const [imageTemplates, setImageTemplates] = useState<PromptTemplate[]>([]);
  const [imageTemplateId, setImageTemplateId] = useState<string | null>(task.imageDefaultTemplateId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    Promise.all([
      api.get<{ directions: Array<{ id: string; label: string; content: string }>; draftSelectedDirectionId: string | null }>(`/tasks/${task.id}`),
      api.get<OutputPreset[]>("/settings/presets"),
      api.get<PromptTemplate[]>("/settings/prompt-templates?type=image_generation"),
    ]).then(([taskData, ps, templateRows]) => {
      setPresets(ps);
      setImageTemplates(templateRows);
      setImageTemplateId(task.imageDefaultTemplateId ?? templateRows.find((row) => row.isDefault)?.id ?? null);
      const dirs = taskData.directions;
      if (dirs.length > 0) {
        const selectedDir = dirs.find((dir) => dir.id === taskData.draftSelectedDirectionId) ?? dirs[0]!;
        setSelectedDirId(selectedDir.id);
        const content = parseDirection(selectedDir.content);
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
          imageTemplateId,
          items: items.map((it) => ({
            listType: it.listType,
            title: it.title,
            description: it.description || undefined,
            sellingPoints: normalizeStringArray(it.sellingPoints),
            suggestedCopy: it.suggestedCopy || undefined,
            compositionIntent: it.compositionIntent || undefined,
            lighting: it.lighting || undefined,
            angle: it.angle || undefined,
            background: it.background || undefined,
            mood: it.mood || undefined,
            visualElements: it.visualElements || undefined,
            productAssetId: it.productAssetId ?? undefined,
            promptTemplateId: it.promptTemplateId ?? null,
            presetId: it.presetId || presets[0]?.id || "",
          })),
        }
      );
      toast.success(`方案已确认，共 ${res.items.length} 张图片`);
      setConfirmOpen(false);
      onNext();
    } catch (error) {
      toast.error(error instanceof Error ? `确认失败：${error.message}` : "确认失败，请重试");
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
          <select
            className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs"
            value={imageTemplateId ?? ""}
            onChange={(e) => setImageTemplateId(e.target.value || null)}
            title="所有图片默认继承此模板"
          >
            {imageTemplates.map((template) => <option key={template.id} value={template.id}>默认：{template.name}</option>)}
          </select>
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
                promptTemplates={imageTemplates}
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
// Step 4 — generation grid + per-item polling + retry + streaming timers
// ---------------------------------------------------------------------------

function Step4({ task }: { task: GenerationTask }) {
  const [planVersionId, setPlanVersionId] = useState<string | null>(null);
  const [selectedDirection, setSelectedDirection] = useState<DesignDirection | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
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

  // Streaming state
  const [streamPreviews, setStreamPreviews] = useState<Record<string, string>>({});
  const [streamingIds, setStreamingIds] = useState<Set<string>>(new Set());
  const streamSourcesRef = useRef<Record<string, AbortController>>({});

  // Per-image generation timers
  const [streamStartTimes, setStreamStartTimes] = useState<Record<string, number>>({});
  const [streamElapsedMs, setStreamElapsedMs] = useState<Record<string, number>>({});
  const [streamFinalMs, setStreamFinalMs] = useState<Record<string, number>>({});
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Per-image params expand state
  const [expandedParams, setExpandedParams] = useState<Set<string>>(new Set());
  const [imageTemplates, setImageTemplates] = useState<PromptTemplate[]>([]);
  const [promptTarget, setPromptTarget] = useState<{ item: ImageItem; version?: ImageVersion; regenerate: boolean } | null>(null);
  const [promptRender, setPromptRender] = useState<PromptRender | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [promptTemplateId, setPromptTemplateId] = useState<string | null>(null);
  const [promptInstruction, setPromptInstruction] = useState("");
  const [promptProposal, setPromptProposal] = useState<string | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);

  // Tick all active streaming timers
  useEffect(() => {
    streamTimerRef.current = setInterval(() => {
      setStreamElapsedMs(prev => {
        const now = Date.now();
        const next: Record<string, number> = { ...prev };
        for (const id of Object.keys(streamStartTimes)) {
          if (streamingIds.has(id)) next[id] = now - (streamStartTimes[id] ?? now);
        }
        return next;
      });
    }, 200);
    return () => { if (streamTimerRef.current) clearInterval(streamTimerRef.current); };
  }, [streamStartTimes, streamingIds]);

  useEffect(() => {
    api.get<{
      planVersions: Array<{ id: string; selectedDirectionId: string }>;
      directions: DesignDirection[];
    }>(`/tasks/${task.id}`)
      .then((data) => {
        const latest = data.planVersions[0];
        if (latest) {
          setPlanVersionId(latest.id);
          const dir = data.directions.find(d => d.id === latest.selectedDirectionId);
          if (dir) setSelectedDirection(dir);
        }
      })
      .catch(() => toast.error("加载方案数据失败"));
  }, [task.id]);

  useEffect(() => {
    api.get<PromptTemplate[]>("/settings/prompt-templates?type=image_generation")
      .then(setImageTemplates)
      .catch(() => toast.error("加载图片 Prompt 模板失败"));
  }, []);

  useEffect(() => {
    if (!planVersionId) return;
    api.get<ImageItem[]>(`/tasks/${task.id}/plan/${planVersionId}/items`)
      .then(setItems)
      .catch(() => toast.error("加载图片清单失败"));
  }, [task.id, planVersionId]);

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

  const pollJobs = useCallback(async (itemList: ImageItem[]) => {
    const allJobs = await api.get<Job[]>(`/jobs?entityType=image_item`).catch(() => [] as Job[]);
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

  useEffect(() => () => {
    stopPolling();
    Object.values(streamSourcesRef.current).forEach((s) => s.abort());
  }, []);

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

  async function handleSelectVersion(itemId: string, versionId: string) {
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
    if (!pollRef.current) pollRef.current = setInterval(() => pollJobs(items), 3500);
  }

  function startStream(itemId: string, options: {
    templateId?: string | null;
    editablePrompt?: string;
    polishInstruction?: string | null;
  } = {}) {
    if (streamSourcesRef.current[itemId]) {
      streamSourcesRef.current[itemId]!.abort();
      delete streamSourcesRef.current[itemId];
    }

    const now = Date.now();
    setStreamingIds((prev) => new Set([...prev, itemId]));
    setStreamPreviews((prev) => ({ ...prev, [itemId]: "" }));
    setStreamStartTimes((prev) => ({ ...prev, [itemId]: now }));
    setStreamElapsedMs((prev) => ({ ...prev, [itemId]: 0 }));

    const controller = new AbortController();
    streamSourcesRef.current[itemId] = controller;
    void api.postSSE<{
        type: "progress" | "done" | "error";
        b64?: string;
        versionId?: string;
        message?: string;
      }>(`/tasks/items/${itemId}/generate-stream`, options, (payload) => {
      if (payload.type === "progress" && payload.b64) {
        setStreamPreviews((prev) => ({ ...prev, [itemId]: payload.b64! }));
      } else if (payload.type === "done") {
        delete streamSourcesRef.current[itemId];
        const elapsed = Date.now() - (streamStartTimes[itemId] ?? Date.now());
        setStreamFinalMs(prev => ({ ...prev, [itemId]: elapsed }));
        setStreamingIds((prev) => { const next = new Set(prev); next.delete(itemId); return next; });
        setStreamPreviews((prev) => { const next = { ...prev }; delete next[itemId]; return next; });
        loadVersions(items).catch(() => {});
      } else if (payload.type === "error") {
        delete streamSourcesRef.current[itemId];
        setStreamingIds((prev) => { const next = new Set(prev); next.delete(itemId); return next; });
        setStreamPreviews((prev) => { const next = { ...prev }; delete next[itemId]; return next; });
        toast.error(payload.message ?? "生成失败");
      }
    }, controller.signal).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      delete streamSourcesRef.current[itemId];
      setStreamingIds((prev) => { const next = new Set(prev); next.delete(itemId); return next; });
      setStreamPreviews((prev) => { const next = { ...prev }; delete next[itemId]; return next; });
      toast.error(error instanceof Error ? error.message : "连接中断，请重试");
    });
  }

  async function openPromptPanel(item: ImageItem, version: ImageVersion | undefined, regenerate: boolean) {
    setPromptTarget({ item, ...(version ? { version } : {}), regenerate });
    setPromptInstruction("");
    setPromptProposal(null);
    if (!regenerate) return;
    setPromptBusy(true);
    try {
      const rendered = await api.post<PromptRender>("/prompts/render", {
        type: "image_generation",
        imageItemId: item.id,
      });
      setPromptRender(rendered);
      setPromptDraft(rendered.editablePrompt);
      setPromptTemplateId(rendered.templateId);
    } catch {
      toast.error("Prompt 渲染失败");
      setPromptTarget(null);
    } finally {
      setPromptBusy(false);
    }
  }

  async function switchPromptTemplate(templateId: string) {
    if (!promptTarget) return;
    setPromptTemplateId(templateId);
    setPromptBusy(true);
    try {
      const rendered = await api.post<PromptRender>("/prompts/render", {
        type: "image_generation",
        imageItemId: promptTarget.item.id,
        templateId,
      });
      setPromptRender(rendered);
      setPromptDraft(rendered.editablePrompt);
      setPromptProposal(null);
    } catch {
      toast.error("切换模板失败");
    } finally {
      setPromptBusy(false);
    }
  }

  async function polishImagePrompt() {
    if (!promptInstruction.trim()) return;
    setPromptBusy(true);
    try {
      const result = await api.post<{ proposal: string }>("/prompts/polish", {
        type: "image_generation",
        editablePrompt: promptDraft,
        instruction: promptInstruction,
      });
      setPromptProposal(result.proposal);
    } catch {
      toast.error("Prompt 润色失败");
    } finally {
      setPromptBusy(false);
    }
  }

  function confirmRegeneration() {
    if (!promptTarget) return;
    startStream(promptTarget.item.id, {
      templateId: promptTemplateId,
      editablePrompt: promptProposal ?? promptDraft,
      polishInstruction: promptProposal ? promptInstruction : null,
    });
    setPromptTarget(null);
  }

  async function savePromptAsTemplate() {
    if (!promptRender) return;
    const name = window.prompt("自定义模板名称");
    if (!name?.trim()) return;
    try {
      const parameterized = await api.post<{ parameterizedBody: string }>("/prompts/parameterize", {
        type: "image_generation",
        text: promptProposal ?? promptDraft,
        contextVariables: promptRender.contextVariables,
      });
      const created = await api.post<PromptTemplate>("/settings/prompt-templates", {
        type: "image_generation",
        name: name.trim(),
        description: "从单图生成 Prompt 另存",
        body: parameterized.parameterizedBody,
      });
      setImageTemplates((current) => [...current, created]);
      setPromptTemplateId(created.id);
      toast.success("已另存为自定义模板");
    } catch {
      toast.error("另存模板失败，请检查变量还原结果");
    }
  }

  const anyGenerated = Object.values(versions).some(vs => vs.length > 0);
  const allDone = items.length > 0 && items.every(it => (versions[it.id]?.length ?? 0) > 0);

  function toggleParamsExpand(itemId: string) {
    setExpandedParams(prev => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  }

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

      {/* ── 设计方向配置摘要（折叠） ─────────────────────────── */}
      {selectedDirection && (() => {
        const dc = parseDirection(selectedDirection.content);
        return (
          <div className="mb-5 rounded-lg border border-zinc-100">
            <button
              onClick={() => setConfigOpen(v => !v)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs"
            >
              <div className="flex items-center gap-2 text-zinc-500">
                <Info size={12} className="shrink-0" />
                <span className="font-medium text-zinc-700">
                  采用方向：{dc.label ?? selectedDirection.label}
                </span>
                {dc.positioning && (
                  <span className="hidden truncate text-zinc-400 sm:inline max-w-[360px]">
                    — {dc.positioning}
                  </span>
                )}
              </div>
              <ChevronDown
                size={13}
                className={`shrink-0 text-zinc-400 transition-transform ${configOpen ? "rotate-180" : ""}`}
              />
            </button>
            {configOpen && (
              <div className="border-t border-zinc-100 px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                {[
                  { label: "定位", value: dc.positioning },
                  { label: "配色", value: dc.colorScheme },
                  { label: "版式", value: dc.layoutIntent },
                  { label: "文案策略", value: dc.copyStrategy },
                ].map(({ label, value }) =>
                  value ? (
                    <div key={label}>
                      <span className="font-medium text-zinc-500">{label}</span>
                      <p className="mt-0.5 text-zinc-700">{value}</p>
                    </div>
                  ) : null
                )}
              </div>
            )}
          </div>
        );
      })()}

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
            const isStreaming   = streamingIds.has(item.id);
            const streamPreview = streamPreviews[item.id];
            const elapsed = streamElapsedMs[item.id] ?? 0;
            const finalMs = streamFinalMs[item.id];
            const isLoading    = !isStreaming && (job?.status === "queued" || job?.status === "running");
            const isFailed     = !isStreaming && (job?.status === "failed"  || job?.status === "interrupted");
            const isInpainting = job?.type === "image_edit" && isLoading;

            return (
              <div key={item.id} className="flex flex-col overflow-hidden rounded-xl border border-zinc-100 bg-white">
                <div className="group relative aspect-square w-full overflow-hidden bg-zinc-50">
                  {isStreaming ? (
                    <>
                      {streamPreview ? (
                        <img
                          src={`data:image/jpeg;base64,${streamPreview}`}
                          alt={item.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-400">
                          <Loader2 size={22} className="animate-spin" />
                        </div>
                      )}
                      <div className="absolute inset-0 flex items-end justify-center pb-3 pointer-events-none">
                        <div className="flex items-center gap-1.5 rounded-full bg-zinc-900/80 px-3 py-1.5 text-xs text-white shadow-lg">
                          <Loader2 size={11} className="animate-spin" />
                          渲染中… {fmtElapsed(elapsed)}
                        </div>
                      </div>
                    </>
                  ) : selected && selected.filePath ? (
                    <>
                      <img
                        src={`/api/products/assets/file?path=${encodeURIComponent(selected.filePath)}`}
                        alt={item.title}
                        className={`h-full w-full object-cover transition-opacity ${isInpainting ? "opacity-50" : ""}`}
                      />
                      {isInpainting && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="flex items-center gap-1.5 rounded-full bg-zinc-900/85 px-3 py-1.5 text-xs text-white shadow-lg">
                            <Loader2 size={12} className="animate-spin" /> 微调中…
                          </div>
                        </div>
                      )}
                      <div className="absolute right-2 top-2 flex gap-1">
                        <button
                          onClick={() => openPromptPanel(item, selected, true)}
                          className="rounded bg-white/80 p-1 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
                          title="重新生成"
                        >
                          <RefreshCw size={13} className="text-zinc-500" />
                        </button>
                        <button
                          onClick={() => openPromptPanel(item, selected, false)}
                          className="rounded bg-white/80 p-1 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
                          title="查看完整 Prompt"
                        >
                          <FileText size={13} className="text-zinc-500" />
                        </button>
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
                    <div className="flex h-full items-center justify-center text-xs text-zinc-300">待生成</div>
                  )}
                </div>

                <div className="flex items-start justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-zinc-900">{item.title}</p>
                    <p className="text-xs text-zinc-400">
                      {item.listType === "main_image" ? "主图" : "详情页"}
                      {finalMs != null && !isStreaming && (
                        <span className="ml-1.5 text-zinc-300">· {fmtElapsed(finalMs)}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {isFailed && !isStreaming && (
                      <button
                        onClick={() => openPromptPanel(item, selected, true)}
                        className="flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50"
                        title={job?.errorMessage ?? "重试"}
                      >
                        <RefreshCw size={11} /> 重试
                      </button>
                    )}
                    {selected && itemVersions.length > 1 && !isStreaming && (
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

                {/* Expandable generation params */}
                <div className="border-t border-zinc-50">
                  <button
                    onClick={() => toggleParamsExpand(item.id)}
                    className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
                  >
                    <ChevronDown
                      size={11}
                      className={`shrink-0 transition-transform ${expandedParams.has(item.id) ? "rotate-180" : ""}`}
                    />
                    生成参数
                  </button>
                  {expandedParams.has(item.id) && (
                    <div className="border-t border-zinc-50 px-3 pb-3 space-y-1.5 text-[11px]">
                      {[
                        { label: "内容描述", value: item.description },
                        { label: "构图意图", value: item.compositionIntent },
                        { label: "光照", value: (item as unknown as Record<string, string>)["lighting"] },
                        { label: "视角", value: (item as unknown as Record<string, string>)["angle"] },
                        { label: "背景", value: (item as unknown as Record<string, string>)["background"] },
                        { label: "氛围", value: (item as unknown as Record<string, string>)["mood"] },
                        { label: "视觉元素", value: (item as unknown as Record<string, string>)["visualElements"] },
                        { label: "主标题文案", value: item.suggestedCopy },
                      ].map(({ label, value }) =>
                        value ? (
                          <div key={label}>
                            <span className="font-medium text-zinc-400">{label}</span>
                            <p className="text-zinc-600 leading-relaxed">{value}</p>
                          </div>
                        ) : null
                      )}
                      {item.sellingPoints && (() => {
                        const pts: string[] = typeof item.sellingPoints === "string"
                          ? JSON.parse(item.sellingPoints)
                          : item.sellingPoints;
                        return pts.length > 0 ? (
                          <div>
                            <span className="font-medium text-zinc-400">卖点</span>
                            <p className="text-zinc-600">{pts.join("、")}</p>
                          </div>
                        ) : null;
                      })()}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

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
      <Sheet
        open={Boolean(promptTarget)}
        onOpenChange={(open) => { if (!open) setPromptTarget(null); }}
        title={promptTarget?.regenerate ? `重新生成：${promptTarget.item.title}` : `版本 Prompt：${promptTarget?.item.title ?? ""}`}
        className="w-[640px]"
      >
        {promptTarget && (
          <div className="flex h-full flex-col gap-4 p-5">
            {promptTarget.regenerate ? (
              <>
                <div>
                  <Label>本次模板</Label>
                  <select className="mt-1 h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm"
                    value={promptTemplateId ?? ""} onChange={(e) => switchPromptTemplate(e.target.value)}>
                    {imageTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                  </select>
                </div>
                <div className="min-h-0 flex-1">
                  <Label>可编辑正文</Label>
                  <Textarea rows={15} className="mt-1 h-[320px] font-mono text-xs"
                    value={promptProposal ?? promptDraft} onChange={(e) => {
                      setPromptProposal(null);
                      setPromptDraft(e.target.value);
                    }} />
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <p className="mb-1 text-xs font-medium text-zinc-500">固定真实性与尺寸契约（不可编辑）</p>
                  <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-500">{promptRender?.lockedSuffix}</pre>
                </div>
                <div className="flex gap-2">
                  <Input value={promptInstruction} onChange={(e) => setPromptInstruction(e.target.value)} maxLength={1000} placeholder="输入 AI 润色意见" />
                  <Button variant="outline" onClick={polishImagePrompt} disabled={promptBusy || !promptInstruction.trim()}><Sparkles size={13} /> 预览润色</Button>
                </div>
                {promptProposal && <p className="text-xs text-amber-700">当前显示 AI 提案；取消提案不会影响原 Prompt。</p>}
                <div className="mt-auto flex justify-between">
                  <Button variant="outline" onClick={savePromptAsTemplate}><Copy size={13} /> 另存模板</Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setPromptTarget(null)}>取消</Button>
                    <Button onClick={confirmRegeneration} disabled={promptBusy}>确认并重新生成</Button>
                  </div>
                </div>
              </>
            ) : (() => {
              const version = promptTarget.version;
              const parent = version?.parentVersionId
                ? (versions[promptTarget.item.id] ?? []).find((candidate) => candidate.id === version.parentVersionId)
                : undefined;
              const prompt = version?.finalPrompt;
              return (
                <>
                  {version?.generationType === "inpaint" && (
                    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
                      <p className="font-medium">局部微调指令</p>
                      <p className="mt-1">{version.instruction || "未记录"}</p>
                      {parent && <p className="mt-2 text-xs text-blue-700">父版本 Prompt 可追溯：{parent.finalPrompt ? "已记录" : "历史版本未恢复"}</p>}
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <Label>当次完整 Prompt</Label>
                    {prompt && <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(prompt)}><Copy size={12} /> 复制</Button>}
                  </div>
                  {prompt ? (
                    <pre className="flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs leading-relaxed text-zinc-700">{prompt}</pre>
                  ) : (
                    <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-sm text-zinc-500">
                      此历史流式版本无法从模型日志精确恢复 Prompt，未使用当前上下文推测重建。
                    </div>
                  )}
                  {version?.polishInstruction && <p className="text-xs text-zinc-500">润色意见：{version.polishInstruction}</p>}
                </>
              );
            })()}
          </div>
        )}
      </Sheet>
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}

// Helper — also used by Step2
function parseDirection(json: string): DirectionContent {
  try { return JSON.parse(json) as DirectionContent; } catch { return {}; }
}

// ---------------------------------------------------------------------------
// Export toolbar
// ---------------------------------------------------------------------------

function ExportToolbar({
  taskId, planVersionId, items,
}: { taskId: string; planVersionId: string; items: ImageItem[] }) {
  const hasDetailPages = items.some((it) => it.listType === "detail_page");
  const zipUrl    = `/api/tasks/${taskId}/export/zip?planVersionId=${planVersionId}`;
  const stitchUrl = `/api/tasks/${taskId}/export/stitch?planVersionId=${planVersionId}`;
  return (
    <div className="mt-6 flex items-center gap-3 rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3">
      <p className="text-sm font-medium text-zinc-700">导出</p>
      <div className="ml-auto flex gap-2">
        <a href={zipUrl} download="images-export.zip"
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50">
          <Download size={13} /> 打包下载 (ZIP)
        </a>
        {hasDetailPages && (
          <a href={stitchUrl} download="detail-stitch.jpg"
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50">
            <Rows2 size={13} /> 拼接详情页
          </a>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SortableItemRow
// ---------------------------------------------------------------------------

function SortableItemRow({
  id, item, index, presets, promptTemplates, onChange, onRemove,
}: {
  id: string; item: DraftItem; index: number; presets: OutputPreset[];
  promptTemplates: PromptTemplate[];
  onChange: (patch: Partial<DraftItem>) => void; onRemove: () => void;
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
        <Input className="flex-1 h-7 text-xs" placeholder={`图片标题 ${index + 1}`}
          value={item.title} onChange={(e) => onChange({ title: e.target.value })} />
        <button onClick={() => setExpanded(v => !v)} className="text-xs text-zinc-400 hover:text-zinc-700 px-1">
          {expanded ? "收起" : "展开"}
        </button>
        <button onClick={onRemove} className="text-zinc-300 hover:text-red-500"><X size={14} /></button>
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
              <Label className="text-xs text-zinc-500">图片 Prompt 模板</Label>
              <select className="h-7 rounded-md border border-zinc-200 bg-white px-2 text-xs"
                value={item.promptTemplateId ?? ""} onChange={(e) => onChange({ promptTemplateId: e.target.value || null })}>
                <option value="">继承批量默认</option>
                {promptTemplates.map((template) => <option key={template.id} value={template.id}>覆盖：{template.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-zinc-500">主标题文案</Label>
              <Input className="h-7 text-xs" value={item.suggestedCopy ?? ""} onChange={(e) => onChange({ suggestedCopy: e.target.value })} placeholder="建议主标题" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-zinc-500">输出预设</Label>
              <select className="h-7 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-900 focus:outline-none"
                value={item.presetId ?? ""} onChange={(e) => onChange({ presetId: e.target.value })}>
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

// ---------------------------------------------------------------------------
// Step 1 — config: user ideas, plan count, image counts
// ---------------------------------------------------------------------------

function Step1({
  task,
  config,
  setConfig,
  onNext,
}: {
  task: GenerationTask;
  config: Step1Config;
  setConfig: (c: Step1Config) => void;
  onNext: () => void;
}) {
  const outputTypes: string[] = JSON.parse(task.outputTypes);
  const hasMain   = outputTypes.includes("main_image");
  const hasDetail = outputTypes.includes("detail_page");
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptRender, setPromptRender] = useState<PromptRender | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [polishInstruction, setPolishInstruction] = useState("");
  const [polishProposal, setPolishProposal] = useState<string | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);

  useEffect(() => {
    api.get<PromptTemplate[]>("/settings/prompt-templates?type=design_plan")
      .then((rows) => {
        setTemplates(rows);
        if (!config.planTemplateId) {
          setConfig({ ...config, planTemplateId: task.planDefaultTemplateId ?? rows.find((row) => row.isDefault)?.id ?? null });
        }
      })
      .catch(() => toast.error("加载方案 Prompt 模板失败"));
  }, [task.planDefaultTemplateId, config.planTemplateId]);

  async function loadPrompt(templateId = config.planTemplateId) {
    setPromptBusy(true);
    try {
      const rendered = await api.post<PromptRender>("/prompts/render", {
        type: "design_plan",
        taskId: task.id,
        templateId,
        options: {
          userIdeas: config.userIdeas,
          planCount: config.planCount,
          mainImageCount: hasMain ? config.mainImageCount : 0,
          detailImageCount: hasDetail ? config.detailImageCount : 0,
        },
      });
      setPromptRender(rendered);
      setPromptDraft(rendered.editablePrompt);
      setPolishProposal(null);
    } catch {
      toast.error("Prompt 渲染失败");
    } finally {
      setPromptBusy(false);
    }
  }

  async function openPrompt() {
    setPromptOpen(true);
    await loadPrompt();
  }

  async function polishPrompt() {
    if (!polishInstruction.trim()) return;
    setPromptBusy(true);
    try {
      const result = await api.post<{ proposal: string }>("/prompts/polish", {
        type: "design_plan",
        editablePrompt: promptDraft,
        instruction: polishInstruction,
      });
      setPolishProposal(result.proposal);
    } catch {
      toast.error("Prompt 润色失败");
    } finally {
      setPromptBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-8 py-10">
      <h2 className="mb-6 text-base font-medium text-zinc-900">任务配置确认</h2>

      <div className="flex flex-col gap-5 rounded-lg border border-zinc-100 p-5 text-sm">
        {/* Output types */}
        <div className="flex gap-3">
          <span className="w-28 shrink-0 text-zinc-400">输出类型</span>
          <span className="text-zinc-900">
            {outputTypes.map(t => t === "main_image" ? "主图" : "详情页").join(" + ")}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-zinc-400">方案 Prompt</span>
          <select
            className="h-8 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-sm"
            value={config.planTemplateId ?? ""}
            onChange={(e) => setConfig({ ...config, planTemplateId: e.target.value || null, planEditablePrompt: undefined })}
          >
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={openPrompt}><FileText size={13} /> 查看与编辑</Button>
        </div>

        {/* Image counts */}
        {hasMain && (
          <div className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-zinc-400">主图数量</span>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                step={1}
                className="h-8 w-24"
                value={config.mainImageCount}
                onChange={(event) => {
                  const count = Math.floor(Number(event.target.value));
                  if (Number.isFinite(count) && count >= 1) setConfig({ ...config, mainImageCount: count });
                }}
              />
              <span className="text-xs text-zinc-400">张</span>
            </div>
          </div>
        )}
        {hasDetail && (
          <div className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-zinc-400">详情页数量</span>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                step={1}
                className="h-8 w-24"
                value={config.detailImageCount}
                onChange={(event) => {
                  const count = Math.floor(Number(event.target.value));
                  if (Number.isFinite(count) && count >= 1) setConfig({ ...config, detailImageCount: count });
                }}
              />
              <span className="text-xs text-zinc-400">张</span>
            </div>
          </div>
        )}

        {/* Plan count */}
        <div className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-zinc-400">方案数量</span>
          <div className="flex items-center gap-2">
            {[2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setConfig({ ...config, planCount: n })}
                className={`flex h-7 w-7 items-center justify-center rounded-md text-sm transition-colors ${
                  config.planCount === n
                    ? "bg-zinc-900 text-white"
                    : "border border-zinc-200 text-zinc-600 hover:border-zinc-400"
                }`}
              >
                {n}
              </button>
            ))}
            <span className="text-xs text-zinc-400">个设计方向</span>
          </div>
        </div>

        {/* User ideas */}
        <div className="flex flex-col gap-1.5">
          <span className="text-zinc-400">
            创意方向参考
            <span className="ml-1 text-xs font-normal">（选填，AI 将优先参考）</span>
          </span>
          <Textarea
            rows={3}
            placeholder="例如：想要高端简约的风格，主色调用深蓝色，突出产品质感…"
            value={config.userIdeas}
            onChange={(e) => setConfig({ ...config, userIdeas: e.target.value })}
            className="text-sm"
          />
        </div>

        {/* Competitor analysis note */}
        <div className="flex gap-3">
          <span className="w-28 shrink-0 text-zinc-400">竞品分析</span>
          <span className="text-zinc-500">已关联，AI 将基于竞品洞察生成差异化方向</span>
        </div>
      </div>

      <div className="mt-8 flex justify-end">
        <Button onClick={onNext}>
          <Zap size={14} /> 生成设计方向
        </Button>
      </div>

      <Sheet open={promptOpen} onOpenChange={setPromptOpen} title="方案生成 Prompt" className="w-[620px]">
        <div className="flex h-full flex-col gap-4 p-5">
          {promptBusy && !promptRender ? <Loader2 className="animate-spin text-zinc-400" size={18} /> : (
            <>
              <div>
                <Label>可编辑正文</Label>
                <Textarea rows={16} value={polishProposal ?? promptDraft} onChange={(e) => {
                  setPolishProposal(null);
                  setPromptDraft(e.target.value);
                }} className="mt-1 font-mono text-xs" />
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="mb-1 text-xs font-medium text-zinc-500">固定输出契约（不可编辑）</p>
                <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-500">{promptRender?.lockedSuffix}</pre>
              </div>
              <div className="flex gap-2">
                <Input value={polishInstruction} onChange={(e) => setPolishInstruction(e.target.value)} placeholder="输入意见，让 AI 提出润色版本" maxLength={1000} />
                <Button variant="outline" onClick={polishPrompt} disabled={promptBusy || !polishInstruction.trim()}><Sparkles size={13} /> 润色</Button>
              </div>
              {polishProposal && <p className="text-xs text-amber-700">正在预览 AI 提案；取消可恢复当前正文，应用后才用于生成。</p>}
              <div className="mt-auto flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setPolishProposal(null); setPromptOpen(false); }}>取消</Button>
                <Button onClick={() => {
                  setConfig({ ...config, planEditablePrompt: polishProposal ?? promptDraft });
                  setPromptDraft(polishProposal ?? promptDraft);
                  setPolishProposal(null);
                  setPromptOpen(false);
                  toast.success("本次方案 Prompt 已应用");
                }}>应用本次</Button>
              </div>
            </>
          )}
        </div>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskWizard root
// ---------------------------------------------------------------------------

export function TaskWizard() {
  const { taskId, step } = useParams<{ taskId: string; step: string }>();
  const navigate = useNavigate();
  const currentStep = Math.max(1, Math.min(4, Number(step ?? 1)));

  const [task, setTask] = useState<GenerationTask | null>(null);
  const [loading, setLoading] = useState(true);

  // Config collected in Step 1, passed to Step 2 for SSE query params
  const [step1Config, setStep1Config] = useState<Step1Config>({
    userIdeas: "",
    planCount: 3,
    mainImageCount: 3,
    detailImageCount: 3,
    planTemplateId: null,
    generateRequested: false,
  });

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
        {currentStep === 1 && (
          <Step1
            task={task}
            config={step1Config}
            setConfig={setStep1Config}
            onNext={() => {
              setStep1Config((current) => ({ ...current, generateRequested: true }));
              goStep(2);
            }}
          />
        )}
        {currentStep === 2 && (
          <Step2
            task={task}
            config={step1Config}
            onGenerationRequestConsumed={() => {
              setStep1Config((current) => current.generateRequested
                ? { ...current, generateRequested: false }
                : current);
            }}
            onNext={() => goStep(3)}
          />
        )}
        {currentStep === 3 && <Step3 task={task} onNext={() => goStep(4)} />}
        {currentStep === 4 && <Step4 task={task} />}
      </div>
    </div>
  );
}
