import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { modelProviders, modelSceneRoutes, type ProviderName, type SceneKey } from "../db/schema.js";
import { GatewayError } from "./types.js";

/** All non-secret request settings are frozen with a task or copied for an immediate call. */
export interface ModelRouteSnapshot {
  routeId: string;
  scene: SceneKey;
  provider: ProviderName;
  baseUrl: string | null;
  modelId: string;
  billingModelId: string | null;
  parameters: Record<string, unknown>;
}

export type ResolvedModelRoute = ModelRouteSnapshot;

function parseParameters(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* invalid legacy configuration is treated as no extras */ }
  return {};
}

/** Resolve a user-selected route and make a transport-safe snapshot. API keys are intentionally not included. */
export async function resolveModelRoute(scene: SceneKey, routeId: string): Promise<ResolvedModelRoute> {
  const [route] = await db.select().from(modelSceneRoutes)
    .where(and(eq(modelSceneRoutes.id, routeId), eq(modelSceneRoutes.scene, scene)));
  if (!route) throw new GatewayError("capability_not_supported", "所选模型不存在或不属于当前场景");
  if (!route.providerId || !route.modelId) {
    throw new GatewayError("capability_not_supported", "所选模型路由尚未完成配置");
  }
  const [provider] = await db.select().from(modelProviders).where(eq(modelProviders.id, route.providerId));
  if (!provider?.isConfigured) {
    throw new GatewayError("authentication_failed", `供应商 \"${provider?.name ?? route.providerId}\" 未配置 API 密钥`);
  }
  return {
    routeId: route.id,
    scene,
    provider: provider.name,
    baseUrl: provider.baseUrl,
    modelId: route.modelId,
    billingModelId: route.billingModelId,
    parameters: parseParameters(route.parameters),
  };
}

/** Compatibility resolver for historical requests that predate route selection. New UI/API calls pass an ID. */
export async function resolveDefaultModelRoute(scene: SceneKey): Promise<ResolvedModelRoute> {
  const [route] = await db.select({ id: modelSceneRoutes.id }).from(modelSceneRoutes)
    .where(and(eq(modelSceneRoutes.scene, scene), eq(modelSceneRoutes.isDefault, true)));
  if (!route) throw new GatewayError("capability_not_supported", `场景 \"${scene}\" 没有默认模型`);
  return resolveModelRoute(scene, route.id);
}

/** Returns a frozen route only when the caller explicitly chose one; preserves legacy enqueue behaviour. */
export async function snapshotSelectedModelRoute(scene: SceneKey, routeId?: string | null): Promise<ModelRouteSnapshot | null> {
  return routeId ? resolveModelRoute(scene, routeId) : null;
}
