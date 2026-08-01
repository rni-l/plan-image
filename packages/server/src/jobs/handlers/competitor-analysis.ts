import { db } from "../../db/index.js";
import {
  competitorAssets,
  imageAnalysisCards,
  backgroundJobs,
} from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { gatewayCall } from "../../gateway/index.js";
import { readAndVerifyAsset } from "../../lib/storage.js";

export interface CompetitorAnalysisInput {
  productId: string;
  analysisVersionId: string;
  competitorAssetId: string;
  cardId: string;
}

const SYSTEM_PROMPT = `你是一位专业的电商视觉分析师。
请分析提供的1688商品竞品图片，输出严格的JSON格式分析结果，不要包含其他内容。`;

const USER_PROMPT = `请分析这张商品图片，按以下JSON格式输出：
{
  "layout": "版式布局描述（如：产品居中+白底，左图右文，全图文字叠加等）",
  "colors": "主要配色方案（列举2-4个主色和使用方式）",
  "copy": "主要文案内容（标题、副标题、卖点文字等）",
  "selling_points": "突出展示的核心卖点（列举2-4个）",
  "scene": "使用场景或背景环境描述",
  "techniques": "主要视觉手法（如：产品特写、场景化、对比图、数据可视化等）"
}
只输出JSON，不输出任何额外说明。`;

export async function handleCompetitorImageAnalysis(
  jobId: string,
  inputRaw: unknown
): Promise<void> {
  const input = inputRaw as CompetitorAnalysisInput;

  // Load competitor image
  const [asset] = await db
    .select()
    .from(competitorAssets)
    .where(eq(competitorAssets.id, input.competitorAssetId));

  if (!asset) {
    throw new Error(`竞品素材不存在: ${input.competitorAssetId}`);
  }

  const imageBuffer = await readAndVerifyAsset(asset.filePath, asset.checksum);
  const imageBase64 = imageBuffer.toString("base64");

  // Call vision model
  const response = await gatewayCall("competitor_image_analysis", {
    scene: "competitor_image_analysis",
    prompt: USER_PROMPT,
    systemPrompt: SYSTEM_PROMPT,
    images: [imageBase64],
  });

  // Parse model output
  let modelOutput: unknown;
  try {
    const text = response.text ?? "";
    // Extract JSON even if model adds extra text
    const match = text.match(/\{[\s\S]*\}/);
    modelOutput = JSON.parse(match?.[0] ?? text);
  } catch {
    modelOutput = { raw: response.text };
  }

  // Persist result to card
  await db
    .update(imageAnalysisCards)
    .set({
      modelOutput: JSON.stringify(modelOutput),
      updatedAt: new Date(),
    })
    .where(eq(imageAnalysisCards.id, input.cardId));

  // Link job to card
  await db
    .update(imageAnalysisCards)
    .set({ updatedAt: new Date() })
    .where(eq(imageAnalysisCards.id, input.cardId));
}
