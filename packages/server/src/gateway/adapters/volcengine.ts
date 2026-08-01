import type { ModelAdapter, GatewayRequest, GatewayResponse, ModelCapability } from "../types.js";
import { GatewayError } from "../types.js";
import { readApiKey } from "../secrets.js";

/**
 * 火山方舟 / 豆包 adapter
 * Docs: https://www.volcengine.com/docs/82379
 * Compatible with OpenAI chat completions format.
 * Image generation uses Seedream/SeedEdit endpoints.
 */
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
    // Route to the right endpoint based on whether images + mask are present
    if (req.mask) return this.imageEdit(req);
    if (!req.images?.length && (req.parameters?.["task_type"] === "image_gen")) {
      return this.imageGeneration(req);
    }
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
    const body: Record<string, unknown> = {
      model: req.model,
      prompt: req.prompt,
      ...(req.parameters ?? {}),
    };
    if (req.images?.[0]) {
      body["image"] = req.images[0]; // reference image
    }

    const data = (await this.post(VolcengineAdapter.IMAGE_GEN_URL, body)) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };

    const first = data.data?.[0];
    if (!first) throw new GatewayError("invalid_response", "火山方舟图片生成无返回数据");
    if (first.b64_json) return { image: first.b64_json, imageMime: "image/jpeg" };
    if (first.url) {
      const imgRes = await fetch(first.url);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      return { image: buf.toString("base64"), imageMime: "image/jpeg" };
    }
    throw new GatewayError("invalid_response", "火山方舟图片生成返回格式异常");
  }

  private async imageEdit(req: GatewayRequest): Promise<GatewayResponse> {
    if (!req.images?.[0] || !req.mask) {
      throw new GatewayError("capability_not_supported", "图片编辑需要提供原图和遮罩");
    }
    const data = (await this.post(VolcengineAdapter.IMAGE_EDIT_URL, {
      model: req.model,
      image: req.images[0],
      mask: req.mask,
      prompt: req.prompt,
      ...(req.parameters ?? {}),
    })) as { data?: Array<{ b64_json?: string }> };

    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new GatewayError("invalid_response", "火山方舟图片编辑返回格式异常");
    return { image: b64, imageMime: "image/jpeg" };
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
        signal: AbortSignal.timeout(180_000), // image gen can be slow
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
