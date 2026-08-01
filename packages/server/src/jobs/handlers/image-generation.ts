import { db } from "../../db/index.js";
import {
  imageItems,
  imageVersions,
  designPlanVersions,
  designDirections,
  generationTasks,
  products,
  productSpecifications,
  sellingPoints,
} from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { gatewayCall } from "../../gateway/index.js";
import { saveImageAsset } from "../../lib/storage.js";
import { randomUUID } from "node:crypto";

export interface ImageGenerationInput {
  imageItemId: string;
  planVersionId: string;
}

interface ImageItemData {
  title: string;
  description?: string | null;
  sellingPoints?: string[] | null;
  suggestedCopy?: string | null;
  compositionIntent?: string | null;
  lighting?: string | null;
  angle?: string | null;
  background?: string | null;
  mood?: string | null;
  visualElements?: string | null;
  listType?: string | null;
}

interface DirectionStyle {
  positioning?: string;
  colorScheme?: string;
  layoutIntent?: string;
  copyStrategy?: string;
  label?: string;
}

/**
 * Build a narrative image-generation prompt optimised for Chinese image models
 * (通义万象 / Wanx). Converts structured fields into a flowing description
 * rather than a key-value list, which tends to produce better results.
 */
function buildImagePrompt(
  item: ImageItemData,
  dir: DirectionStyle,
  product: { name: string; specs: string; points: string },
  width: number,
  height: number
): string {
  const parts: string[] = [];

  // --- Scene / subject opener ---
  const productSubject = product.name
    ? `${product.name}电商商品图`
    : "电商商品图";
  const isDetail = item.listType === "detail_page";
  const imageTypeLabel = isDetail ? "详情页展示图" : "主图";
  parts.push(`专业${productSubject}，${imageTypeLabel}。`);

  // --- Composition & framing ---
  const compParts: string[] = [];
  if (item.compositionIntent) compParts.push(item.compositionIntent);
  if (item.angle)              compParts.push(`拍摄视角：${item.angle}`);
  if (compParts.length > 0)   parts.push(compParts.join("，") + "。");

  // --- Visual elements present in the scene ---
  if (item.visualElements) {
    parts.push(`画面包含：${item.visualElements}。`);
  }

  // --- Background ---
  if (item.background) {
    parts.push(`背景：${item.background}。`);
  }

  // --- Lighting ---
  if (item.lighting) {
    parts.push(`光照：${item.lighting}。`);
  }

  // --- Design direction color & layout ---
  if (dir.colorScheme) {
    parts.push(`配色方案：${dir.colorScheme}。`);
  }
  if (dir.layoutIntent) {
    parts.push(`版式策略：${dir.layoutIntent}。`);
  }

  // --- Selling points and copy ---
  const spList = item.sellingPoints?.filter(Boolean) ?? [];
  if (spList.length > 0) {
    parts.push(`画面重点突出：${spList.join("、")}。`);
  }
  if (item.suggestedCopy) {
    parts.push(`主标题文案：「${item.suggestedCopy}」（覆叠于画面适当位置）。`);
  }

  // --- Product specs hint (brief, for relevance) ---
  if (product.specs) {
    parts.push(`产品特性：${product.specs}。`);
  }

  // --- Mood & style ---
  const moodKeywords: string[] = [];
  if (item.mood)         moodKeywords.push(item.mood);
  if (dir.positioning)   moodKeywords.push(dir.positioning);
  if (moodKeywords.length > 0) {
    parts.push(`视觉情绪：${moodKeywords.join("，")}。`);
  }

  // --- Quality tail ---
  const aspectRatio = width === height ? "1:1" : `${width}:${height}`;
  parts.push(
    `输出规格 ${width}×${height}（${aspectRatio}）。` +
    "超高清商业摄影质感，细节精准，光影自然，色彩准确，专业电商风格。"
  );

  return parts.join("\n");
}

