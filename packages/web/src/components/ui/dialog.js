import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";
// Re-export primitives with shadcn-style styling
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
function DialogPortal({ children }) {
    return _jsx(DialogPrimitive.Portal, { children: children });
}
function DialogOverlay({ className, ...props }) {
    return (_jsx(DialogPrimitive.Backdrop, { className: cn("fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]", "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-200", className), ...props }));
}
function DialogContent({ className, children, ...props }) {
    return (_jsxs(DialogPortal, { children: [_jsx(DialogOverlay, {}), _jsx(DialogPrimitive.Popup, { className: cn("fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2", "rounded-xl border border-zinc-200 bg-white p-6 shadow-lg", "data-[starting-style]:opacity-0 data-[starting-style]:scale-95", "data-[ending-style]:opacity-0 data-[ending-style]:scale-95", "transition-all duration-200", className), ...props, children: children })] }));
}
function DialogHeader({ className, ...props }) {
    return (_jsx("div", { className: cn("mb-4 flex flex-col gap-1.5", className), ...props }));
}
function DialogFooter({ className, ...props }) {
    return (_jsx("div", { className: cn("mt-6 flex justify-end gap-2", className), ...props }));
}
function DialogTitle({ className, ...props }) {
    return (_jsx(DialogPrimitive.Title, { className: cn("text-base font-semibold tracking-tight text-zinc-900", className), ...props }));
}
function DialogDescription({ className, ...props }) {
    return (_jsx(DialogPrimitive.Description, { className: cn("text-sm text-zinc-500", className), ...props }));
}
export { Dialog, DialogTrigger, DialogClose, DialogPortal, DialogOverlay, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, };
