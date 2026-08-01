import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "@/lib/utils";
export function Input({ className, type, ...props }) {
    return (_jsx("input", { type: type, className: cn("flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-900 disabled:cursor-not-allowed disabled:opacity-40", className), ...props }));
}
