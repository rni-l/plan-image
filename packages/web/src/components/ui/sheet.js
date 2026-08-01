import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
export function Sheet({ open, onOpenChange, title, children, className, }) {
    return (_jsx(DialogPrimitive.Root, { open: open, onOpenChange: onOpenChange, children: _jsxs(DialogPrimitive.Portal, { children: [_jsx(DialogPrimitive.Backdrop, { className: "fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px]\n            data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200" }), _jsxs(DialogPrimitive.Popup, { className: cn("fixed right-0 top-0 z-50 flex h-full w-[480px] flex-col bg-white shadow-xl", "data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full", "transition-transform duration-200", className), children: [title && (_jsxs("div", { className: "flex items-center justify-between border-b border-zinc-100 px-6 py-4", children: [_jsx(DialogPrimitive.Title, { className: "text-sm font-semibold text-zinc-900", children: title }), _jsx(DialogPrimitive.Close, { render: _jsx("button", { className: "rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700", children: _jsx(X, { size: 16 }) }) })] })), _jsx("div", { className: "flex-1 overflow-y-auto", children: children })] })] }) }));
}
