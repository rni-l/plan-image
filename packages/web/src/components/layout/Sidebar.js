import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { NavLink, useLocation } from "react-router-dom";
import { Package, ListTodo, ScrollText, CircleDollarSign, Settings } from "lucide-react";
import { cn } from "@/lib/utils.js";
const mainNav = [
    { to: "/products", label: "商品库", icon: Package },
    { to: "/task-center", label: "任务中心", icon: ListTodo },
    { to: "/logs", label: "日志记录", icon: ScrollText },
    { to: "/billing", label: "用量计费", icon: CircleDollarSign },
];
const bottomNav = [
    { to: "/settings/models", label: "设置", icon: Settings },
];
export function Sidebar() {
    const location = useLocation();
    function isActive(to) {
        return location.pathname.startsWith(to);
    }
    return (_jsxs("aside", { className: "flex h-screen w-[220px] shrink-0 flex-col border-r", style: {
            background: "var(--sidebar-bg)",
            borderColor: "var(--sidebar-border)",
        }, children: [_jsx("div", { className: "flex h-12 items-center px-4", children: _jsx("span", { className: "text-sm font-semibold tracking-tight text-zinc-900", children: "\u5546\u54C1\u56FE\u7247\u5DE5\u4F5C\u53F0" }) }), _jsx("nav", { className: "flex-1 px-2 py-1", children: mainNav.map(({ to, label, icon: Icon }) => (_jsx(NavItem, { to: to, label: label, icon: Icon, active: isActive(to) }, to))) }), _jsxs("div", { className: "px-2 py-2", children: [_jsx("div", { className: "mb-2 h-px bg-zinc-200" }), bottomNav.map(({ to, label, icon: Icon }) => (_jsx(NavItem, { to: to, label: label, icon: Icon, active: isActive("/settings") }, to)))] })] }));
}
function NavItem({ to, label, icon: Icon, active, }) {
    return (_jsxs(NavLink, { to: to, className: cn("relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors", active
            ? "bg-zinc-100 font-medium text-zinc-900"
            : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"), children: [active && (_jsx("span", { className: "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-zinc-900" })), _jsx(Icon, { size: 16, className: active ? "text-zinc-900" : "text-zinc-500" }), label] }));
}
