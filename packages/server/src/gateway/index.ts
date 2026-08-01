import { db } from "../db/index.js";
import { modelProviders, modelSceneRoutes, modelCallLogs, type SceneKey } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { ModelAdapter, GatewayRequest, GatewayResponse } from "./types.js";
import { GatewayError } from "./types.js";
import { BailianAdapter } from "./adapters/bailian.js";
import { VolcengineAdapter } from "./adapters/volcengine.js";
import { GptProxyAdapter } from "./adapters/gpt-proxy.js";
import { randomUUID } from "node:crypto";

// Adapter singletons — lazy-initialised per provider config
const adapterCache = new Map<string, ModelAdapter>();

function buildAdapter(providerName: string, baseUrl?: string | null, modelId?: string | null): ModelAdapter {
  const key = `${providerName}:${baseUrl ?? ""}`;
  if (adapterCache.has(key)) return adapterCache.get(key)!;

  let adapter: ModelAdapter;
  switch (providerName) {
    case "bailian":
      adapter = new BailianAdapter();
      break;
    case "volcengine":
      adapter = new VolcengineAdapter();
      break;
    case "gpt_proxy":
      if (!baseUrl) throw new GatewayError("authentication_failed", "GPT中转服务未配置 Base URL");
      adapter = new GptProxyAdapter(baseUrl, modelId ?? undefined);
      break;
    default:
      throw new GatewayError("unknown", `未知供应商: ${providerName}`);
  }

  adapterCache.set(key, adapter);
  return adapter;
}

/** Invalidate adapter cache when provider config changes. */
export function invalidateAdapterCache(): void {
  adapterCache.clear();
}

/**
 * Look up the configured route for a scene, validate capabilities, and send.
 * This is the primary entry point for all job handlers.
 *
 * @param jobId  Optional background_jobs.id to link in model_call_logs
 */
export async function gatewayCall(
  scene: SceneKey,
  req: Omit<GatewayRequest, "model">,
  jobId?: string
): Promise<GatewayResponse> {
  // Load route from DB
  const [route] = await db
    .select()
    .from(modelSceneRoutes)
    .where(eq(modelSceneRoutes.scene, scene));

  if (!route?.providerId || !route.modelId) {
    throw new GatewayError(
      "capability_not_supported",
      `场景 "${scene}" 尚未配置模型，请在设置页完成路由配置`
    );
  }

  // Load provider record
  const [provider] = await db
    .select()
    .from(modelProviders)
    .where(eq(modelProviders.id, route.providerId));

  if (!provider?.isConfigured) {
    throw new GatewayError(
      "authentication_failed",
      `供应商 "${provider?.name ?? route.providerId}" 未配置 API 密钥`
    );
  }

  const adapter = buildAdapter(provider.name, provider.baseUrl, route.modelId);

  // Parse extra parameters from route config
  const extraParams = route.parameters ? (JSON.parse(route.parameters) as Record<string, unknown>) : {};

  const startMs = Date.now();
  let result: GatewayResponse;
  try {
    result = await adapter.send({
      ...req,
      model: route.modelId,
      parameters: { ...extraParams, ...(req.parameters ?? {}) },
    });
  } catch (err) {
    // Write failed call log
    const durationMs = Date.now() - startMs;
    const ge = err instanceof GatewayError ? err : null;
    await db.insert(modelCallLogs).values({
      id: randomUUID(),
      jobId: jobId ?? null,
      scene,
      provider: provider.name,
      model: route.modelId,
      status: "failed",
      errorType: ge?.type ?? "unknown",
      durationMs,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      createdAt: new Date(),
    }).catch(() => { /* never let logging fail a job */ });
    throw err;
  }

  // Write succeeded call log
  const durationMs = Date.now() - startMs;
  await db.insert(modelCallLogs).values({
    id: randomUUID(),
    jobId: jobId ?? null,
    scene,
    provider: provider.name,
    model: route.modelId,
    status: "succeeded",
    errorType: null,
    durationMs,
    promptTokens: result.usage?.promptTokens ?? null,
    completionTokens: result.usage?.completionTokens ?? null,
    totalTokens: result.usage?.totalTokens ?? null,
    createdAt: new Date(),
  }).catch(() => { /* never let logging fail a job */ });

  return result;
}
