import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, Circle, Plus, Trash2, Save } from "lucide-react";
// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
const SECTIONS = [
    { to: "/settings/models", label: "模型供应商" },
    { to: "/settings/routing", label: "场景路由" },
    { to: "/settings/presets", label: "输出预设" },
];
export function SettingsPage() {
    const { section } = useParams();
    return (_jsxs("div", { className: "flex h-full gap-0", children: [_jsxs("aside", { className: "w-44 shrink-0 border-r border-zinc-200 bg-zinc-50 px-2 py-4", children: [_jsx("p", { className: "mb-2 px-3 text-xs font-medium uppercase tracking-wider text-zinc-400", children: "\u8BBE\u7F6E" }), SECTIONS.map(({ to, label }) => (_jsx(NavLink, { to: to, className: ({ isActive }) => `block rounded-md px-3 py-1.5 text-sm transition-colors ${isActive
                            ? "bg-zinc-100 font-medium text-zinc-900"
                            : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"}`, children: label }, to)))] }), _jsxs("div", { className: "flex-1 overflow-y-auto px-8 py-8", children: [section === "models" && _jsx(ModelsSection, {}), section === "routing" && _jsx(RoutingSection, {}), section === "presets" && _jsx(PresetsSection, {})] })] }));
}
// ---------------------------------------------------------------------------
// 1. Models section
// ---------------------------------------------------------------------------
const PROVIDER_META = {
    bailian: { label: "阿里云百炼", hasBaseUrl: false },
    volcengine: { label: "火山方舟/豆包", hasBaseUrl: false },
    gpt_proxy: { label: "GPT 中转服务", hasBaseUrl: true },
};
function ModelsSection() {
    const [providers, setProviders] = useState([]);
    useEffect(() => {
        api.get("/settings/providers").then(setProviders).catch(() => {
            toast.error("加载供应商配置失败");
        });
    }, []);
    // Ensure all 3 providers are shown even if not in DB yet
    const allNames = ["bailian", "volcengine", "gpt_proxy"];
    const displayed = allNames.map((name) => providers.find((p) => p.name === name) ?? { id: "", name, baseUrl: null, isConfigured: false, keyHint: null, updatedAt: 0 });
    async function handleSave(name, apiKey, baseUrl, modelId) {
        await api.put(`/settings/providers/${name}`, { apiKey, baseUrl, modelId });
        const updated = await api.get("/settings/providers");
        setProviders(updated);
        toast.success("API 密钥已保存");
    }
    return (_jsxs("div", { className: "max-w-2xl", children: [_jsx("h2", { className: "section-title mb-1 text-base text-zinc-900", children: "\u6A21\u578B\u4F9B\u5E94\u5546" }), _jsx("p", { className: "mb-6 text-sm text-zinc-500", children: "\u5BC6\u94A5\u53EA\u4FDD\u5B58\u5728\u672C\u673A\uFF0C\u4E0D\u4E0A\u4F20\u5230\u4EFB\u4F55\u670D\u52A1\u5668\u3002" }), _jsx("div", { className: "flex flex-col gap-4", children: displayed.map((p) => (_jsx(ProviderCard, { provider: p, onSave: handleSave }, p.name))) })] }));
}
function ProviderCard({ provider, onSave, }) {
    const meta = PROVIDER_META[provider.name];
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
    const [saving, setSaving] = useState(false);
    async function handleSubmit(e) {
        e.preventDefault();
        if (!apiKey.trim())
            return;
        setSaving(true);
        try {
            await onSave(provider.name, apiKey.trim(), baseUrl.trim() || undefined);
            setApiKey("");
        }
        finally {
            setSaving(false);
        }
    }
    return (_jsxs("div", { className: "rounded-lg border border-zinc-100 p-5", children: [_jsxs("div", { className: "mb-4 flex items-center gap-2", children: [_jsx("span", { className: "text-sm font-medium text-zinc-900", children: meta.label }), provider.isConfigured ? (_jsxs("span", { className: "flex items-center gap-1 text-xs text-green-600", children: [_jsx(CheckCircle, { size: 12 }), " \u5DF2\u914D\u7F6E"] })) : (_jsxs("span", { className: "flex items-center gap-1 text-xs text-zinc-400", children: [_jsx(Circle, { size: 12 }), " \u672A\u914D\u7F6E"] })), provider.isConfigured && provider.keyHint && (_jsxs("span", { className: "ml-auto font-mono text-xs text-zinc-400", children: ["\u2022\u2022\u2022\u2022", provider.keyHint] }))] }), _jsxs("form", { onSubmit: handleSubmit, className: "flex flex-col gap-3", children: [meta.hasBaseUrl && (_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx(Label, { htmlFor: `${provider.name}-baseurl`, children: provider.name === "bailian" ? "专属服务地址 Base URL" : "Base URL" }), _jsx(Input, { id: `${provider.name}-baseurl`, placeholder: "https://api.example.com", value: baseUrl, onChange: (e) => setBaseUrl(e.target.value) })] })), _jsxs("div", { className: "flex gap-2", children: [_jsx("div", { className: "flex-1", children: _jsx(Input, { type: "password", placeholder: provider.isConfigured ? "输入新密钥以更新" : "粘贴 API 密钥", value: apiKey, onChange: (e) => setApiKey(e.target.value), autoComplete: "off" }) }), _jsxs(Button, { type: "submit", disabled: !apiKey.trim() || saving, size: "sm", children: [_jsx(Save, { size: 14 }), saving ? "保存中…" : "保存"] })] })] })] }));
}
// ---------------------------------------------------------------------------
// 2. Routing section
// ---------------------------------------------------------------------------
const SCENE_LABELS = {
    competitor_image_analysis: "竞品图片分析",
    competitor_synthesis: "综合规律总结",
    design_plan: "设计方案生成",
    image_generation: "图片生成",
    image_edit: "图片微调",
};
const PROVIDER_OPTIONS = [
    { name: "bailian", label: "阿里云百炼" },
    { name: "volcengine", label: "火山方舟/豆包" },
    { name: "gpt_proxy", label: "GPT 中转服务" },
];
function RoutingSection() {
    const sceneOrder = Object.keys(SCENE_LABELS);
    const [rows, setRows] = useState(() => Object.fromEntries(sceneOrder.map((s) => [s, { providerName: "", modelId: "", dirty: false, saving: false }])));
    useEffect(() => {
        api
            .get("/settings/routes")
            .then((routes) => {
            setRows((prev) => {
                const next = { ...prev };
                for (const r of routes) {
                    next[r.scene] = {
                        providerName: (r.providerName ?? ""),
                        modelId: r.modelId ?? "",
                        dirty: false,
                        saving: false,
                    };
                }
                return next;
            });
        })
            .catch(() => toast.error("加载场景路由失败"));
    }, []);
    function update(scene, field, value) {
        setRows((prev) => ({
            ...prev,
            [scene]: { ...prev[scene], [field]: value, dirty: true },
        }));
    }
    async function save(scene) {
        const row = rows[scene];
        if (!row?.providerName || !row.modelId.trim()) {
            toast.error("请选择供应商并填写模型 ID");
            return;
        }
        setRows((prev) => ({ ...prev, [scene]: { ...prev[scene], saving: true } }));
        try {
            await api.put(`/settings/routes/${scene}`, {
                providerName: row.providerName,
                modelId: row.modelId.trim(),
            });
            setRows((prev) => ({ ...prev, [scene]: { ...prev[scene], dirty: false, saving: false } }));
            toast.success("已保存");
        }
        catch {
            toast.error("保存失败");
            setRows((prev) => ({ ...prev, [scene]: { ...prev[scene], saving: false } }));
        }
    }
    return (_jsxs("div", { className: "max-w-2xl", children: [_jsx("h2", { className: "section-title mb-1 text-base text-zinc-900", children: "\u573A\u666F\u8DEF\u7531" }), _jsx("p", { className: "mb-6 text-sm text-zinc-500", children: "\u6BCF\u4E2A\u573A\u666F\u72EC\u7ACB\u914D\u7F6E\u6A21\u578B\uFF0C\u4FEE\u6539\u4E0D\u5F71\u54CD\u5DF2\u63D0\u4EA4\u7684\u4EFB\u52A1\u3002" }), _jsx("div", { className: "overflow-hidden rounded-lg border border-zinc-200", children: sceneOrder.map((scene, i) => {
                    const row = rows[scene] ?? { providerName: "", modelId: "", dirty: false, saving: false };
                    const canSave = row.dirty && !!row.providerName && !!row.modelId.trim();
                    return (_jsxs("div", { className: `flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-zinc-100" : ""}`, children: [_jsx("span", { className: "w-32 shrink-0 text-sm text-zinc-700", children: SCENE_LABELS[scene] }), _jsxs("select", { className: "h-8 w-36 shrink-0 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900", value: row.providerName, onChange: (e) => update(scene, "providerName", e.target.value), children: [_jsx("option", { value: "", children: "\u2014 \u4F9B\u5E94\u5546 \u2014" }), PROVIDER_OPTIONS.map((p) => (_jsx("option", { value: p.name, children: p.label }, p.name)))] }), _jsx(Input, { className: "flex-1", placeholder: "\u6A21\u578B ID\uFF0C\u5982 qwen-vl-max", value: row.modelId, onChange: (e) => update(scene, "modelId", e.target.value), onKeyDown: (e) => e.key === "Enter" && canSave && save(scene) }), _jsx(Button, { size: "sm", variant: canSave ? "default" : "ghost", disabled: !canSave || row.saving, onClick: () => save(scene), className: "w-14 shrink-0", children: row.saving ? "…" : "保存" })] }, scene));
                }) })] }));
}
// ---------------------------------------------------------------------------
// 3. Presets section
// ---------------------------------------------------------------------------
function PresetsSection() {
    const [presets, setPresets] = useState([]);
    const [adding, setAdding] = useState(false);
    useEffect(() => {
        api.get("/settings/presets").then(setPresets).catch(() => toast.error("加载预设失败"));
    }, []);
    async function handleUpdate(id, patch) {
        try {
            const updated = await api.patch(`/settings/presets/${id}`, patch);
            setPresets((prev) => prev.map((p) => (p.id === id ? updated : p)));
        }
        catch {
            toast.error("保存失败");
        }
    }
    async function handleDelete(id) {
        await api.delete(`/settings/presets/${id}`);
        setPresets((prev) => prev.filter((p) => p.id !== id));
        toast.success("预设已删除");
    }
    async function handleAdd(preset) {
        const created = await api.post("/settings/presets", preset);
        setPresets((prev) => [...prev, created]);
        setAdding(false);
        toast.success("预设已创建");
    }
    return (_jsxs("div", { className: "max-w-3xl", children: [_jsxs("div", { className: "mb-6 flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "section-title mb-1 text-base text-zinc-900", children: "\u8F93\u51FA\u9884\u8BBE" }), _jsx("p", { className: "text-sm text-zinc-500", children: "\u521B\u5EFA\u4EFB\u52A1\u65F6\u53EF\u9009\u62E9\u9884\u8BBE\uFF0C\u4EFB\u52A1\u4FDD\u5B58\u5FEB\u7167\u4E0D\u53D7\u540E\u7EED\u4FEE\u6539\u5F71\u54CD\u3002" })] }), _jsxs(Button, { size: "sm", variant: "outline", onClick: () => setAdding(true), children: [_jsx(Plus, { size: 14 }), "\u65B0\u5EFA\u9884\u8BBE"] })] }), _jsx("div", { className: "overflow-hidden rounded-lg border border-zinc-200", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-zinc-100 bg-zinc-50 text-xs text-zinc-500", children: [_jsx("th", { className: "px-4 py-2 text-left font-medium", children: "\u540D\u79F0" }), _jsx("th", { className: "px-4 py-2 text-left font-medium", children: "\u7C7B\u578B" }), _jsx("th", { className: "px-4 py-2 text-left font-medium", children: "\u5C3A\u5BF8" }), _jsx("th", { className: "px-4 py-2 text-left font-medium", children: "\u683C\u5F0F" }), _jsx("th", { className: "px-4 py-2 text-left font-medium", children: "\u8D28\u91CF" }), _jsx("th", { className: "px-4 py-2" })] }) }), _jsxs("tbody", { className: "divide-y divide-zinc-100", children: [presets.map((preset) => (_jsx(PresetRow, { preset: preset, onUpdate: (patch) => handleUpdate(preset.id, patch), onDelete: () => handleDelete(preset.id) }, preset.id))), adding && (_jsx(NewPresetRow, { onSave: handleAdd, onCancel: () => setAdding(false) }))] })] }) })] }));
}
function PresetRow({ preset, onUpdate, onDelete, }) {
    return (_jsxs("tr", { className: "group hover:bg-zinc-50", children: [_jsx("td", { className: "px-4 py-2", children: _jsx(InlineEdit, { value: preset.name, onCommit: (v) => onUpdate({ name: v }) }) }), _jsx("td", { className: "px-4 py-2 text-zinc-500", children: preset.presetType === "main_image" ? "主图" : "详情模块" }), _jsxs("td", { className: "px-4 py-2 font-mono text-zinc-700", children: [preset.width, " \u00D7 ", preset.height] }), _jsx("td", { className: "px-4 py-2 uppercase text-zinc-500", children: preset.format }), _jsx("td", { className: "px-4 py-2 text-zinc-500", children: preset.quality }), _jsx("td", { className: "px-4 py-2 text-right", children: !preset.isDefault && (_jsx("button", { onClick: onDelete, className: "invisible text-zinc-400 hover:text-red-600 group-hover:visible", children: _jsx(Trash2, { size: 14 }) })) })] }));
}
function NewPresetRow({ onSave, onCancel, }) {
    const [name, setName] = useState("");
    const [presetType, setPresetType] = useState("main_image");
    const [width, setWidth] = useState(1000);
    const [height, setHeight] = useState(1000);
    const [format, setFormat] = useState("jpg");
    const [quality, setQuality] = useState(90);
    function handleSave() {
        if (!name.trim())
            return;
        onSave({ name: name.trim(), presetType, width, height, format, quality });
    }
    return (_jsxs("tr", { className: "bg-zinc-50", children: [_jsx("td", { className: "px-4 py-2", children: _jsx(Input, { autoFocus: true, className: "h-7 text-xs", placeholder: "\u9884\u8BBE\u540D\u79F0", value: name, onChange: (e) => setName(e.target.value) }) }), _jsx("td", { className: "px-4 py-2", children: _jsxs("select", { className: "h-7 rounded border border-zinc-200 px-1 text-xs", value: presetType, onChange: (e) => setPresetType(e.target.value), children: [_jsx("option", { value: "main_image", children: "\u4E3B\u56FE" }), _jsx("option", { value: "detail_module", children: "\u8BE6\u60C5\u6A21\u5757" })] }) }), _jsx("td", { className: "px-4 py-2", children: _jsxs("div", { className: "flex items-center gap-1", children: [_jsx(Input, { type: "number", className: "h-7 w-16 text-xs", value: width, onChange: (e) => setWidth(Number(e.target.value)) }), _jsx("span", { className: "text-zinc-400", children: "\u00D7" }), _jsx(Input, { type: "number", className: "h-7 w-16 text-xs", value: height, onChange: (e) => setHeight(Number(e.target.value)) })] }) }), _jsx("td", { className: "px-4 py-2", children: _jsxs("select", { className: "h-7 rounded border border-zinc-200 px-1 text-xs", value: format, onChange: (e) => setFormat(e.target.value), children: [_jsx("option", { value: "jpg", children: "JPG" }), _jsx("option", { value: "png", children: "PNG" })] }) }), _jsx("td", { className: "px-4 py-2", children: _jsx(Input, { type: "number", className: "h-7 w-14 text-xs", value: quality, min: 1, max: 100, onChange: (e) => setQuality(Number(e.target.value)) }) }), _jsx("td", { className: "px-4 py-2", children: _jsxs("div", { className: "flex justify-end gap-1", children: [_jsx(Button, { size: "sm", variant: "ghost", onClick: onCancel, className: "h-7 text-xs", children: "\u53D6\u6D88" }), _jsx(Button, { size: "sm", onClick: handleSave, className: "h-7 text-xs", disabled: !name.trim(), children: "\u4FDD\u5B58" })] }) })] }));
}
// ---------------------------------------------------------------------------
// Inline editable cell
// ---------------------------------------------------------------------------
function InlineEdit({ value, onCommit, }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    if (!editing) {
        return (_jsx("button", { onClick: () => { setDraft(value); setEditing(true); }, className: "rounded px-1 text-left hover:bg-zinc-100", children: value }));
    }
    return (_jsx(Input, { autoFocus: true, className: "h-7 text-xs", value: draft, onChange: (e) => setDraft(e.target.value), onBlur: () => { onCommit(draft); setEditing(false); }, onKeyDown: (e) => {
            if (e.key === "Enter") {
                onCommit(draft);
                setEditing(false);
            }
            if (e.key === "Escape") {
                setDraft(value);
                setEditing(false);
            }
        } }));
}
