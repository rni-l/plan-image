import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, } from "@/components/ui/dialog";
export function ProductsPage() {
    const navigate = useNavigate();
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    useEffect(() => {
        loadProducts();
    }, []);
    async function loadProducts() {
        try {
            const data = await api.get("/products");
            setProducts(data);
        }
        catch {
            toast.error("加载商品列表失败");
        }
        finally {
            setLoading(false);
        }
    }
    return (_jsxs("div", { className: "px-8 py-8", children: [_jsxs("div", { className: "mb-6 flex items-center justify-between", children: [_jsx("h1", { className: "page-title text-xl text-zinc-900", children: "\u5546\u54C1\u5E93" }), _jsxs(Button, { onClick: () => setDialogOpen(true), children: [_jsx(Plus, { size: 16 }), "\u65B0\u5EFA\u5546\u54C1"] })] }), loading ? (_jsx(ProductGridSkeleton, {})) : products.length === 0 ? (_jsx(EmptyState, { onNew: () => setDialogOpen(true) })) : (_jsx("div", { className: "grid grid-cols-4 gap-4", children: products.map((p) => (_jsx(ProductCard, { product: p, onClick: () => navigate(`/products/${p.id}/info`) }, p.id))) })), _jsx(NewProductDialog, { open: dialogOpen, onOpenChange: setDialogOpen, onCreated: (product) => {
                    setProducts((prev) => [product, ...prev]);
                    navigate(`/products/${product.id}/info`);
                } })] }));
}
// ---------------------------------------------------------------------------
// Product card
// ---------------------------------------------------------------------------
function ProductCard({ product, onClick, }) {
    const updatedAt = new Date(product.updatedAt).toLocaleDateString("zh-CN", {
        month: "short",
        day: "numeric",
    });
    return (_jsxs("button", { onClick: onClick, className: "group flex flex-col overflow-hidden rounded-lg border border-zinc-100 bg-white text-left transition-shadow hover:shadow-sm", children: [_jsx("div", { className: "flex aspect-square w-full items-center justify-center bg-zinc-50", children: _jsx(Package, { size: 32, className: "text-zinc-300" }) }), _jsxs("div", { className: "p-3", children: [_jsx("p", { className: "truncate text-sm font-medium text-zinc-900 group-hover:text-zinc-700", children: product.name }), _jsxs("p", { className: "mt-0.5 text-xs text-zinc-400", children: [updatedAt, " \u66F4\u65B0"] })] })] }));
}
// ---------------------------------------------------------------------------
// New product dialog
// ---------------------------------------------------------------------------
function NewProductDialog({ open, onOpenChange, onCreated, }) {
    const [name, setName] = useState("");
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);
    async function handleSubmit(e) {
        e.preventDefault();
        if (!name.trim())
            return;
        setSubmitting(true);
        try {
            const product = await api.post("/products", {
                name: name.trim(),
                notes: notes.trim() || undefined,
            });
            toast.success("商品已创建");
            onOpenChange(false);
            onCreated(product);
            setName("");
            setNotes("");
        }
        catch {
            toast.error("创建失败，请重试");
        }
        finally {
            setSubmitting(false);
        }
    }
    return (_jsx(Dialog, { open: open, onOpenChange: onOpenChange, children: _jsx(DialogContent, { children: _jsxs("form", { onSubmit: handleSubmit, children: [_jsx(DialogHeader, { children: _jsx(DialogTitle, { children: "\u65B0\u5EFA\u5546\u54C1" }) }), _jsxs("div", { className: "flex flex-col gap-4", children: [_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx(Label, { htmlFor: "product-name", children: "\u5546\u54C1\u540D\u79F0 *" }), _jsx(Input, { id: "product-name", placeholder: "\u4F8B\uFF1A\u70ED\u7194\u80F6\u68D2 7mm \u900F\u660E\u6B3E", value: name, onChange: (e) => setName(e.target.value), autoFocus: true, required: true })] }), _jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx(Label, { htmlFor: "product-notes", children: "\u5907\u6CE8\uFF08\u53EF\u9009\uFF09" }), _jsx(Textarea, { id: "product-notes", placeholder: "\u4EA7\u54C1\u7CFB\u5217\u3001\u7248\u672C\u8BF4\u660E\u7B49", rows: 3, value: notes, onChange: (e) => setNotes(e.target.value) })] })] }), _jsxs(DialogFooter, { children: [_jsx(DialogClose, { render: _jsx(Button, { type: "button", variant: "outline", children: "\u53D6\u6D88" }) }), _jsx(Button, { type: "submit", disabled: !name.trim() || submitting, children: submitting ? "创建中…" : "创建商品" })] })] }) }) }));
}
// ---------------------------------------------------------------------------
// Skeleton + empty state
// ---------------------------------------------------------------------------
function ProductGridSkeleton() {
    return (_jsx("div", { className: "grid grid-cols-4 gap-4", children: Array.from({ length: 8 }).map((_, i) => (_jsxs("div", { className: "overflow-hidden rounded-lg border border-zinc-100", children: [_jsx("div", { className: "aspect-square w-full animate-pulse bg-zinc-100" }), _jsxs("div", { className: "p-3", children: [_jsx("div", { className: "h-3.5 w-3/4 animate-pulse rounded bg-zinc-100" }), _jsx("div", { className: "mt-1.5 h-3 w-1/2 animate-pulse rounded bg-zinc-100" })] })] }, i))) }));
}
function EmptyState({ onNew }) {
    return (_jsxs("div", { className: "flex flex-col items-center justify-center gap-3 py-32 text-zinc-400", children: [_jsx(Package, { size: 40, strokeWidth: 1.5 }), _jsx("p", { className: "text-sm", children: "\u6682\u65E0\u5546\u54C1\uFF0C\u65B0\u5EFA\u7B2C\u4E00\u4E2A\u5546\u54C1\u5F00\u59CB\u5DE5\u4F5C" }), _jsxs(Button, { variant: "outline", size: "sm", onClick: onNew, children: [_jsx(Plus, { size: 14 }), "\u65B0\u5EFA\u5546\u54C1"] })] }));
}
