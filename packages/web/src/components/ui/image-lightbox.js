import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
/**
 * Full-screen image preview overlay.
 * Close via ESC key, clicking the backdrop, or the X button.
 */
export function ImageLightbox({ src, alt = "", onClose }) {
    useEffect(() => {
        if (!src)
            return;
        const onKey = (e) => {
            if (e.key === "Escape")
                onClose();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [src, onClose]);
    if (!src)
        return null;
    return createPortal(_jsxs("div", { role: "dialog", "aria-modal": "true", "aria-label": "\u56FE\u7247\u9884\u89C8", className: "fixed inset-0 z-50 flex items-center justify-center bg-black/85", onClick: onClose, children: [_jsx("button", { className: "absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/25", onClick: onClose, "aria-label": "\u5173\u95ED\u9884\u89C8", children: _jsx(X, { size: 20 }) }), _jsx("img", { src: src, alt: alt, className: "max-h-[90vh] max-w-[90vw] rounded object-contain shadow-2xl", onClick: (e) => e.stopPropagation(), draggable: false })] }), document.body);
}
