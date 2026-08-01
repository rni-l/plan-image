import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable, arrayMove, } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Sparkles, Trash2, Upload, X, ZoomIn, } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, } from "@/components/ui/dialog";
// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function ProductInfoTab({ productId, onNameChange, }) {
    const [product, setProduct] = useState(null);
    const [assets, setAssets] = useState([]);
    const [name, setName] = useState("");
    const [notes, setNotes] = useState("");
    const [specs, setSpecs] = useState([]);
    const [points, setPoints] = useState([]);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    // Lightbox
    const [lightboxSrc, setLightboxSrc] = useState(null);
    // AI extraction dialog
    const [extractOpen, setExtractOpen] = useState(false);
    const [extractRaw, setExtractRaw] = useState("");
    const [extracting, setExtracting] = useState(false);
    const [extracted, setExtracted] = useState(null);
    const [extractError, setExtractError] = useState(null);
    // Track whether form is dirty
    const initial = useRef({ name: "", notes: "", specs: "[]", points: "[]" });
    const dirty = name !== initial.current.name ||
        notes !== initial.current.notes ||
        JSON.stringify(specs) !== initial.current.specs ||
        JSON.stringify(points) !== initial.current.points;
    // Load product
    useEffect(() => {
        api
            .get(`/products/${productId}`)
            .then((p) => {
            setProduct(p);
            setAssets([...p.assets].sort((a, b) => a.sortOrder - b.sortOrder));
            const n = p.name ?? "";
            const no = p.notes ?? "";
            const sp = p.specifications.map((s) => ({
                label: s.label,
                value: s.value,
            }));
            const pts = p.sellingPoints.map((s) => s.content);
            setName(n);
            setNotes(no);
            setSpecs(sp);
            setPoints(pts);
            initial.current = {
                name: n,
                notes: no,
                specs: JSON.stringify(sp),
                points: JSON.stringify(pts),
            };
        })
            .catch(() => toast.error("加载商品资料失败"));
    }, [productId]);
    // Image upload
    const handleUpload = useCallback(async (files) => {
        if (!files?.length)
            return;
        setUploading(true);
        try {
            for (const file of Array.from(files)) {
                const asset = await api.upload(`/products/${productId}/assets`, file);
                setAssets((prev) => [...prev, asset]);
            }
        }
        catch {
            toast.error("上传失败，请检查文件格式（JPEG / PNG / WEBP，最大 20 MB）");
        }
        finally {
            setUploading(false);
        }
    }, [productId]);
    // Drag-and-drop reorder
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
    async function handleDragEnd(event) {
        const { active, over } = event;
        if (!over || active.id === over.id)
            return;
        const oldIdx = assets.findIndex((a) => a.id === active.id);
        const newIdx = assets.findIndex((a) => a.id === over.id);
        const reordered = arrayMove(assets, oldIdx, newIdx);
        setAssets(reordered);
        await api
            .patch(`/products/${productId}/assets/reorder`, {
            ids: reordered.map((a) => a.id),
        })
            .catch(() => toast.error("排序保存失败"));
    }
    // Delete image
    async function handleDeleteAsset(assetId) {
        await api.delete(`/products/${productId}/assets/${assetId}`).catch(() => {
            toast.error("删除失败");
            return;
        });
        setAssets((prev) => prev.filter((a) => a.id !== assetId));
    }
    // Save form
    async function handleSave() {
        setSaving(true);
        try {
            await Promise.all([
                api.patch(`/products/${productId}`, {
                    name,
                    notes: notes || undefined,
                }),
                api.put(`/products/${productId}/specs`, { specs }),
                api.put(`/products/${productId}/selling-points`, {
                    sellingPoints: points,
                }),
            ]);
            initial.current = {
                name,
                notes,
                specs: JSON.stringify(specs),
                points: JSON.stringify(points),
            };
            onNameChange?.(name);
            toast.success("已保存");
        }
        catch {
            toast.error("保存失败，请重试");
        }
        finally {
            setSaving(false);
        }
    }
    // AI extract
    async function handleExtract() {
        if (!extractRaw.trim())
            return;
        setExtracting(true);
        setExtracted(null);
        setExtractError(null);
        try {
            const result = await api.post(`/products/${productId}/extract-info`, {
                rawText: extractRaw,
            });
            setExtracted(result);
        }
        catch {
            setExtractError("提取失败，请检查模型配置或稍后重试");
        }
        finally {
            setExtracting(false);
        }
    }
    // Apply extracted data to form
    function handleApplyExtract() {
        if (!extracted)
            return;
        if (extracted.specs.length > 0)
            setSpecs(extracted.specs);
        if (extracted.sellingPoints.length > 0)
            setPoints(extracted.sellingPoints);
        if (extracted.notes)
            setNotes(extracted.notes);
        setExtractOpen(false);
        setExtracted(null);
        setExtractRaw("");
        toast.success("已填入表单，记得保存修改");
    }
    function handleExtractDialogOpenChange(open) {
        setExtractOpen(open);
        if (!open) {
            setExtracted(null);
            setExtractError(null);
        }
    }
    if (!product) {
        return _jsx("div", { className: "px-8 py-6 text-sm text-zinc-400", children: "\u52A0\u8F7D\u4E2D\u2026" });
    }
    return (_jsxs("div", { className: "flex h-full flex-col", children: [_jsxs("div", { className: "grid min-h-0 flex-1 grid-cols-[40%_60%] gap-8 overflow-hidden px-8 py-6  pr-16", children: [_jsxs("div", { className: "overflow-y-auto", children: [_jsx(Label, { className: "mb-3 block text-zinc-700", children: "\u5546\u54C1\u53C2\u8003\u56FE" }), _jsx(DndContext, { sensors: sensors, collisionDetection: closestCenter, onDragEnd: handleDragEnd, children: _jsx(SortableContext, { items: assets.map((a) => a.id), strategy: rectSortingStrategy, children: _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [assets.map((asset) => (_jsx(SortableImageItem, { asset: asset, onDelete: () => handleDeleteAsset(asset.id), onZoom: (src) => setLightboxSrc(src) }, asset.id))), _jsx(UploadCard, { uploading: uploading, onFiles: handleUpload })] }) }) })] }), _jsxs("div", { className: "flex min-h-0 flex-col gap-6 overflow-y-auto pr-1", children: [_jsxs("div", { className: "flex items-end gap-3", children: [_jsxs("div", { className: "flex flex-1 flex-col gap-1.5", children: [_jsx(Label, { htmlFor: "pname", children: "\u5546\u54C1\u540D\u79F0" }), _jsx(Input, { id: "pname", value: name, onChange: (e) => setName(e.target.value) })] }), _jsxs(Button, { variant: "outline", size: "sm", className: "shrink-0", onClick: () => setExtractOpen(true), children: [_jsx(Sparkles, { size: 14 }), " AI \u63D0\u53D6\u4FE1\u606F"] })] }), _jsxs("div", { children: [_jsxs("div", { className: "mb-2 flex items-center justify-between", children: [_jsx(Label, { className: "text-zinc-700", children: "\u89C4\u683C\u53C2\u6570" }), _jsxs("button", { onClick: () => setSpecs((s) => [...s, { label: "", value: "" }]), className: "flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700", children: [_jsx(Plus, { size: 12 }), " \u6DFB\u52A0"] })] }), _jsxs("div", { className: "flex flex-col gap-1.5", children: [specs.length === 0 && (_jsx("p", { className: "text-xs text-zinc-400", children: "\u6682\u65E0\u89C4\u683C\u53C2\u6570" })), specs.map((spec, i) => (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Input, { className: "w-28 shrink-0", placeholder: "\u53C2\u6570\u540D", value: spec.label, onChange: (e) => setSpecs((s) => s.map((x, j) => j === i ? { ...x, label: e.target.value } : x)) }), _jsx(Input, { className: "flex-1", placeholder: "\u53C2\u6570\u503C", value: spec.value, onChange: (e) => setSpecs((s) => s.map((x, j) => j === i ? { ...x, value: e.target.value } : x)) }), _jsx("button", { onClick: () => setSpecs((s) => s.filter((_, j) => j !== i)), className: "shrink-0 text-zinc-300 hover:text-red-500", children: _jsx(X, { size: 14 }) })] }, i)))] })] }), _jsxs("div", { children: [_jsxs("div", { className: "mb-2 flex items-center justify-between", children: [_jsx(Label, { className: "text-zinc-700", children: "\u6838\u5FC3\u5356\u70B9" }), _jsxs("button", { onClick: () => setPoints((p) => [...p, ""]), className: "flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700", children: [_jsx(Plus, { size: 12 }), " \u6DFB\u52A0"] })] }), _jsxs("div", { className: "flex flex-col gap-1.5", children: [points.length === 0 && (_jsx("p", { className: "text-xs text-zinc-400", children: "\u6682\u65E0\u5356\u70B9" })), points.map((pt, i) => (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Input, { className: "flex-1", placeholder: `卖点 ${i + 1}`, value: pt, onChange: (e) => setPoints((p) => p.map((x, j) => (j === i ? e.target.value : x))) }), _jsx("button", { onClick: () => setPoints((p) => p.filter((_, j) => j !== i)), className: "shrink-0 text-zinc-300 hover:text-red-500", children: _jsx(X, { size: 14 }) })] }, i)))] })] }), _jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx(Label, { htmlFor: "pnotes", children: "\u5907\u6CE8" }), _jsx(Textarea, { id: "pnotes", rows: 3, placeholder: "\u53EF\u9009\u5907\u6CE8", value: notes, onChange: (e) => setNotes(e.target.value) })] })] })] }), _jsx("div", { className: "flex justify-end border-t border-zinc-100 px-8 py-4", children: _jsx(Button, { onClick: handleSave, disabled: !dirty || saving, children: saving ? "保存中…" : "保存修改" }) }), _jsx(ImageLightbox, { src: lightboxSrc, onClose: () => setLightboxSrc(null) }), _jsx(TextExtractDialog, { open: extractOpen, onOpenChange: handleExtractDialogOpenChange, rawText: extractRaw, onRawTextChange: setExtractRaw, extracting: extracting, extracted: extracted, extractError: extractError, onExtract: handleExtract, onApply: handleApplyExtract, onReset: () => {
                    setExtracted(null);
                    setExtractError(null);
                } })] }));
}
// ---------------------------------------------------------------------------
// Sortable image item
// ---------------------------------------------------------------------------
function SortableImageItem({ asset, onDelete, onZoom, }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging, } = useSortable({ id: asset.id });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };
    const imgUrl = `/api/products/assets/file?path=${encodeURIComponent(asset.filePath)}`;
    return (_jsxs("div", { ref: setNodeRef, style: style, className: "group relative aspect-square overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50", children: [_jsx("img", { src: imgUrl, alt: "", className: "h-full w-full object-cover", draggable: false }), _jsx("div", { ...listeners, ...attributes, className: "absolute left-1 top-1 cursor-grab rounded bg-white/80 p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100", children: _jsx(GripVertical, { size: 12, className: "text-zinc-500" }) }), _jsx("button", { onClick: () => onZoom(imgUrl), className: "absolute left-1 bottom-1 rounded bg-white/80 p-0.5 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100", "aria-label": "\u653E\u5927\u67E5\u770B", children: _jsx(ZoomIn, { size: 12, className: "text-zinc-500" }) }), _jsx("button", { onClick: onDelete, className: "absolute right-1 top-1 rounded bg-white/80 p-0.5 opacity-0 shadow-sm transition-opacity hover:bg-red-50 group-hover:opacity-100", children: _jsx(Trash2, { size: 12, className: "text-zinc-500 hover:text-red-600" }) })] }));
}
// ---------------------------------------------------------------------------
// Upload card
// ---------------------------------------------------------------------------
function UploadCard({ uploading, onFiles, }) {
    const inputRef = useRef(null);
    return (_jsxs("button", { type: "button", onClick: () => inputRef.current?.click(), disabled: uploading, className: "flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-200 bg-zinc-50 text-zinc-400 transition-colors hover:border-zinc-300 hover:bg-zinc-100 disabled:opacity-50", children: [uploading ? (_jsx("div", { className: "h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700" })) : (_jsxs(_Fragment, { children: [_jsx(Upload, { size: 18 }), _jsx("span", { className: "text-xs", children: "\u4E0A\u4F20\u56FE\u7247" })] })), _jsx("input", { ref: inputRef, type: "file", accept: "image/jpeg,image/png,image/webp", multiple: true, className: "hidden", onChange: (e) => onFiles(e.target.files) })] }));
}
// ---------------------------------------------------------------------------
// AI text extraction dialog
// ---------------------------------------------------------------------------
function TextExtractDialog({ open, onOpenChange, rawText, onRawTextChange, extracting, extracted, extractError, onExtract, onApply, onReset, }) {
    return (_jsx(Dialog, { open: open, onOpenChange: onOpenChange, children: _jsxs(DialogContent, { className: "max-w-xl", children: [_jsx(DialogHeader, { children: _jsxs(DialogTitle, { className: "flex items-center gap-2", children: [_jsx(Sparkles, { size: 16, className: "text-zinc-500" }), "AI \u63D0\u53D6\u5546\u54C1\u4FE1\u606F"] }) }), !extracted && (_jsxs("div", { className: "flex flex-col gap-3", children: [_jsx("p", { className: "text-xs text-zinc-500", children: "\u7C98\u8D34\u4EA7\u54C1\u63CF\u8FF0\u3001\u89C4\u683C\u53C2\u6570\u3001\u5BA3\u4F20\u6587\u6848\u7B49\u539F\u59CB\u6587\u5B57\uFF0CAI \u5C06\u81EA\u52A8\u63D0\u53D6\u89C4\u683C\u53C2\u6570\u3001\u6838\u5FC3\u5356\u70B9\u548C\u5907\u6CE8\u3002" }), _jsx(Textarea, { rows: 8, placeholder: "\u7C98\u8D34\u539F\u59CB\u6587\u5B57\u5185\u5BB9\u2026", value: rawText, onChange: (e) => onRawTextChange(e.target.value), disabled: extracting }), extractError && (_jsx("p", { className: "text-xs text-red-500", children: extractError }))] })), extracted && (_jsxs("div", { className: "flex flex-col gap-4 text-sm", children: [_jsx("p", { className: "text-xs text-zinc-500", children: "\u63D0\u53D6\u5B8C\u6210\uFF0C\u786E\u8BA4\u540E\u5C06\u8986\u76D6\u5BF9\u5E94\u5B57\u6BB5\uFF08\u5DF2\u6709\u5185\u5BB9\u5C06\u88AB\u66FF\u6362\uFF09\u3002" }), extracted.specs.length > 0 && (_jsxs("div", { children: [_jsxs("p", { className: "mb-1.5 font-medium text-zinc-700", children: ["\u89C4\u683C\u53C2\u6570\uFF08", extracted.specs.length, " \u6761\uFF09"] }), _jsx("div", { className: "rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 space-y-1", children: extracted.specs.map((s, i) => (_jsxs("div", { className: "flex gap-2 text-xs", children: [_jsx("span", { className: "w-24 shrink-0 text-zinc-400", children: s.label }), _jsx("span", { className: "text-zinc-700", children: s.value })] }, i))) })] })), extracted.sellingPoints.length > 0 && (_jsxs("div", { children: [_jsxs("p", { className: "mb-1.5 font-medium text-zinc-700", children: ["\u6838\u5FC3\u5356\u70B9\uFF08", extracted.sellingPoints.length, " \u6761\uFF09"] }), _jsx("ul", { className: "rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 space-y-1", children: extracted.sellingPoints.map((pt, i) => (_jsxs("li", { className: "text-xs text-zinc-700", children: ["\u00B7 ", pt] }, i))) })] })), extracted.notes && (_jsxs("div", { children: [_jsx("p", { className: "mb-1.5 font-medium text-zinc-700", children: "\u5907\u6CE8" }), _jsx("p", { className: "rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 whitespace-pre-wrap", children: extracted.notes })] })), extracted.specs.length === 0 &&
                            extracted.sellingPoints.length === 0 &&
                            !extracted.notes && (_jsx("p", { className: "text-xs text-zinc-400", children: "\u672A\u80FD\u4ECE\u6587\u672C\u4E2D\u63D0\u53D6\u5230\u7ED3\u6784\u5316\u4FE1\u606F\uFF0C\u8BF7\u68C0\u67E5\u8F93\u5165\u5185\u5BB9\u3002" }))] })), _jsx(DialogFooter, { children: !extracted ? (_jsxs(_Fragment, { children: [_jsx(DialogClose, { render: _jsx(Button, { variant: "outline", type: "button", children: "\u53D6\u6D88" }) }), _jsx(Button, { onClick: onExtract, disabled: extracting || !rawText.trim(), children: extracting ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "mr-1.5 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" }), " ", "\u63D0\u53D6\u4E2D\u2026"] })) : (_jsxs(_Fragment, { children: [_jsx(Sparkles, { size: 14 }), " \u5F00\u59CB\u63D0\u53D6"] })) })] })) : (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", onClick: () => onOpenChange(false), children: "\u53D6\u6D88" }), _jsx(Button, { variant: "outline", onClick: onReset, children: "\u91CD\u65B0\u8F93\u5165" }), _jsx(Button, { onClick: onApply, children: "\u586B\u5165\u8868\u5355" })] })) })] }) }));
}
