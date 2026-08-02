import { db } from "../db/index.js";
import { modelProviders, modelSceneRoutes, modelCallLogs, type SceneKey } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { ModelAdapter, GatewayRequest, GatewayResponse, ImageStreamChunk, TextStreamChunk } from "./types.js";
import { GatewayError } from "./types.js";
import { BailianAdapter } from "./adapters/bailian.js";
import { VolcengineAdapter } from "./adapters/volcengine.js";
import { GptProxyAdapter } from "./adapters/gpt-proxy.js";
import { randomUUID } from "node:crypto";

export type { TextStreamChunk };

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

/** Build a loggable params string — replaces binary blobs with size placeholders. */
function buildRequestParams(req: Omit<GatewayRequest, "model">): string {
  const out: Record<string, unknown> = { parameters: req.parameters ?? {} };
  if (req.systemPrompt) out.systemPrompt = req.systemPrompt;
  if (req.images?.length) {
    out.images = req.images.map((b, i) =>
      `[image ${i + 1}: ~${Math.round(b.length * 0.75 / 1024)}KB]`
    );
  }
  if (req.mask) out.mask = `[mask: ~${Math.round(req.mask.length * 0.75 / 1024)}KB]`;
  return JSON.stringify(out, null, 2);
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
      errorMessage: ge?.message ?? (err instanceof Error ? err.message : String(err)),
      requestPrompt: req.prompt,
      requestParams: buildRequestParams(req),
      responseBody: null,
      durationMs,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      createdAt: new Date(),
    }).catch(() => {});
    throw err;
  }

  const durationMs = Date.now() - startMs;
  const responseBodyLog = result.image
    ? `[image: ~${Math.round(result.image.length * 0.75 / 1024)}KB]`
    : (result.text ?? null);

  // Prefer the adapter-provided actual sent body for accurate logging;
  // fall back to the raw gateway params when the adapter doesn't supply it.
  const loggedParams = result._sentBody
    ? JSON.stringify(result._sentBody, null, 2)
    : buildRequestParams(req);

  await db.insert(modelCallLogs).values({
    id: randomUUID(),
    jobId: jobId ?? null,
    scene,
    provider: provider.name,
    model: route.modelId,
    status: "succeeded",
    errorType: null,
    errorMessage: null,
    requestPrompt: req.prompt,
    requestParams: loggedParams,
    responseBody: responseBodyLog,
    durationMs,
    promptTokens: result.usage?.promptTokens ?? null,
    completionTokens: result.usage?.completionTokens ?? null,
    totalTokens: result.usage?.totalTokens ?? null,
    createdAt: new Date(),
  }).catch(() => {});

  return result;
}

/**
 * Streaming text variant — yields text delta chunks as the model outputs them.
 * Currently only VolcengineAdapter supports sendTextStream; others fall back to
 * a single-chunk wrapper around send().
 */
export async function* gatewayTextStream(
  scene: SceneKey,
  req: Omit<GatewayRequest, "model">
): AsyncGenerator<TextStreamChunk> {
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
  const extraParams = route.parameters
    ? (JSON.parse(route.parameters) as Record<string, unknown>)
    : {};

  const fullReq: GatewayRequest = {
    ...req,
    model: route.modelId,
    parameters: { ...extraParams, ...(req.parameters ?? {}) },
  };

  if (adapter.sendTextStream) {
    yield* adapter.sendTextStream(fullReq);
  } else {
    // Non-streaming fallback: use gatewayCall so the request gets properly logged
    const result = await gatewayCall(scene, req);
    if (result.text) {
      yield { text: result.text, done: true };
    } else {
      throw new GatewayError("invalid_response", "模型未返回文本内容");
    }
  }
}

export async function* gatewayStream(
  scene: SceneKey,
  req: Omit<GatewayRequest, "model">
): AsyncGenerator<ImageStreamChunk> {
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
  const extraParams = route.parameters
    ? (JSON.parse(route.parameters) as Record<string, unknown>)
    : {};

  const fullReq: GatewayRequest = {
    ...req,
    model: route.modelId,
    parameters: { ...extraParams, ...(req.parameters ?? {}) },
  };

  if (adapter.sendStream) {
    yield* adapter.sendStream(fullReq);
  } else {
    // Non-streaming fallback: single chunk on completion
    const result = await adapter.send(fullReq);
    if (result.image) {
      yield { b64: result.image, done: true };
    } else {
      throw new GatewayError("invalid_response", "模型不支持流式渲染且未返回图片");
    }
  }
}
