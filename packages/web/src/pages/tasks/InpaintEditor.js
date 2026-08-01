import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Eraser, Loader2, Paintbrush, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
const BRUSH_SIZES = [16, 32, 64, 128];
// ---------------------------------------------------------------------------
// InpaintEditor
// ---------------------------------------------------------------------------
export function InpaintEditor({ itemId, itemTitle, version, open, onClose, onSubmitted, }) {
    const canvasRef = useRef(null);
    const [tool, setTool] = useState("brush");
    const [brushSize, setBrushSize] = useState(32);
    const [instruction, setInstruction] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const isDrawing = useRef(false);
    const lastPoint = useRef(null);
    const imgSrc = `/api/products/assets/file?path=${encodeURIComponent(version.filePath)}`;
    // Reset state every time the editor opens
    useEffect(() => {
        if (!open)
            return;
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
        setInstruction("");
        setTool("brush");
        setBrushSize(32);
    }, [open]);
    // ---------------------------------------------------------------------------
    // Canvas helpers
    // ---------------------------------------------------------------------------
    function getCanvasPoint(e, canvas) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (canvas.width / rect.width),
            y: (e.clientY - rect.top) * (canvas.height / rect.height),
        };
    }
    function drawCircle(ctx, x, y) {
        if (tool === "eraser") {
            ctx.globalCompositeOperation = "destination-out";
        }
        else {
            ctx.globalCompositeOperation = "source-over";
            ctx.fillStyle = "rgba(255, 50, 50, 0.55)";
        }
        ctx.beginPath();
        ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
    }
    function interpolateDraw(ctx, from, to) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, Math.floor(dist / 2));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            drawCircle(ctx, from.x + dx * t, from.y + dy * t);
        }
    }
    function onPointerDown(e) {
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        canvas.setPointerCapture(e.pointerId);
        isDrawing.current = true;
        const ctx = canvas.getContext("2d");
        const pt = getCanvasPoint(e, canvas);
        lastPoint.current = pt;
        drawCircle(ctx, pt.x, pt.y);
    }
    function onPointerMove(e) {
        if (!isDrawing.current)
            return;
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        const ctx = canvas.getContext("2d");
        const pt = getCanvasPoint(e, canvas);
        if (lastPoint.current)
            interpolateDraw(ctx, lastPoint.current, pt);
        lastPoint.current = pt;
    }
    function onPointerUp() {
        isDrawing.current = false;
        lastPoint.current = null;
    }
    function clearMask() {
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }
    function hasMask() {
        const canvas = canvasRef.current;
        if (!canvas)
            return false;
        const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 3; i < data.length; i += 4) {
            if ((data[i] ?? 0) > 10)
                return true;
        }
        return false;
    }
    /** Export visible brush strokes as a black/white PNG mask (white = edit area). */
    function exportMask() {
        const src = canvasRef.current;
        const off = document.createElement("canvas");
        off.width = src.width;
        off.height = src.height;
        const ctx = off.getContext("2d");
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, off.width, off.height);
        const srcPx = src.getContext("2d").getImageData(0, 0, src.width, src.height);
        const dstPx = ctx.getImageData(0, 0, off.width, off.height);
        for (let i = 0; i < srcPx.data.length; i += 4) {
            if ((srcPx.data[i + 3] ?? 0) > 10) {
                dstPx.data[i] = dstPx.data[i + 1] = dstPx.data[i + 2] = dstPx.data[i + 3] = 255;
            }
        }
        ctx.putImageData(dstPx, 0, 0);
        return off.toDataURL("image/png");
    }
    async function handleSubmit() {
        if (!instruction.trim()) {
            toast.error("请输入修改指令");
            return;
        }
        if (!hasMask()) {
            toast.error("请先在图片上涂抹需要修改的区域");
            return;
        }
        setSubmitting(true);
        try {
            await api.post(`/tasks/items/${itemId}/inpaint`, {
                parentVersionId: version.id,
                maskDataUrl: exportMask(),
                instruction: instruction.trim(),
            });
            toast.success("微调任务已提交，生成后将自动更新");
            onSubmitted();
            onClose();
        }
        catch {
            toast.error("提交失败，请重试");
        }
        finally {
            setSubmitting(false);
        }
    }
    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------
    return (_jsx(Sheet, { open: open, onOpenChange: (v) => { if (!v && !submitting)
            onClose(); }, title: `局部微调 — ${itemTitle}`, className: "w-[90vw] max-w-[1100px]", children: _jsxs("div", { className: "flex", style: { minHeight: "calc(100vh - 65px)" }, children: [_jsxs("div", { className: "flex flex-1 flex-col gap-3 p-4", style: { minWidth: 0 }, children: [_jsxs("div", { className: "flex items-center gap-2", children: [["brush", "eraser"].map((t) => (_jsxs("button", { onClick: () => setTool(t), className: `flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${tool === t
                                        ? "bg-zinc-900 text-white"
                                        : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`, children: [t === "brush" ? _jsx(Paintbrush, { size: 12 }) : _jsx(Eraser, { size: 12 }), t === "brush" ? "笔刷" : "橡皮"] }, t))), _jsx("div", { className: "mx-1 h-4 w-px bg-zinc-200" }), BRUSH_SIZES.map((s) => (_jsx("button", { title: `${s}px`, onClick: () => setBrushSize(s), className: `flex h-6 w-6 items-center justify-center rounded-full transition-colors ${brushSize === s ? "bg-zinc-900" : "border border-zinc-200 hover:bg-zinc-50"}`, children: _jsx("span", { className: `rounded-full ${brushSize === s ? "bg-white" : "bg-zinc-400"}`, style: { width: Math.max(4, s / 8), height: Math.max(4, s / 8) } }) }, s))), _jsx("div", { className: "mx-1 h-4 w-px bg-zinc-200" }), _jsxs("button", { onClick: clearMask, className: "flex items-center gap-1 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50", children: [_jsx(Trash2, { size: 12 }), " \u6E05\u7A7A"] })] }), _jsx("div", { className: "relative flex flex-1 items-center justify-center overflow-hidden rounded-lg bg-zinc-50", children: _jsxs("div", { className: "relative inline-block max-h-full max-w-full", children: [_jsx("img", { src: imgSrc, alt: itemTitle, className: "block max-h-[calc(100vh-220px)] max-w-full select-none object-contain", draggable: false, onLoad: (e) => {
                                            const img = e.currentTarget;
                                            const canvas = canvasRef.current;
                                            if (!canvas)
                                                return;
                                            canvas.width = img.naturalWidth;
                                            canvas.height = img.naturalHeight;
                                        } }), _jsx("canvas", { ref: canvasRef, className: "absolute inset-0 h-full w-full", style: { cursor: tool === "eraser" ? "cell" : "crosshair", touchAction: "none" }, onPointerDown: onPointerDown, onPointerMove: onPointerMove, onPointerUp: onPointerUp, onPointerLeave: onPointerUp })] }) }), _jsx("p", { className: "text-xs text-zinc-400", children: "\u63D0\u793A\uFF1A\u7528\u7B14\u5237\u6D82\u62B9\u9700\u8981\u4FEE\u6539\u7684\u533A\u57DF\uFF08\u7EA2\u8272\u9AD8\u4EAE\uFF09\uFF0C\u7528\u6A61\u76AE\u64E6\u9664\u8BEF\u9009\u533A\u57DF" })] }), _jsxs("div", { className: "flex w-64 shrink-0 flex-col gap-4 border-l border-zinc-100 p-5", children: [_jsxs("div", { className: "flex flex-1 flex-col gap-2", children: [_jsx(Label, { className: "text-xs text-zinc-500", children: "\u4FEE\u6539\u6307\u4EE4" }), _jsx(Textarea, { className: "flex-1 resize-none text-sm", style: { minHeight: 140 }, placeholder: "描述你想修改的内容，例如：\n\n把左下角背景换成\n木纹桌面场景\n\n去掉右上角的水印", value: instruction, onChange: (e) => setInstruction(e.target.value), maxLength: 500, disabled: submitting }), _jsxs("p", { className: "text-right text-xs text-zinc-300", children: [instruction.length, " / 500"] })] }), _jsxs("div", { className: "flex flex-col gap-2", children: [_jsx(Button, { className: "w-full", onClick: handleSubmit, disabled: submitting || !instruction.trim(), children: submitting
                                        ? _jsxs(_Fragment, { children: [_jsx(Loader2, { size: 13, className: "animate-spin" }), " \u63D0\u4EA4\u4E2D\u2026"] })
                                        : "生成微调" }), _jsx(Button, { variant: "outline", className: "w-full", onClick: onClose, disabled: submitting, children: "\u53D6\u6D88" })] })] })] }) }));
}
