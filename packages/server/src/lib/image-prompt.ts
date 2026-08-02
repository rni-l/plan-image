/**
 * Shared utilities for image-generation prompt construction.
 * Used by both the background job handler and the streaming SSE route.
 */

import fs from "node:fs";
import { db } from "../db/index.js";
import {
  imageItems,
  designPlanVersions,
  designDirections,
  generationTasks,
  products,
  productSpecifications,
  sellingPoints,
  productAssets,
} from "../db/schema.js";
import { eq } from "drizzle-orm";
import { assetPath } from "./paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImageItemData {
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

export interface DirectionStyle {
  positioning?: string;
  colorScheme?: string;
  layoutIntent?: string;
  copyStrategy?: string;
  label?: string;
}

export interface ProductContext {
  name: string;
  specs: string;
  points: string;
  /** Visual analysis text from the product image (from product_assets.analysis) */
  visualDescription?: string | undefined;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Build a comprehensive, detailed image-generation prompt optimised for Chinese
 * image models (通义万象 / Seedream).  Each visual dimension is expanded into a
 * full descriptive clause rather than a single keyword, which consistently
 * produces higher-quality, on-brief results.
 */
export function buildImagePrompt(
  item: ImageItemData,
  dir: DirectionStyle,
  product: ProductContext,
  width: number,
  height: number
): string {
  const parts: string[] = [];
  const isDetail = item.listType === "detail_page";
  const imageTypeLabel = isDetail ? "详情页展示图" : "主图";

  // ── 1. 画面定位与目的 ──────────────────────────────────────────────────────
  const subjectLine = product.name
    ? `这是一张专业的${product.name}电商${imageTypeLabel}`
    : `这是一张专业的电商${imageTypeLabel}`;
  const dirLabel = dir.label ? `，采用「${dir.label}」视觉方向` : "";
  const positioningNote = dir.positioning ? `，目标：${dir.positioning}` : "";
  parts.push(`${subjectLine}${dirLabel}${positioningNote}。`);

  // ── 2. 商品视觉描述（来自 product_assets 分析）────────────────────────────
  if (product.visualDescription) {
    parts.push(`商品外观参考：${product.visualDescription}。生成时必须忠实还原商品的真实外观、颜色和材质，不可随意改变商品造型。`);
  }

  // ── 3. 构图与画面主体 ──────────────────────────────────────────────────────
  if (item.compositionIntent || item.angle) {
    const compParts: string[] = [];
    if (item.compositionIntent) compParts.push(item.compositionIntent);
    if (item.angle) compParts.push(`拍摄视角为${item.angle}`);
    parts.push(`构图与主体：${compParts.join("，")}。`);
  }

  // ── 4. 场景中的视觉元素 ────────────────────────────────────────────────────
  if (item.visualElements) {
    parts.push(`画面元素清单：${item.visualElements}。所有元素应自然融合，主体商品最为突出清晰。`);
  }

  // ── 5. 背景 ────────────────────────────────────────────────────────────────
  if (item.background) {
    parts.push(`背景设计：${item.background}。`);
  }

  // ── 6. 光照方案 ────────────────────────────────────────────────────────────
  if (item.lighting) {
    parts.push(`光照方案：${item.lighting}。光照要自然真实，准确表现商品材质质感。`);
  }

  // ── 7. 配色与色彩基调 ──────────────────────────────────────────────────────
  if (dir.colorScheme) {
    parts.push(`整体配色：${dir.colorScheme}。色彩应统一和谐，符合目标受众审美。`);
  }

  // ── 8. 版式策略 ────────────────────────────────────────────────────────────
  if (dir.layoutIntent) {
    parts.push(`版式策略：${dir.layoutIntent}。`);
  }

  // ── 9. 卖点视觉强调 ────────────────────────────────────────────────────────
  const spList = item.sellingPoints?.filter(Boolean) ?? [];
  if (spList.length > 0) {
    parts.push(`视觉重点强调以下卖点：${spList.join("、")}。通过构图、光照或道具选择，让这些卖点在画面中得到直观体现。`);
  }

  // ── 10. 文案覆叠 ───────────────────────────────────────────────────────────
  if (item.suggestedCopy) {
    const copyStrategy = dir.copyStrategy
      ? `文案风格参考：${dir.copyStrategy}。`
      : "";
    parts.push(`主标题文案「${item.suggestedCopy}」覆叠于画面中，字体醒目、与背景形成对比。${copyStrategy}`);
  }

  // ── 11. 产品规格提示（确保商品特性可见）──────────────────────────────────
  if (product.specs) {
    parts.push(`商品关键特性（画面中需体现）：${product.specs}。`);
  }

  // ── 12. 氛围与情绪 ─────────────────────────────────────────────────────────
  const moodParts: string[] = [];
  if (item.mood) moodParts.push(item.mood);
  if (dir.positioning && !item.mood) moodParts.push(dir.positioning);
  if (moodParts.length > 0) {
    parts.push(`整体视觉氛围：${moodParts.join("，")}。每一个画面元素都应服务于这一情绪基调。`);
  }

  // ── 13. 图片标题/用途说明（给模型提供意图上下文）──────────────────────────
  if (item.title || item.description) {
    const titlePart = item.title ? `「${item.title}」` : "";
    const descPart  = item.description ? `——${item.description}` : "";
    parts.push(`本图用途：${titlePart}${descPart}。`);
  }

  // ── 14. 技术规格与质量要求 ────────────────────────────────────────────────
  const aspectRatio = width === height ? "1:1" : `${width}:${height}`;
  parts.push(
    `输出规格：${width}×${height}像素（${aspectRatio}）。` +
    "画面要求超高清商业摄影质感，商品细节清晰锐利，色彩准确还原，光影层次丰富自然，" +
    "无水印，专业电商风格，画面干净整洁，无任何多余杂乱元素。"
  );

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Data loader
// ---------------------------------------------------------------------------

export interface PromptContext {
  prompt: string;
  width: number;
  height: number;
  /** Raw image item record from the DB */
  item: typeof imageItems.$inferSelect;
  /** Base64-encoded product reference image, if available */
  productImageBase64?: string | undefined;
}

/**
 * Load all context needed to build an image-generation prompt for a given item.
 * Throws if the item or its plan version cannot be found.
 */
export async function loadPromptContext(imageItemId: string): Promise<PromptContext> {
  const [item] = await db.select().from(imageItems).where(eq(imageItems.id, imageItemId));
  if (!item) throw new Error(`图片项不存在: ${imageItemId}`);

  const [planVersion] = await db
    .select()
    .from(designPlanVersions)
    .where(eq(designPlanVersions.id, item.designPlanVersionId));
  if (!planVersion) throw new Error(`方案版本不存在: ${item.designPlanVersionId}`);

  const [direction] = await db
    .select()
    .from(designDirections)
    .where(eq(designDirections.id, planVersion.selectedDirectionId));

  const [task] = await db
    .select()
    .from(generationTasks)
    .where(eq(generationTasks.id, planVersion.generationTaskId));

  // Load product context
  let productName        = "";
  let productSpecs       = "";
  let productPoints      = "";
  let visualDescription  = "";
  let productImageBase64: string | undefined;

  if (task) {
    const [product] = await db.select().from(products).where(eq(products.id, task.productId));
    const [specs, points] = await Promise.all([
      db.select().from(productSpecifications).where(eq(productSpecifications.productId, task.productId)),
      db.select().from(sellingPoints).where(eq(sellingPoints.productId, task.productId)),
    ]);
    productName   = product?.name ?? "";
    productSpecs  = specs.map(s => `${s.label}:${s.value}`).join("，");
    productPoints = points.map(p => p.content).join("；");

    // --- Load product reference image ---
    // Prefer the asset linked to this specific image item; fall back to the first asset.
    let targetAsset: typeof productAssets.$inferSelect | undefined;

    if (item.productAssetId) {
      const [linked] = await db
        .select()
        .from(productAssets)
        .where(eq(productAssets.id, item.productAssetId));
      targetAsset = linked;
    }

    if (!targetAsset) {
      const allAssets = await db
        .select()
        .from(productAssets)
        .where(eq(productAssets.productId, task.productId))
        .orderBy(productAssets.sortOrder);
      targetAsset = allAssets[0];
    }

    if (targetAsset) {
      // Build visual description from stored analysis
      if (targetAsset.analysis) {
        try {
          const parsed = JSON.parse(targetAsset.analysis) as Record<string, string>;
          visualDescription = [
            parsed["appearance"],
            parsed["colors"] ? `颜色：${parsed["colors"]}` : "",
            parsed["materials"] ? `材质：${parsed["materials"]}` : "",
            parsed["keyFeatures"] ? `视觉特征：${parsed["keyFeatures"]}` : "",
            parsed["style"] ? `风格：${parsed["style"]}` : "",
          ].filter(Boolean).join("；");
        } catch { /* ignore */ }
      }

      // Read image file and convert to base64
      try {
        const buffer = await fs.promises.readFile(assetPath(targetAsset.filePath));
        productImageBase64 = buffer.toString("base64");
      } catch { /* file missing — proceed without reference image */ }
    }
  }

  // Parse direction style
  let dirStyle: DirectionStyle = {};
  if (direction) {
    try { dirStyle = JSON.parse(direction.content) as DirectionStyle; } catch { /* ignore */ }
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

  const itemData: ImageItemData = {
    title:             item.title,
    description:       item.description,
    sellingPoints:     itemPoints,
    suggestedCopy:     item.suggestedCopy,
    compositionIntent: item.compositionIntent,
    lighting:          item.lighting,
    angle:             item.angle,
    background:        item.background,
    mood:              item.mood,
    visualElements:    item.visualElements,
    listType:          item.listType,
  };

  const prompt = buildImagePrompt(
    itemData,
    dirStyle,
    {
      name:   productName,
      specs:  productSpecs,
      points: productPoints,
      ...(visualDescription ? { visualDescription } : {}),
    },
    width,
    height
  );

  return {
    prompt,
    width,
    height,
    item,
    ...(productImageBase64 ? { productImageBase64 } : {}),
  };
}
