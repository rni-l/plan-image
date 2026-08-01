import { db } from "../../db/index.js";
import {
  imageAnalysisCards,
  synthesisReports,
  products,
  productSpecifications,
  sellingPoints,
} from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { gatewayCall } from "../../gateway/index.js";
import { randomUUID } from "node:crypto";

export interface CompetitorSynthesisInput {
  productId: string;
  analysisVersionId: string;
}

const SYSTEM_PROMPT = `你是一位顶级的电商视觉策略顾问，擅长从多张竞品图中提炼行业规律、识别差异化机会，并给出可直接指导成图的设计建议。
请基于提供的竞品分析数据，输出严格的JSON格式综合报告，不包含任何额外说明。`;

export async function handleCompetitorSynthesis(
  jobId: string,
  inputRaw: unknown
): Promise<void> {
  const input = inputRaw as CompetitorSynthesisInput;

  // Load cards (human_override takes priority over model_output)
  const cards = await db
    .select()
    .from(imageAnalysisCards)
    .where(eq(imageAnalysisCards.analysisVersionId, input.analysisVersionId));

  if (cards.length === 0) {
    throw new Error("没有可用的分析卡片，请先完成逐图分析");
  }

  const effectiveCards = cards.map((c) => {
    return c.humanOverride
      ? JSON.parse(c.humanOverride)
      : JSON.parse(c.modelOutput);
  });

  // Load product context
  const [product] = await db.select().from(products).where(eq(products.id, input.productId));
  const [specs, points] = await Promise.all([
    db.select().from(productSpecifications).where(eq(productSpecifications.productId, input.productId)),
    db.select().from(sellingPoints).where(eq(sellingPoints.productId, input.productId)),
  ]);

  const productContext = product ? `商品名称：${product.name}
规格参数：${specs.map((s) => `${s.label}: ${s.value}`).join("，") || "暂无"}
核心卖点：${points.map((p) => p.content).join("；") || "暂无"}` : "";

  const prompt = `请基于以下${cards.length}张竞品图片的分析数据，为自有商品生成可直接指导成图的综合策略报告。

【自有产品信息】
${productContext || "暂无产品信息"}

【竞品逐图分析数据】
${effectiveCards.map((c, i) => `第${i + 1}张：${JSON.stringify(c)}`).join("\n\n")}

请按以下JSON格式输出综合报告（所有数组字段都应有2-5条内容）：
{
  "industry_patterns": [
    {
      "pattern": "行业共性规律的简洁描述",
      "evidence": "支持该规律的具体图片证据（引用图片序号和细节）",
      "logic": "背后的消费者心理逻辑"
    }
  ],
  "differentiation_opportunities": [
    {
      "opportunity": "差异化机会的简洁描述",
      "how_to_apply": "结合自有产品卖点，如何具体实施",
      "evidence_indices": [0, 1],
      "priority": "high"
    }
  ],
  "design_suggestions": [
    {
      "suggestion": "具体可操作的设计建议（一句话）",
      "rationale": "为什么这样做、预期效果",
      "visual_elements": "需要体现的具体视觉元素（色彩、构图、字体等）"
    }
  ],
  "key_findings": [
    {
      "finding": "最重要的单项发现",
      "evidence_indices": [0]
    }
  ],
  "recommended_style": "综合推荐的视觉风格基调（2-3句话，包含色彩方向、构图偏好、情绪定位，直接可用于指导成图方向）"
}
只输出JSON。`;

  const response = await gatewayCall("competitor_synthesis", {
    scene: "competitor_synthesis",
    prompt,
    systemPrompt: SYSTEM_PROMPT,
  });

  let content: unknown;
  try {
    const text = response.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    content = JSON.parse(match?.[0] ?? text);
  } catch {
    content = { raw: response.text };
  }

  // Upsert synthesis report
  const [existing] = await db
    .select()
    .from(synthesisReports)
    .where(eq(synthesisReports.analysisVersionId, input.analysisVersionId));

  if (existing) {
    await db
      .update(synthesisReports)
      .set({ content: JSON.stringify(content) })
      .where(eq(synthesisReports.analysisVersionId, input.analysisVersionId));
  } else {
    await db.insert(synthesisReports).values({
      id: randomUUID(),
      analysisVersionId: input.analysisVersionId,
      content: JSON.stringify(content),
      createdAt: new Date(),
    });
  }
}
