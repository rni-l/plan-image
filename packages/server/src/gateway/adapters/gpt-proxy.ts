import type { ModelAdapter, GatewayRequest, GatewayResponse, ModelCapability } from "../types.js";
import { GatewayError } from "../types.js";
import { readApiKey } from "../secrets.js";

/**
 * GPT 中转服务 adapter — OpenAI-compatible API
 * baseUrl and modelId come from the provider config saved in settings.
 */
export class GptProxyAdapter implements ModelAdapter {
  readonly providerName = "gpt_proxy";
  readonly capabilities: ModelCapability[] = ["text", "vision", "image_gen"];

  constructor(
    private readonly baseUrl: string,
    private readonly defaultModel?: string
  ) {}

  private get apiKey() { return readApiKey("gpt_proxy"); }

  async send(req: GatewayRequest): Promise<GatewayResponse> {
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
        body: JSON.stringify({
          model,
          messages,
          ...(req.parameters ?? {}),
        }),
        signal: AbortSignal.timeout(120_000),
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
    return { text };
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
