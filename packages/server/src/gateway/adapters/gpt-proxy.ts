import type { ModelAdapter, GatewayRequest, GatewayResponse, ModelCapability } from "../types.js";
import { GatewayError } from "../types.js";
import { readApiKey } from "../secrets.js";

/**
 * Map a pixel-dimension size string ("1000x1000", "800x1200") or an already-valid
 * keyword to a valid OpenAI image size.
 *
 * Canonical sizes:
 *   DALL-E 3:    1024x1024 | 1792x1024 | 1024x1792
 *   gpt-image-2: 1024x1024 | 1536x1024 | 1024x1536 | auto
 *   DALL-E 2:    256x256   | 512x512   | 1024x1024
 *
 * Unknown / non-standard pixel dimensions are rounded to the nearest canonical
 * size based on aspect ratio.
 */
function toOpenAISize(size: unknown): string {
  if (!size) return "1024x1024";
  const s = String(size).trim().toLowerCase();

  const VALID = [
    "256x256", "512x512",
    "1024x1024",
    "1792x1024", "1024x1792",  // DALL-E 3
    "1536x1024", "1024x1536",  // gpt-image-2
    "auto",
  ];
  if (VALID.includes(s)) return s;

  // Convert arbitrary pixel dimensions — snap to nearest aspect ratio
  const m = s.match(/^(\d+)[x×*](\d+)$/);
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    const ratio = w / h;
    if (ratio > 1.2) return "1536x1024";  // landscape
    if (ratio < 0.8) return "1024x1536";  // portrait
    return "1024x1024";                   // square
  }
  return "1024x1024";
}

/**
 * Wrap a raw base64 string as a data URL.
 * Already-wrapped data URLs are passed through unchanged.
 */
function toDataUrl(b64: string): string {
  if (b64.startsWith("data:")) return b64;
  let mime = "image/jpeg";
  if (b64.startsWith("iVBOR")) mime = "image/png";
  else if (b64.startsWith("UklG")) mime = "image/webp";
  return `data:${mime};base64,${b64}`;
}

/**
 * GPT 中转服务 adapter — OpenAI-compatible API
 * baseUrl and modelId come from the provider config saved in settings.
 */
export class GptProxyAdapter implements ModelAdapter {
  readonly providerName = "gpt_proxy";
  readonly capabilities: ModelCapability[] = ["text", "vision", "image_gen", "image_edit"];

  constructor(
    private readonly baseUrl: string,
    private readonly defaultModel?: string
  ) {}

  private get apiKey() { return readApiKey("gpt_proxy"); }

  async send(req: GatewayRequest): Promise<GatewayResponse> {
    if (req.mask) return this.imageEdit(req);
    if (req.parameters?.["task_type"] === "image_gen") return this.imageGeneration(req);
    return this.textCompletion(req);
  }

