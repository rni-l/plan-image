import { db } from "../../db/index.js";
import {
  imageAnalysisCards,
  analysisVersions,
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

const SYSTEM_PROMPT = `你是一位专业的电商视觉策略顾问。
请基于提供的竞品分析数据，输出严格的JSON格式综合报告，不要包含其他内容。`;

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
    const data = c.humanOverride
      ? JSON.parse(c.humanOverride)
      : JSON.parse(c.modelOutput);
    return data;
  });

  // Load product context
  const [product] = await db.select().from(products).where(eq(products.id, input.productId));
  const specs = await db.select().from(productSpecifications).where(eq(productSpecifications.productId, input.productId));
  const points = await db.select().from(sellingPoints).where(eq(sellingPoints.productId, input.productId));

  const productContext = product ? `
商品名称: ${product.name}
规格参数: ${specs.map((s) => `${s.label}: ${s.value}`).join(", ") || "暂无"}
核心卖点: ${points.map((p) => p.content).join("；") || "暂无"}
` : "";

  const prompt = `基于以下${cards.length}张竞品图片的分析数据，生成综合报告。

产品信息：${productContext}

竞品分析数据：
${effectiveCards.map((c, i) => `图片${i + 1}: ${JSON.stringify(c)}`).join("\n")}

请按以下JSON格式输出综合报告：
{
  "industry_patterns": "行业共性规律（3-5条，每条包含现象和逻辑）",
  "differentiation_opportunities": "差异化机会（2-4条，结合自有产品卖点，标注证据图片索引）",
  "design_suggestions": "面向成图的设计建议（3-5条具体可操作的建议）",
  "key_findings": [
    {
      "finding": "关键发现内容",
      "evidence_indices": [0, 1]
    }
  ]
}
只输出JSON，不输出任何额外说明。`;

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
