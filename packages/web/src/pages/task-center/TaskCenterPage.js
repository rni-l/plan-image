import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Layers, ChevronRight, ChevronLeft, ChevronRight as ChevronRightNav, } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const STEP_LABELS = {
    1: "选择配置",
    2: "生成方向",
    3: "编辑方案",
    4: "生成中 / 完成",
};
function typeLabel(outputTypes) {
    const types = JSON.parse(outputTypes);
    return types.map((t) => (t === "main_image" ? "主图" : "详情页")).join(" + ");
}
function fmtDate(ts) {
    return new Date(ts).toLocaleDateString("zh-CN", {
        month: "short",
        day: "numeric",
    });
}
// ---------------------------------------------------------------------------
// Task card
// ---------------------------------------------------------------------------
function TaskCard({ task, onClick }) {
    const isDone = task.currentStep === 4;
    const stepLabel = STEP_LABELS[task.currentStep] ?? `步骤 ${task.currentStep}`;
    return (_jsxs("button", { onClick: onClick, className: "flex w-full items-center gap-4 rounded-lg border border-zinc-100 bg-white px-4 py-3 text-left transition-shadow hover:shadow-sm", children: [_jsx(Layers, { size: 16, className: "shrink-0 text-zinc-400" }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("p", { className: "truncate text-sm font-medium text-zinc-900", children: task.productName }), _jsxs("p", { className: "mt-0.5 text-xs text-zinc-400", children: [typeLabel(task.outputTypes), " \u00B7 \u66F4\u65B0\u4E8E ", fmtDate(task.updatedAt)] })] }), _jsx(Badge, { variant: isDone ? "succeeded" : "running", className: "shrink-0 text-xs", children: stepLabel }), _jsx(ChevronRight, { size: 14, className: "shrink-0 text-zinc-300" })] }));
}
// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
const FILTER_TABS = [
    { key: "all", label: "全部" },
    { key: "active", label: "进行中" },
    { key: "done", label: "已完成" },
];
const LIMIT = 30;
export function TaskCenterPage() {
    const navigate = useNavigate();
    const [filter, setFilter] = useState("all");
    const [page, setPage] = useState(1);
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const pollRef = useRef(null);
    const load = useCallback(async (quiet = false) => {
        if (!quiet)
            setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page) });
            if (filter !== "all")
                params.set("step", filter);
            const res = await api.get(`/tasks?${params}`);
            setRows(res.data);
            setTotal(res.total);
        }
        finally {
            if (!quiet)
                setLoading(false);
        }
    }, [filter, page]);
    // Initial load + reload on filter/page change
    useEffect(() => { void load(); }, [load]);
    // Reset to page 1 when filter changes
    useEffect(() => { setPage(1); }, [filter]);
    // Poll every 5 s when there are in-progress tasks
    useEffect(() => {
        if (pollRef.current)
            clearTimeout(pollRef.current);
        const hasActive = rows.some((r) => r.currentStep < 4);
        if (hasActive) {
            pollRef.current = setTimeout(() => void load(true), 5000);
        }
        return () => { if (pollRef.current)
            clearTimeout(pollRef.current); };
    }, [rows, load]);
    const totalPages = Math.max(1, Math.ceil(total / LIMIT));
    return (_jsxs("div", { className: "flex h-full flex-col", children: [_jsxs("div", { className: "flex items-center justify-between border-b px-6 py-4", children: [_jsx("h1", { className: "text-base font-semibold text-zinc-900", children: "\u4EFB\u52A1\u4E2D\u5FC3" }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-8 w-8", onClick: () => void load(), title: "\u5237\u65B0", children: _jsx(RefreshCw, { size: 14, className: loading ? "animate-spin" : "" }) })] }), _jsxs("div", { className: "flex flex-1 flex-col gap-4 overflow-y-auto p-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("div", { className: "flex gap-1 rounded-lg bg-zinc-100 p-1", children: FILTER_TABS.map(({ key, label }) => (_jsx("button", { onClick: () => setFilter(key), className: `rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${filter === key
                                        ? "bg-white text-zinc-900 shadow-sm"
                                        : "text-zinc-500 hover:text-zinc-700"}`, children: label }, key))) }), _jsxs("span", { className: "text-xs text-zinc-400", children: ["\u5171 ", total, " \u4E2A\u4EFB\u52A1"] })] }), loading ? (_jsx("div", { className: "flex flex-col gap-2", children: [1, 2, 3].map((i) => (_jsx("div", { className: "h-[60px] animate-pulse rounded-lg border border-zinc-100 bg-zinc-50" }, i))) })) : rows.length === 0 ? (_jsxs("div", { className: "flex flex-col items-center gap-3 py-24 text-zinc-400", children: [_jsx(Layers, { size: 36, strokeWidth: 1.5 }), _jsx("p", { className: "text-sm", children: "\u6682\u65E0\u4EFB\u52A1" })] })) : (_jsx("div", { className: "flex flex-col gap-2", children: rows.map((task) => (_jsx(TaskCard, { task: task, onClick: () => navigate(`/tasks/${task.id}/step/${task.currentStep}`) }, task.id))) })), totalPages > 1 && (_jsxs("div", { className: "flex items-center justify-between text-xs text-zinc-500", children: [_jsxs("span", { children: ["\u7B2C ", page, " / ", totalPages, " \u9875"] }), _jsxs("div", { className: "flex gap-1", children: [_jsx(Button, { variant: "outline", size: "icon", className: "h-7 w-7", disabled: page <= 1, onClick: () => setPage((p) => p - 1), children: _jsx(ChevronLeft, { size: 13 }) }), _jsx(Button, { variant: "outline", size: "icon", className: "h-7 w-7", disabled: page >= totalPages, onClick: () => setPage((p) => p + 1), children: _jsx(ChevronRightNav, { size: 13 }) })] })] }))] })] }));
}
