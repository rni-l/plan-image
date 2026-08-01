import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useParams, NavLink, Navigate } from "react-router-dom";
import { api } from "@/lib/api";
import { ProductInfoTab } from "./tabs/ProductInfoTab";
import { ResearchTab } from "./tabs/ResearchTab";
import { TasksTab } from "./tabs/TasksTab";
const TABS = [
    { key: "info", label: "商品资料" },
    { key: "research", label: "竞品研究" },
    { key: "tasks", label: "成图任务" },
];
export function ProductWorkbench() {
    const { productId, tab } = useParams();
    const [product, setProduct] = useState(null);
    useEffect(() => {
        if (productId) {
            api.get(`/products/${productId}`).then(setProduct).catch(() => { });
        }
    }, [productId]);
    if (!tab || !TABS.find((t) => t.key === tab)) {
        return _jsx(Navigate, { to: `/products/${productId}/info`, replace: true });
    }
    return (_jsxs("div", { className: "flex h-full flex-col", children: [_jsxs("div", { className: "border-b border-zinc-200 px-8", children: [_jsxs("p", { className: "mb-3 pt-6 text-xs text-zinc-400", children: [_jsx(NavLink, { to: "/products", className: "hover:text-zinc-700", children: "\u5546\u54C1\u5E93" }), " / ", _jsx("span", { className: "text-zinc-600", children: product?.name ?? "…" })] }), _jsx("nav", { className: "flex gap-1", children: TABS.map(({ key, label }) => (_jsx(NavLink, { to: `/products/${productId}/${key}`, className: ({ isActive }) => `border-b-2 px-1 pb-2 text-sm transition-colors ${isActive
                                ? "border-zinc-900 font-medium text-zinc-900"
                                : "border-transparent text-zinc-500 hover:text-zinc-700"}`, children: label }, key))) })] }), _jsxs("div", { className: "flex-1 overflow-y-auto", children: [tab === "info" && (_jsx(ProductInfoTab, { productId: productId, onNameChange: (name) => setProduct((p) => p ? { ...p, name } : p) })), tab === "research" && (_jsx(ResearchTab, { productId: productId })), tab === "tasks" && (_jsx(TasksTab, { productId: productId }))] })] }));
}
