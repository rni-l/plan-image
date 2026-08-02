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
  productAssets,
} from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { gatewayCall } from "../../gateway/index.js";
import { randomUUID } from "node:crypto";
import { analyseAndPersistAsset } from "../../lib/product-analysis.js";

export interface DesignPlanInput {
  taskId: string;
  productId: string;
}

const SYSTEM_PROMPT = `你是一位顶级的电商视觉创意总监，擅长将商品特性与竞品洞察转化为可落地执行的视觉方案。
请基于提供的商品信息和竞品分析，生成3个差异化设计方向，以严格的JSON格式输出，不包含任何其他内容。
每个方向的图片列表需要包含非常丰富的视觉细节（构图、光照、角度、背景、氛围、视觉元素），以便直接驱动AI图片生成，每个字段必须写得具体且完整。`;

// ---------------------------------------------------------------------------
// Synthesis formatter
// ---------------------------------------------------------------------------

/** Summarise synthesis report (new structured format) into a few lines of context */
function formatSynthesis(parsed: Record<string, unknown>): string {
  const lines: string[] = [];

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

  if (typeof parsed["recommended_style"] === "string") {
    lines.push(`推荐视觉风格基调：${parsed["recommended_style"]}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

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
  const [specs, points, rawAssets] = await Promise.all([
    db.select().from(productSpecifications).where(eq(productSpecifications.productId, input.productId)),
    db.select().from(sellingPoints).where(eq(sellingPoints.productId, input.productId)),
    db.select().from(productAssets).where(eq(productAssets.productId, input.productId)).orderBy(productAssets.sortOrder),
  ]);

  // --- Analyse product images (fills in .analysis on DB rows) ---
  const assets = await Promise.all(
    rawAssets.map(async (a) => {
      const parsedAnalysis = await analyseAndPersistAsset(a);
      return { ...a, parsedAnalysis };
    })
  );

  // Build product image context string for the prompt
  const productImageCtx = assets.length > 0
    ? assets.map((a, i) => {
        const desc = a.parsedAnalysis
          ? [
              a.parsedAnalysis["appearance"],
              a.parsedAnalysis["colors"] ? `颜色：${a.parsedAnalysis["colors"]}` : "",
              a.parsedAnalysis["materials"] ? `材质：${a.parsedAnalysis["materials"]}` : "",
              a.parsedAnalysis["keyFeatures"] ? `视觉特征：${a.parsedAnalysis["keyFeatures"]}` : "",
              a.parsedAnalysis["style"] ? `风格：${a.parsedAnalysis["style"]}` : "",
            ].filter(Boolean).join("；")
          : "（图片分析失败，请基于商品名称判断）";
        return `  图片${i + 1}（ID: ${a.id}）: ${desc}`;
      }).join("\n")
    : "  暂无商品图片";

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

  // Build the list of valid productAssetIds for the LLM to choose from
  const validAssetIds = assets.map(a => a.id);
  const assetIdNote = validAssetIds.length > 0
    ? `可用的商品图片ID列表：${validAssetIds.join("、")}。每张图必须从这个列表中选择一个productAssetId。`
    : "暂无商品图片，productAssetId填null。";

  const prompt = `请为以下商品设计3个差异化的视觉方向，用于生成${outputTypeLabel}图片。
3个方向之间需有明显差异，例如：极简高端、温暖生活场景、数据驱动专业风。

【商品信息】
${productCtx}

【商品图片视觉分析】
${productImageCtx}

【竞品分析洞察】
${synthesisContent || "暂无竞品分析数据，请基于商品特性自行判断"}

${assetIdNote}

输出格式（严格JSON，只包含directions数组）：
{
  "directions": [
    {
      "label": "方向A — 简短主题名（6字以内）",
      "positioning": "核心定位和目标受众（2-3句话，说清楚为谁设计、传递什么价值）",
      "colorScheme": "完整配色方案（主色+辅色+点缀色，各自说明色值或颜色名，说明配色传递的情绪）",
      "layoutIntent": "版式和构图策略（详细说明：产品占比、位置、留白处理、文字区域安排）",
      "copyStrategy": "文案风格和主要卖点侧重（说明语气、字数、情感诉求方向）",
      "imageList": [
        {
          "listType": "main_image",
          "productAssetId": "使用哪张商品图片的ID（从上方可用ID中选择）",
          "title": "图片标题（8字以内）",
          "description": "图片核心内容和视觉目标（30字以内）",
          "sellingPoints": ["最突出的卖点1", "最突出的卖点2", "最突出的卖点3"],
          "suggestedCopy": "建议主标题文案（10-15字，有冲击力，与卖点呼应）",
          "compositionIntent": "详细构图描述（商品摆放位置/比例/与背景关系，如：商品前侧45度置于画面中央偏右，占画面高度70%，左侧留白用于文字排版）",
          "lighting": "完整光照方案（主光源位置/角度/强度，补光和轮廓光设置，阴影处理，光线色温，如：左侧柔和主光源45度，右下角低强度补光消除重阴影，顶部轮廓光增加立体感，5500K自然白光）",
          "angle": "精确拍摄视角（含水平角度、高度、距离，如：前侧45度水平视角，与商品齐高，中景距离）",
          "background": "背景详细描述（材质/颜色/纹理/道具摆放/景深处理，如：浅灰色无缝背景纸，右后方摆放浅色干燥花束作点缀，背景浅焦虚化，与商品形成明暗对比）",
          "mood": "视觉情绪描述（3-6个形容词，并简要说明如何通过画面元素体现，如：高级感通过大量留白体现、温暖感通过暖色调灯光体现）",
          "visualElements": "画面中所有视觉元素清单（商品本身+道具+背景元素，如：商品主体+打开的包装盒+品牌标签+一片绿叶+木质底板）"
        }
      ]
    }
  ]
}

要求：
- 每个方向生成${imagesPerDirection}
- imageList中的listType必须是"main_image"或"detail_page"
- lighting、angle、background、mood、visualElements、productAssetId字段必须填写，且内容详细、具体，可直接用于驱动图片生成模型
- 不同图片尽量使用不同的构图、拍摄角度和场景，体现多样性
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
      productAssetId?: string | null;
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
