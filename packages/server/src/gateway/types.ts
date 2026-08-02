/** A text delta chunk from a streaming text completion */
export type TextStreamChunk = { text: string; done: boolean };

/** Capability flags a model can declare */
export type ModelCapability =
  | "text"       // generate/analyze text
  | "vision"     // understand image inputs
  | "image_gen"  // generate images from text/image prompts
  | "image_edit" // edit images with mask + instruction

/** A single frame from a streaming image generation response */
export type ImageStreamChunk = {
  /** Base64-encoded JPEG, progressively improving quality with each frame */
  b64: string;
  /** True on the last frame — highest quality, generation complete */
  done: boolean;
};

export interface ModelAdapter {
  readonly providerName: string;
  /** Declared capabilities — checked before job submission */
  readonly capabilities: ModelCapability[];
  /** Send a completion/generation request */
  send(req: GatewayRequest): Promise<GatewayResponse>;
  /**
   * Optional streaming variant for image generation.
   * Yields progressive preview frames; the final frame has done=true.
   * Falls back to a single-chunk wrapper around send() when absent.
   */
  sendStream?(req: GatewayRequest): AsyncGenerator<ImageStreamChunk>;
  /**
   * Optional streaming variant for text completions.
   * Yields text delta chunks; the final chunk has done=true.
   * When absent, gatewayTextStream falls back to send() wrapped in a single chunk.
   */
  sendTextStream?(req: GatewayRequest): AsyncGenerator<TextStreamChunk>;
}

export interface GatewayRequest {
  scene: string;
  model: string;
  /** Plain text prompt or instruction */
  prompt: string;
  /** System prompt (text scenes) */
  systemPrompt?: string;
  /** Base64-encoded images */
  images?: string[];
  /** Base64-encoded mask image (image_edit only) */
  mask?: string;
  /** Extra provider-specific parameters from route config */
  parameters?: Record<string, unknown>;
}

export interface GatewayUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface GatewayResponse {
  /** Primary text output */
  text?: string;
  /** Base64-encoded image output (image_gen / image_edit) */
  image?: string;
  /** Mime type of image output */
  imageMime?: "image/jpeg" | "image/png" | "image/webp";
  /** Token usage — populated by text/vision calls; absent for image-gen */
  usage?: GatewayUsage;
  /**
   * The exact body that was sent to the upstream API, for accurate logging.
   * Binary fields (images, masks) are replaced with size placeholders.
   */
  _sentBody?: Record<string, unknown>;
}

/** Normalized error types surfaced to jobs and UI */
export type GatewayErrorType =
  | "authentication_failed"
  | "rate_limited"
  | "timeout"
  | "content_rejected"
  | "capability_not_supported"
  | "invalid_response"
  | "unknown";

export class GatewayError extends Error {
  constructor(
    public readonly type: GatewayErrorType,
    message: string
  ) {
    super(message);
    this.name = "GatewayError";
  }
}
