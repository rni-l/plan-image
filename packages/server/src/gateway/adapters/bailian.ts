import type { ModelAdapter, GatewayRequest, GatewayResponse, ModelCapability } from "../types.js";
import { GatewayError } from "../types.js";
import { readApiKey } from "../secrets.js";

/**
 * 阿里云百炼 adapter
 * Docs: https://help.aliyun.com/zh/model-studio/
 * Text/vision: POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
 */
export class BailianAdapter implements ModelAdapter {
  readonly providerName = "bailian";
  readonly capabilities: ModelCapability[] = ["text", "vision"];

  private get apiKey() { return readApiKey("bailian"); }

  async send(req: GatewayRequest): Promise<GatewayResponse> {
    const messages = buildMessages(req);

    let res: Response;
    try {
      res = await fetch(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Key only in header, never logged
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: req.model,
            messages,
            ...(req.parameters ?? {}),
          }),
          signal: AbortSignal.timeout(120_000),
        }
      );
    } catch (err) {
      throw mapFetchError(err, "bailian");
    }

    if (!res.ok) {
      await throwFromStatus(res, "bailian");
    }

    const data = (await res.json()) as DashScopeResponse;
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new GatewayError("invalid_response", "百炼返回了非预期的响应结构");
    }
    return { text };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMessages(req: GatewayRequest): unknown[] {
  const msgs: unknown[] = [];

  if (req.systemPrompt) {
    msgs.push({ role: "system", content: req.systemPrompt });
  }

  if (req.images && req.images.length > 0) {
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

interface DashScopeResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { code?: string; message?: string };
}

async function throwFromStatus(res: Response, provider: string): Promise<never> {
  let body: { error?: { code?: string; message?: string } } = {};
  try { body = await res.json(); } catch { /* ignore */ }

  const msg = body.error?.message ?? res.statusText;
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
