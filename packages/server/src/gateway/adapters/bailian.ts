import type { ModelAdapter, GatewayRequest, GatewayResponse, ModelCapability, TextStreamChunk } from "../types.js";
import { GatewayError } from "../types.js";
import { readApiKey } from "../secrets.js";

/**
 * 阿里云百炼 adapter
 * Docs: https://help.aliyun.com/zh/model-studio/
 *
 * Text / vision : POST BAILIAN_BASE/compatible-mode/v1/chat/completions
 * Image gen/edit: POST BAILIAN_BASE/api/v1/services/aigc/multimodal-generation/generation
 */
const BAILIAN_BASE = "https://llm-8i4z2iv36spkom6n.cn-beijing.maas.aliyuncs.com";

export class BailianAdapter implements ModelAdapter {
  readonly providerName = "bailian";
  readonly capabilities: ModelCapability[] = ["text", "vision", "image_gen", "image_edit"];

  private get apiKey() { return readApiKey("bailian"); }

  async send(req: GatewayRequest): Promise<GatewayResponse> {
    if (req.parameters?.["task_type"] === "image_gen")  return this.imageGeneration(req);
    if (req.parameters?.["task_type"] === "image_edit") return this.imageEdit(req);
    return this.textCompletion(req);
  }

  // ---------------------------------------------------------------------------
  // Text / vision
  // ---------------------------------------------------------------------------

