/** Capability flags a model can declare */
export type ModelCapability =
  | "text"       // generate/analyze text
  | "vision"     // understand image inputs
  | "image_gen"  // generate images from text/image prompts
  | "image_edit" // edit images with mask + instruction

export interface ModelAdapter {
  readonly providerName: string;
  /** Declared capabilities — checked before job submission */
  readonly capabilities: ModelCapability[];
  /** Send a completion/generation request */
  send(req: GatewayRequest): Promise<GatewayResponse>;
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

export interface GatewayResponse {
  /** Primary text output */
  text?: string;
  /** Base64-encoded image output (image_gen / image_edit) */
  image?: string;
  /** Mime type of image output */
  imageMime?: "image/jpeg" | "image/png" | "image/webp";
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
