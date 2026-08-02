import type { ModelAdapter, GatewayRequest, GatewayResponse, ModelCapability, ImageStreamChunk, TextStreamChunk } from "../types.js";
import { GatewayError } from "../types.js";
import { readApiKey } from "../secrets.js";

/**
 * 火山方舟 / 豆包 adapter
 * Docs: https://www.volcengine.com/docs/82379
 *
 * Text/vision: POST /api/v3/chat/completions  (OpenAI-compat)
 * Image gen  : POST /api/v3/images/generations (Seedream — sync, stream:false)
 *   - size uses resolution keywords: "1K" | "2K" | "4K"  (NOT pixel dimensions)
 *   - requires stream:false, response_format, watermark
 * Image edit : POST /api/v3/images/edits
 */

/**
 * Map a pixel-dimension size string ("1000x1000", "2048x2048") or an
 * already-valid keyword ("2K", "4K") to Volcengine's resolution keyword.
 * All 火山方舟 image-generation models use "2K" (≤2048px) or "4K" (>2048px).
 * "1K" is intentionally excluded — current models require at least 2K.
 */
function toSeedreamSize(size: unknown): string {
  if (!size) return "2K";
  const s = String(size).trim();
  // Pass through if already a valid keyword (accept 1K too, in case caller knows better)
  if (/^\d+K$/i.test(s)) return s.toUpperCase();
  // Convert pixel dimensions "NxM" / "N*M"
  const m = s.match(/^(\d+)[xX*×](\d+)$/);
  if (m) {
    const maxDim = Math.max(Number(m[1]), Number(m[2]));
    if (maxDim <= 2048) return "2K";
    return "4K";
  }
  return "2K"; // safe fallback
}

/**
 * Wrap a raw base64 string as a data URL.
 * Already-wrapped data URLs are passed through unchanged.
 * MIME type is detected from the first bytes of the base64 payload.
 */
function toDataUrl(b64: string): string {
  if (b64.startsWith("data:")) return b64;
  let mime = "image/jpeg";
  if (b64.startsWith("iVBOR")) mime = "image/png";
  else if (b64.startsWith("UklG"))  mime = "image/webp";
  // jpeg: starts with /9j/ — default
  return `data:${mime};base64,${b64}`;
}

export class VolcengineAdapter implements ModelAdapter {
  readonly providerName = "volcengine";
  readonly capabilities: ModelCapability[] = ["text", "vision", "image_gen", "image_edit"];

  private static readonly TEXT_URL =
    "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
  private static readonly IMAGE_GEN_URL =
    "https://ark.cn-beijing.volces.com/api/v3/images/generations";
  private static readonly IMAGE_EDIT_URL =
    "https://ark.cn-beijing.volces.com/api/v3/images/edits";

  private get apiKey() { return readApiKey("volcengine"); }

  async send(req: GatewayRequest): Promise<GatewayResponse> {
    if (req.mask) return this.imageEdit(req);
    if (req.parameters?.["task_type"] === "image_gen") return this.imageGeneration(req);
    return this.textCompletion(req);
  }

