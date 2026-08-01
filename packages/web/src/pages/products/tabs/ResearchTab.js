import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Zap, RefreshCw, Pencil, X, Check, Loader2, ZoomIn } from "lucide-react";
import { api } from "@/lib/api";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, } from "@/components/ui/dialog";
// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function ResearchTab({ productId }) {
    const [assets, setAssets] = useState([]);
    const [versions, setVersions] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [cards, setCards] = useState([]);
    const [assetMap, setAssetMap] = useState({});
    const [report, setReport] = useState(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [synthesizing, setSynthesizing] = useState(false);
    const pollRef = useRef(null);
    // ── Load assets + versions ──────────────────────────────────────────────
    const loadData = useCallback(async () => {
        const [assetList, versionList] = await Promise.all([
            api.get(`/research/${productId}/assets`),
            api.get(`/research/${productId}/versions`),
        ]);
        setAssets(assetList);
        setAssetMap(Object.fromEntries(assetList.map((a) => [a.id, a])));
        setVersions(versionList);
        if (versionList.length > 0 && !selectedId) {
            setSelectedId(versionList[0].id);
        }
    }, [productId, selectedId]);
    useEffect(() => { loadData().catch(() => { }); }, [productId]);
    // ── Load version detail ─────────────────────────────────────────────────
    const loadVersion = useCallback(async (versionId) => {
        const detail = await api.get(`/research/versions/${versionId}`);
        setCards(detail.cards);
        setReport(detail.report);
    }, []);
    useEffect(() => {
        if (selectedId)
            loadVersion(selectedId).catch(() => { });
    }, [selectedId, loadVersion]);
    // ── Job polling ─────────────────────────────────────────────────────────
    function startPolling(versionId) {
        stopPolling();
        pollRef.current = setInterval(async () => {
            const jobs = await api.get(`/jobs?entityType=analysis_version&entityId=${versionId}`).catch(() => []);
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
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }
    useEffect(() => () => stopPolling(), []);
    // ── Trigger analysis ────────────────────────────────────────────────────
    async function handleAnalyze() {
        if (assets.length === 0) {
            toast.error("请先上传竞品素材");
            return;
        }
        setAnalyzing(true);
        try {
            const res = await api.post(`/research/${productId}/analyze`, {});
            const newVersion = res.version;
            setVersions((prev) => [newVersion, ...prev]);
            setSelectedId(newVersion.id);
            setCards([]);
            setReport(null);
            toast.success(`分析任务已提交 (${res.jobIds.length} 张图)`);
            startPolling(newVersion.id);
        }
        catch {
            setAnalyzing(false);
            toast.error("提交分析失败");
        }
    }
    // ── Trigger synthesis ───────────────────────────────────────────────────
    async function handleSynthesize() {
        if (!selectedId)
            return;
        setSynthesizing(true);
        try {
            await api.post(`/research/versions/${selectedId}/synthesize`, {});
            toast.success("综合报告生成任务已提交");
            startPolling(selectedId);
        }
        catch {
            setSynthesizing(false);
            toast.error("提交综合报告失败");
        }
    }
    // ── Version label helper ────────────────────────────────────────────────
    function versionLabel(v) {
        const date = new Date(v.createdAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
        const count = JSON.parse(v.competitorAssetIds).length;
        return `v${v.versionNumber} · ${date} · ${count}张`;
    }
    // ── Render ──────────────────────────────────────────────────────────────
    return (_jsxs("div", { className: "flex h-full flex-col", children: [_jsxs("div", { className: "flex items-center gap-3 border-b border-zinc-100 px-8 py-3", children: [_jsx("select", { className: "h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900", value: selectedId ?? "", onChange: (e) => setSelectedId(e.target.value), disabled: versions.length === 0, children: versions.length === 0
                            ? _jsx("option", { value: "", children: "\u2014 \u6682\u65E0\u5206\u6790\u7248\u672C \u2014" })
                            : versions.map((v) => (_jsx("option", { value: v.id, children: versionLabel(v) }, v.id))) }), _jsx("div", { className: "flex-1" }), _jsxs(Button, { variant: "outline", size: "sm", onClick: () => setSheetOpen(true), children: [_jsx(Upload, { size: 14 }), " \u7BA1\u7406\u7D20\u6750 (", assets.length, ")"] }), _jsx(Button, { size: "sm", onClick: handleAnalyze, disabled: analyzing || assets.length === 0, children: analyzing
                            ? _jsxs(_Fragment, { children: [_jsx(Loader2, { size: 14, className: "animate-spin" }), " \u5206\u6790\u4E2D\u2026"] })
                            : _jsxs(_Fragment, { children: [_jsx(Zap, { size: 14 }), " \u751F\u6210\u5206\u6790"] }) })] }), versions.length === 0 ? (_jsx(EmptyResearch, { onUpload: () => setSheetOpen(true), onAnalyze: handleAnalyze, hasAssets: assets.length > 0 })) : (_jsxs("div", { className: "flex flex-1 overflow-hidden", children: [_jsx("div", { className: "flex-1 overflow-y-auto px-8 py-6", children: analyzing && cards.length === 0 ? (_jsx("div", { className: "grid grid-cols-2 gap-3", children: Array.from({ length: 4 }).map((_, i) => (_jsxs("div", { className: "animate-pulse rounded-lg border border-zinc-100", children: [_jsx("div", { className: "aspect-video w-full bg-zinc-100" }), _jsxs("div", { className: "p-3 space-y-2", children: [_jsx("div", { className: "h-3 w-3/4 rounded bg-zinc-100" }), _jsx("div", { className: "h-3 w-1/2 rounded bg-zinc-100" })] })] }, i))) })) : (_jsx("div", { className: "grid grid-cols-2 gap-3", children: cards.map((card) => (_jsx(AnalysisCard, { card: card, asset: assetMap[card.competitorAssetId], onOverrideSaved: (updated) => setCards((prev) => prev.map((c) => c.id === updated.id ? updated : c)) }, card.id))) })) }), _jsx("div", { className: "w-[38%] shrink-0 overflow-y-auto border-l border-zinc-100 px-5 py-6", children: _jsx(SynthesisPanel, { report: report, synthesizing: synthesizing, onSynthesize: handleSynthesize, cards: cards }) })] })), _jsx(AssetSheet, { open: sheetOpen, onClose: () => setSheetOpen(false), productId: productId, assets: assets, onUploaded: (a) => setAssets((prev) => [...prev, a]), onDeleted: (id) => setAssets((prev) => prev.filter((a) => a.id !== id)) })] }));
}
// ---------------------------------------------------------------------------
// Analysis card
// ---------------------------------------------------------------------------
/** Convert any field value to a display string, handling nested objects gracefully. */
function fieldValueToString(key, val) {
    if (val === null || val === undefined)
        return "";
    if (typeof val === "string")
        return val;
    // colors: { palette, mood }
    if (key === "colors" && typeof val === "object" && !Array.isArray(val)) {
        const c = val;
        const parts = [c["palette"], c["mood"]].filter(Boolean);
        return parts.length > 0 ? parts.join(" · ") : JSON.stringify(val);
    }
    if (Array.isArray(val))
        return val.join("；");
    if (typeof val === "object")
        return JSON.stringify(val);
    return String(val);
}
function AnalysisCard({ card, asset, onOverrideSaved, }) {
    const [editOpen, setEditOpen] = useState(false);
    const [lightboxSrc, setLightboxSrc] = useState(null);
    const effective = card.humanOverride
        ? JSON.parse(card.humanOverride)
        : JSON.parse(card.modelOutput);
    const isOverridden = !!card.humanOverride;
    const isEmpty = !effective || Object.keys(effective).length === 0 || !!effective["raw"];
    const imgUrl = asset
        ? `/api/products/assets/file?path=${encodeURIComponent(asset.filePath)}`
        : null;
    const FIELD_LABELS = {
        layout: "版式", colors: "配色", typography: "字体",
        copy: "文案", selling_points: "卖点", scene: "场景",
        techniques: "手法", emotional_appeal: "情感", strengths: "亮点",
    };
    return (_jsxs("div", { className: `group overflow-hidden rounded-lg border bg-white ${isOverridden ? "border-zinc-300" : "border-zinc-100"}`, children: [_jsxs("div", { className: "relative aspect-video w-full overflow-hidden bg-zinc-50", children: [imgUrl ? (_jsx("img", { src: imgUrl, alt: "", className: "h-full w-full object-cover" })) : (_jsx("div", { className: "flex h-full items-center justify-center text-xs text-zinc-400", children: "\u65E0\u56FE" })), isOverridden && (_jsx("span", { className: "absolute left-2 top-2 rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-white", children: "\u5DF2\u4FEE\u6B63" })), isEmpty && (_jsx("div", { className: "absolute inset-0 flex items-center justify-center bg-zinc-50/80", children: _jsx(Loader2, { size: 20, className: "animate-spin text-zinc-300" }) })), imgUrl && (_jsx("button", { onClick: () => setLightboxSrc(imgUrl), className: "absolute right-2 top-2 rounded bg-white/80 p-1 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100", "aria-label": "\u653E\u5927\u67E5\u770B", children: _jsx(ZoomIn, { size: 12, className: "text-zinc-500" }) }))] }), _jsxs("div", { className: "p-3", children: [!isEmpty && (_jsx("div", { className: "mb-2 space-y-1", children: Object.entries(FIELD_LABELS).map(([key, label]) => {
                            const val = effective[key];
                            if (!val)
                                return null;
                            const display = fieldValueToString(key, val);
                            if (!display)
                                return null;
                            return (_jsxs("div", { className: "flex gap-1.5 text-xs leading-relaxed", children: [_jsx("span", { className: "w-8 shrink-0 text-zinc-400", children: label }), _jsx("span", { className: "text-zinc-700 line-clamp-2", children: display })] }, key));
                        }) })), _jsxs("button", { onClick: () => setEditOpen(true), className: "flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700", children: [_jsx(Pencil, { size: 11 }), " \u4FEE\u6B63"] })] }), _jsx(OverrideDialog, { open: editOpen, onOpenChange: setEditOpen, card: card, effective: effective, fieldLabels: FIELD_LABELS, onSaved: onOverrideSaved }), _jsx(ImageLightbox, { src: lightboxSrc, onClose: () => setLightboxSrc(null) })] }));
}
// ---------------------------------------------------------------------------
// Override dialog
// ---------------------------------------------------------------------------
function OverrideDialog({ open, onOpenChange, card, effective, fieldLabels, onSaved, }) {
    // Draft stores everything as strings for textarea editing; objects are serialised.
    const [draft, setDraft] = useState({});
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        if (open) {
            const stringified = {};
            for (const [k, v] of Object.entries(effective)) {
                stringified[k] = fieldValueToString(k, v);
            }
            setDraft(stringified);
        }
    }, [open, effective]);
    async function handleSave() {
        setSaving(true);
        try {
            const updated = await api.patch(`/research/cards/${card.id}`, {
                humanOverride: draft,
            });
            onSaved(updated);
            onOpenChange(false);
            toast.success("修正已保存");
        }
        catch {
            toast.error("保存失败");
        }
        finally {
            setSaving(false);
        }
    }
    return (_jsx(Dialog, { open: open, onOpenChange: onOpenChange, children: _jsxs(DialogContent, { className: "max-w-lg", children: [_jsx(DialogHeader, { children: _jsx(DialogTitle, { children: "\u4FEE\u6B63\u5206\u6790\u5361\u7247" }) }), _jsx("div", { className: "flex flex-col gap-3", children: Object.entries(fieldLabels).map(([key, label]) => (_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx(Label, { className: "text-xs text-zinc-500", children: label }), _jsx(Textarea, { rows: 2, value: draft[key] ?? "", onChange: (e) => setDraft((d) => ({ ...d, [key]: e.target.value })) })] }, key))) }), _jsxs(DialogFooter, { children: [_jsx(DialogClose, { render: _jsx(Button, { variant: "outline", type: "button", children: "\u53D6\u6D88" }) }), _jsx(Button, { onClick: handleSave, disabled: saving, children: saving ? "保存中…" : _jsxs(_Fragment, { children: [_jsx(Check, { size: 14 }), " \u4FDD\u5B58\u4FEE\u6B63"] }) })] })] }) }));
}
// ---------------------------------------------------------------------------
// Synthesis report panel
// ---------------------------------------------------------------------------
function SynthesisPanel({ report, synthesizing, onSynthesize, cards, }) {
    const parsed = report ? JSON.parse(report.content) : null;
    const allDone = cards.length > 0 && cards.every((c) => c.modelOutput !== "");
    return (_jsxs("div", { children: [_jsxs("div", { className: "mb-4 flex items-start justify-between", children: [_jsx("h3", { className: "section-title text-sm text-zinc-900", children: "\u7EFC\u5408\u62A5\u544A" }), _jsx(Button, { size: "sm", variant: "outline", onClick: onSynthesize, disabled: synthesizing || !allDone, className: "shrink-0", children: synthesizing
                            ? _jsxs(_Fragment, { children: [_jsx(Loader2, { size: 12, className: "animate-spin" }), " \u751F\u6210\u4E2D"] })
                            : _jsxs(_Fragment, { children: [_jsx(RefreshCw, { size: 12 }), " \u57FA\u4E8E\u4FEE\u6B63\u91CD\u65B0\u751F\u6210"] }) })] }), !report && !synthesizing && (_jsx("p", { className: "text-xs text-zinc-400", children: allDone
                    ? "逐图分析已完成，点击右上角按钮生成综合报告。"
                    : "等待逐图分析完成后即可生成综合报告。" })), synthesizing && !report && (_jsxs("div", { className: "flex items-center gap-2 text-xs text-zinc-400", children: [_jsx(Loader2, { size: 12, className: "animate-spin" }), " \u7EFC\u5408\u62A5\u544A\u751F\u6210\u4E2D\u2026"] })), parsed && (_jsx("div", { className: "space-y-5 text-sm", children: [
                    ["行业共性规律", "industry_patterns"],
                    ["差异化机会", "differentiation_opportunities"],
                    ["设计建议", "design_suggestions"],
                ].map(([label, key]) => (_jsxs("div", { children: [_jsx("p", { className: "mb-1.5 font-medium text-zinc-800", children: label }), _jsx("p", { className: "leading-relaxed text-zinc-600 whitespace-pre-wrap text-xs", children: typeof parsed[key] === "string"
                                ? parsed[key]
                                : JSON.stringify(parsed[key], null, 2) })] }, key))) }))] }));
}
// ---------------------------------------------------------------------------
// Asset management sheet
// ---------------------------------------------------------------------------
function AssetSheet({ open, onClose, productId, assets, onUploaded, onDeleted, }) {
    const inputRef = useRef(null);
    const [uploading, setUploading] = useState(false);
    const [lightboxSrc, setLightboxSrc] = useState(null);
    async function handleFiles(files) {
        if (!files?.length)
            return;
        setUploading(true);
        try {
            for (const file of Array.from(files)) {
                const asset = await api.upload(`/products/${productId}/competitor-assets`, file);
                onUploaded(asset);
            }
        }
        catch {
            toast.error("上传失败");
        }
        finally {
            setUploading(false);
            if (inputRef.current)
                inputRef.current.value = "";
        }
    }
    async function handleDelete(id) {
        await api.delete(`/products/${productId}/competitor-assets/${id}`).catch(() => {
            toast.error("删除失败");
            return;
        });
        onDeleted(id);
    }
    return (_jsxs(_Fragment, { children: [_jsx(Sheet, { open: open, onOpenChange: onClose, title: "\u7ADE\u54C1\u7D20\u6750", children: _jsxs("div", { className: "p-6", children: [_jsxs("button", { onClick: () => inputRef.current?.click(), disabled: uploading, className: "mb-5 flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-200 py-8 text-zinc-400 hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50", children: [uploading
                                    ? _jsx(Loader2, { size: 20, className: "animate-spin" })
                                    : _jsx(Upload, { size: 20 }), _jsx("span", { className: "text-sm", children: uploading ? "上传中…" : "点击上传竞品图片" }), _jsx("span", { className: "text-xs", children: "JPEG / PNG / WEBP\uFF0C\u6700\u5927 20 MB" })] }), _jsx("input", { ref: inputRef, type: "file", multiple: true, accept: "image/jpeg,image/png,image/webp", className: "hidden", onChange: (e) => handleFiles(e.target.files) }), assets.length === 0 ? (_jsx("p", { className: "text-center text-xs text-zinc-400", children: "\u6682\u65E0\u7ADE\u54C1\u7D20\u6750" })) : (_jsx("div", { className: "grid grid-cols-3 gap-2", children: assets.map((asset) => {
                                const url = `/api/products/assets/file?path=${encodeURIComponent(asset.filePath)}`;
                                return (_jsxs("div", { className: "group relative aspect-square overflow-hidden rounded-lg border border-zinc-100", children: [_jsx("img", { src: url, alt: asset.originalName ?? "", className: "h-full w-full object-cover" }), _jsx("button", { onClick: () => setLightboxSrc(url), className: "absolute left-1 bottom-1 rounded bg-white/80 p-1 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100", "aria-label": "\u653E\u5927\u67E5\u770B", children: _jsx(ZoomIn, { size: 12, className: "text-zinc-500" }) }), _jsx("button", { onClick: () => handleDelete(asset.id), className: "absolute right-1 top-1 rounded bg-white/80 p-1 opacity-0 shadow-sm transition-opacity hover:bg-red-50 group-hover:opacity-100", "aria-label": "\u5220\u9664", children: _jsx(X, { size: 12, className: "text-zinc-500 hover:text-red-600" }) })] }, asset.id));
                            }) }))] }) }), _jsx(ImageLightbox, { src: lightboxSrc, onClose: () => setLightboxSrc(null) })] }));
}
// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
function EmptyResearch({ onUpload, onAnalyze, hasAssets, }) {
    return (_jsxs("div", { className: "flex flex-1 flex-col items-center justify-center gap-3 py-20 text-zinc-400", children: [_jsx(Zap, { size: 36, strokeWidth: 1.5 }), _jsx("p", { className: "text-sm", children: "\u4E0A\u4F20\u7ADE\u54C1\u56FE\u7247\u540E\u751F\u6210\u5206\u6790" }), _jsxs("div", { className: "flex gap-2", children: [_jsxs(Button, { variant: "outline", size: "sm", onClick: onUpload, children: [_jsx(Upload, { size: 14 }), " \u4E0A\u4F20\u7ADE\u54C1\u56FE"] }), hasAssets && (_jsxs(Button, { size: "sm", onClick: onAnalyze, children: [_jsx(Zap, { size: 14 }), " \u751F\u6210\u5206\u6790"] }))] })] }));
}
