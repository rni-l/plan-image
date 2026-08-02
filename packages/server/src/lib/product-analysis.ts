/**
 * Shared utility for analysing product reference images with a vision model.
 */

import fs from "node:fs";
import { db } from "../db/index.js";
import { productAssets } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { gatewayCall } from "../gateway/index.js";
import { assetPath } from "./paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProductImageAnalysis {
  appearance: string;
  colors: string;
  materials: string;
  keyFeatures: string;
  style: string;
  shootingAngle: string;
  backgroundStyle: string;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `你是专业的商业摄影视觉分析师。请对给定的商品图片进行全面、具体的视觉描述，供后续AI图片生成参考。`;

const USER_PROMPT = `请对这张商品图片进行全面的视觉分析，输出严格JSON，格式如下：
{
  "appearance": "商品外观详细描述（形状、尺寸比例、整体造型）",
  "colors": "主色调和细节颜色（列举2-4个具体颜色）",
  "materials": "材质与质感描述（如哑光塑料、亮面金属、磨砂玻璃等）",
  "keyFeatures": "最重要的3-5个视觉特征（最能识别该商品的细节）",
  "style": "整体风格与品质感（如科技感、温馨、奢华、日式简约等）",
  "shootingAngle": "图片的拍摄角度（正面/侧面/俯角等）",
  "backgroundStyle": "背景风格（纯白/场景/渐变等）"
}
只输出JSON，不要其他内容。`;

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Analyse a product image using the vision model.
 * Returns the parsed analysis object, or null if the image cannot be read or
 * the model returns an unparseable response.
 */
export async function analyseProductImage(
  filePath: string
): Promise<ProductImageAnalysis | null> {
  const absolutePath = assetPath(filePath);
  let imageB64: string;
  try {
    const buffer = await fs.promises.readFile(absolutePath);
    imageB64 = buffer.toString("base64");
  } catch {
    return null;
  }

  try {
    const response = await gatewayCall("competitor_image_analysis", {
      scene: "competitor_image_analysis",
      prompt: USER_PROMPT,
      systemPrompt: SYSTEM_PROMPT,
      images: [imageB64],
    });
    const text = response.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as ProductImageAnalysis;
  } catch {
    return null;
  }
}

/**
 * Analyse a product asset and persist the result to the database.
 * If analysis already exists and `force` is false, the stored value is returned
 * without calling the model again.
 *
 * Returns the analysis, or null if analysis fails.
 */
export async function analyseAndPersistAsset(
  asset: typeof productAssets.$inferSelect,
  force = false
): Promise<ProductImageAnalysis | null> {
  // Return cached result unless forced
  if (!force && asset.analysis) {
    try {
      return JSON.parse(asset.analysis) as ProductImageAnalysis;
    } catch { /* fall through to re-analyse */ }
  }

  const result = await analyseProductImage(asset.filePath);
  if (result) {
    await db
      .update(productAssets)
      .set({ analysis: JSON.stringify(result) })
      .where(eq(productAssets.id, asset.id));
  }
  return result;
}