  private async textCompletion(req: GatewayRequest): Promise<GatewayResponse> {
    const messages: unknown[] = [];
    if (req.systemPrompt) messages.push({ role: "system", content: req.systemPrompt });

    if (req.images?.length) {
      const content: unknown[] = req.images.map((b64) => ({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${b64}` },
      }));
      content.push({ type: "text", text: req.prompt });
      messages.push({ role: "user", content });
    } else {
      messages.push({ role: "user", content: req.prompt });
    }

    const res = await this.post(VolcengineAdapter.TEXT_URL, {
      model: req.model,
      messages,
      ...(req.parameters ?? {}),
    });

    const data = res as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new GatewayError("invalid_response", "火山方舟返回了非预期的响应结构");
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
    // Strip internal gateway routing params; translate size to Seedream keyword format.
    const {
      task_type: _t,       // internal only — never sent to API
      size,
      n,
      watermark,
      response_format,
      ...restParams
    } = (req.parameters ?? {}) as Record<string, unknown>;

    const body: Record<string, unknown> = {
      model: req.model,
      prompt: req.prompt,
      stream: false,                                              // synchronous response
      response_format: (response_format as string | undefined) ?? "url",
      watermark: watermark ?? false,
      size: toSeedreamSize(size),                                // "1K" / "2K" / "4K"
      ...restParams,
    };
    if (n != null) body["n"] = n;
    // Reference image: pass as data URL (data:image/<format>;base64,<data>).
    // Only attach if the base64 payload is non-empty to avoid "invalid url" errors.
    if (req.images?.[0] && req.images[0].length > 0) {
      body["image"] = toDataUrl(req.images[0]);
    }

    // DEBUG — remove after confirming size format
    console.log("[volcengine imageGeneration] body sent to API:", JSON.stringify({ ...body, image: body["image"] ? "[...]" : undefined }, null, 2));
    console.log(body);

    const data = (await this.post(VolcengineAdapter.IMAGE_GEN_URL, body)) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };

    const first = data.data?.[0];
    if (!first) throw new GatewayError("invalid_response", "火山方舟图片生成无返回数据");

    // Build a log-safe copy (replace binary fields with size placeholders)
    const logBody = { ...body };
    if (typeof logBody["image"] === "string") {
      logBody["image"] = `[image: ~${Math.round((logBody["image"] as string).length * 0.75 / 1024)}KB]`;
    }

    if (first.b64_json) return { image: first.b64_json, imageMime: "image/jpeg", _sentBody: logBody };
    if (first.url) {
      const imgRes = await fetch(first.url, { signal: AbortSignal.timeout(360_000) });
      if (!imgRes.ok) {
        throw new GatewayError("invalid_response", `火山方舟图片URL下载失败: ${imgRes.status}`);
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      return { image: buf.toString("base64"), imageMime: "image/jpeg", _sentBody: logBody };
    }
    throw new GatewayError("invalid_response", "火山方舟图片生成返回格式异常");
  }

  private async imageEdit(req: GatewayRequest): Promise<GatewayResponse> {
    if (!req.images?.[0] || !req.mask) {
      throw new GatewayError("capability_not_supported", "图片编辑需要提供原图和遮罩");
    }
    const editBody = {
      model: req.model,
      image: toDataUrl(req.images[0]),
      mask: toDataUrl(req.mask),
      prompt: req.prompt,
      ...(req.parameters ?? {}),
    };
    const data = (await this.post(VolcengineAdapter.IMAGE_EDIT_URL, editBody)) as {
      data?: Array<{ b64_json?: string }>;
    };

    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new GatewayError("invalid_response", "火山方舟图片编辑返回格式异常");

    const logBody = { ...editBody,
      image: `[image: ~${Math.round(editBody.image.length * 0.75 / 1024)}KB]`,
      mask:  `[mask: ~${Math.round(editBody.mask!.length  * 0.75 / 1024)}KB]`,
    };
    return { image: b64, imageMime: "image/jpeg", _sentBody: logBody };
  }

  /**
   * Streaming text completion — yields text delta chunks as the model outputs them.
   * Uses OpenAI-compatible SSE format (data: {"choices":[{"delta":{"content":"..."}}]}).
   */
  async *sendTextStream(req: GatewayRequest): AsyncGenerator<TextStreamChunk> {
    const messages: unknown[] = [];
    if (req.systemPrompt) messages.push({ role: "system", content: req.systemPrompt });

    if (req.images?.length) {
      const content: unknown[] = req.images.map((b64) => ({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${b64}` },
      }));
      content.push({ type: "text", text: req.prompt });
      messages.push({ role: "user", content });
    } else {
      messages.push({ role: "user", content: req.prompt });
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      stream: true,
      ...(req.parameters ?? {}),
    };