export async function handleImageGeneration(
  jobId: string,
  inputRaw: unknown
): Promise<void> {
  const input = inputRaw as ImageGenerationInput;

  // Load image item
  const [item] = await db.select().from(imageItems).where(eq(imageItems.id, input.imageItemId));
  if (!item) throw new Error(`图片项不存在: ${input.imageItemId}`);

  // Load plan version → task → direction
  const [planVersion] = await db
    .select()
    .from(designPlanVersions)
    .where(eq(designPlanVersions.id, input.planVersionId));
  if (!planVersion) throw new Error(`方案版本不存在: ${input.planVersionId}`);

  const [direction] = await db
    .select()
    .from(designDirections)
    .where(eq(designDirections.id, planVersion.selectedDirectionId));

  const [task] = await db
    .select()
    .from(generationTasks)
    .where(eq(generationTasks.id, planVersion.generationTaskId));

  // Load product context
  let productName = "";
  let productSpecs = "";
  let productPoints = "";
  if (task) {
    const [product] = await db.select().from(products).where(eq(products.id, task.productId));
    const [specs, points] = await Promise.all([
      db.select().from(productSpecifications).where(eq(productSpecifications.productId, task.productId)),
      db.select().from(sellingPoints).where(eq(sellingPoints.productId, task.productId)),
    ]);
    productName  = product?.name ?? "";
    productSpecs = specs.map(s => `${s.label}:${s.value}`).join("，");
    productPoints = points.map(p => p.content).join("；");
  }

  // Parse direction style
  let dirStyle: DirectionStyle = {};
  if (direction) {
    try {
      dirStyle = JSON.parse(direction.content) as DirectionStyle;
    } catch { /* ignore */ }
  }

  // Parse output preset for dimensions
  let width = 1000;
  let height = 1000;
  try {
    const preset = JSON.parse(item.outputPresetSnapshot) as { width?: number; height?: number };
    width  = preset.width  ?? 1000;
    height = preset.height ?? 1000;
  } catch { /* use defaults */ }

  // Parse item selling points
  let itemPoints: string[] = [];
  if (item.sellingPoints) {
    try { itemPoints = JSON.parse(item.sellingPoints) as string[]; } catch { /* ignore */ }
  }

  // Assemble item data (merges DB columns + parsed fields)
  const itemData: ImageItemData = {
    title:            item.title,
    description:      item.description,
    sellingPoints:    itemPoints,
    suggestedCopy:    item.suggestedCopy,
    compositionIntent: item.compositionIntent,
    // Extended fields written by design-plan if present in the item snapshot
    lighting:         (item as unknown as Record<string, string | null>)["lighting"]       ?? null,
    angle:            (item as unknown as Record<string, string | null>)["angle"]          ?? null,
    background:       (item as unknown as Record<string, string | null>)["background"]     ?? null,
    mood:             (item as unknown as Record<string, string | null>)["mood"]           ?? null,
    visualElements:   (item as unknown as Record<string, string | null>)["visualElements"] ?? null,
    listType:         item.listType,
  };

  const prompt = buildImagePrompt(
    itemData,
    dirStyle,
    { name: productName, specs: productSpecs, points: productPoints },
    width,
    height
  );

  // Call image generation via gateway
  const response = await gatewayCall("image_generation", {
    scene: "image_generation",
    prompt,
    parameters: {
      task_type: "image_gen",
      size: `${width}x${height}`,
      n: 1,
    },
  });

  if (!response.image) {
    throw new Error("图片生成失败：模型未返回图片数据");
  }

  // Save generated image to disk
  const buffer = Buffer.from(response.image, "base64");
  const assetId = randomUUID();
  const saved = await saveImageAsset(buffer, assetId, "generated");

  const now = new Date();

  // Deselect any existing versions for this item
  await db
    .update(imageVersions)
    .set({ isSelected: false })
    .where(eq(imageVersions.imageItemId, input.imageItemId));

  // Create new version (selected)
  await db.insert(imageVersions).values({
    id: assetId,
    imageItemId: input.imageItemId,
    filePath: saved.relativePath,
    checksum: saved.checksum,
    generationType: "initial",
    parentVersionId: null,
    jobId,
    maskPath: null,
    instruction: null,
    isSelected: true,
    createdAt: now,
  });

  // Update item's updatedAt
  await db
    .update(imageItems)
    .set({ updatedAt: now })
    .where(eq(imageItems.id, input.imageItemId));
}
