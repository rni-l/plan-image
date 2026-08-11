import { useEffect, useState } from "react";
import { useParams, NavLink, Navigate } from "react-router-dom";
import { Download } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ProductInfoTab } from "./tabs/ProductInfoTab";
import { ResearchTab } from "./tabs/ResearchTab";
import { TasksTab } from "./tabs/TasksTab";

interface Product {
  id: string;
  name: string;
  notes: string | null;
}

const TABS = [
  { key: "info",     label: "商品资料" },
  { key: "research", label: "竞品研究" },
  { key: "tasks",    label: "成图任务" },
] as const;

export function ProductWorkbench() {
  const { productId, tab } = useParams<{ productId: string; tab: string }>();
  const [product, setProduct] = useState<Product | null>(null);

  useEffect(() => {
    if (productId) {
      api.get<Product>(`/products/${productId}`).then(setProduct).catch(() => {});
    }
  }, [productId]);

  if (!tab || !TABS.find((t) => t.key === tab)) {
    return <Navigate to={`/products/${productId}/info`} replace />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb + tabs */}
      <div className="border-b border-zinc-200 px-8">
        <div className="mb-3 flex items-center justify-between pt-4">
          <p className="text-xs text-zinc-400">
            <NavLink to="/products" className="hover:text-zinc-700">
              商品库
            </NavLink>
            {" / "}
            <span className="text-zinc-600">{product?.name ?? "…"}</span>
          </p>
          <Button size="sm" variant="outline" onClick={() => api.download(`/products/${productId}/transfer/project`, `${product?.name ?? "project"}-export.zip`)}>
            <Download size={14} /> 导出项目
          </Button>
        </div>
        <nav className="flex gap-1">
          {TABS.map(({ key, label }) => (
            <NavLink
              key={key}
              to={`/products/${productId}/${key}`}
              className={({ isActive }) =>
                `border-b-2 px-1 pb-2 text-sm transition-colors ${
                  isActive
                    ? "border-zinc-900 font-medium text-zinc-900"
                    : "border-transparent text-zinc-500 hover:text-zinc-700"
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "info" && (
          <ProductInfoTab
            productId={productId!}
            onNameChange={(name) => setProduct((p) => p ? { ...p, name } : p)}
          />
        )}
        {tab === "research" && (
          <ResearchTab productId={productId!} />
        )}
        {tab === "tasks" && (
          <TasksTab productId={productId!} />
        )}
      </div>
    </div>
  );
}
