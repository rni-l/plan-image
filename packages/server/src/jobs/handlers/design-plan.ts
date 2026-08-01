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

const SYSTEM_PROMPT = `你是一位顶级的电商视觉创意总监，擅长将商品特性与竞品洞察转化为可落地执行的视觉方案。
请基于提供的商品信息和竞品分析，生成3个差异化设计方向，以严格的JSON格式输出，不包含任何其他内容。
每个方向的图片列表需要包含足够的视觉细节（构图、光照、角度、背景、氛围），以便直接驱动AI图片生成。`;

/** Summarise synthesis report (new structured format) into a few lines of context */
function formatSynthesis(parsed: Record<string, unknown>): string {
  const lines: string[] = [];

  // industry_patterns
  const patterns = parsed["industry_patterns"];
  if (Array.isArray(patterns) && patterns.length > 0) {
    lines.push("行业共性规律：");
    (patterns as Array<{ pattern?: string; logic?: string }>)
      .slice(0, 3)
      .forEach((p, i) => {
        if (p.pattern) lines.push(`  ${i + 1}. ${p.pattern}${p.logic ? `（${p.logic}）` : ""}`);
      });
  } else if (typeof patterns === "string") {
    lines.push(`行业共性规律：${patterns}`);
  }

  // differentiation_opportunities
  const opps = parsed["differentiation_opportunities"];
  if (Array.isArray(opps) && opps.length > 0) {
    lines.push("差异化机会：");
    (opps as Array<{ opportunity?: string; how_to_apply?: string; priority?: string }>)
      .filter((o) => o.priority === "high" || !o.priority)
      .slice(0, 3)
      .forEach((o, i) => {
        if (o.opportunity) lines.push(`  ${i + 1}. ${o.opportunity}${o.how_to_apply ? ` → ${o.how_to_apply}` : ""}`);
      });
  } else if (typeof opps === "string") {
    lines.push(`差异化机会：${opps}`);
  }

  // design_suggestions
  const suggestions = parsed["design_suggestions"];
  if (Array.isArray(suggestions) && suggestions.length > 0) {
    lines.push("设计建议：");
    (suggestions as Array<{ suggestion?: string; visual_elements?: string }>)
      .slice(0, 3)
      .forEach((s, i) => {
        if (s.suggestion) lines.push(`  ${i + 1}. ${s.suggestion}${s.visual_elements ? `（视觉元素：${s.visual_elements}）` : ""}`);
      });
  } else if (typeof suggestions === "string") {
    lines.push(`设计建议：${suggestions}`);
  }

  // recommended_style
  if (typeof parsed["recommended_style"] === "string") {
    lines.push(`推荐视觉风格基调：${parsed["recommended_style"]}`);
  }

  return lines.join("\n");
}

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

  // Load synthesis report
  const [synthesisRow] = await db
    .select()
    .from(synthesisReports)
    .where(eq(synthesisReports.analysisVersionId, task.analysisVersionId));

  let synthesisContent = "";
  if (synthesisRow) {
    try {
      const parsed = JSON.parse(synthesisRow.content) as Record<string, unknown>;
      synthesisContent = formatSynthesis(parsed);
    } catch { /* ignore */ }
  }

  // Fallback: use raw analysis cards if no synthesis
  if (!synthesisContent) {
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
        synthesisContent = `竞品图片分析（${cards.length}张）：\n` +
          cards.slice(0, 5).map((c, i) => {
            const d = JSON.parse(c.humanOverride ?? c.modelOutput) as Record<string, unknown>;
            return `图${i + 1}: 版式=${d["layout"] ?? ""}，色彩=${
              typeof d["colors"] === "object"
                ? (d["colors"] as Record<string, string>)?.palette ?? ""
                : d["colors"] ?? ""
            }，情感=${d["emotional_appeal"] ?? ""}，亮点=${d["strengths"] ?? ""}`;
          }).join("\n");
      }
    }
  }

  const productCtx = `商品名称：${product?.name ?? "未知"}
规格参数：${specs.map(s => `${s.label}=${s.value}`).join("，") || "暂无"}
核心卖点：${points.map(p => p.content).join("；") || "暂无"}`;

  const outputTypeLabel =
    outputTypes.includes("main_image") && outputTypes.includes("detail_page")
      ? "主图 + 详情页"
      : outputTypes.includes("main_image") ? "主图" : "详情页";

  const imagesPerDirection = outputTypes.length > 1
    ? "2-3张主图（listType: main_image）和2-3张详情页图（listType: detail_page）"
    : outputTypes[0] === "main_image"
      ? "3-4张主图（listType: main_image）"
      : "3-4张详情页图（listType: detail_page）";

  const prompt = `请为以下商品设计3个差异化的视觉方向，用于生成${outputTypeLabel}图片。
3个方向之间需有明显差异，例如：极简高端、温暖生活场景、数据驱动专业风。

【商品信息】
${productCtx}

【竞品分析洞察】
${synthesisContent || "暂无竞品分析数据，请基于商品特性自行判断"}

输出格式（严格JSON，只包含directions数组）：
{
  "directions": [
    {
      "label": "方向A — 简短主题名（6字以内）",
      "positioning": "核心定位和目标受众（1-2句话）",
      "colorScheme": "主色调+辅色的具体色彩描述（如：米白+金棕，传递高端温暖感）",
      "layoutIntent": "版式和构图策略（如：产品居中占60%，四周留白，标题底部对齐）",
      "copyStrategy": "文案风格和主要卖点侧重（如：技术数据为主，体现专业可信赖）",
      "imageList": [
        {
          "listType": "main_image",
          "title": "图片标题（8字以内）",
          "description": "图片核心内容描述（25字以内）",
          "sellingPoints": ["核心卖点1", "核心卖点2"],
          "suggestedCopy": "建议主标题文案（10字以内，有冲击力）",
          "compositionIntent": "构图意图（如：产品45度俯角居中，占画面65%）",
          "lighting": "光照描述（如：顶部柔光+侧面自然光，营造通透质感）",
          "angle": "拍摄视角（如：前侧45度、正俯角、平视正面）",
          "background": "背景细节（如：纯白无缝背景、原木桌面+绿植点缀、户外草坪柔焦）",
          "mood": "视觉情绪关键词（3-5个，如：简洁、高级感、清新、温馨）",
          "visualElements": "画面中需要出现的具体视觉元素（如：产品+包装盒+使用道具）"
        }
      ]
    }
  ]
}

要求：
- 每个方向生成${imagesPerDirection}
- imageList中的listType必须是"main_image"或"detail_page"
- lighting、angle、background、mood、visualElements字段必须填写，供图片生成模型直接使用
- 只输出JSON`;

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
      lighting?: string;
      angle?: string;
      background?: string;
      mood?: string;
      visualElements?: string;
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
