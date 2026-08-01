import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Loader2, ChevronRight, Layers } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, } from "@/components/ui/dialog";
const STEP_LABELS = {
    1: "选择配置",
    2: "设计方向",
    3: "编辑方案",
    4: "生成中 / 完成",
};
// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function TasksTab({ productId }) {
    const navigate = useNavigate();
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [versions, setVersions] = useState([]);
    useEffect(() => {
        Promise.all([
            api.get(`/products/${productId}/tasks`),
            api.get(`/research/${productId}/versions`),
        ])
            .then(([t, v]) => { setTasks(t); setVersions(v); })
            .catch(() => toast.error("加载失败"))
            .finally(() => setLoading(false));
    }, [productId]);
    function handleCreated(task) {
        setTasks((prev) => [task, ...prev]);
        setDialogOpen(false);
        navigate(`/tasks/${task.id}/step/1`);
    }
    return (_jsxs("div", { className: "px-8 py-6", children: [_jsxs("div", { className: "mb-5 flex items-center justify-between", children: [_jsx("h2", { className: "text-sm font-medium text-zinc-900", children: "\u6210\u56FE\u4EFB\u52A1" }), _jsxs(Button, { size: "sm", onClick: () => setDialogOpen(true), disabled: versions.length === 0, children: [_jsx(Plus, { size: 14 }), " \u65B0\u5EFA\u4EFB\u52A1"] })] }), versions.length === 0 && !loading && (_jsx("p", { className: "mb-4 rounded-md border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-700", children: "\u8BF7\u5148\u5728\u300C\u7ADE\u54C1\u7814\u7A76\u300DTab \u5B8C\u6210\u81F3\u5C11\u4E00\u6B21\u7ADE\u54C1\u5206\u6790\uFF0C\u624D\u80FD\u521B\u5EFA\u6210\u56FE\u4EFB\u52A1\u3002" })), loading ? (_jsxs("div", { className: "flex items-center gap-2 text-sm text-zinc-400", children: [_jsx(Loader2, { size: 14, className: "animate-spin" }), " \u52A0\u8F7D\u4E2D\u2026"] })) : tasks.length === 0 ? (_jsx(EmptyTasks, { onNew: () => setDialogOpen(true), hasVersions: versions.length > 0 })) : (_jsx("div", { className: "flex flex-col gap-2", children: tasks.map((task) => (_jsx(TaskRow, { task: task, onClick: () => navigate(`/tasks/${task.id}/step/${task.currentStep}`) }, task.id))) })), _jsx(NewTaskDialog, { open: dialogOpen, onOpenChange: setDialogOpen, productId: productId, versions: versions, onCreated: handleCreated })] }));
}
// ---------------------------------------------------------------------------
// Task row
// ---------------------------------------------------------------------------
function TaskRow({ task, onClick }) {
    const types = JSON.parse(task.outputTypes);
    const typeLabel = types.map(t => t === "main_image" ? "主图" : "详情页").join(" + ");
    const date = new Date(task.createdAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
    const stepLabel = STEP_LABELS[task.currentStep] ?? `步骤${task.currentStep}`;
    return (_jsxs("button", { onClick: onClick, className: "flex items-center gap-4 rounded-lg border border-zinc-100 bg-white px-4 py-3 text-left transition-shadow hover:shadow-sm", children: [_jsx(Layers, { size: 16, className: "shrink-0 text-zinc-400" }), _jsxs("div", { className: "flex-1", children: [_jsxs("p", { className: "text-sm font-medium text-zinc-900", children: [typeLabel, " \u6210\u56FE\u4EFB\u52A1"] }), _jsxs("p", { className: "mt-0.5 text-xs text-zinc-400", children: [date, " \u521B\u5EFA"] })] }), _jsx("span", { className: `shrink-0 rounded-full px-2 py-0.5 text-xs ${task.currentStep === 4
                    ? "bg-green-50 text-green-700"
                    : "bg-zinc-100 text-zinc-600"}`, children: stepLabel }), _jsx(ChevronRight, { size: 14, className: "shrink-0 text-zinc-300" })] }));
}
// ---------------------------------------------------------------------------
// New task dialog
// ---------------------------------------------------------------------------
function NewTaskDialog({ open, onOpenChange, productId, versions, onCreated, }) {
    const [analysisVersionId, setAnalysisVersionId] = useState(versions[0]?.id ?? "");
    const [outputTypes, setOutputTypes] = useState(["main_image"]);
    const [submitting, setSubmitting] = useState(false);
    useEffect(() => {
        if (open && versions[0])
            setAnalysisVersionId(versions[0].id);
    }, [open, versions]);
    function toggleType(t) {
        setOutputTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
    }
    async function handleSubmit(e) {
        e.preventDefault();
        if (!analysisVersionId || outputTypes.length === 0)
            return;
        setSubmitting(true);
        try {
            const task = await api.post(`/products/${productId}/tasks`, {
                analysisVersionId,
                outputTypes,
            });
            onCreated(task);
        }
        catch {
            toast.error("创建失败，请重试");
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsx(Dialog, { open: open, onOpenChange: onOpenChange, children: _jsx(DialogContent, { children: _jsxs("form", { onSubmit: handleSubmit, children: [_jsx(DialogHeader, { children: _jsx(DialogTitle, { children: "\u65B0\u5EFA\u6210\u56FE\u4EFB\u52A1" }) }), _jsxs("div", { className: "flex flex-col gap-5", children: [_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx(Label, { children: "\u5173\u8054\u7ADE\u54C1\u5206\u6790\u7248\u672C" }), _jsx("select", { className: "h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900", value: analysisVersionId, onChange: (e) => setAnalysisVersionId(e.target.value), required: true, children: versions.map((v) => {
                                            const date = new Date(v.createdAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
                                            const count = JSON.parse(v.competitorAssetIds).length;
                                            return (_jsxs("option", { value: v.id, children: ["v", v.versionNumber, " \u00B7 ", date, " \u00B7 ", count, "\u5F20\u7ADE\u54C1"] }, v.id));
                                        }) })] }), _jsxs("div", { children: [_jsx(Label, { className: "mb-2 block", children: "\u8F93\u51FA\u7C7B\u578B" }), _jsx("div", { className: "flex gap-3", children: [
                                            { key: "main_image", label: "主图", desc: "800×800 等比方形" },
                                            { key: "detail_page", label: "详情页", desc: "宽版长图模块" },
                                        ].map(({ key, label, desc }) => (_jsxs("button", { type: "button", onClick: () => toggleType(key), className: `flex flex-1 flex-col rounded-lg border px-4 py-3 text-left transition-colors ${outputTypes.includes(key)
                                                ? "border-zinc-900 bg-zinc-50"
                                                : "border-zinc-200"}`, children: [_jsx("span", { className: "text-sm font-medium text-zinc-900", children: label }), _jsx("span", { className: "mt-0.5 text-xs text-zinc-400", children: desc })] }, key))) }), outputTypes.length === 0 && (_jsx("p", { className: "mt-1.5 text-xs text-red-500", children: "\u81F3\u5C11\u9009\u62E9\u4E00\u79CD\u8F93\u51FA\u7C7B\u578B" }))] })] }), _jsxs(DialogFooter, { children: [_jsx(DialogClose, { render: _jsx(Button, { type: "button", variant: "outline", children: "\u53D6\u6D88" }) }), _jsx(Button, { type: "submit", disabled: !analysisVersionId || outputTypes.length === 0 || submitting, children: submitting ? "创建中…" : "创建并开始" })] })] }) }) }));
}
// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
function EmptyTasks({ onNew, hasVersions }) {
    return (_jsxs("div", { className: "flex flex-col items-center gap-3 py-24 text-zinc-400", children: [_jsx(Layers, { size: 36, strokeWidth: 1.5 }), _jsx("p", { className: "text-sm", children: "\u6682\u65E0\u6210\u56FE\u4EFB\u52A1" }), hasVersions && (_jsxs(Button, { variant: "outline", size: "sm", onClick: onNew, children: [_jsx(Plus, { size: 14 }), " \u65B0\u5EFA\u4EFB\u52A1"] }))] }));
}