    let res: Response;
    try {
      res = await fetch(VolcengineAdapter.TEXT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(360_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/timeout|abort/i.test(msg)) throw new GatewayError("timeout", "volcengine: 请求超时");
      throw new GatewayError("unknown", `volcengine: ${msg}`);
    }

    if (!res.ok) {
      let errBody: { error?: { message?: string } } = {};
      try { errBody = await res.json(); } catch { /* ignore */ }
      const msg = errBody.error?.message ?? res.statusText;
      if (res.status === 401 || res.status === 403) throw new GatewayError("authentication_failed", `volcengine: ${msg}`);
      if (res.status === 429) throw new GatewayError("rate_limited", `volcengine: ${msg}`);
      throw new GatewayError("invalid_response", `volcengine: HTTP ${res.status} — ${msg}`);
    }

    if (!res.body) throw new GatewayError("invalid_response", "volcengine: 流式响应无 body");

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

  async *sendStream(req: GatewayRequest): AsyncGenerator<ImageStreamChunk> {
    if (req.parameters?.["task_type"] !== "image_gen") {
      throw new GatewayError("capability_not_supported", "流式渲染仅支持图片生成场景");
    }

    const {
      task_type: _t,
      size,
      n,
      watermark,
      response_format: _rf, // force b64_json for streaming
      ...restParams
    } = (req.parameters ?? {}) as Record<string, unknown>;

    const body: Record<string, unknown> = {
      model: req.model,
      prompt: req.prompt,
      stream: true,
      response_format: "b64_json",  // streaming requires b64, not URL
      watermark: watermark ?? false,
      size: toSeedreamSize(size),                                // "1K" / "2K" / "4K"
      ...restParams,
    };
    if (n != null) body["n"] = n;

    let res: Response;
    try {
      res = await fetch(VolcengineAdapter.IMAGE_GEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(720_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/timeout|abort/i.test(msg)) throw new GatewayError("timeout", "volcengine: 请求超时");
      throw new GatewayError("unknown", `volcengine: ${msg}`);
    }

    if (!res.ok) {
      let errBody: { error?: { message?: string } } = {};
      try { errBody = await res.json(); } catch { /* ignore */ }
      const msg = errBody.error?.message ?? res.statusText;
      if (res.status === 401 || res.status === 403) throw new GatewayError("authentication_failed", `volcengine: ${msg}`);
      if (res.status === 429) throw new GatewayError("rate_limited", `volcengine: ${msg}`);
      throw new GatewayError("invalid_response", `volcengine: HTTP ${res.status} — ${msg}`);
    }

    if (!res.body) throw new GatewayError("invalid_response", "volcengine: 流式响应无 body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // Process complete lines (SSE events are newline-delimited)
        const lines = buf.split("\n");
        buf = lines.pop()!; // keep the last (potentially incomplete) line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;

          let chunk: { data?: Array<{ b64_json?: string; finish_reason?: string | null }> };
          try {
            chunk = JSON.parse(trimmed.slice(6)) as typeof chunk;
          } catch {
            continue; // skip malformed lines
          }

          const item = chunk.data?.[0];
          if (!item?.b64_json) continue;

          const isDone = item.finish_reason === "stop";
          yield { b64: item.b64_json, done: isDone };
          if (isDone) return;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async post(url: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(720_000), // image gen can be slow
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/timeout|abort/i.test(msg)) throw new GatewayError("timeout", `volcengine: 请求超时`);
      throw new GatewayError("unknown", `volcengine: ${msg}`);
    }

    if (!res.ok) {
      let errBody: { error?: { message?: string } } = {};
      try { errBody = await res.json(); } catch { /* ignore */ }
      const msg = errBody.error?.message ?? res.statusText;
      if (res.status === 401 || res.status === 403) throw new GatewayError("authentication_failed", `volcengine: ${msg}`);
      if (res.status === 429) throw new GatewayError("rate_limited", `volcengine: ${msg}`);
      if (res.status === 400 && /content|filter/i.test(msg)) throw new GatewayError("content_rejected", `volcengine: ${msg}`);
      throw new GatewayError("invalid_response", `volcengine: HTTP ${res.status} — ${msg}`);
    }

    return res.json();
  }
}
