import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export type ModelScene = "competitor_image_analysis" | "competitor_synthesis" | "design_plan" | "image_generation" | "image_edit";

type Route = { id: string; modelId: string | null; providerName: string | null; isDefault: boolean };

/** Shared selector used by AI actions. It defaults to the scene default and submits the stable route ID. */
export function ModelRouteSelect({ scene, value, onChange, className = "" }: { scene: ModelScene; value?: string; onChange: (id: string) => void; className?: string }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  useEffect(() => {
    let active = true;
    api.get<Route[]>(`/settings/routes?scene=${scene}`).then((items) => {
      if (!active) return;
      setRoutes(items);
      if (!value) onChange(items.find((item) => item.isDefault)?.id ?? items[0]?.id ?? "");
    }).catch(() => active && setRoutes([]));
    return () => { active = false; };
  }, [scene]);
  return <select aria-label="选择模型" className={`h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm ${className}`} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
    <option value="">请选择模型</option>
    {routes.map((route) => <option key={route.id} value={route.id}>{route.providerName ?? "未配置"} · {route.modelId ?? "未配置"}{route.isDefault ? "（默认）" : ""}</option>)}
  </select>;
}
