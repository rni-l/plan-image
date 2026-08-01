import { integer, real, text, sqliteTable } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
};

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  notes: text("notes"),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  ...timestamps,
});

export const productAssets = sqliteTable("product_assets", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  filePath: text("file_path").notNull(),
  checksum: text("checksum").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const productSpecifications = sqliteTable("product_specifications", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  label: text("label").notNull(),
  value: text("value").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const sellingPoints = sqliteTable("selling_points", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  content: text("content").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ---------------------------------------------------------------------------
// Competitor research
// ---------------------------------------------------------------------------

export const competitorAssets = sqliteTable("competitor_assets", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  filePath: text("file_path").notNull(),
  checksum: text("checksum").notNull(),
  originalName: text("original_name"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const analysisVersions = sqliteTable("analysis_versions", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  versionNumber: integer("version_number").notNull(),
  /** JSON array of competitor_asset ids included in this version */
  competitorAssetIds: text("competitor_asset_ids").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const imageAnalysisCards = sqliteTable("image_analysis_cards", {
  id: text("id").primaryKey(),
  analysisVersionId: text("analysis_version_id")
    .notNull()
    .references(() => analysisVersions.id),
  competitorAssetId: text("competitor_asset_id")
    .notNull()
    .references(() => competitorAssets.id),
  /** JSON object: layout, colors, copy, selling_points, scene, techniques */
  modelOutput: text("model_output").notNull(),
  /** JSON object with same shape; null = not yet overridden */
  humanOverride: text("human_override"),
  ...timestamps,
});

export const synthesisReports = sqliteTable("synthesis_reports", {
  id: text("id").primaryKey(),
  analysisVersionId: text("analysis_version_id")
    .notNull()
    .references(() => analysisVersions.id)
    .unique(),
  /** JSON object: industry_patterns, differentiation_opportunities, design_suggestions */
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// Generation tasks
// ---------------------------------------------------------------------------

export type OutputType = "main_image" | "detail_page";
export type TaskStep = 1 | 2 | 3 | 4;

export const generationTasks = sqliteTable("generation_tasks", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  analysisVersionId: text("analysis_version_id")
    .notNull()
    .references(() => analysisVersions.id),
  /** JSON array: e.g. ["main_image", "detail_page"] */
  outputTypes: text("output_types").notNull(),
  /** Frozen snapshot of model routing + output presets at creation time */
  configSnapshot: text("config_snapshot").notNull(),
  currentStep: integer("current_step").notNull().default(1),
  ...timestamps,
});

export const designDirections = sqliteTable("design_directions", {
  id: text("id").primaryKey(),
  generationTaskId: text("generation_task_id")
    .notNull()
    .references(() => generationTasks.id),
  label: text("label").notNull(), // e.g. "方向A"
  /** Full JSON content: positioning, colorScheme, layoutIntent, copyStrategy, etc. */
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const designPlanVersions = sqliteTable("design_plan_versions", {
  id: text("id").primaryKey(),
  generationTaskId: text("generation_task_id")
    .notNull()
    .references(() => generationTasks.id),
  selectedDirectionId: text("selected_direction_id")
    .notNull()
    .references(() => designDirections.id),
  versionNumber: integer("version_number").notNull().default(1),
  /** null = draft; non-null = confirmed (immutable after this point) */
  confirmedAt: integer("confirmed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type ListType = "main_image" | "detail_page";

export const imageItems = sqliteTable("image_items", {
  id: text("id").primaryKey(),
  designPlanVersionId: text("design_plan_version_id")
    .notNull()
    .references(() => designPlanVersions.id),
  listType: text("list_type").$type<ListType>().notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  title: text("title").notNull(),
  description: text("description"),
  /** JSON array of selling point strings */
  sellingPoints: text("selling_points"),
  suggestedCopy: text("suggested_copy"),
  compositionIntent: text("composition_intent"),
  /** JSON array of reference asset ids */
  referenceAssetIds: text("reference_asset_ids"),
  /** Frozen output preset snapshot at plan confirmation */
  outputPresetSnapshot: text("output_preset_snapshot").notNull(),
  ...timestamps,
});

export type GenerationType = "initial" | "regeneration" | "inpaint";

export const imageVersions = sqliteTable("image_versions", {
  id: text("id").primaryKey(),
  imageItemId: text("image_item_id")
    .notNull()
    .references(() => imageItems.id),
  filePath: text("file_path").notNull(),
  checksum: text("checksum").notNull(),
  generationType: text("generation_type").$type<GenerationType>().notNull(),
  /** For inpaint: the version that was edited */
  parentVersionId: text("parent_version_id"),
  /** FK to background_jobs.id — set after job completion */
  jobId: text("job_id"),
  /** Path to mask file (inpaint only) */
  maskPath: text("mask_path"),
  /** Natural language instruction (inpaint only) */
  instruction: text("instruction"),
  /** 1 = this is the currently selected version for the item */
  isSelected: integer("is_selected", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// Background jobs
// ---------------------------------------------------------------------------

export type JobType =
  | "competitor_image_analysis"
  | "competitor_synthesis"
  | "design_plan"
  | "image_generation"
  | "image_edit"
  | "export";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export const backgroundJobs = sqliteTable("background_jobs", {
  id: text("id").primaryKey(),
  type: text("type").$type<JobType>().notNull(),
  status: text("status").$type<JobStatus>().notNull().default("queued"),
  /** Related entity for quick lookup (e.g. 'image_item', 'analysis_version') */
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  /** Complete frozen input at enqueue time — used for retry */
  inputSnapshot: text("input_snapshot"),
  /** Normalized error type (authentication_failed, rate_limited, timeout, etc.) */
  errorType: text("error_type"),
  /** User-facing error message (no API keys or request headers) */
  errorMessage: text("error_message"),
  startedAt: integer("started_at", { mode: "timestamp" }),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type ProviderName = "bailian" | "volcengine" | "gpt_proxy";
export type SceneKey =
  | "competitor_image_analysis"
  | "competitor_synthesis"
  | "design_plan"
  | "image_generation"
  | "image_edit";

export const modelProviders = sqliteTable("model_providers", {
  id: text("id").primaryKey(),
  name: text("name").$type<ProviderName>().notNull().unique(),
  /** Only for gpt_proxy */
  baseUrl: text("base_url"),
  /** Whether an API key has been saved to the secrets file */
  isConfigured: integer("is_configured", { mode: "boolean" }).notNull().default(false),
  /** Last 4 chars of the key for display; never the full key */
  keyHint: text("key_hint"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const modelSceneRoutes = sqliteTable("model_scene_routes", {
  id: text("id").primaryKey(),
  scene: text("scene").$type<SceneKey>().notNull().unique(),
  providerId: text("provider_id").references(() => modelProviders.id),
  modelId: text("model_id"),
  /** JSON object of extra model parameters */
  parameters: text("parameters"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type PresetType = "main_image" | "detail_module";
export type ImageFormat = "jpg" | "png";

export const outputPresets = sqliteTable("output_presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  presetType: text("preset_type").$type<PresetType>().notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  format: text("format").$type<ImageFormat>().notNull().default("jpg"),
  quality: integer("quality").notNull().default(90),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
});

export const modelCallLogs = sqliteTable("model_call_logs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").references(() => backgroundJobs.id),
  scene: text("scene").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull(), // 'succeeded' | 'failed'
  errorType: text("error_type"),
  durationMs: integer("duration_ms"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  // NOTE: prompt text, request headers, and API keys are never stored here
});

// ---------------------------------------------------------------------------
// Logs & Billing
// ---------------------------------------------------------------------------

/** Records every inbound HTTP API request for auditing and diagnostics */
export const apiRequestLogs = sqliteTable("api_request_logs", {
  id: text("id").primaryKey(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  statusCode: integer("status_code"),
  durationMs: integer("duration_ms"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/** Per-model pricing config used to compute costs in the billing view */
export const modelPricing = sqliteTable("model_pricing", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  modelId: text("model_id").notNull(),
  /** Price in USD per 1 million input tokens (text models) */
  pricePerMInputTokens: real("price_per_m_input_tokens").notNull().default(0),
  /** Price in USD per 1 million output tokens (text models) */
  pricePerMOutputTokens: real("price_per_m_output_tokens").notNull().default(0),
  /** 1 = image-generation model, 0 = text/vision model */
  isImageModel: integer("is_image_model", { mode: "boolean" }).notNull().default(false),
  /** Price in USD per generated image (image models) */
  pricePerImage: real("price_per_image").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
