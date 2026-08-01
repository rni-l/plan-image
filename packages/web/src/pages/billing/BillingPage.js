import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Pencil, Check, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PROVIDER_LABELS = {
    bailian: "百炼",
    volcengine: "火山方舟",
    gpt_proxy: "GPT中转",
};
function fmtNum(n, decimals = 0) {
    if (n == null)
        return "—";
    return n.toLocaleString("zh-CN", { maximumFractionDigits: decimals });
}
function fmtUsd(n) {
    if (n == null)
        return "—";
    if (n < 0.001)
        return "< $0.001";
    return `$${n.toFixed(4)}`;
}
function SummaryCard({ label, value, sub }) {
    return (_jsxs("div", { className: "rounded-lg border bg-white p-4", children: [_jsx("p", { className: "text-xs text-zinc-500", children: label }), _jsx("p", { className: "mt-1 text-2xl font-semibold text-zinc-900", children: value }), sub && _jsx("p", { className: "mt-0.5 text-xs text-zinc-400", children: sub })] }));
}
// ---------------------------------------------------------------------------
// Pricing editor row
// ---------------------------------------------------------------------------
function PricingEditorRow({ row, onSave, onDelete, }) {
    const [editing, setEditing] = useState(false);
    const [input, setInput] = useState(row.pricePerMInputTokens.toString());
    const [output, setOutput] = useState(row.pricePerMOutputTokens.toString());
    const save = async () => {
        await onSave({ ...row, pricePerMInputTokens: Number(input), pricePerMOutputTokens: Number(output) });
        setEditing(false);
    };
    return (_jsxs("tr", { className: "border-b last:border-0", children: [_jsx("td", { className: "px-3 py-2 text-xs", children: PROVIDER_LABELS[row.provider] ?? row.provider }), _jsx("td", { className: "px-3 py-2 font-mono text-xs", children: row.modelId }), _jsx("td", { className: "px-3 py-2 text-xs text-right", children: editing ? (_jsx(Input, { value: input, onChange: e => setInput(e.target.value), className: "h-6 w-24 text-xs text-right" })) : (`$${row.pricePerMInputTokens}`) }), _jsx("td", { className: "px-3 py-2 text-xs text-right", children: editing ? (_jsx(Input, { value: output, onChange: e => setOutput(e.target.value), className: "h-6 w-24 text-xs text-right" })) : (`$${row.pricePerMOutputTokens}`) }), _jsx("td", { className: "px-3 py-2 text-right", children: editing ? (_jsxs("div", { className: "flex justify-end gap-1", children: [_jsx(Button, { variant: "ghost", size: "icon", className: "h-6 w-6", onClick: () => void save(), children: _jsx(Check, { size: 12, className: "text-emerald-600" }) }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-6 w-6", onClick: () => setEditing(false), children: _jsx(X, { size: 12, className: "text-zinc-400" }) })] })) : (_jsxs("div", { className: "flex justify-end gap-1", children: [_jsx(Button, { variant: "ghost", size: "icon", className: "h-6 w-6", onClick: () => setEditing(true), children: _jsx(Pencil, { size: 12, className: "text-zinc-400" }) }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-6 w-6", onClick: () => onDelete(row), children: _jsx(Trash2, { size: 12, className: "text-zinc-400" }) })] })) })] }));
}
// ---------------------------------------------------------------------------
// New pricing row form
// ---------------------------------------------------------------------------
function AddPricingForm({ onAdd }) {
    const [provider, setProvider] = useState("");
    const [modelId, setModelId] = useState("");
    const [inputP, setInputP] = useState("0");
    const [outputP, setOutputP] = useState("0");
    const [saving, setSaving] = useState(false);
    const submit = async () => {
        if (!provider.trim() || !modelId.trim()) {
            toast.error("供应商和模型ID不能为空");
            return;
        }
        setSaving(true);
        try {
            await api.put(`/billing/pricing/${encodeURIComponent(provider)}/${encodeURIComponent(modelId)}`, {
                pricePerMInputTokens: Number(inputP),
                pricePerMOutputTokens: Number(outputP),
            });
            setProvider("");
            setModelId("");
            setInputP("0");
            setOutputP("0");
            onAdd();
        }
        catch {
            toast.error("保存失败");
        }
        finally {
            setSaving(false);
        }
    };
    return (_jsxs("tr", { className: "border-t bg-zinc-50/50", children: [_jsx("td", { className: "px-3 py-2", children: _jsx(Input, { value: provider, onChange: e => setProvider(e.target.value), placeholder: "bailian / volcengine / gpt_proxy", className: "h-6 text-xs" }) }), _jsx("td", { className: "px-3 py-2", children: _jsx(Input, { value: modelId, onChange: e => setModelId(e.target.value), placeholder: "\u6A21\u578BID", className: "h-6 font-mono text-xs" }) }), _jsx("td", { className: "px-3 py-2", children: _jsx(Input, { value: inputP, onChange: e => setInputP(e.target.value), className: "h-6 w-24 text-xs text-right ml-auto" }) }), _jsx("td", { className: "px-3 py-2", children: _jsx(Input, { value: outputP, onChange: e => setOutputP(e.target.value), className: "h-6 w-24 text-xs text-right ml-auto" }) }), _jsx("td", { className: "px-3 py-2 text-right", children: _jsx(Button, { size: "sm", className: "h-6 text-xs px-3", disabled: saving, onClick: () => void submit(), children: "\u6DFB\u52A0" }) })] }));
}
// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export function BillingPage() {
    const [summary, setSummary] = useState(null);
    const [models, setModels] = useState([]);
    const [pricing, setPricing] = useState([]);
    const [loading, setLoading] = useState(false);
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [s, m, p] = await Promise.all([
                api.get("/billing/summary"),
                api.get("/billing/by-model"),
                api.get("/billing/pricing"),
            ]);
            setSummary(s);
            setModels(m.data);
            setPricing(p.data);
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { void load(); }, [load]);
    const handleSavePricing = async (row) => {
        try {
            await api.put(`/billing/pricing/${encodeURIComponent(row.provider)}/${encodeURIComponent(row.modelId)}`, {
                pricePerMInputTokens: row.pricePerMInputTokens,
                pricePerMOutputTokens: row.pricePerMOutputTokens,
                isImageModel: row.isImageModel,
                pricePerImage: row.pricePerImage,
            });
            toast.success("价格已更新");
            await load();
        }
        catch {
            toast.error("保存失败");
        }
    };
    const handleDeletePricing = async (row) => {
        try {
            await api.delete(`/billing/pricing/${encodeURIComponent(row.provider)}/${encodeURIComponent(row.modelId)}`);
            toast.success("已删除");
            await load();
        }
        catch {
            toast.error("删除失败");
        }
    };
    return (_jsxs("div", { className: "flex flex-col h-full", children: [_jsxs("div", { className: "flex items-center justify-between border-b px-6 py-4", children: [_jsx("h1", { className: "text-base font-semibold text-zinc-900", children: "\u7528\u91CF\u4E0E\u8BA1\u8D39" }), _jsxs(Button, { variant: "ghost", size: "sm", className: "h-7 gap-1.5 text-xs", onClick: () => void load(), children: [_jsx(RefreshCw, { size: 13, className: loading ? "animate-spin" : "" }), "\u5237\u65B0"] })] }), _jsxs("div", { className: "flex flex-col gap-6 p-6 overflow-y-auto", children: [_jsxs("div", { className: "grid grid-cols-2 gap-3 sm:grid-cols-4", children: [_jsx(SummaryCard, { label: "\u603B\u8C03\u7528\u6B21\u6570", value: fmtNum(summary?.totalCalls), sub: `成功 ${fmtNum(summary?.succeededCalls)} / 失败 ${fmtNum(summary?.failedCalls)}` }), _jsx(SummaryCard, { label: "\u603BToken\u7528\u91CF", value: fmtNum(summary?.totalTokens), sub: `输入 ${fmtNum(summary?.totalPromptTokens)} / 输出 ${fmtNum(summary?.totalCompTokens)}` }), _jsx(SummaryCard, { label: "\u9884\u4F30\u8D39\u7528 (USD)", value: fmtUsd(summary?.estimatedCostUsd), sub: "\u6839\u636E\u4E0B\u65B9\u4EF7\u683C\u914D\u7F6E\u8BA1\u7B97" }), _jsx(SummaryCard, { label: "\u5E73\u5747\u8F93\u51FAToken", value: summary && summary.succeededCalls > 0
                                    ? fmtNum(Math.round(summary.totalCompTokens / summary.succeededCalls))
                                    : "—", sub: "\u6BCF\u6B21\u6210\u529F\u8C03\u7528" })] }), _jsxs("section", { children: [_jsx("h2", { className: "mb-3 text-sm font-medium text-zinc-700", children: "\u6309\u6A21\u578B\u6C47\u603B" }), _jsx("div", { className: "overflow-x-auto rounded-md border", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b bg-zinc-50 text-xs text-zinc-500", children: [_jsx("th", { className: "px-3 py-2 text-left font-medium", children: "\u4F9B\u5E94\u5546" }), _jsx("th", { className: "px-3 py-2 text-left font-medium", children: "\u6A21\u578B" }), _jsx("th", { className: "px-3 py-2 text-right font-medium", children: "\u8C03\u7528\u6B21\u6570" }), _jsx("th", { className: "px-3 py-2 text-right font-medium", children: "\u8F93\u5165Token" }), _jsx("th", { className: "px-3 py-2 text-right font-medium", children: "\u8F93\u51FAToken" }), _jsx("th", { className: "px-3 py-2 text-right font-medium", children: "\u5E73\u5747\u8017\u65F6" }), _jsx("th", { className: "px-3 py-2 text-right font-medium", children: "\u9884\u4F30\u8D39\u7528" })] }) }), _jsxs("tbody", { children: [models.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 7, className: "px-3 py-8 text-center text-xs text-zinc-400", children: "\u6682\u65E0\u6570\u636E" }) })), models.map((r) => (_jsxs("tr", { className: "border-b last:border-0 hover:bg-zinc-50/50", children: [_jsx("td", { className: "px-3 py-2 text-xs", children: PROVIDER_LABELS[r.provider] ?? r.provider }), _jsx("td", { className: "px-3 py-2 font-mono text-xs text-zinc-700", children: r.model }), _jsxs("td", { className: "px-3 py-2 text-right text-xs", children: [_jsx("span", { children: fmtNum(r.totalCalls) }), r.failedCalls > 0 && (_jsxs(Badge, { variant: "failed", className: "ml-1.5 text-xs px-1 py-0", children: [r.failedCalls, "\u5931\u8D25"] }))] }), _jsx("td", { className: "px-3 py-2 text-right text-xs text-zinc-600", children: fmtNum(r.promptTokens) }), _jsx("td", { className: "px-3 py-2 text-right text-xs text-zinc-600", children: fmtNum(r.completionTokens) }), _jsx("td", { className: "px-3 py-2 text-right text-xs text-zinc-500", children: r.avgDurationMs ? `${(r.avgDurationMs / 1000).toFixed(1)}s` : "—" }), _jsx("td", { className: "px-3 py-2 text-right text-xs font-medium text-zinc-800", children: r.pricePerMInput == null ? (_jsx("span", { className: "text-zinc-400 text-xs", children: "\u672A\u914D\u7F6E\u4EF7\u683C" })) : (fmtUsd(r.estimatedCostUsd)) })] }, `${r.provider}:${r.model}`)))] })] }) })] }), _jsxs("section", { children: [_jsx("h2", { className: "mb-3 text-sm font-medium text-zinc-700", children: "\u4EF7\u683C\u914D\u7F6E" }), _jsx("p", { className: "mb-3 text-xs text-zinc-500", children: "\u6309\u6A21\u578B\u914D\u7F6E\u6BCF\u767E\u4E07 Token \u7684\u4EF7\u683C\uFF08USD\uFF09\uFF0C\u7528\u4E8E\u4F30\u7B97\u8D39\u7528\u3002\u4FEE\u6539\u540E\u7ACB\u5373\u751F\u6548\u4E8E\u6240\u6709\u5386\u53F2\u6570\u636E\u6C47\u603B\u3002" }), _jsx("div", { className: "overflow-x-auto rounded-md border", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b bg-zinc-50 text-xs text-zinc-500", children: [_jsx("th", { className: "px-3 py-2 text-left font-medium", children: "\u4F9B\u5E94\u5546" }), _jsx("th", { className: "px-3 py-2 text-left font-medium", children: "\u6A21\u578BID" }), _jsx("th", { className: "px-3 py-2 text-right font-medium", children: "\u8F93\u5165 $/1M Token" }), _jsx("th", { className: "px-3 py-2 text-right font-medium", children: "\u8F93\u51FA $/1M Token" }), _jsx("th", { className: "px-3 py-2 text-right font-medium", children: "\u64CD\u4F5C" })] }) }), _jsxs("tbody", { children: [pricing.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 5, className: "px-3 py-4 text-center text-xs text-zinc-400", children: "\u6682\u65E0\u4EF7\u683C\u914D\u7F6E" }) })), pricing.map((r) => (_jsx(PricingEditorRow, { row: r, onSave: handleSavePricing, onDelete: handleDeletePricing }, r.id))), _jsx(AddPricingForm, { onAdd: () => void load() })] })] }) })] })] })] }));
}
