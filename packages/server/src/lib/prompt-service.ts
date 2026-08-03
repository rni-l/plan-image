export const TEMPLATE_BODY_MAX_LENGTH = 20_000;
export const FINAL_PROMPT_MAX_LENGTH = 30_000;
export const POLISH_INSTRUCTION_MAX_LENGTH = 1_000;

export type PromptTemplateType = "design_plan" | "image_generation";
export type PromptVariableValue = string | number | boolean | null | undefined;
export type PromptVariables = Record<string, PromptVariableValue>;

export const DESIGN_PLAN_VARIABLES = [
  "product_name",
  "product_notes",
  "product_specifications",
  "selling_points",
  "product_visual_analysis",
  "competitor_insights",
  "user_ideas",
  "plan_count",
  "main_image_count",
  "detail_image_count",
  "output_types",
  "product_asset_ids",
] as const;

export const IMAGE_GENERATION_VARIABLES = [
  "product_name",
  "product_specifications",
  "product_selling_points",
  "product_visual_description",
  "direction_label",
  "direction_positioning",
  "direction_color_scheme",
  "direction_layout_intent",
  "direction_copy_strategy",
  "image_list_type",
  "image_title",
  "image_description",
  "image_selling_points",
  "image_suggested_copy",
  "image_composition_intent",
  "image_lighting",
  "image_angle",
  "image_background",
  "image_mood",
  "image_visual_elements",
  "product_asset_id",
  "reference_asset_ids",
  "width",
  "height",
  "aspect_ratio",
] as const;

export const DESIGN_PLAN_LOCKED_SUFFIX = `【固定输出契约（不可编辑）】
仅输出严格 JSON，不要输出 Markdown、解释或代码围栏。根对象必须为 {"directions": [...]}。
每个方向必须包含 label、positioning、colorScheme、layoutIntent、copyStrategy、imageList。
imageList 中每项必须包含 listType、productAssetId、title、description、sellingPoints、suggestedCopy、compositionIntent、lighting、angle、background、mood、visualElements。
listType 只能为 main_image 或 detail_page；方向数量及每类图片数量必须严格符合上文要求。`;

export const IMAGE_GENERATION_LOCKED_SUFFIX = `【固定生成契约（不可编辑）】
必须忠实还原参考商品的真实外观、颜色、材质、比例、结构和品牌细节，不得擅自改变商品造型，不得生成与商品不一致的文字或标识。
输出尺寸必须严格为上文指定的宽度与高度；画面需清晰、无水印、无多余边框，不得输出尺寸说明或其他画外内容。`;

export function allowedVariablesFor(type: PromptTemplateType): readonly string[] {
  return type === "design_plan" ? DESIGN_PLAN_VARIABLES : IMAGE_GENERATION_VARIABLES;
}

function formatValue(value: PromptVariableValue): string {
  if (value == null) return "";
  return String(value);
}

function assertKnownVariable(name: string, allowed: Set<string>): void {
  if (!allowed.has(name)) throw new Error(`未知变量：${name}`);
}

