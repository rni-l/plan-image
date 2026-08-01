import { db } from "../../db/index.js";
import {
  generationTasks,
  designDirections,
  analysisVersions,
  synthesisReports,
  imageAnalysisCards,
  products,
  productSpecifications,
  sellingPoints,
} from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { gatewayCall } from "../../gateway/index.js";
import { randomUUID } from "node:crypto";

export interface DesignPlanInput {
  taskId: string;
  productId: string;
}

const SYSTEM_PROMPT = `你是一位专业的电商视觉策略顾问和创意总监。
请基于提供的商品信息和竞品分析，生成3个差异化的设计方向，以严格的JSON格式输出，不包含其他内容。`;

export async function handleDesignPlan(
  _jobId: string,
  inputRaw: unknown
): Promise<void> {
  const input = inputRaw as DesignPlanInput;

  // Load task
  const [task] = await db
    .select()
    .from(generationTasks)
    .where(eq(generationTasks.id, input.taskId));
  if (!task) throw new Error(`成图任务不存在: ${input.taskId}`);

  const outputTypes: string[] = JSON.parse(task.outputTypes);

  // Load product info
  const [product] = await db.select().from(products).where(eq(products.id, input.productId));
  const [specs, points] = await Promise.all([
    db.select().from(productSpecifications).where(eq(productSpecifications.productId, input.productId)),
    db.select().from(sellingPoints).where(eq(sellingPoints.productId, input.productId)),
  ]);

  // Load synthesis report for the referenced analysis version
  const [synthesisRow] = await db
    .select()
    .from(synthesisReports)
    .where(eq(synthesisReports.analysisVersionId, task.analysisVersionId));

  let synthesisContent = "";
  if (synthesisRow) {
    try {
      const parsed = JSON.parse(synthesisRow.content) as Record<string, unknown>;
      synthesisContent = `
竞品综合分析结论：
- 行业共性规律：${parsed["industry_patterns"] ?? ""}
- 差异化机会：${parsed["differentiation_opportunities"] ?? ""}
- 设计建议：${parsed["design_suggestions"] ?? ""}`;
    } catch { /* ignore parse error */ }
  } else {
    // Fall back to individual cards summary
    const [version] = await db
      .select()
      .from(analysisVersions)
      .where(eq(analysisVersions.id, task.analysisVersionId));
    if (version) {
      const cards = await db
        .select()
        .from(imageAnalysisCards)
        .where(eq(imageAnalysisCards.analysisVersionId, version.id));
      if (cards.length > 0) {
        synthesisContent = `\n竞品图片分析（${cards.length}张）：\n` +
          cards.slice(0, 5).map((c, i) => {
            const d = JSON.parse(c.humanOverride ?? c.modelOutput) as Record<string, string>;
            return `图${i + 1}: 版式=${d["layout"] ?? ""}, 配色=${d["colors"] ?? ""}, 卖点=${d["selling_points"] ?? ""}`;
          }).join("\n");
      }
    }
  }

  const productCtx = `
商品名称：${product?.name ?? "未知"}
规格参数：${specs.map(s => `${s.label}=${s.value}`).join("，") || "暂无"}
核心卖点：${points.map(p => p.content).join("；") || "暂无"}`;

  const outputTypeLabel = outputTypes.includes("main_image") && outputTypes.includes("detail_page")
    ? "主图 + 详情页"
    : outputTypes.includes("main_image") ? "主图" : "详情页";

  const prompt = `请为以下商品设计3个差异化的视觉方向，用于生成${outputTypeLabel}图片。

${productCtx}
${synthesisContent}

输出格式（严格JSON，只包含directions数组）：
{
  "directions": [
    {
      "label": "方向A — 简短主题名",
      "positioning": "核心定位和目标受众（2句话）",
      "colorScheme": "主要配色方案和视觉情绪",
      "layoutIntent": "版式和构图策略",
      "copyStrategy": "文案风格和主要卖点侧重",
      "imageList": [
        {
          "listType": "main_image",
          "title": "图片标题（10字内）",
          "description": "图片内容描述（30字内）",
          "sellingPoints": ["卖点1", "卖点2"],
          "suggestedCopy": "建议主标题文案",
          "compositionIntent": "构图意图，如：产品居中白底45度俯角"
        }
      ]
    }
  ]
}

要求：
- 每个方向生成${outputTypes.length > 1 ? "2-3张主图和2-3张详情页图" : outputTypes[0] === "main_image" ? "3-4张主图" : "3-4张详情页图"}
- 3个方向之间要有明显差异（如：高端商务、亲民实用、场景化生活）
- imageList中的listType必须是"main_image"或"detail_page"
- 只输出JSON，不输出任何额外说明`;

  const response = await gatewayCall("design_plan", { scene: "design_plan", prompt, systemPrompt: SYSTEM_PROMPT });

  // Parse directions from model output
  const text = response.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  let directions: Array<{
    label: string;
    positioning: string;
    colorScheme: string;
    layoutIntent: string;
    copyStrategy: string;
    imageList: Array<{
      listType: string;
      title: string;
      description?: string;
      sellingPoints?: string[];
      suggestedCopy?: string;
      compositionIntent?: string;
    }>;
  }> = [];

  try {
    const parsed = JSON.parse(match?.[0] ?? text) as { directions?: typeof directions };
    if (Array.isArray(parsed.directions)) {
      directions = parsed.directions.slice(0, 3);
    }
  } catch {
    throw new Error("设计方向生成失败：模型返回格式错误，请重试");
  }

  if (directions.length === 0) {
    throw new Error("设计方向生成失败：未能解析到方向数据，请重试");
  }

  const now = new Date();
  for (const dir of directions) {
    await db.insert(designDirections).values({
      id: randomUUID(),
      generationTaskId: input.taskId,
      label: dir.label ?? "未命名方向",
      content: JSON.stringify(dir),
      createdAt: now,
    });
  }
}
