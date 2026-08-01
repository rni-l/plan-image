import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

interface Product {
  id: string;
  name: string;
  notes: string | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function ProductsPage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    try {
      const data = await api.get<Product[]>("/products");
      setProducts(data);
    } catch {
      toast.error("加载商品列表失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="page-title text-xl text-zinc-900">商品库</h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus size={16} />
          新建商品
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <ProductGridSkeleton />
      ) : products.length === 0 ? (
        <EmptyState onNew={() => setDialogOpen(true)} />
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              onClick={() => navigate(`/products/${p.id}/info`)}
            />
          ))}
        </div>
      )}

      {/* New product dialog */}
      <NewProductDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(product) => {
          setProducts((prev) => [product, ...prev]);
          navigate(`/products/${product.id}/info`);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product card
// ---------------------------------------------------------------------------

function ProductCard({
  product,
  onClick,
}: {
  product: Product;
  onClick: () => void;
}) {
  const updatedAt = new Date(product.updatedAt).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });

  return (
    <button
      onClick={onClick}
      className="group flex flex-col overflow-hidden rounded-lg border border-zinc-100 bg-white text-left transition-shadow hover:shadow-sm"
    >
      {/* Thumbnail placeholder */}
      <div className="flex aspect-square w-full items-center justify-center bg-zinc-50">
        <Package size={32} className="text-zinc-300" />
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="truncate text-sm font-medium text-zinc-900 group-hover:text-zinc-700">
          {product.name}
        </p>
        <p className="mt-0.5 text-xs text-zinc-400">{updatedAt} 更新</p>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// New product dialog
// ---------------------------------------------------------------------------

function NewProductDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (product: Product) => void;
}) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const product = await api.post<Product>("/products", {
        name: name.trim(),
        notes: notes.trim() || undefined,
      });
      toast.success("商品已创建");
      onOpenChange(false);
      onCreated(product);
      setName("");
      setNotes("");
    } catch {
      toast.error("创建失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>新建商品</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="product-name">商品名称 *</Label>
              <Input
                id="product-name"
                placeholder="例：热熔胶棒 7mm 透明款"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="product-notes">备注（可选）</Label>
              <Textarea
                id="product-notes"
                placeholder="产品系列、版本说明等"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline">
                  取消
                </Button>
              }
            />
            <Button type="submit" disabled={!name.trim() || submitting}>
              {submitting ? "创建中…" : "创建商品"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Skeleton + empty state
// ---------------------------------------------------------------------------

function ProductGridSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-zinc-100">
          <div className="aspect-square w-full animate-pulse bg-zinc-100" />
          <div className="p-3">
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-zinc-100" />
            <div className="mt-1.5 h-3 w-1/2 animate-pulse rounded bg-zinc-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-32 text-zinc-400">
      <Package size={40} strokeWidth={1.5} />
      <p className="text-sm">暂无商品，新建第一个商品开始工作</p>
      <Button variant="outline" size="sm" onClick={onNew}>
        <Plus size={14} />
        新建商品
      </Button>
    </div>
  );
}