  private async textCompletion(req: GatewayRequest): Promise<GatewayResponse> {
    const model = req.model || this.defaultModel || "gpt-4o";
    const url = `${this.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
    const messages = buildMessages(req);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model, messages, ...(req.parameters ?? {}) }),
        signal: AbortSignal.timeout(360_000),
      });
    } catch (err) {
      throw mapFetchError(err, "gpt_proxy");
    }

    if (!res.ok) await throwFromStatus(res, "gpt_proxy");

    const data = (await res.json()) as OpenAIResponse;
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new GatewayError("invalid_response", "GPT中转返回了非预期的响应结构");
    }
    const u = data.usage;
    return {
      text,
      ...(u
        ? {
            usage: {
              promptTokens: u.prompt_tokens ?? 0,
              completionTokens: u.completion_tokens ?? 0,
              totalTokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
            },
          }
        : {}),
    };
  }

  private async imageGeneration(req: GatewayRequest): Promise<GatewayResponse> {
    const model = req.model || this.defaultModel || "gpt-image-2";
    const url = `${this.baseUrl.replace(/\/$/, "")}/v1/images/generations`;
    const { task_type: _t, size, quality, ...rest } = (req.parameters ?? {}) as Record<string, unknown>;

    const body: Record<string, unknown> = {
      model,
      prompt: req.prompt,
      n: 1,
      size: toOpenAISize(size),
      response_format: "b64_json",
      // quality is supported by gpt-image-2: "low" | "medium" | "high" | "auto"
      // default to "high" unless the route config overrides it
      quality: (quality as string | undefined) ?? "high",
      ...rest,
    };

    // Pass product reference image when provided (supported by gpt-image-2)
    if (req.images?.[0] && req.images[0].length > 0) {
      body["image"] = toDataUrl(req.images[0]);
    }

    // Build a log-safe copy — replace binary data with size placeholders
    const logBody = { ...body };
    if (typeof logBody["image"] === "string") {
      logBody["image"] = `[image: ~${Math.round((logBody["image"] as string).length * 0.75 / 1024)}KB]`;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(720_000),
      });
    } catch (err) {
      throw mapFetchError(err, "gpt_proxy");
    }

    if (!res.ok) await throwFromStatus(res, "gpt_proxy");

    const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const first = data.data?.[0];
    if (!first) throw new GatewayError("invalid_response", "GPT中转图片生成无返回数据");

    if (first.b64_json) return { image: first.b64_json, imageMime: "image/png", _sentBody: logBody };
    if (first.url) {
      const imgRes = await fetch(first.url, { signal: AbortSignal.timeout(360_000) });
      const buf = Buffer.from(await imgRes.arrayBuffer());
      return { image: buf.toString("base64"), imageMime: "image/png", _sentBody: logBody };
    }
    throw new GatewayError("invalid_response", "GPT中转图片生成返回格式异常");
  }

  /**
   * Image editing via OpenAI /v1/images/edits.
   * Uses multipart/form-data (PNG files) — different from volcengine which accepts JSON data URLs.
   */
  private async imageEdit(req: GatewayRequest): Promise<GatewayResponse> {
    if (!req.images?.[0] || !req.mask) {
      throw new GatewayError("capability_not_supported", "图片编辑需要提供原图和遮罩");
    }

    const model = req.model || this.defaultModel || "gpt-image-2";
    const url = `${this.baseUrl.replace(/\/$/, "")}/v1/images/edits`;
    const { task_type: _t, size, quality, n: _n, ...rest } = (req.parameters ?? {}) as Record<string, unknown>;

    // Convert base64 → Buffer → Blob for multipart upload
    const imageBlob = new Blob([Buffer.from(req.images[0], "base64")], { type: "image/png" });
    const maskBlob  = new Blob([Buffer.from(req.mask,       "base64")], { type: "image/png" });

    const form = new FormData();
    form.append("model",  model);
    form.append("prompt", req.prompt);
    form.append("image",  imageBlob, "image.png");
    form.append("mask",   maskBlob,  "mask.png");
    form.append("n",      "1");
    form.append("size",   toOpenAISize(size));
    form.append("response_format", "b64_json");
    // quality default: "high"
    form.append("quality", (quality as string | undefined) ?? "high");
    // forward any extra route params that are scalar
    for (const [k, v] of Object.entries(rest)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        form.append(k, String(v));
      }
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        // Do NOT set Content-Type — fetch sets it automatically with the boundary
        body: form,
        signal: AbortSignal.timeout(720_000),
      });
    } catch (err) {
      throw mapFetchError(err, "gpt_proxy");
    }

    if (!res.ok) await throwFromStatus(res, "gpt_proxy");

    const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const first = data.data?.[0];
    if (!first) throw new GatewayError("invalid_response", "GPT中转图片编辑无返回数据");

    const logBody = {
      model, prompt: req.prompt, size: toOpenAISize(size), quality: (quality as string | undefined) ?? "high",
      image: `[image: ~${Math.round(req.images[0].length * 0.75 / 1024)}KB]`,
      mask:  `[mask: ~${Math.round(req.mask.length * 0.75 / 1024)}KB]`,
    };

    if (first.b64_json) return { image: first.b64_json, imageMime: "image/png", _sentBody: logBody };
    if (first.url) {
      const imgRes = await fetch(first.url, { signal: AbortSignal.timeout(360_000) });
      const buf = Buffer.from(await imgRes.arrayBuffer());
      return { image: buf.toString("base64"), imageMime: "image/png", _sentBody: logBody };
    }
    throw new GatewayError("invalid_response", "GPT中转图片编辑返回格式异常");
  }
}

function buildMessages(req: GatewayRequest): unknown[] {
  const msgs: unknown[] = [];
  if (req.systemPrompt) msgs.push({ role: "system", content: req.systemPrompt });

  if (req.images?.length) {
    const content: unknown[] = req.images.map((b64) => ({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "high" },
    }));
    content.push({ type: "text", text: req.prompt });
    msgs.push({ role: "user", content });
  } else {
    msgs.push({ role: "user", content: req.prompt });
  }
  return msgs;
}

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

async function throwFromStatus(res: Response, provider: string): Promise<never> {
  let body: { error?: { message?: string } } = {};
  try { body = await res.json(); } catch { /* ignore */ }
  const msg = body.error?.message ?? res.statusText;
  if (res.status === 401 || res.status === 403) throw new GatewayError("authentication_failed", `${provider}: ${msg}`);
  if (res.status === 429) throw new GatewayError("rate_limited", `${provider}: ${msg}`);
  throw new GatewayError("invalid_response", `${provider}: HTTP ${res.status} — ${msg}`);
}

function mapFetchError(err: unknown, provider: string): GatewayError {
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout|abort/i.test(msg)) return new GatewayError("timeout", `${provider}: 请求超时`);
  return new GatewayError("unknown", `${provider}: ${msg}`);
}