  private async textCompletion(req: GatewayRequest): Promise<GatewayResponse> {
    const messages = buildChatMessages(req);
    let res: Response;
    try {
      res = await fetch(
        `${BAILIAN_BASE}/compatible-mode/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: req.model,
            messages,
            ...(req.parameters ?? {}),
          }),
          signal: AbortSignal.timeout(360_000),
        }
      );
    } catch (err) {
      throw mapFetchError(err, "bailian");
    }
    if (!res.ok) await throwFromStatus(res, "bailian");

    const data = (await res.json()) as DashScopeCompatResponse;
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new GatewayError("invalid_response", "百炼返回了非预期的响应结构");
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

  // ---------------------------------------------------------------------------
  // Text streaming (OpenAI-compatible SSE)
  // ---------------------------------------------------------------------------

  async *sendTextStream(req: GatewayRequest): AsyncGenerator<TextStreamChunk> {
    const messages = buildChatMessages(req);
    let res: Response;
    try {
      res = await fetch(
        `${BAILIAN_BASE}/compatible-mode/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: req.model,
            messages,
            stream: true,
            ...(req.parameters ?? {}),
          }),
          signal: AbortSignal.timeout(360_000),
        }
      );
    } catch (err) {
      throw mapFetchError(err, "bailian");
    }
    if (!res.ok) await throwFromStatus(res, "bailian");
    if (!res.body) throw new GatewayError("invalid_response", "bailian: 流式响应无 body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split("\n");
        buf = lines.pop()!;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") {
            if (trimmed === "data: [DONE]") { yield { text: "", done: true }; return; }
            continue;
          }
          if (!trimmed.startsWith("data: ")) continue;

          let chunk: { choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }> };
          try { chunk = JSON.parse(trimmed.slice(6)) as typeof chunk; } catch { continue; }

          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) yield { text: delta, done: false };
          if (chunk.choices?.[0]?.finish_reason === "stop") {
            yield { text: "", done: true };
            return;
          }
        }
      }
      yield { text: "", done: true };
    } finally {
      reader.releaseLock();
    }
  }

  // ---------------------------------------------------------------------------
  // Image generation — qwen-image-2.0 multimodal generation endpoint
  // ---------------------------------------------------------------------------

  private async imageGeneration(req: GatewayRequest): Promise<GatewayResponse> {
    const { task_type: _t, n, watermark, negative_prompt, size, ...rest } =
      (req.parameters ?? {}) as Record<string, unknown>;

    const content: unknown[] = [];
    if (req.images?.length) {
      for (const b64 of req.images) {
        content.push({ image: `data:image/jpeg;base64,${b64}` });
      }
    }
    content.push({ text: req.prompt });

    const endpoint = `${BAILIAN_BASE}/api/v1/services/aigc/multimodal-generation/generation`;

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: req.model,
          input: {
            messages: [{ role: "user", content }],
          },
          parameters: {
            n: n ?? 1,
            watermark: watermark ?? false,
            ...(negative_prompt !== undefined ? { negative_prompt } : {}),
            ...(size ? { size: String(size).replace(/[xX]/, "*") } : {}),
            ...rest,
          },
        }),
        signal: AbortSignal.timeout(720_000),
      });
    } catch (err) {
      throw mapFetchError(err, "bailian");
    }

    if (!res.ok) await throwFromStatus(res, "bailian");

    // Response: { output: { choices: [{ message: { content: [{ image: "url_or_b64" }] } }] } }
    const data = (await res.json()) as MultigenResponse;
    const choice = data.output?.choices?.[0];
    if (!choice) throw new GatewayError("invalid_response", "百炼图片生成未返回任何结果");

    const imgEntry = choice.message?.content?.find(
      (c): c is { image: string } => "image" in c && typeof c.image === "string"
    );
    if (!imgEntry) throw new GatewayError("invalid_response", "百炼图片生成响应中未找到图片字段");

    const raw = imgEntry.image;
    // raw may be a URL or inline base64 / data-URI
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      const imgRes = await fetch(raw, { signal: AbortSignal.timeout(360_000) });
      const buf = Buffer.from(await imgRes.arrayBuffer());
      return { image: buf.toString("base64"), imageMime: "image/jpeg" };
    }
    // data:image/...;base64,<data>
    const b64 = raw.includes(",") ? raw.split(",")[1]! : raw;
    return { image: b64, imageMime: "image/jpeg" };
  }

  // ---------------------------------------------------------------------------
  // Image edit — qwen-image-edit multimodal endpoint
  // ---------------------------------------------------------------------------

  private async imageEdit(req: GatewayRequest): Promise<GatewayResponse> {
    if (!req.images?.[0]) {
      throw new GatewayError("capability_not_supported", "图片编辑需要提供原图");
    }

    const { task_type: _t, n, watermark, size, ...rest } =
      (req.parameters ?? {}) as Record<string, unknown>;

    const content: unknown[] = [
      { image: `data:${detectMimeFromBase64(req.images[0])};base64,${req.images[0]}` },
      ...(req.mask
        ? [{ image: `data:${detectMimeFromBase64(req.mask)};base64,${req.mask}` }]
        : []),
      { text: req.prompt },
    ];

    const endpoint = `${BAILIAN_BASE}/api/v1/services/aigc/multimodal-generation/generation`;

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: req.model,
          input: { messages: [{ role: "user", content }] },
          parameters: {
            n: n ?? 1,
            watermark: watermark ?? false,
            ...(size ? { size: String(size).replace(/[xX]/, "*") } : {}),
            ...rest,
          },
        }),
        signal: AbortSignal.timeout(720_000),
      });
    } catch (err) {
      throw mapFetchError(err, "bailian");
    }

    if (!res.ok) await throwFromStatus(res, "bailian");

    const data = (await res.json()) as MultigenResponse;
    const imgEntry = data.output?.choices?.[0]?.message?.content?.find(
      (c): c is { image: string } => "image" in c && typeof c.image === "string"
    );
    if (!imgEntry) throw new GatewayError("invalid_response", "百炼图片编辑响应中未找到图片字段");

    const raw = imgEntry.image;
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      const imgRes = await fetch(raw, { signal: AbortSignal.timeout(360_000) });
      const buf = Buffer.from(await imgRes.arrayBuffer());
      return { image: buf.toString("base64"), imageMime: "image/jpeg" };
    }
    const b64 = raw.includes(",") ? raw.split(",")[1]! : raw;
    return { image: b64, imageMime: "image/jpeg" };
  }
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface DashScopeCompatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { code?: string; message?: string };
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface MultigenResponse {
  output?: {
    choices?: Array<{
      finish_reason?: string;
      message?: {
        role?: string;
        content?: Array<Record<string, unknown>>;
      };
    }>;
  };
  code?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildChatMessages(req: GatewayRequest): unknown[] {
  const msgs: unknown[] = [];

  if (req.systemPrompt) {
    msgs.push({ role: "system", content: req.systemPrompt });
  }

  if (req.images?.length) {
    const content: unknown[] = req.images.map((b64) => ({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${b64}` },
    }));
    content.push({ type: "text", text: req.prompt });
    msgs.push({ role: "user", content });
  } else {
    msgs.push({ role: "user", content: req.prompt });
  }

  return msgs;
}

async function throwFromStatus(res: Response, provider: string): Promise<never> {
  // DashScope returns { code, message, request_id } at top level
  // OpenAI-compat wraps in { error: { message } }
  let body: { error?: { code?: string; message?: string }; message?: string; code?: string } = {};
  try { body = await res.json(); } catch { /* ignore */ }

  const msg = body.error?.message ?? body.message ?? res.statusText;
  if (res.status === 401 || res.status === 403) throw new GatewayError("authentication_failed", `${provider}: ${msg}`);
  if (res.status === 429)                        throw new GatewayError("rate_limited",           `${provider}: ${msg}`);
  if (res.status === 400 && /content|filter/i.test(msg)) throw new GatewayError("content_rejected", `${provider}: ${msg}`);
  throw new GatewayError("invalid_response", `${provider}: HTTP ${res.status} — ${msg}`);
}

function mapFetchError(err: unknown, provider: string): GatewayError {
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout|abort/i.test(msg)) return new GatewayError("timeout", `${provider}: 请求超时`);
  return new GatewayError("unknown", `${provider}: ${msg}`);
}

/**
 * Detect image MIME type from the first bytes of a base64-encoded binary.
 * PNG magic bytes (89 50 4E 47) → b64 prefix "iVBOR"
 * JPEG magic bytes (FF D8 FF)   → b64 prefix "/9j/"
 * WEBP container (52 49 46 46)  → b64 prefix "UklG"
 */
function detectMimeFromBase64(b64: string): string {
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("/9j/"))  return "image/jpeg";
  if (b64.startsWith("UklG"))  return "image/webp";
  return "image/jpeg"; // safe fallback
}
