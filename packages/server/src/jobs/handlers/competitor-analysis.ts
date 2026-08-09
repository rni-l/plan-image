import { db } from "../../db/index.js";
import {
  competitorAssets,
  imageAnalysisCards,
  products,
  productSpecifications,
  sellingPoints,
} from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { gatewayCall } from "../../gateway/index.js";
import { readAndVerifyAsset } from "../../lib/storage.js";
import { resolveDefaultModelRoute, type ModelRouteSnapshot } from "../../gateway/model-route.js";

export interface CompetitorAnalysisInput {
  productId: string;
  analysisVersionId: string;
  competitorAssetId: string;
  cardId: string;
  modelRoute: ModelRouteSnapshot;
}

/** Build system prompt with product context injected for better relevance */
function buildSystemPrompt(productName: string): string {
  const subject = productName ? `"${productName}"同类` : "电商";
  return `你是一位专业的电商视觉分析师，擅长解读${subject}商品图片的视觉策略。
请深度分析竞品图片的视觉设计，以严格的JSON格式输出，不包含任何额外说明。
分析重点：视觉层次、色彩策略、卖点传达方式、情感诉求及可借鉴的设计手法。`;
}

/** Build user prompt referencing product category so analysis stays relevant */
function buildUserPrompt(productName: string): string {
  const qualifier = productName ? `"${productName}"同类` : "";
  return `请从电商视觉策略角度深度分析这张${qualifier}竞品商品图片，按以下JSON格式输出：
{
  "layout": "版式布局（如：产品居中白底、左图右文、沉浸全屏场景、信息流卡片等，描述具体比例关系）",
  "colors": {
    "palette": "主要配色（列举2-4个主色，含大致比例和对应使用区域）",
    "mood": "整体色彩情绪（如：高冷商务、温暖生活、清新自然、奢华质感）"
  },
  "typography": "字体层次（标题/副标题/正文的大小层次、字重对比、中英文混排方式）",
  "copy": "主要文案内容（标题、副标题、卖点标签等，尽量还原原文）",
  "selling_points": "突出展示的核心卖点（2-4个，说明各自的展示方式：图标、文字、对比数据等）",
  "scene": "场景与背景（详细描述：背景类型、道具、氛围光线、季节/时段感）",
  "techniques": "视觉手法（从以下选择并补充：产品特写、场景化融入、对比展示、数据可视化、模特使用、爆炸图等）",
  "emotional_appeal": "情感诉求（消费者看到此图产生的情感反应和潜在购买动机）",
  "product_prominence": "产品占比（产品主体在画面中的大致比例及位置，如：主体居中占70%，白底留白30%）",
  "strengths": "最值得借鉴的1-2个视觉亮点（具体说明为什么有效）",
  "weaknesses": "可能存在的视觉弱点（如有，1条即可）"
}
只输出JSON，不输出任何额外说明。`;
}

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

  // Load product context for more targeted analysis
  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, input.productId));

  const imageBuffer = await readAndVerifyAsset(asset.filePath, asset.checksum);
  const imageBase64 = imageBuffer.toString("base64");

  const productName = product?.name ?? "";

  // Call vision model with product-aware prompts
  const response = await gatewayCall(input.modelRoute ?? await resolveDefaultModelRoute("competitor_image_analysis"), {
    scene: "competitor_image_analysis",
    prompt: buildUserPrompt(productName),
    systemPrompt: buildSystemPrompt(productName),
    images: [imageBase64],
  }, jobId);

  // Parse model output
  let modelOutput: unknown;
  try {
    const text = response.text ?? "";
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
}
