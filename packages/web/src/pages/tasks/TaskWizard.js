import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate, NavLink } from "react-router-dom";
import { Loader2, ChevronRight, Check, Plus, X, GripVertical, RefreshCw, ZoomIn, AlertCircle, Zap, Pencil, Download, Rows2, } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove, } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, } from "@/components/ui/dialog";
import { InpaintEditor } from "./InpaintEditor";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STEPS = [
    { n: 1, label: "选择配置" },
    { n: 2, label: "设计方向" },
    { n: 3, label: "编辑方案" },
    { n: 4, label: "生成与导出" },
];
// ---------------------------------------------------------------------------
// Step 2 — poll for directions, display cards, user selects one
// ---------------------------------------------------------------------------
function Step2({ task, onNext }) {
    const [directions, setDirections] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState(null);
    const [saving, setSaving] = useState(false);
    const pollRef = useRef(null);
    const loadDirections = useCallback(async () => {
        const data = await api.get(`/tasks/${task.id}`);
        if (data.directions.length > 0) {
            setDirections(data.directions);
            setLoading(false);
            stopPolling();
        }
    }, [task.id]);
    function stopPolling() {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }
    useEffect(() => {
        loadDirections().catch(() => { });
        pollRef.current = setInterval(() => loadDirections().catch(() => { }), 3000);
        return () => stopPolling();
    }, [loadDirections]);
    async function handleNext() {
        if (!selectedId)
            return;
        setSaving(true);
        try {
            await api.patch(`/tasks/${task.id}/direction`, { directionId: selectedId });
            onNext();
        }
        catch {
            toast.error("保存失败，请重试");
            setSaving(false);
        }
    }
    if (loading) {
        return (_jsxs("div", { className: "flex flex-col items-center gap-4 py-24 text-zinc-400", children: [_jsx(Loader2, { size: 28, className: "animate-spin" }), _jsx("p", { className: "text-sm", children: "AI \u6B63\u5728\u751F\u6210\u8BBE\u8BA1\u65B9\u5411\uFF0C\u901A\u5E38\u9700\u898130-60\u79D2\u2026" })] }));
    }
    return (_jsxs("div", { className: "px-8 py-6", children: [_jsxs("div", { className: "mb-5 flex items-center justify-between", children: [_jsx("h2", { className: "text-sm font-medium text-zinc-900", children: "\u9009\u62E9\u8BBE\u8BA1\u65B9\u5411" }), _jsx(Button, { size: "sm", onClick: handleNext, disabled: !selectedId || saving, children: saving ? _jsxs(_Fragment, { children: [_jsx(Loader2, { size: 13, className: "animate-spin" }), " \u4FDD\u5B58\u4E2D"] }) : _jsxs(_Fragment, { children: ["\u7F16\u8F91\u65B9\u6848 ", _jsx(ChevronRight, { size: 13 })] }) })] }), _jsx("div", { className: "grid grid-cols-3 gap-4", children: directions.map((dir) => {
                    const content = parseDirection(dir.content);
                    const isSelected = selectedId === dir.id;
                    return (_jsxs("button", { onClick: () => setSelectedId(dir.id), className: `flex flex-col rounded-xl border p-4 text-left transition-all ${isSelected ? "border-zinc-900 shadow-md ring-1 ring-zinc-900" : "border-zinc-100 hover:border-zinc-300"}`, children: [_jsxs("div", { className: "mb-3 flex items-start justify-between", children: [_jsx("span", { className: "text-sm font-semibold text-zinc-900", children: content.label ?? dir.label }), isSelected && (_jsx("span", { className: "flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900", children: _jsx(Check, { size: 10, className: "text-white" }) }))] }), _jsxs("div", { className: "flex flex-col gap-2 text-xs", children: [content.positioning && (_jsxs("div", { children: [_jsx("span", { className: "font-medium text-zinc-500", children: "\u5B9A\u4F4D" }), _jsx("p", { className: "mt-0.5 text-zinc-700 line-clamp-2", children: content.positioning })] })), content.colorScheme && (_jsxs("div", { children: [_jsx("span", { className: "font-medium text-zinc-500", children: "\u914D\u8272" }), _jsx("p", { className: "mt-0.5 text-zinc-700 line-clamp-2", children: content.colorScheme })] })), content.layoutIntent && (_jsxs("div", { children: [_jsx("span", { className: "font-medium text-zinc-500", children: "\u7248\u5F0F" }), _jsx("p", { className: "mt-0.5 text-zinc-700 line-clamp-2", children: content.layoutIntent })] })), content.imageList && (_jsxs("p", { className: "mt-1 text-zinc-400", children: [content.imageList.length, " \u5F20\u56FE\u7247"] }))] })] }, dir.id));
                }) })] }));
}
// ---------------------------------------------------------------------------
// Step 3 — editable image list, confirm dialog, create plan
// ---------------------------------------------------------------------------
function Step3({ task, onNext }) {
    const [items, setItems] = useState([]);
    const [presets, setPresets] = useState([]);
    const [loadingDir, setLoadingDir] = useState(true);
    const [selectedDirId, setSelectedDirId] = useState(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
    useEffect(() => {
        Promise.all([
            api.get(`/tasks/${task.id}`),
            api.get("/settings/presets"),
        ]).then(([taskData, ps]) => {
            setPresets(ps);
            const dirs = taskData.directions;
            if (dirs.length > 0) {
                const lastDir = dirs[dirs.length - 1];
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
    function handleDragEnd(event) {
        const { active, over } = event;
        if (!over || active.id === over.id)
            return;
        const oldIdx = items.findIndex((_, i) => String(i) === active.id);
        const newIdx = items.findIndex((_, i) => String(i) === over.id);
        setItems((prev) => arrayMove(prev, oldIdx, newIdx));
    }
    function updateItem(index, patch) {
        setItems((prev) => prev.map((it, i) => i === index ? { ...it, ...patch } : it));
    }
    function removeItem(index) {
        setItems((prev) => prev.filter((_, i) => i !== index));
    }
    function addItem(listType) {
        const defaultPreset = presets.find(p => listType === "main_image" ? p.presetType === "main_image" : p.presetType === "detail_module") ?? presets[0];
        setItems((prev) => [...prev, { listType, title: "", presetId: defaultPreset?.id ?? "" }]);
    }
    async function handleConfirm() {
        if (!selectedDirId)
            return;
        const invalid = items.some(it => !it.title.trim());
        if (invalid) {
            toast.error("所有图片项必须填写标题");
            return;
        }
        if (items.length === 0) {
            toast.error("至少需要一张图片");
            return;
        }
        setSubmitting(true);
        try {
            const res = await api.post(`/tasks/${task.id}/plan`, {
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
            });
            toast.success(`方案已确认，共 ${res.items.length} 张图片`);
            setConfirmOpen(false);
            // Store planVersionId for step4 via navigation state
            onNext();
        }
        catch {
            toast.error("确认失败，请重试");
        }
        finally {
            setSubmitting(false);
        }
    }
    if (loadingDir) {
        return (_jsxs("div", { className: "flex items-center justify-center py-24 text-zinc-400", children: [_jsx(Loader2, { size: 16, className: "animate-spin mr-2" }), " \u52A0\u8F7D\u65B9\u6848\u6570\u636E\u2026"] }));
    }
    const mainItems = items.filter(it => it.listType === "main_image");
    const detailItems = items.filter(it => it.listType === "detail_page");
    const itemIds = items.map((_, i) => String(i));
    return (_jsxs("div", { className: "px-8 py-6", children: [_jsxs("div", { className: "mb-5 flex items-center justify-between", children: [_jsxs("h2", { className: "text-sm font-medium text-zinc-900", children: ["\u7F16\u8F91\u56FE\u7247\u6E05\u5355\uFF08", items.length, " \u5F20\uFF09"] }), _jsxs("div", { className: "flex gap-2", children: [_jsxs(Button, { size: "sm", variant: "outline", onClick: () => addItem("main_image"), children: [_jsx(Plus, { size: 13 }), " \u4E3B\u56FE"] }), _jsxs(Button, { size: "sm", variant: "outline", onClick: () => addItem("detail_page"), children: [_jsx(Plus, { size: 13 }), " \u8BE6\u60C5\u9875"] }), _jsxs(Button, { size: "sm", onClick: () => setConfirmOpen(true), disabled: items.length === 0, children: ["\u786E\u8BA4\u65B9\u6848 ", _jsx(ChevronRight, { size: 13 })] })] })] }), _jsx(DndContext, { sensors: sensors, collisionDetection: closestCenter, onDragEnd: handleDragEnd, children: _jsx(SortableContext, { items: itemIds, strategy: verticalListSortingStrategy, children: _jsx("div", { className: "flex flex-col gap-2", children: items.map((item, index) => (_jsx(SortableItemRow, { id: String(index), item: item, index: index, presets: presets, onChange: (patch) => updateItem(index, patch), onRemove: () => removeItem(index) }, String(index)))) }) }) }), items.length === 0 && (_jsx("div", { className: "flex flex-col items-center gap-3 py-20 text-zinc-400", children: _jsx("p", { className: "text-sm", children: "\u6E05\u5355\u4E3A\u7A7A\uFF0C\u70B9\u51FB\u4E0A\u65B9\u6309\u94AE\u6DFB\u52A0\u56FE\u7247" }) })), _jsx(Dialog, { open: confirmOpen, onOpenChange: setConfirmOpen, children: _jsxs(DialogContent, { children: [_jsx(DialogHeader, { children: _jsx(DialogTitle, { children: "\u786E\u8BA4\u65B9\u6848" }) }), _jsxs("div", { className: "text-sm text-zinc-600 space-y-1", children: [_jsx("p", { children: "\u5373\u5C06\u9501\u5B9A\u4EE5\u4E0B\u56FE\u7247\u6E05\u5355\u5E76\u8FDB\u5165\u751F\u6210\u9636\u6BB5\uFF1A" }), mainItems.length > 0 && _jsxs("p", { children: ["\u00B7 \u4E3B\u56FE ", mainItems.length, " \u5F20"] }), detailItems.length > 0 && _jsxs("p", { children: ["\u00B7 \u8BE6\u60C5\u9875\u56FE ", detailItems.length, " \u5F20"] }), _jsx("p", { className: "mt-2 text-xs text-zinc-400", children: "\u786E\u8BA4\u540E\u56FE\u7247\u6E05\u5355\u4E0D\u53EF\u518D\u4FEE\u6539\uFF08\u53EF\u91CD\u65B0\u751F\u6210\uFF09\u3002" })] }), _jsxs(DialogFooter, { children: [_jsx(DialogClose, { render: _jsx(Button, { variant: "outline", type: "button", children: "\u53D6\u6D88" }) }), _jsx(Button, { onClick: handleConfirm, disabled: submitting, children: submitting ? _jsxs(_Fragment, { children: [_jsx(Loader2, { size: 14, className: "animate-spin" }), " \u63D0\u4EA4\u4E2D"] }) : "确认并生成" })] })] }) })] }));
}
// ---------------------------------------------------------------------------
// Step 4 — generation grid + per-item polling + retry
// ---------------------------------------------------------------------------
function Step4({ task }) {
    const [planVersionId, setPlanVersionId] = useState(null);
    const [items, setItems] = useState([]);
    const [jobs, setJobs] = useState({});
    const [versions, setVersions] = useState({});
    const [generating, setGenerating] = useState(false);
    const [lightboxSrc, setLightboxSrc] = useState(null);
    const [inpaintTarget, setInpaintTarget] = useState(null);
    const pollRef = useRef(null);
    // Load latest plan version for this task
    useEffect(() => {
        api.get(`/tasks/${task.id}`)
            .then((data) => {
            const latest = data.planVersions[0];
            if (latest)
                setPlanVersionId(latest.id);
        })
            .catch(() => toast.error("加载方案数据失败"));
    }, [task.id]);
    // Load items once planVersionId is known
    useEffect(() => {
        if (!planVersionId)
            return;
        api.get(`/tasks/${task.id}/plan/${planVersionId}/items`)
            .then(setItems)
            .catch(() => toast.error("加载图片清单失败"));
    }, [task.id, planVersionId]);
    // Load versions for all items
    const loadVersions = useCallback(async (itemList) => {
        const entries = await Promise.all(itemList.map(async (item) => {
            const vs = await api.get(`/tasks/items/${item.id}/versions`).catch(() => []);
            return [item.id, vs];
        }));
        setVersions(Object.fromEntries(entries));
    }, []);
    useEffect(() => {
        if (items.length > 0)
            loadVersions(items);
    }, [items, loadVersions]);
    // Poll jobs for all items
    const pollJobs = useCallback(async (itemList) => {
        const allJobs = await api.get(`/jobs?entityType=image_item`).catch(() => []);
        const itemIds = new Set(itemList.map(it => it.id));
        const relevant = allJobs.filter(j => j.entityId && itemIds.has(j.entityId));
        const byItem = {};
        for (const j of relevant) {
            if (j.entityId)
                byItem[j.entityId] = j;
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
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }
    useEffect(() => () => stopPolling(), []);
    async function handleGenerate() {
        if (!planVersionId || items.length === 0)
            return;
        setGenerating(true);
        try {
            await api.post(`/tasks/${task.id}/generate`, { planVersionId });
            toast.success(`已提交 ${items.length} 张图片生成任务`);
            stopPolling();
            pollRef.current = setInterval(() => pollJobs(items), 3500);
        }
        catch {
            toast.error("提交失败，请重试");
            setGenerating(false);
        }
    }
    async function handleRetry(itemId) {
        try {
            await api.post(`/tasks/items/${itemId}/retry`, {});
            toast.success("已重新提交");
            if (!pollRef.current) {
                pollRef.current = setInterval(() => pollJobs(items), 3500);
            }
        }
        catch {
            toast.error("重试失败");
        }
    }
    async function handleSelectVersion(itemId, versionId) {
        // Optimistic update first, then sync to server
        setVersions((prev) => ({
            ...prev,
            [itemId]: (prev[itemId] ?? []).map((v) => ({ ...v, isSelected: v.id === versionId })),
        }));
        try {
            await api.patch(`/tasks/items/${itemId}/versions/${versionId}/select`, {});
        }
        catch {
            toast.error("切换版本失败");
            loadVersions(items).catch(() => { });
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
    return (_jsxs("div", { className: "px-8 py-6", children: [_jsxs("div", { className: "mb-5 flex items-center justify-between", children: [_jsxs("h2", { className: "text-sm font-medium text-zinc-900", children: ["\u751F\u6210\u56FE\u7247", allDone ? " — 已完成" : ""] }), !allDone && (_jsx(Button, { size: "sm", onClick: handleGenerate, disabled: generating || items.length === 0, children: generating
                            ? _jsxs(_Fragment, { children: [_jsx(Loader2, { size: 13, className: "animate-spin" }), " \u751F\u6210\u4E2D\u2026"] })
                            : _jsxs(_Fragment, { children: [_jsx(Zap, { size: 13 }), " ", anyGenerated ? "重新全部生成" : "开始生成"] }) }))] }), items.length === 0 ? (_jsxs("div", { className: "flex items-center justify-center py-24 text-zinc-400", children: [_jsx(Loader2, { size: 16, className: "animate-spin mr-2" }), " \u52A0\u8F7D\u6E05\u5355\u2026"] })) : (_jsx("div", { className: "grid grid-cols-3 gap-4", children: items.map((item) => {
                    const job = jobs[item.id];
                    const itemVersions = versions[item.id] ?? [];
                    const selected = itemVersions.find(v => v.isSelected) ?? itemVersions[0];
                    const isLoading = job?.status === "queued" || job?.status === "running";
                    const isFailed = job?.status === "failed" || job?.status === "interrupted";
                    const isInpainting = job?.type === "image_edit" && isLoading;
                    return (_jsxs("div", { className: "flex flex-col overflow-hidden rounded-xl border border-zinc-100 bg-white", children: [_jsx("div", { className: "group relative aspect-square w-full overflow-hidden bg-zinc-50", children: selected && selected.filePath ? (_jsxs(_Fragment, { children: [_jsx("img", { src: `/api/products/assets/file?path=${encodeURIComponent(selected.filePath)}`, alt: item.title, className: `h-full w-full object-cover transition-opacity ${isInpainting ? "opacity-50" : ""}` }), isInpainting && (_jsx("div", { className: "absolute inset-0 flex items-center justify-center", children: _jsxs("div", { className: "flex items-center gap-1.5 rounded-full bg-zinc-900/85 px-3 py-1.5 text-xs text-white shadow-lg", children: [_jsx(Loader2, { size: 12, className: "animate-spin" }), "\u5FAE\u8C03\u4E2D\u2026"] }) })), _jsxs("div", { className: "absolute right-2 top-2 flex gap-1", children: [_jsx("button", { onClick: () => setInpaintTarget({ item, version: selected }), className: "rounded bg-white/80 p-1 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100", title: "\u5C40\u90E8\u5FAE\u8C03", children: _jsx(Pencil, { size: 13, className: "text-zinc-500" }) }), _jsx("button", { onClick: () => setLightboxSrc(`/api/products/assets/file?path=${encodeURIComponent(selected.filePath)}`), className: "rounded bg-white/80 p-1 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100", title: "\u653E\u5927\u67E5\u770B", children: _jsx(ZoomIn, { size: 13, className: "text-zinc-500" }) }), _jsx("a", { href: `/api/products/assets/file?path=${encodeURIComponent(selected.filePath)}`, download: `${item.title || "image"}.jpg`, className: "rounded bg-white/80 p-1 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100", title: "\u4E0B\u8F7D\u6B64\u56FE", onClick: (e) => e.stopPropagation(), children: _jsx(Download, { size: 13, className: "text-zinc-500" }) })] })] })) : isLoading ? (_jsxs("div", { className: "flex h-full flex-col items-center justify-center gap-2 text-zinc-400", children: [_jsx(Loader2, { size: 22, className: "animate-spin" }), _jsx("span", { className: "text-xs", children: job?.status === "queued" ? "排队中…" : "生成中…" })] })) : isFailed ? (_jsxs("div", { className: "flex h-full flex-col items-center justify-center gap-2 text-red-400", children: [_jsx(AlertCircle, { size: 22 }), _jsx("span", { className: "text-xs", children: "\u751F\u6210\u5931\u8D25" })] })) : (_jsx("div", { className: "flex h-full items-center justify-center text-xs text-zinc-300", children: "\u5F85\u751F\u6210" })) }), _jsxs("div", { className: "flex items-start justify-between gap-2 px-3 py-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-xs font-medium text-zinc-900", children: item.title }), _jsx("p", { className: "text-xs text-zinc-400", children: item.listType === "main_image" ? "主图" : "详情页" })] }), _jsxs("div", { className: "flex shrink-0 items-center gap-1", children: [isFailed && (_jsxs("button", { onClick: () => handleRetry(item.id), className: "flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50", title: job?.errorMessage ?? "重试", children: [_jsx(RefreshCw, { size: 11 }), " \u91CD\u8BD5"] })), selected && itemVersions.length > 1 && (_jsx("div", { className: "flex items-center gap-0.5", children: [...itemVersions].reverse().map((v, i) => (_jsxs("button", { title: v.generationType === "inpaint" ? `微调 v${i + 1}` : `生成 v${i + 1}`, onClick: () => handleSelectVersion(item.id, v.id), className: `rounded px-1 py-0.5 text-[10px] leading-none transition-colors ${v.isSelected
                                                        ? "bg-zinc-900 text-white"
                                                        : "border border-zinc-200 text-zinc-400 hover:border-zinc-400"}`, children: ["v", i + 1] }, v.id))) }))] })] })] }, item.id));
                }) })), allDone && planVersionId && (_jsx(ExportToolbar, { taskId: task.id, planVersionId: planVersionId, items: items })), inpaintTarget && (_jsx(InpaintEditor, { itemId: inpaintTarget.item.id, itemTitle: inpaintTarget.item.title, version: inpaintTarget.version, open: true, onClose: () => setInpaintTarget(null), onSubmitted: handleInpaintSubmitted })), _jsx(ImageLightbox, { src: lightboxSrc, onClose: () => setLightboxSrc(null) })] }));
}
// Helper — also used by Step2
function parseDirection(json) {
    try {
        return JSON.parse(json);
    }
    catch {
        return {};
    }
}
// ---------------------------------------------------------------------------
// Export toolbar — appears below Step 4 grid when all images are generated
// ---------------------------------------------------------------------------
function ExportToolbar({ taskId, planVersionId, items, }) {
    const hasDetailPages = items.some((it) => it.listType === "detail_page");
    const zipUrl = `/api/tasks/${taskId}/export/zip?planVersionId=${planVersionId}`;
    const stitchUrl = `/api/tasks/${taskId}/export/stitch?planVersionId=${planVersionId}`;
    return (_jsxs("div", { className: "mt-6 flex items-center gap-3 rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3", children: [_jsx("p", { className: "text-sm font-medium text-zinc-700", children: "\u5BFC\u51FA" }), _jsxs("div", { className: "ml-auto flex gap-2", children: [_jsxs("a", { href: zipUrl, download: "images-export.zip", className: "inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50", children: [_jsx(Download, { size: 13 }), " \u6253\u5305\u4E0B\u8F7D (ZIP)"] }), hasDetailPages && (_jsxs("a", { href: stitchUrl, download: "detail-stitch.jpg", className: "inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50", children: [_jsx(Rows2, { size: 13 }), " \u62FC\u63A5\u8BE6\u60C5\u9875"] }))] })] }));
}
function SortableItemRow({ id, item, index, presets, onChange, onRemove, }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
    const [expanded, setExpanded] = useState(false);
    return (_jsxs("div", { ref: setNodeRef, style: style, className: "rounded-lg border border-zinc-100 bg-white", children: [_jsxs("div", { className: "flex items-center gap-2 px-3 py-2", children: [_jsx("div", { ...listeners, ...attributes, className: "cursor-grab text-zinc-300 hover:text-zinc-500", children: _jsx(GripVertical, { size: 14 }) }), _jsx("span", { className: `shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${item.listType === "main_image" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"}`, children: item.listType === "main_image" ? "主图" : "详情页" }), _jsx(Input, { className: "flex-1 h-7 text-xs", placeholder: `图片标题 ${index + 1}`, value: item.title, onChange: (e) => onChange({ title: e.target.value }) }), _jsx("button", { onClick: () => setExpanded(v => !v), className: "text-xs text-zinc-400 hover:text-zinc-700 px-1", children: expanded ? "收起" : "展开" }), _jsx("button", { onClick: onRemove, className: "text-zinc-300 hover:text-red-500", children: _jsx(X, { size: 14 }) })] }), expanded && (_jsxs("div", { className: "border-t border-zinc-50 px-3 py-3 space-y-3", children: [_jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx(Label, { className: "text-xs text-zinc-500", children: "\u5185\u5BB9\u63CF\u8FF0" }), _jsx(Textarea, { rows: 2, className: "text-xs", value: item.description ?? "", onChange: (e) => onChange({ description: e.target.value }), placeholder: "\u56FE\u7247\u5185\u5BB9\u63CF\u8FF0" })] }), _jsxs("div", { className: "flex flex-col gap-1", children: [_jsx(Label, { className: "text-xs text-zinc-500", children: "\u6784\u56FE\u610F\u56FE" }), _jsx(Textarea, { rows: 2, className: "text-xs", value: item.compositionIntent ?? "", onChange: (e) => onChange({ compositionIntent: e.target.value }), placeholder: "\u5982\uFF1A\u4EA7\u54C1\u5C45\u4E2D\u767D\u5E9545\u5EA6\u4FEF\u89D2" })] })] }), _jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx(Label, { className: "text-xs text-zinc-500", children: "\u4E3B\u6807\u9898\u6587\u6848" }), _jsx(Input, { className: "h-7 text-xs", value: item.suggestedCopy ?? "", onChange: (e) => onChange({ suggestedCopy: e.target.value }), placeholder: "\u5EFA\u8BAE\u4E3B\u6807\u9898" })] }), _jsxs("div", { className: "flex flex-col gap-1", children: [_jsx(Label, { className: "text-xs text-zinc-500", children: "\u8F93\u51FA\u9884\u8BBE" }), _jsxs("select", { className: "h-7 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-900 focus:outline-none", value: item.presetId ?? "", onChange: (e) => onChange({ presetId: e.target.value }), children: [_jsx("option", { value: "", children: "\u9ED8\u8BA4\u9884\u8BBE" }), presets.map(p => (_jsxs("option", { value: p.id, children: [p.name, " (", p.width, "\u00D7", p.height, ")"] }, p.id)))] })] })] })] }))] }));
}
function Step1({ task, onNext }) {
    const [submitting, setSubmitting] = useState(false);
    const outputTypes = JSON.parse(task.outputTypes);
    async function handleGenerate() {
        setSubmitting(true);
        try {
            await api.post(`/tasks/${task.id}/generate-directions`, {});
            toast.success("设计方向生成任务已提交");
            onNext();
        }
        catch {
            toast.error("提交失败，请重试");
            setSubmitting(false);
        }
    }
    return (_jsxs("div", { className: "mx-auto max-w-lg px-8 py-10", children: [_jsx("h2", { className: "mb-6 text-base font-medium text-zinc-900", children: "\u4EFB\u52A1\u914D\u7F6E\u786E\u8BA4" }), _jsxs("div", { className: "flex flex-col gap-4 rounded-lg border border-zinc-100 p-5 text-sm", children: [_jsxs("div", { className: "flex gap-3", children: [_jsx("span", { className: "w-24 shrink-0 text-zinc-400", children: "\u8F93\u51FA\u7C7B\u578B" }), _jsx("span", { className: "text-zinc-900", children: outputTypes.map(t => t === "main_image" ? "主图" : "详情页").join(" + ") })] }), _jsxs("div", { className: "flex gap-3", children: [_jsx("span", { className: "w-24 shrink-0 text-zinc-400", children: "\u7ADE\u54C1\u5206\u6790" }), _jsx("span", { className: "text-zinc-900", children: "\u5DF2\u5173\u8054" })] }), _jsxs("div", { className: "flex gap-3", children: [_jsx("span", { className: "w-24 shrink-0 text-zinc-400", children: "\u4E0B\u4E00\u6B65" }), _jsx("span", { className: "text-zinc-500", children: "AI \u5C06\u57FA\u4E8E\u7ADE\u54C1\u7814\u7A76\u548C\u5546\u54C1\u4FE1\u606F\u751F\u62103\u4E2A\u5DEE\u5F02\u5316\u8BBE\u8BA1\u65B9\u5411" })] })] }), _jsx("div", { className: "mt-8 flex justify-end", children: _jsx(Button, { onClick: handleGenerate, disabled: submitting, children: submitting
                        ? _jsxs(_Fragment, { children: [_jsx(Loader2, { size: 14, className: "animate-spin" }), " \u63D0\u4EA4\u4E2D\u2026"] })
                        : _jsxs(_Fragment, { children: [_jsx(Zap, { size: 14 }), " \u751F\u6210\u8BBE\u8BA1\u65B9\u5411"] }) }) })] }));
}
export function TaskWizard() {
    const { taskId, step } = useParams();
    const navigate = useNavigate();
    const currentStep = Math.max(1, Math.min(4, Number(step ?? 1)));
    const [task, setTask] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!taskId)
            return;
        api.get(`/tasks/${taskId}`)
            .then(setTask)
            .catch(() => toast.error("加载任务失败"))
            .finally(() => setLoading(false));
    }, [taskId]);
    function goStep(n) {
        navigate(`/tasks/${taskId}/step/${n}`);
    }
    if (loading) {
        return (_jsxs("div", { className: "flex h-full items-center justify-center text-sm text-zinc-400", children: [_jsx(Loader2, { size: 16, className: "animate-spin mr-2" }), " \u52A0\u8F7D\u4E2D\u2026"] }));
    }
    if (!task) {
        return (_jsxs("div", { className: "flex h-full flex-col items-center justify-center gap-3 text-sm text-zinc-400", children: [_jsx(AlertCircle, { size: 28 }), _jsx("p", { children: "\u4EFB\u52A1\u4E0D\u5B58\u5728" }), _jsx(NavLink, { to: "/products", className: "text-xs underline", children: "\u8FD4\u56DE\u5546\u54C1\u5E93" })] }));
    }
    const outputTypes = JSON.parse(task.outputTypes);
    const typeLabel = outputTypes.map(t => t === "main_image" ? "主图" : "详情页").join(" + ");
    return (_jsxs("div", { className: "flex h-full flex-col", children: [_jsxs("div", { className: "border-b border-zinc-200 px-8 pt-5 pb-4", children: [_jsxs("p", { className: "mb-3 text-xs text-zinc-400", children: [_jsx(NavLink, { to: "/products", className: "hover:text-zinc-700", children: "\u5546\u54C1\u5E93" }), " / ", _jsx(NavLink, { to: `/products/${task.productId}/tasks`, className: "hover:text-zinc-700", children: "\u6210\u56FE\u4EFB\u52A1" }), " / ", _jsx("span", { className: "text-zinc-600", children: typeLabel })] }), _jsx("ol", { className: "flex items-center gap-0", children: STEPS.map(({ n, label }, i) => {
                            const done = n < currentStep;
                            const active = n === currentStep;
                            return (_jsxs("li", { className: "flex items-center", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: `flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium ${active ? "bg-zinc-900 text-white" : done ? "bg-zinc-700 text-white" : "border border-zinc-300 text-zinc-400"}`, children: done ? _jsx(Check, { size: 10 }) : n }), _jsx("span", { className: `text-sm ${active ? "font-medium text-zinc-900" : "text-zinc-400"}`, children: label })] }), i < STEPS.length - 1 && _jsx("span", { className: "mx-4 h-px w-8 bg-zinc-200" })] }, n));
                        }) })] }), _jsxs("div", { className: "flex-1 overflow-y-auto", children: [currentStep === 1 && _jsx(Step1, { task: task, onNext: () => goStep(2) }), currentStep === 2 && _jsx(Step2, { task: task, onNext: () => goStep(3) }), currentStep === 3 && _jsx(Step3, { task: task, onNext: () => goStep(4) }), currentStep === 4 && _jsx(Step4, { task: task })] })] }));
}