export function validateTemplateBody(
  templateBody: string,
  allowedVariables: readonly string[],
): void {
  if (templateBody.length > TEMPLATE_BODY_MAX_LENGTH) {
    throw new Error(`模板正文不能超过 20,000 字，当前为 ${templateBody.length} 字`);
  }

  const allowed = new Set(allowedVariables);
  const tokenPattern = /{{\s*(#if\s+([A-Za-z0-9_]+)|\/if|([A-Za-z0-9_]+))\s*}}/g;
  let depth = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(templateBody)) !== null) {
    const between = templateBody.slice(cursor, match.index);
    if (between.includes("{{") || between.includes("}}")) {
      throw new Error("模板包含无法识别的变量或条件语法");
    }
    cursor = match.index + match[0].length;

    const conditionVariable = match[2];
    const plainVariable = match[3];
    if (conditionVariable) {
      assertKnownVariable(conditionVariable, allowed);
      if (depth > 0) throw new Error("条件块不支持嵌套");
      depth = 1;
    } else if (match[1] === "/if") {
      if (depth === 0) throw new Error("发现未配对的 {{/if}} 条件结束标记");
      depth = 0;
    } else if (plainVariable) {
      assertKnownVariable(plainVariable, allowed);
    }
  }

  const tail = templateBody.slice(cursor);
  if (tail.includes("{{") || tail.includes("}}")) {
    throw new Error("模板包含无法识别的变量或未闭合条件块");
  }
  if (depth !== 0) throw new Error("模板包含未闭合的条件块");
}

export interface RenderPromptTemplateInput {
  templateBody: string;
  variables: PromptVariables;
  allowedVariables: readonly string[];
  lockedSuffix: string;
}

export interface RenderedPrompt {
  editablePrompt: string;
  lockedSuffix: string;
  finalPrompt: string;
  contextVariables: Record<string, string>;
}

export function composeFinalPrompt(
  editablePromptInput: string,
  lockedSuffixInput: string,
  contextVariables: Record<string, string> = {},
): RenderedPrompt {
  const editablePrompt = editablePromptInput.trim();
  const lockedSuffix = lockedSuffixInput.trim();
  const finalPrompt = [editablePrompt, lockedSuffix].filter(Boolean).join("\n\n");
  if (finalPrompt.length > FINAL_PROMPT_MAX_LENGTH) {
    throw new Error(`最终 Prompt 不能超过 30,000 字，当前为 ${finalPrompt.length} 字`);
  }
  return { editablePrompt, lockedSuffix, finalPrompt, contextVariables };
}

export function renderPromptTemplate(input: RenderPromptTemplateInput): RenderedPrompt {
  validateTemplateBody(input.templateBody, input.allowedVariables);

  const contextVariables = Object.fromEntries(
    input.allowedVariables.map((name) => [name, formatValue(input.variables[name])]),
  );

  const withConditions = input.templateBody.replace(
    /{{\s*#if\s+([A-Za-z0-9_]+)\s*}}([\s\S]*?){{\s*\/if\s*}}/g,
    (_whole, name: string, content: string) => contextVariables[name] ? content : "",
  );

  const editablePrompt = withConditions.replace(
    /{{\s*([A-Za-z0-9_]+)\s*}}/g,
    (_whole, name: string) => contextVariables[name] ?? "",
  ).trim();

  return composeFinalPrompt(editablePrompt, input.lockedSuffix, contextVariables);
}

export function validatePolishInstruction(instruction: string): string {
  const trimmed = instruction.trim();
  if (trimmed.length > POLISH_INSTRUCTION_MAX_LENGTH) {
    throw new Error(`润色意见不能超过 1,000 字，当前为 ${trimmed.length} 字`);
  }
  return trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parameterizePrompt(
  renderedText: string,
  contextVariables: Record<string, string>,
  allowedVariables: readonly string[],
): string {
  const allowed = new Set(allowedVariables);
  const entries = Object.entries(contextVariables)
    .filter(([name, value]) => allowed.has(name) && value.length > 0)
    .sort((a, b) => b[1].length - a[1].length);

  let result = renderedText;
  for (const [name, value] of entries) {
    result = result.replace(new RegExp(escapeRegExp(value), "g"), `{{${name}}}`);
  }
  return result;
}

export interface DesignPromptOptions {
  userIdeas?: string;
  planCount?: number;
  mainImageCount?: number;
  detailImageCount?: number;
}

export interface ResolvedPromptTemplate {
  id: string;
  type: PromptTemplateType;
  name: string;
  body: string;
  archivedAt: Date | null;
}

export async function resolvePromptTemplate(
  type: PromptTemplateType,
  preferredId?: string | null,
): Promise<ResolvedPromptTemplate> {
  const [{ db }, schema, drizzle] = await Promise.all([
    import("../db/index.js"),
    import("../db/schema.js"),
    import("drizzle-orm"),
  ]);
  if (preferredId) {
    const [template] = await db.select().from(schema.promptTemplates)
      .where(drizzle.eq(schema.promptTemplates.id, preferredId));
    if (!template || template.type !== type) throw new Error("模板不存在或类型不匹配");
    return template;
  }
  const [template] = await db.select().from(schema.promptTemplates)
    .where(drizzle.and(
      drizzle.eq(schema.promptTemplates.type, type),
      drizzle.eq(schema.promptTemplates.isDefault, true),
      drizzle.isNull(schema.promptTemplates.archivedAt),
    ))
    .orderBy(schema.promptTemplates.createdAt)
    .limit(1);
  if (!template) throw new Error(`未配置 ${type} 默认模板`);
  return template;
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function productVisualDescription(analysis: string | null | undefined): string {
  const parsed = parseJsonRecord(analysis);
  return [
    parsed["appearance"],
    parsed["colors"] ? `颜色：${String(parsed["colors"])}` : "",
    parsed["materials"] ? `材质：${String(parsed["materials"])}` : "",
    parsed["keyFeatures"] ? `视觉特征：${String(parsed["keyFeatures"])}` : "",
    parsed["style"] ? `风格：${String(parsed["style"])}` : "",
  ].filter(Boolean).join("；");
}

export async function buildDesignPlanPromptVariables(
  taskId: string,
  options: DesignPromptOptions = {},
): Promise<{ variables: PromptVariables; defaultTemplateId: string | null }> {
  const [{ db }, schema, drizzle] = await Promise.all([
    import("../db/index.js"),
    import("../db/schema.js"),
    import("drizzle-orm"),
  ]);
  const [task] = await db.select().from(schema.generationTasks)
    .where(drizzle.eq(schema.generationTasks.id, taskId));
  if (!task) throw new Error(`任务不存在：${taskId}`);
  const [[product], specifications, points, assets, [synthesis]] = await Promise.all([
    db.select().from(schema.products).where(drizzle.eq(schema.products.id, task.productId)),
    db.select().from(schema.productSpecifications)
      .where(drizzle.eq(schema.productSpecifications.productId, task.productId))
      .orderBy(schema.productSpecifications.sortOrder),
    db.select().from(schema.sellingPoints)
      .where(drizzle.eq(schema.sellingPoints.productId, task.productId))
      .orderBy(schema.sellingPoints.sortOrder),
    db.select().from(schema.productAssets)
      .where(drizzle.eq(schema.productAssets.productId, task.productId))
      .orderBy(schema.productAssets.sortOrder),
    db.select().from(schema.synthesisReports)
      .where(drizzle.eq(schema.synthesisReports.analysisVersionId, task.analysisVersionId)),
  ]);

  const outputTypes = (() => {
    try { return JSON.parse(task.outputTypes) as string[]; } catch { return []; }
  })();
  const visualAnalysis = assets.length
    ? assets.map((asset, index) => `图片${index + 1}（ID: ${asset.id}）：${productVisualDescription(asset.analysis) || "暂无视觉分析"}`).join("\n")
    : "暂无商品图片";
  let competitorInsights = "暂无竞品分析数据，请基于商品特性判断";
  if (synthesis?.content) {
    try { competitorInsights = JSON.stringify(JSON.parse(synthesis.content), null, 2); }
    catch { competitorInsights = synthesis.content; }
  }

  return {
    defaultTemplateId: task.planDefaultTemplateId,
    variables: {
      product_name: product?.name ?? "未知商品",
      product_notes: product?.notes ?? "",
      product_specifications: specifications.map((item) => `${item.label}=${item.value}`).join("，"),
      selling_points: points.map((item) => item.content).join("；"),
      product_visual_analysis: visualAnalysis,
      competitor_insights: competitorInsights,
      user_ideas: options.userIdeas ?? "",
      plan_count: options.planCount ?? 3,
      main_image_count: options.mainImageCount ?? (outputTypes.includes("main_image") ? 3 : 0),
      detail_image_count: options.detailImageCount ?? (outputTypes.includes("detail_page") ? 3 : 0),
      output_types: outputTypes.map((type) => type === "main_image" ? "主图" : "详情页图").join(" + "),
      product_asset_ids: assets.map((asset) => asset.id).join("、") || "无",
    },
  };
}

export interface ImagePromptData {
  variables: PromptVariables;
  defaultTemplateId: string | null;
  width: number;
  height: number;
  item: {
    id: string;
    designPlanVersionId: string;
    promptTemplateId: string | null;
  };
  productImageBase64?: string;
}

export async function buildImageGenerationPromptData(imageItemId: string): Promise<ImagePromptData> {
  const [{ db }, schema, drizzle, fsModule, pathsModule] = await Promise.all([
    import("../db/index.js"),
    import("../db/schema.js"),
    import("drizzle-orm"),
    import("node:fs"),
    import("./paths.js"),
  ]);
  const [item] = await db.select().from(schema.imageItems)
    .where(drizzle.eq(schema.imageItems.id, imageItemId));
  if (!item) throw new Error(`图片项不存在：${imageItemId}`);
  const [plan] = await db.select().from(schema.designPlanVersions)
    .where(drizzle.eq(schema.designPlanVersions.id, item.designPlanVersionId));
  if (!plan) throw new Error(`方案版本不存在：${item.designPlanVersionId}`);
  const [[direction], [task]] = await Promise.all([
    db.select().from(schema.designDirections).where(drizzle.eq(schema.designDirections.id, plan.selectedDirectionId)),
    db.select().from(schema.generationTasks).where(drizzle.eq(schema.generationTasks.id, plan.generationTaskId)),
  ]);
  if (!task) throw new Error(`任务不存在：${plan.generationTaskId}`);
  const [[product], specifications, points, assets] = await Promise.all([
    db.select().from(schema.products).where(drizzle.eq(schema.products.id, task.productId)),
    db.select().from(schema.productSpecifications)
      .where(drizzle.eq(schema.productSpecifications.productId, task.productId))
      .orderBy(schema.productSpecifications.sortOrder),
    db.select().from(schema.sellingPoints)
      .where(drizzle.eq(schema.sellingPoints.productId, task.productId))
      .orderBy(schema.sellingPoints.sortOrder),
    db.select().from(schema.productAssets)
      .where(drizzle.eq(schema.productAssets.productId, task.productId))
      .orderBy(schema.productAssets.sortOrder),
  ]);

  const directionContent = parseJsonRecord(direction?.content);
  const selectedAsset = assets.find((asset) => asset.id === item.productAssetId) ?? assets[0];
  let width = 1000;
  let height = 1000;
  const preset = parseJsonRecord(item.outputPresetSnapshot);
  if (typeof preset["width"] === "number") width = preset["width"];
  if (typeof preset["height"] === "number") height = preset["height"];
  const sellingPointList = (() => {
    try { return item.sellingPoints ? (JSON.parse(item.sellingPoints) as string[]) : []; }
    catch { return []; }
  })();
  const referenceIds = (() => {
    try { return item.referenceAssetIds ? (JSON.parse(item.referenceAssetIds) as string[]) : []; }
    catch { return []; }
  })();

  let productImageBase64: string | undefined;
  if (selectedAsset) {
    try {
      productImageBase64 = (await fsModule.promises.readFile(pathsModule.assetPath(selectedAsset.filePath))).toString("base64");
    } catch { /* Missing legacy asset: prompt generation can still proceed. */ }
  }

  const divisor = (a: number, b: number): number => b === 0 ? a : divisor(b, a % b);
  const ratioDivisor = divisor(width, height);
  return {
    defaultTemplateId: item.promptTemplateId ?? task.imageDefaultTemplateId,
    width,
    height,
    item: {
      id: item.id,
      designPlanVersionId: item.designPlanVersionId,
      promptTemplateId: item.promptTemplateId,
    },
    ...(productImageBase64 ? { productImageBase64 } : {}),
    variables: {
      product_name: product?.name ?? "未知商品",
      product_specifications: specifications.map((spec) => `${spec.label}=${spec.value}`).join("，"),
      product_selling_points: points.map((point) => point.content).join("；"),
      product_visual_description: productVisualDescription(selectedAsset?.analysis),
      direction_label: direction?.label ?? directionContent["label"] as string ?? "",
      direction_positioning: String(directionContent["positioning"] ?? ""),
      direction_color_scheme: String(directionContent["colorScheme"] ?? ""),
      direction_layout_intent: String(directionContent["layoutIntent"] ?? ""),
      direction_copy_strategy: String(directionContent["copyStrategy"] ?? ""),
      image_list_type: item.listType === "main_image" ? "主图" : "详情页图",
      image_title: item.title,
      image_description: item.description ?? "",
      image_selling_points: sellingPointList.join("、"),
      image_suggested_copy: item.suggestedCopy ?? "",
      image_composition_intent: item.compositionIntent ?? "",
      image_lighting: item.lighting ?? "",
      image_angle: item.angle ?? "",
      image_background: item.background ?? "",
      image_mood: item.mood ?? "",
      image_visual_elements: item.visualElements ?? "",
      product_asset_id: item.productAssetId ?? selectedAsset?.id ?? "",
      reference_asset_ids: referenceIds.join("、"),
      width,
      height,
      aspect_ratio: `${width / ratioDivisor}:${height / ratioDivisor}`,
    },
  };
}

export async function renderDesignPlanPromptSnapshot(input: {
  taskId: string;
  templateId?: string | null;
  templateBody?: string;
  editablePrompt?: string;
  options?: DesignPromptOptions;
}): Promise<RenderedPrompt & { templateId: string | null; templateName: string | null }> {
  const context = await buildDesignPlanPromptVariables(input.taskId, input.options);
  const template = input.templateBody
    ? null
    : await resolvePromptTemplate("design_plan", input.templateId ?? context.defaultTemplateId);
  const contextVariables = Object.fromEntries(
    DESIGN_PLAN_VARIABLES.map((name) => [name, formatValue(context.variables[name])]),
  );
  const rendered = input.editablePrompt !== undefined
    ? composeFinalPrompt(input.editablePrompt, DESIGN_PLAN_LOCKED_SUFFIX, contextVariables)
    : renderPromptTemplate({
        templateBody: input.templateBody ?? template!.body,
        variables: context.variables,
        allowedVariables: DESIGN_PLAN_VARIABLES,
        lockedSuffix: DESIGN_PLAN_LOCKED_SUFFIX,
      });
  return { templateId: template?.id ?? input.templateId ?? null, templateName: template?.name ?? null, ...rendered };
}

export async function renderImageGenerationPromptSnapshot(input: {
  imageItemId: string;
  templateId?: string | null;
  templateBody?: string;
  editablePrompt?: string;
}): Promise<ImagePromptData & RenderedPrompt & { templateId: string | null; templateName: string | null }> {
  const context = await buildImageGenerationPromptData(input.imageItemId);
  const template = input.templateBody
    ? null
    : await resolvePromptTemplate("image_generation", input.templateId ?? context.defaultTemplateId);
  const contextVariables = Object.fromEntries(
    IMAGE_GENERATION_VARIABLES.map((name) => [name, formatValue(context.variables[name])]),
  );
  const rendered = input.editablePrompt !== undefined
    ? composeFinalPrompt(input.editablePrompt, IMAGE_GENERATION_LOCKED_SUFFIX, contextVariables)
    : renderPromptTemplate({
        templateBody: input.templateBody ?? template!.body,
        variables: context.variables,
        allowedVariables: IMAGE_GENERATION_VARIABLES,
        lockedSuffix: IMAGE_GENERATION_LOCKED_SUFFIX,
      });
  return {
    ...context,
    ...rendered,
    templateId: template?.id ?? input.templateId ?? null,
    templateName: template?.name ?? null,
  };
}
