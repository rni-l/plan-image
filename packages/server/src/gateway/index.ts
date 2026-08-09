import { db } from "../db/index.js";
import { modelCallLogs } from "../db/schema.js";
import type { ModelAdapter, GatewayRequest, GatewayResponse, ImageStreamChunk, TextStreamChunk } from "./types.js";
import { GatewayError } from "./types.js";
import { BailianAdapter } from "./adapters/bailian.js";
import { VolcengineAdapter } from "./adapters/volcengine.js";
import { GptProxyAdapter } from "./adapters/gpt-proxy.js";
import { randomUUID } from "node:crypto";
import type { ModelRouteSnapshot } from "./model-route.js";

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
  route: ModelRouteSnapshot,
  req: Omit<GatewayRequest, "model">,
  jobId?: string
): Promise<GatewayResponse> {
  const adapter = buildAdapter(route.provider, route.baseUrl, route.modelId);

  const startMs = Date.now();
  let result: GatewayResponse;
  try {
    result = await adapter.send({
      ...req,
      model: route.modelId,
      parameters: { ...route.parameters, ...(req.parameters ?? {}) },
    });
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const ge = err instanceof GatewayError ? err : null;
    await db.insert(modelCallLogs).values({
      id: randomUUID(),
      jobId: jobId ?? null,
      scene: route.scene,
      modelRouteId: route.routeId,
      provider: route.provider,
      // Use billingModelId when set so the billing join hits the correct pricing row.
      // The actual request model is captured in requestParams._sentBody.
      model: route.billingModelId ?? route.modelId,
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
      // No output produced on failure — image counts stay null
      inputImageCount: null,
      outputImageCount: null,
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
    scene: route.scene,
    modelRouteId: route.routeId,
    provider: route.provider,
    // Use billingModelId when set so the billing join hits the correct pricing row.
    // The actual request model is captured in requestParams._sentBody.
    model: route.billingModelId ?? route.modelId,
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
    // For image-generation calls: count output image and input reference images.
    // null on text/vision calls (result.image is absent).
    outputImageCount: result.image != null ? 1 : null,
    inputImageCount:  result.image != null ? (req.images?.length ?? 0) : null,
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
  route: ModelRouteSnapshot,
  req: Omit<GatewayRequest, "model">,
  jobId?: string,
): AsyncGenerator<TextStreamChunk> {
  const adapter = buildAdapter(route.provider, route.baseUrl, route.modelId);

  const fullReq: GatewayRequest = {
    ...req,
    model: route.modelId,
    parameters: { ...route.parameters, ...(req.parameters ?? {}) },
  };

  if (adapter.sendTextStream) {
    const startMs = Date.now();
    let responseText = "";
    try {
      for await (const chunk of adapter.sendTextStream(fullReq)) {
        responseText += chunk.text;
        yield chunk;
      }
      await db.insert(modelCallLogs).values({
        id: randomUUID(), jobId: jobId ?? null, scene: route.scene, modelRouteId: route.routeId, provider: route.provider,
        model: route.billingModelId ?? route.modelId, status: "succeeded",
        errorType: null, errorMessage: null, requestPrompt: req.prompt,
        requestParams: buildRequestParams(req), responseBody: responseText,
        durationMs: Date.now() - startMs, promptTokens: null, completionTokens: null,
        totalTokens: null, inputImageCount: null, outputImageCount: null, createdAt: new Date(),
      }).catch(() => {});
    } catch (err) {
      const ge = err instanceof GatewayError ? err : null;
      await db.insert(modelCallLogs).values({
        id: randomUUID(), jobId: jobId ?? null, scene: route.scene, modelRouteId: route.routeId, provider: route.provider,
        model: route.billingModelId ?? route.modelId, status: "failed",
        errorType: ge?.type ?? "unknown",
        errorMessage: ge?.message ?? (err instanceof Error ? err.message : String(err)),
        requestPrompt: req.prompt, requestParams: buildRequestParams(req), responseBody: null,
        durationMs: Date.now() - startMs, promptTokens: null, completionTokens: null,
        totalTokens: null, inputImageCount: null, outputImageCount: null, createdAt: new Date(),
      }).catch(() => {});
      throw err;
    }
  } else {
    // Non-streaming fallback: use gatewayCall so the request gets properly logged
    const result = await gatewayCall(route, req, jobId);
    if (result.text) {
      yield { text: result.text, done: true };
    } else {
      throw new GatewayError("invalid_response", "模型未返回文本内容");
    }
  }
}

export async function* gatewayStream(
  route: ModelRouteSnapshot,
  req: Omit<GatewayRequest, "model">,
  jobId?: string,
): AsyncGenerator<ImageStreamChunk> {
  const adapter = buildAdapter(route.provider, route.baseUrl, route.modelId);

  const fullReq: GatewayRequest = {
    ...req,
    model: route.modelId,
    parameters: { ...route.parameters, ...(req.parameters ?? {}) },
  };

  if (adapter.sendStream) {
    const startMs = Date.now();
    let outputProduced = false;
    try {
      for await (const chunk of adapter.sendStream(fullReq)) {
        if (chunk.b64) outputProduced = true;
        yield chunk;
      }
      await db.insert(modelCallLogs).values({
        id: randomUUID(),
        jobId: jobId ?? null,
        scene: route.scene,
        modelRouteId: route.routeId,
        provider: route.provider,
        model: route.billingModelId ?? route.modelId,
        status: "succeeded",
        errorType: null,
        errorMessage: null,
        requestPrompt: req.prompt,
        requestParams: buildRequestParams(req),
        responseBody: outputProduced ? "[streamed image]" : null,
        durationMs: Date.now() - startMs,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        inputImageCount: req.images?.length ?? 0,
        outputImageCount: outputProduced ? 1 : 0,
        createdAt: new Date(),
      }).catch(() => {});
    } catch (err) {
      const ge = err instanceof GatewayError ? err : null;
      await db.insert(modelCallLogs).values({
        id: randomUUID(),
        jobId: jobId ?? null,
        scene: route.scene,
        modelRouteId: route.routeId,
        provider: route.provider,
        model: route.billingModelId ?? route.modelId,
        status: "failed",
        errorType: ge?.type ?? "unknown",
        errorMessage: ge?.message ?? (err instanceof Error ? err.message : String(err)),
        requestPrompt: req.prompt,
        requestParams: buildRequestParams(req),
        responseBody: null,
        durationMs: Date.now() - startMs,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        inputImageCount: req.images?.length ?? 0,
        outputImageCount: 0,
        createdAt: new Date(),
      }).catch(() => {});
      throw err;
    }
  } else {
    // Non-streaming fallback: single chunk on completion
    const result = await gatewayCall(route, req, jobId);
    if (result.image) {
      yield { b64: result.image, done: true };
    } else {
      throw new GatewayError("invalid_response", "模型不支持流式渲染且未返回图片");
    }
  }
}
