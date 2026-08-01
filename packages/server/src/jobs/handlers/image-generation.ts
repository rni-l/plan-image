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

  // Load product context for richer prompt
  let productName = "";
  let productSpecs = "";
  let productPoints = "";
  if (task) {
    const [product] = await db.select().from(products).where(eq(products.id, task.productId));
    const [specs, points] = await Promise.all([
      db.select().from(productSpecifications).where(eq(productSpecifications.productId, task.productId)),
      db.select().from(sellingPoints).where(eq(sellingPoints.productId, task.productId)),
    ]);
    productName = product?.name ?? "";
    productSpecs = specs.map(s => `${s.label}:${s.value}`).join("，");
    productPoints = points.map(p => p.content).join("；");
  }

  // Parse direction content for visual style context
  let dirStyle = "";
  if (direction) {
    try {
      const d = JSON.parse(direction.content) as {
        positioning?: string;
        colorScheme?: string;
        layoutIntent?: string;
      };
      dirStyle = [
        d.positioning ? `定位：${d.positioning}` : "",
        d.colorScheme ? `配色：${d.colorScheme}` : "",
        d.layoutIntent ? `版式：${d.layoutIntent}` : "",
      ].filter(Boolean).join(" | ");
    } catch { /* ignore */ }
  }

  // Parse preset snapshot for size
  let width = 1000;
  let height = 1000;
  try {
    const preset = JSON.parse(item.outputPresetSnapshot) as { width?: number; height?: number };
    width = preset.width ?? 1000;
    height = preset.height ?? 1000;
  } catch { /* use defaults */ }

  // Parse item selling points
  let itemPoints: string[] = [];
  if (item.sellingPoints) {
    try { itemPoints = JSON.parse(item.sellingPoints) as string[]; } catch { /* ignore */ }
  }

  // Build generation prompt
  const prompt = [
    `商品：${productName}`,
    productSpecs ? `规格：${productSpecs}` : "",
    productPoints ? `卖点：${productPoints}` : "",
    `图片标题：${item.title}`,
    item.description ? `内容描述：${item.description}` : "",
    itemPoints.length > 0 ? `展示卖点：${itemPoints.join("，")}` : "",
    item.suggestedCopy ? `主标题文案：${item.suggestedCopy}` : "",
    item.compositionIntent ? `构图意图：${item.compositionIntent}` : "",
    dirStyle ? `设计风格：${dirStyle}` : "",
    `输出规格：${width}×${height}px，电商主图风格，白底或场景化背景，专业摄影级别`,
  ].filter(Boolean).join("\n");

  // Call image generation via gateway
  const response = await gatewayCall("image_generation", {
    scene: "image_generation",
    prompt,
    parameters: {
      task_type: "image_gen",
      // size_x format for OpenAI-compatible providers (volcengine/gpt_proxy)
      // bailian adapter normalises "NxM" → "N*M" internally
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
