import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevronRightIcon } from "lucide-react";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PROVIDER_LABELS = {
    bailian: "百炼",
    volcengine: "火山方舟",
    gpt_proxy: "GPT中转",
};
const SCENE_LABELS = {
    competitor_image_analysis: "竞品图分析",
    competitor_synthesis: "竞品综合",
    design_plan: "设计方案",
    image_generation: "图片生成",
    image_edit: "图片编辑",
};
function fmtTime(ts) {
    return new Date(ts).toLocaleString("zh-CN", {
        month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
}
function fmtDuration(ms) {
    if (ms == null)
        return "—";
    if (ms < 1000)
        return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}
function MethodBadge({ method }) {
    const colours = {
        GET: "bg-emerald-100 text-emerald-700",
        POST: "bg-blue-100 text-blue-700",
        PUT: "bg-amber-100 text-amber-700",
        PATCH: "bg-orange-100 text-orange-700",
        DELETE: "bg-red-100 text-red-700",
    };
    return (_jsx("span", { className: `inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono font-semibold ${colours[method] ?? "bg-zinc-100 text-zinc-600"}`, children: method }));
}
function StatusBadge({ code }) {
    if (code == null)
        return _jsx("span", { className: "text-zinc-400", children: "\u2014" });
    const cls = code < 300 ? "bg-emerald-100 text-emerald-700" :
        code < 500 ? "bg-amber-100 text-amber-700" :
            "bg-red-100 text-red-700";
    return (_jsx("span", { className: `inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono font-semibold ${cls}`, children: code }));
}
// ---------------------------------------------------------------------------
// Subpages
// ---------------------------------------------------------------------------
function ApiRequestsTab() {
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [method, setMethod] = useState("all");
    const [status, setStatus] = useState("all");
    const [loading, setLoading] = useState(false);
    const [expandedId, setExpandedId] = useState(null);
    const LIMIT = 50;
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
            if (method !== "all")
                params.set("method", method);
            if (status !== "all")
                params.set("status", status);
            const res = await api.get(`/logs/api-requests?${params}`);
            setRows(res.data);
            setTotal(res.total);
        }
        finally {
            setLoading(false);
        }
    }, [page, method, status]);
    useEffect(() => { void load(); }, [load]);
    useEffect(() => { setPage(1); }, [method, status]);
    const totalPages = Math.max(1, Math.ceil(total / LIMIT));
    return (_jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("select", { value: method, onChange: e => setMethod(e.target.value), className: "h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:outline-none", children: [_jsx("option", { value: "all", children: "\u5168\u90E8\u65B9\u6CD5" }), ["GET", "POST", "PUT", "PATCH", "DELETE"].map(m => _jsx("option", { value: m, children: m }, m))] }), _jsxs("select", { value: status, onChange: e => setStatus(e.target.value), className: "h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:outline-none", children: [_jsx("option", { value: "all", children: "\u5168\u90E8\u72B6\u6001" }), _jsx("option", { value: "2xx", children: "2xx \u6210\u529F" }), _jsx("option", { value: "4xx", children: "4xx \u5BA2\u6237\u7AEF\u9519\u8BEF" }), _jsx("option", { value: "5xx", children: "5xx \u670D\u52A1\u5668\u9519\u8BEF" })] }), _jsxs("div", { className: "ml-auto flex items-center gap-2 text-xs text-zinc-500", children: ["\u5171 ", total, " \u6761", _jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7", onClick: () => void load(), children: _jsx(RefreshCw, { size: 13, className: loading ? "animate-spin" : "" }) })] })] }), _jsx("div", { className: "overflow-x-auto rounded-md border", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b bg-zinc-50 text-xs text-zinc-500", children: [_jsx("th", { className: "w-6 px-3 py-2" }), _jsx("th", { className: "px-3 py-2 text-left font-medium", children: "\u65F6\u95F4" }), _jsx("th", { className: "px-3 py-2 text-left font-medium", children: "\u65B9\u6CD5" }), _jsx("th", { className: "px-3 py-2 text-left font-medium", children: "\u8DEF\u5F84" }), _jsx("th", { className: "px-3 py-2 text-left font-medium", children: "\u72B6\u6001" }), _jsx("th", { className: "px-3 py-2 text-right font-medium", children: "\u8017\u65F6" })] }) }), _jsxs("tbody", { children: [rows.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 6, className: "px-3 py-8 text-center text-xs text-zinc-400", children: "\u6682\u65E0\u6570\u636E" }) })), rows.map((r) => (_jsxs(_Fragment, { children: [_jsxs("tr", { className: "border-b cursor-pointer hover:bg-zinc-50/70", onClick: () => setExpandedId(expandedId === r.id ? null : r.id), children: [_jsx("td", { className: "px-3 py-2 text-zinc-400", children: expandedId === r.id
                                                        ? _jsx(ChevronDown, { size: 12 })
                                                        : _jsx(ChevronRightIcon, { size: 12 }) }), _jsx("td", { className: "px-3 py-2 text-xs text-zinc-500 whitespace-nowrap", children: fmtTime(r.createdAt) }), _jsx("td", { className: "px-3 py-2", children: _jsx(MethodBadge, { method: r.method }) }), _jsxs("td", { className: "px-3 py-2 font-mono text-xs text-zinc-700 max-w-[320px] truncate", children: [r.path, r.queryString ?? ""] }), _jsx("td", { className: "px-3 py-2", children: _jsx(StatusBadge, { code: r.statusCode }) }), _jsx("td", { className: "px-3 py-2 text-right text-xs text-zinc-500", children: fmtDuration(r.durationMs) })] }, r.id), expandedId === r.id && (_jsx("tr", { className: "bg-zinc-50 border-b", children: _jsx("td", { colSpan: 6, className: "px-4 py-3", children: _jsxs("div", { className: "grid grid-cols-2 gap-3 text-xs", children: [_jsxs("div", { children: [_jsx("p", { className: "mb-1 font-medium text-zinc-600", children: "\u8BF7\u6C42\u4F53" }), _jsx("pre", { className: "max-h-60 overflow-auto rounded border border-zinc-200 bg-white p-2 text-zinc-700 whitespace-pre-wrap break-all", children: r.requestBody ?? "（无请求体）" })] }), _jsxs("div", { children: [_jsxs("p", { className: "mb-1 font-medium text-zinc-600", children: ["\u54CD\u5E94\u4F53", (r.statusCode ?? 0) < 400 ? "（仅记录错误响应）" : ""] }), _jsx("pre", { className: "max-h-60 overflow-auto rounded border border-zinc-200 bg-white p-2 text-zinc-700 whitespace-pre-wrap break-all", children: r.responseBody ?? "—" })] })] }) }) }, `${r.id}-detail`))] })))] })] }) }), _jsxs("div", { className: "flex items-center justify-between text-xs text-zinc-500", children: [_jsxs("span", { children: ["\u7B2C ", page, " / ", totalPages, " \u9875"] }), _jsxs("div", { className: "flex gap-1", children: [_jsx(Button, { variant: "outline", size: "icon", className: "h-7 w-7", disabled: page <= 1, onClick: () => setPage(p => p - 1), children: _jsx(ChevronLeft, { size: 13 }) }), _jsx(Button, { variant: "outline", size: "icon", className: "h-7 w-7", disabled: page >= totalPages, onClick: () => setPage(p => p + 1), children: _jsx(ChevronRight, { size: 13 }) })] })] })] }));
}
function LlmCallsTab() {
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [provider, setProvider] = useState("all");
    const [status, setStatus] = useState("all");
    const [loading, setLoading] = useState(false);
    const [expandedId, setExpandedId] = useState(null);
    const LIMIT = 50;
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
            if (provider !== "all")
                params.set("provider", provider);
            if (status !== "all")
                params.set("status", status);
            const res = await api.get(`/logs/llm-calls?${params}`);
            setRows(res.data);
            setTotal(res.total);
        }
        finally {
            setLoading(false);
        }
    }, [page, provider, status]);
    useEffect(() => { void load(); }, [load]);
    useEffect(() => { setPage(1); }, [provider, status]);
    const totalPages = Math.max(1, Math.ceil(total / LIMIT));
    return (_jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("select", { value: provider, onChange: e => setProvider(e.target.value), className: "h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:outline-none", children: [_jsx("option", { value: "all", children: "\u5168\u90E8\u4F9B\u5E94\u5546" }), _jsx("option", { value: "bailian", children: "\u767E\u70BC" }), _jsx("option", { value: "volcengine", children: "\u706B\u5C71\u65B9\u821F" }), _jsx("option", { value: "gpt_proxy", children: "GPT\u4E2D\u8F6C" })] }), _jsxs("select", { value: status, onChange: e => setStatus(e.target.value), className: "h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:outline-none", children: [_jsx("option", { value: "all", children: "\u5168\u90E8\u72B6\u6001" }), _jsx("option", { value: "succeeded", children: "\u6210\u529F" }), _jsx("option", { value: "failed", children: "\u5931\u8D25" })] }), _jsxs("div", { className: "ml-auto flex items-center gap-2 text-xs text-zinc-500", children: ["\u5171 ", total, " \u6761", _jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7", onClick: () => void load(), children: _jsx(RefreshCw, { size: 13, className: loading ? "animate-spin" : "" }) })] })] }), _jsx("div", { className: "overflow-x-auto rounded-md border", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b bg-zinc-50 text-xs text-zinc-500", children: [_jsx("th", { className: "w-6 px-3 py-2" }), _jsx("th", { className: "px-3 py-2 text-left font-medium", children: "\u65F6\u95F4" }), _jsx("th", { className: "px-3 py-2 text-left font-medium", children: "\u573A\u666F" }), _jsx("th", { className: "px-3 py-2 text-left font-medium", children: "\u4F9B\u5E94\u5546" }), _jsx("th", { className: "px-3 py-2 text-left font-medium", children: "\u6A21\u578B" }), _jsx("th", { className: "px-3 py-2 text-left font-medium", children: "\u72B6\u6001" }), _jsx("th", { className: "px-3 py-2 text-right font-medium", children: "\u8017\u65F6" }), _jsx("th", { className: "px-3 py-2 text-right font-medium", children: "\u8F93\u5165Token" }), _jsx("th", { className: "px-3 py-2 text-right font-medium", children: "\u8F93\u51FAToken" })] }) }), _jsxs("tbody", { children: [rows.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 9, className: "px-3 py-8 text-center text-xs text-zinc-400", children: "\u6682\u65E0\u6570\u636E" }) })), rows.map((r) => (_jsxs(_Fragment, { children: [_jsxs("tr", { className: `border-b cursor-pointer hover:bg-zinc-50/70 ${r.status === "failed" ? "bg-red-50/30" : ""}`, onClick: () => setExpandedId(expandedId === r.id ? null : r.id), children: [_jsx("td", { className: "px-3 py-2 text-zinc-400", children: expandedId === r.id
                                                        ? _jsx(ChevronDown, { size: 12 })
                                                        : _jsx(ChevronRightIcon, { size: 12 }) }), _jsx("td", { className: "px-3 py-2 text-xs text-zinc-500 whitespace-nowrap", children: fmtTime(r.createdAt) }), _jsx("td", { className: "px-3 py-2 text-xs", children: SCENE_LABELS[r.scene] ?? r.scene }), _jsx("td", { className: "px-3 py-2 text-xs", children: PROVIDER_LABELS[r.provider] ?? r.provider }), _jsx("td", { className: "px-3 py-2 font-mono text-xs text-zinc-700 max-w-[160px] truncate", children: r.model }), _jsx("td", { className: "px-3 py-2", children: _jsx(Badge, { variant: r.status === "succeeded" ? "succeeded" : "failed", className: "text-xs px-1.5 py-0", children: r.status === "succeeded" ? "成功" : "失败" }) }), _jsx("td", { className: "px-3 py-2 text-right text-xs text-zinc-500", children: fmtDuration(r.durationMs) }), _jsx("td", { className: "px-3 py-2 text-right text-xs text-zinc-500", children: r.promptTokens?.toLocaleString() ?? "—" }), _jsx("td", { className: "px-3 py-2 text-right text-xs text-zinc-500", children: r.completionTokens?.toLocaleString() ?? "—" })] }, r.id), expandedId === r.id && (_jsx("tr", { className: "bg-zinc-50 border-b", children: _jsx("td", { colSpan: 9, className: "px-4 py-3", children: _jsxs("div", { className: "grid grid-cols-2 gap-3 text-xs", children: [_jsxs("div", { className: "flex flex-col gap-2", children: [_jsxs("div", { children: [_jsx("p", { className: "mb-1 font-medium text-zinc-600", children: "Prompt\uFF08\u53D1\u9001\u7ED9\u6A21\u578B\u7684\u5185\u5BB9\uFF09" }), _jsx("pre", { className: "max-h-72 overflow-auto rounded border border-zinc-200 bg-white p-2 text-zinc-700 whitespace-pre-wrap break-all", children: r.requestPrompt ?? "—" })] }), _jsxs("div", { children: [_jsx("p", { className: "mb-1 font-medium text-zinc-600", children: "\u8BF7\u6C42\u53C2\u6570" }), _jsx("pre", { className: "max-h-36 overflow-auto rounded border border-zinc-200 bg-white p-2 text-zinc-700 whitespace-pre-wrap", children: r.requestParams ?? "—" })] })] }), _jsxs("div", { className: "flex flex-col gap-2", children: [_jsxs("div", { children: [_jsx("p", { className: "mb-1 font-medium text-zinc-600", children: "\u54CD\u5E94\u5185\u5BB9" }), _jsx("pre", { className: "max-h-56 overflow-auto rounded border border-zinc-200 bg-white p-2 text-zinc-700 whitespace-pre-wrap break-all", children: r.responseBody ?? "—" })] }), r.errorMessage && (_jsxs("div", { children: [_jsx("p", { className: "mb-1 font-medium text-red-600", children: "\u9519\u8BEF\u4FE1\u606F" }), _jsx("pre", { className: "max-h-24 overflow-auto rounded border border-red-200 bg-red-50 p-2 text-red-700 whitespace-pre-wrap break-all", children: r.errorMessage })] }))] })] }) }) }, `${r.id}-detail`))] })))] })] }) }), _jsxs("div", { className: "flex items-center justify-between text-xs text-zinc-500", children: [_jsxs("span", { children: ["\u7B2C ", page, " / ", totalPages, " \u9875"] }), _jsxs("div", { className: "flex gap-1", children: [_jsx(Button, { variant: "outline", size: "icon", className: "h-7 w-7", disabled: page <= 1, onClick: () => setPage(p => p - 1), children: _jsx(ChevronLeft, { size: 13 }) }), _jsx(Button, { variant: "outline", size: "icon", className: "h-7 w-7", disabled: page >= totalPages, onClick: () => setPage(p => p + 1), children: _jsx(ChevronRight, { size: 13 }) })] })] })] }));
}
export function LogsPage() {
    const [tab, setTab] = useState("api");
    return (_jsxs("div", { className: "flex flex-col h-full", children: [_jsx("div", { className: "flex items-center justify-between border-b px-6 py-4", children: _jsx("h1", { className: "text-base font-semibold text-zinc-900", children: "\u65E5\u5FD7\u8BB0\u5F55" }) }), _jsxs("div", { className: "flex flex-col gap-4 p-6 flex-1 min-h-0 overflow-y-auto", children: [_jsx("div", { className: "flex gap-1 rounded-lg bg-zinc-100 p-1 w-fit", children: [["api", "接口请求"], ["llm", "LLM调用"]].map(([id, label]) => (_jsx("button", { onClick: () => setTab(id), className: `rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${tab === id
                                ? "bg-white text-zinc-900 shadow-sm"
                                : "text-zinc-500 hover:text-zinc-700"}`, children: label }, id))) }), tab === "api" && _jsx(ApiRequestsTab, {}), tab === "llm" && _jsx(LlmCallsTab, {})] })] }));
}
