import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { db } from "../db/index.js";
import {
  generationTasks,
  designDirections,
  designPlanVersions,
  imageItems,
  imageVersions,
  outputPresets,
  products,
} from "../db/schema.js";
import { eq, desc, max, lt, and, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { enqueueJob } from "../jobs/worker.js";
import { paths, assetPath } from "../lib/paths.js";
import { gatewayStream, gatewayTextStream } from "../gateway/index.js";
import { loadPromptContext } from "../lib/image-prompt.js";
import { saveImageAsset } from "../lib/storage.js";

const execFileAsync = promisify(execFile);

export const tasksRouter = new Hono();

// ---------------------------------------------------------------------------
// GET /api/tasks — cross-product task list (task center)
// ---------------------------------------------------------------------------
tasksRouter.get("/", async (c) => {
  const stepFilter = c.req.query("step"); // "active" (step<4) | "done" (step=4)
  const page  = Math.max(1, Number(c.req.query("page")  ?? "1"));
  const LIMIT = 30;
  const offset = (page - 1) * LIMIT;

  const conds: ReturnType<typeof eq>[] = [];
  if (stepFilter === "active") conds.push(lt(generationTasks.currentStep, 4));
  if (stepFilter === "done")   conds.push(eq(generationTasks.currentStep, 4));
  const where = conds.length > 0 ? and(...conds) : undefined;

  const [rows, totals] = await Promise.all([
    db
      .select({
        id:          generationTasks.id,
        productId:   generationTasks.productId,
        productName: products.name,
        outputTypes: generationTasks.outputTypes,
        currentStep: generationTasks.currentStep,
        createdAt:   generationTasks.createdAt,
        updatedAt:   generationTasks.updatedAt,
      })
      .from(generationTasks)
      .innerJoin(products, eq(generationTasks.productId, products.id))
      .where(where)
      .orderBy(desc(generationTasks.updatedAt))
      .limit(LIMIT)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)` })
      .from(generationTasks)
      .innerJoin(products, eq(generationTasks.productId, products.id))
      .where(where),
  ]);

  return c.json({ data: rows, total: totals[0]?.total ?? 0, page });
});

// ---------------------------------------------------------------------------
// Item-scoped routes — must be registered BEFORE /:taskId to avoid conflicts
// ---------------------------------------------------------------------------

// GET /api/tasks/items/:itemId/versions
tasksRouter.get("/items/:itemId/versions", async (c) => {
  const itemId = c.req.param("itemId");
  const versions = await db
    .select()
    .from(imageVersions)
    .where(eq(imageVersions.imageItemId, itemId))
    .orderBy(desc(imageVersions.createdAt));
  return c.json(versions);
});

// POST /api/tasks/items/:itemId/inpaint — create mask file + placeholder version + enqueue job
tasksRouter.post("/items/:itemId/inpaint", async (c) => {
  const itemId = c.req.param("itemId");

  const body = await c.req.json<{
    parentVersionId: string;
    maskDataUrl: string;
    instruction: string;
  }>();

  if (!body.parentVersionId || !body.maskDataUrl || !body.instruction?.trim()) {
    return c.json({ error: "parentVersionId、maskDataUrl、instruction 均为必填" }, 400);
  }
  if (body.instruction.length > 500) {
    return c.json({ error: "instruction 不能超过 500 字" }, 400);
  }

  // Verify parentVersion belongs to this item
  const [parentVersion] = await db
    .select()
    .from(imageVersions)
    .where(eq(imageVersions.id, body.parentVersionId));
  if (!parentVersion || parentVersion.imageItemId !== itemId) {
    return c.json({ error: "parentVersionId 不存在或不属于该图片项" }, 404);
  }

  // Decode and write mask file atomically
  const b64 = body.maskDataUrl.includes(",")
    ? body.maskDataUrl.split(",")[1]!
    : body.maskDataUrl;
  const maskBuffer = Buffer.from(b64, "base64");

  const maskId = randomUUID();
  const maskFilename = `${maskId}.png`;
  const maskAbsolute = path.join(paths.masks, maskFilename);
  const maskTmp = maskAbsolute + ".tmp";

  await fs.promises.writeFile(maskTmp, maskBuffer);
  await fs.promises.rename(maskTmp, maskAbsolute);

  const maskRelative = path.join("assets", "masks", maskFilename);

  // Create placeholder imageVersion
  const versionId = randomUUID();
  const now = new Date();
  await db.insert(imageVersions).values({
    id: versionId,
    imageItemId: itemId,
    filePath: "",
    checksum: "",
    generationType: "inpaint",
    parentVersionId: body.parentVersionId,
    jobId: null,
    maskPath: maskRelative,
    instruction: body.instruction.trim(),
    isSelected: false,
    createdAt: now,
  });

  // Enqueue image_edit job (entityType="image_item" so Step4 pollJobs can track it)
  const jobId = await enqueueJob({
    type: "image_edit",
    entityType: "image_item",
    entityId: itemId,
    inputSnapshot: {
      versionId,
      parentVersionId: body.parentVersionId,
      instruction: body.instruction.trim(),
    },
  });

  return c.json({ jobId, versionId }, 201);
});

// PATCH /api/tasks/items/:itemId/versions/:versionId/select — switch selected version
tasksRouter.patch("/items/:itemId/versions/:versionId/select", async (c) => {
  const itemId = c.req.param("itemId");
  const versionId = c.req.param("versionId");

  const [ver] = await db
    .select()
    .from(imageVersions)
    .where(eq(imageVersions.id, versionId));
  if (!ver || ver.imageItemId !== itemId) {
    return c.json({ error: "版本不存在或不属于该图片项" }, 404);
  }

  // Deselect all, then select the target
  await db
    .update(imageVersions)
    .set({ isSelected: false })
    .where(eq(imageVersions.imageItemId, itemId));
  await db
    .update(imageVersions)
    .set({ isSelected: true })
    .where(eq(imageVersions.id, versionId));

  return c.body(null, 204);
});

// POST /api/tasks/items/:itemId/retry
tasksRouter.post("/items/:itemId/retry", async (c) => {
  const itemId = c.req.param("itemId");
  const [item] = await db.select().from(imageItems).where(eq(imageItems.id, itemId));
  if (!item) return c.json({ error: "Not found" }, 404);

  const jobId = await enqueueJob({
    type: "image_generation",
    entityType: "image_item",
    entityId: itemId,
    inputSnapshot: { imageItemId: itemId, planVersionId: item.designPlanVersionId },
  });

  return c.json({ jobId }, 201);
});

// GET /api/tasks/items/:itemId/generate-stream
// SSE endpoint — streams progressive image frames while generating, then saves the result.
tasksRouter.get("/items/:itemId/generate-stream", (c) => {
  const itemId = c.req.param("itemId");

  return streamSSE(c, async (stream) => {
    try {
      // Verify item exists before opening the stream
      const [item] = await db.select().from(imageItems).where(eq(imageItems.id, itemId));
      if (!item) {
        await stream.writeSSE({
          data: JSON.stringify({ type: "error", message: "图片项不存在" }),
          event: "message",
        });
        return;
      }

      const ctx = await loadPromptContext(itemId);
      let lastB64 = "";

      // Stream progressive frames from the model, passing the product photo as reference
      for await (const chunk of gatewayStream("image_generation", {
        scene: "image_generation",
        prompt: ctx.prompt,
        ...(ctx.productImageBase64 ? { images: [ctx.productImageBase64] } : {}),
        parameters: {
          task_type: "image_gen",
          size: `${ctx.width}x${ctx.height}`,
          n: 1,
        },
      })) {
        lastB64 = chunk.b64;
        await stream.writeSSE({
          data: JSON.stringify({ type: "progress", b64: chunk.b64 }),
          event: "message",
        });
        if (chunk.done) break;
      }

      // Persist the final frame as a new image version
      if (lastB64) {
        const buffer = Buffer.from(lastB64, "base64");
        const assetId = randomUUID();
        const saved = await saveImageAsset(buffer, assetId, "generated");
        const now = new Date();

        await db
          .update(imageVersions)
          .set({ isSelected: false })
          .where(eq(imageVersions.imageItemId, itemId));

        await db.insert(imageVersions).values({
          id: assetId,
          imageItemId: itemId,
          filePath: saved.relativePath,
          checksum: saved.checksum,
          generationType: "initial",
          parentVersionId: null,
          jobId: null,
          maskPath: null,
          instruction: null,
          isSelected: true,
          createdAt: now,
        });

        await db
          .update(imageItems)
          .set({ updatedAt: now })
          .where(eq(imageItems.id, itemId));

        await stream.writeSSE({
          data: JSON.stringify({ type: "done", versionId: assetId }),
          event: "message",
        });
      } else {
        await stream.writeSSE({
          data: JSON.stringify({ type: "error", message: "模型未返回图片数据" }),
          event: "message",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await stream.writeSSE({
        data: JSON.stringify({ type: "error", message }),
        event: "message",
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Export routes  (must be before /:taskId to avoid shadowing)
// ---------------------------------------------------------------------------

// GET /api/tasks/:taskId/export/zip?planVersionId=xxx
// Bundles all selected image versions into a zip and streams it back.
tasksRouter.get("/:taskId/export/zip", async (c) => {
  const planVersionId = c.req.query("planVersionId");
  if (!planVersionId) return c.json({ error: "planVersionId required" }, 400);

  const items = await db
    .select()
    .from(imageItems)
    .where(eq(imageItems.designPlanVersionId, planVersionId))
    .orderBy(imageItems.listType, imageItems.sortOrder);

  if (items.length === 0) return c.json({ error: "No items in plan" }, 404);

  // Resolve each item to its selected (or latest) version path
  const filePaths: string[] = [];
  for (const item of items) {
    const vs = await db
      .select()
      .from(imageVersions)
      .where(eq(imageVersions.imageItemId, item.id))
      .orderBy(desc(imageVersions.createdAt));
    const selected = vs.find((v) => v.isSelected) ?? vs[0];
    if (selected?.filePath) filePaths.push(assetPath(selected.filePath));
  }

  if (filePaths.length === 0) return c.json({ error: "No generated images" }, 404);

  const zipId = randomUUID();
  const zipAbsPath = path.join(paths.exports, `export-${zipId}.zip`);

  try {
    // -j: junk directory names so the zip contains flat files
    await execFileAsync("/usr/bin/zip", ["-j", zipAbsPath, ...filePaths]);
    const buffer = await fs.promises.readFile(zipAbsPath);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="images-export.zip"`,
        "Content-Length": String(buffer.byteLength),
      },
    });
  } finally {
    fs.promises.unlink(zipAbsPath).catch(() => {});
  }
});

// GET /api/tasks/:taskId/export/stitch?planVersionId=xxx
// Vertically stitches all detail_page selected images into one tall JPEG.
tasksRouter.get("/:taskId/export/stitch", async (c) => {
  const planVersionId = c.req.query("planVersionId");
  if (!planVersionId) return c.json({ error: "planVersionId required" }, 400);

  const items = await db
    .select()
    .from(imageItems)
    .where(eq(imageItems.designPlanVersionId, planVersionId))
    .orderBy(imageItems.sortOrder);

  const detailItems = items.filter((it) => it.listType === "detail_page");
  if (detailItems.length === 0)
    return c.json({ error: "No detail_page items in plan" }, 404);

  // Collect absolute paths for selected versions
  const absFilePaths: string[] = [];
  for (const item of detailItems) {
    const vs = await db
      .select()
      .from(imageVersions)
      .where(eq(imageVersions.imageItemId, item.id))
      .orderBy(desc(imageVersions.createdAt));
    const selected = vs.find((v) => v.isSelected) ?? vs[0];
    if (selected?.filePath) absFilePaths.push(assetPath(selected.filePath));
  }

  if (absFilePaths.length === 0)
    return c.json({ error: "No generated detail page images" }, 404);

  const sharp = (await import("sharp")).default;

  // Determine target width (widest image wins)
  const metadatas = await Promise.all(absFilePaths.map((fp) => sharp(fp).metadata()));
  const targetWidth = Math.max(...metadatas.map((m) => m.width ?? 800));

  // Resize each image to targetWidth, collect buffers + heights
  const frames: Array<{ buf: Buffer; h: number }> = [];
  for (let i = 0; i < absFilePaths.length; i++) {
    const meta = metadatas[i]!;
    const aspectRatio = (meta.height ?? 800) / (meta.width ?? 800);
    const newHeight = Math.round(targetWidth * aspectRatio);
    const buf = await sharp(absFilePaths[i]!).resize(targetWidth, newHeight).toBuffer();
    frames.push({ buf, h: newHeight });
  }

  const totalHeight = frames.reduce((s, f) => s + f.h, 0);

  // Build composite instruction list
  let yOffset = 0;
  const composites = frames.map(({ buf, h }) => {
    const c = { input: buf, top: yOffset, left: 0 };
    yOffset += h;
    return c;
  });

  const stitched = await sharp({
    create: { width: targetWidth, height: totalHeight, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toBuffer();

  return new Response(new Uint8Array(stitched), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": `attachment; filename="detail-stitch.jpg"`,
      "Content-Length": String(stitched.byteLength),
    },
  });
});

// ---------------------------------------------------------------------------
// Task-scoped routes
// ---------------------------------------------------------------------------

// GET /api/tasks/:taskId
tasksRouter.get("/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const [task] = await db.select().from(generationTasks).where(eq(generationTasks.id, taskId));
  if (!task) return c.json({ error: "Not found" }, 404);

  const [directions, planVersions] = await Promise.all([
    db.select().from(designDirections).where(eq(designDirections.generationTaskId, taskId)),
    db
      .select()
      .from(designPlanVersions)
      .where(eq(designPlanVersions.generationTaskId, taskId))
      .orderBy(desc(designPlanVersions.versionNumber)),
  ]);

  return c.json({ ...task, directions, planVersions });
});

// GET /api/tasks/:taskId/plan/:planVersionId/items
tasksRouter.get("/:taskId/plan/:planVersionId/items", async (c) => {
  const planVersionId = c.req.param("planVersionId");
  const items = await db
    .select()
    .from(imageItems)
    .where(eq(imageItems.designPlanVersionId, planVersionId))
    .orderBy(imageItems.listType, imageItems.sortOrder);
  return c.json(items);
});

// PATCH /api/tasks/:taskId/step
tasksRouter.patch("/:taskId/step", async (c) => {
  const taskId = c.req.param("taskId");
  const body = await c.req.json<{ step: number }>();

  if (body.step < 1 || body.step > 4) return c.json({ error: "Invalid step" }, 400);

  await db
    .update(generationTasks)
    .set({ currentStep: body.step, updatedAt: new Date() })
    .where(eq(generationTasks.id, taskId));

  return c.body(null, 204);
});

// GET /api/tasks/:taskId/generate-directions-stream — SSE: analyse images + stream LLM output + save directions
tasksRouter.get("/:taskId/generate-directions-stream", (c) => {
  const taskId = c.req.param("taskId");
  const userIdeas = c.req.query("userIdeas") ?? "";
  const planCount = Math.min(5, Math.max(2, Number(c.req.query("planCount") ?? "3")));
  const mainImageCount = Math.min(6, Math.max(1, Number(c.req.query("mainImageCount") ?? "3")));
  const detailImageCount = Math.min(6, Math.max(1, Number(c.req.query("detailImageCount") ?? "3")));

  return streamSSE(c, async (stream) => {
    const emit = async (event: Record<string, unknown>) => {
      await stream.writeSSE({ data: JSON.stringify(event), event: "message" });
    };

    try {
      // ── 1. Load task ──────────────────────────────────────────────────
      const [task] = await db.select().from(generationTasks).where(eq(generationTasks.id, taskId));
      if (!task) { await emit({ type: "error", message: "任务不存在" }); return; }

      // Mark task as step 2
      await db.update(generationTasks)
        .set({ currentStep: 2, updatedAt: new Date() })
        .where(eq(generationTasks.id, taskId));

      // ── 2. Delete any stale directions for this task ───────────────────
      await db.delete(designDirections).where(eq(designDirections.generationTaskId, taskId));

      // ── 3. Analyse product images ─────────────────────────────────────
      const { productAssets, productSpecifications, sellingPoints,
              analysisVersions: analysisVersionsTable, synthesisReports,
              imageAnalysisCards } = await import("../db/schema.js");
      const { analyseAndPersistAsset } = await import("../lib/product-analysis.js");

      const rawAssets = await db.select().from(productAssets)
        .where(eq(productAssets.productId, task.productId))
        .orderBy(productAssets.sortOrder);

      await emit({ type: "step", text: `正在分析商品图片（${rawAssets.length} 张）…` });

      const assets = await Promise.all(rawAssets.map(async (a, i) => {
        const parsedAnalysis = await analyseAndPersistAsset(a);
        await emit({ type: "step", text: `商品图片 ${i + 1}/${rawAssets.length} 分析完成` });
        return { ...a, parsedAnalysis };
      }));

      // ── 4. Build context for the design-plan prompt ───────────────────
      const [product] = await db.select().from(products).where(eq(products.id, task.productId));
      const [specs, points] = await Promise.all([
        db.select().from(productSpecifications).where(eq(productSpecifications.productId, task.productId)),
        db.select().from(sellingPoints).where(eq(sellingPoints.productId, task.productId)),
      ]);

      const outputTypes: string[] = JSON.parse(task.outputTypes);
      const validAssetIds = assets.map(a => a.id);

      const productImageCtx = assets.length > 0
        ? assets.map((a, i) => {
            const d = a.parsedAnalysis;
            const desc = d
              ? [d["appearance"], d["colors"] ? `颜色：${d["colors"]}` : "",
                 d["materials"] ? `材质：${d["materials"]}` : "",
                 d["keyFeatures"] ? `视觉特征：${d["keyFeatures"]}` : "",
                 d["style"] ? `风格：${d["style"]}` : ""].filter(Boolean).join("；")
              : "（图片分析失败）";
            return `  图片${i + 1}（ID: ${a.id}）: ${desc}`;
          }).join("\n")
        : "  暂无商品图片";

      // Synthesis / competitor analysis
      const [synthesisRow] = await db.select().from(synthesisReports)
        .where(eq(synthesisReports.analysisVersionId, task.analysisVersionId));
      let synthesisContent = "";
      if (synthesisRow) {
        try {
          const p = JSON.parse(synthesisRow.content) as Record<string, unknown>;
          const lines: string[] = [];
          const patterns = p["industry_patterns"];
          if (Array.isArray(patterns)) {
            lines.push("行业共性规律：");
            (patterns as Array<{ pattern?: string; logic?: string }>).slice(0, 3)
              .forEach((x, i) => { if (x.pattern) lines.push(`  ${i + 1}. ${x.pattern}${x.logic ? `（${x.logic}）` : ""}`); });
          }
          const opps = p["differentiation_opportunities"];
          if (Array.isArray(opps)) {
            lines.push("差异化机会：");
            (opps as Array<{ opportunity?: string; how_to_apply?: string }>).slice(0, 3)
              .forEach((x, i) => { if (x.opportunity) lines.push(`  ${i + 1}. ${x.opportunity}${x.how_to_apply ? ` → ${x.how_to_apply}` : ""}`); });
          }
          synthesisContent = lines.join("\n");
        } catch { /* ignore */ }
      }
      if (!synthesisContent) {
        const [version] = await db.select().from(analysisVersionsTable)
          .where(eq(analysisVersionsTable.id, task.analysisVersionId));
        if (version) {
          const cards = await db.select().from(imageAnalysisCards)
            .where(eq(imageAnalysisCards.analysisVersionId, version.id));
          if (cards.length > 0) {
            synthesisContent = `竞品图片分析（${cards.length}张）：\n` +
              cards.slice(0, 5).map((c, i) => {
                const d = JSON.parse(c.humanOverride ?? c.modelOutput) as Record<string, unknown>;
                return `图${i + 1}: 版式=${d["layout"] ?? ""}，色彩=${
                  typeof d["colors"] === "object"
                    ? (d["colors"] as Record<string, string>)?.palette ?? ""
                    : d["colors"] ?? ""}，情感=${d["emotional_appeal"] ?? ""}`;
              }).join("\n");
          }
        }
      }

      const productCtx = `商品名称：${product?.name ?? "未知"}\n规格参数：${specs.map(s => `${s.label}=${s.value}`).join("，") || "暂无"}\n核心卖点：${points.map(p => p.content).join("；") || "暂无"}`;
      const outputTypeLabel = outputTypes.includes("main_image") && outputTypes.includes("detail_page")
        ? "主图 + 详情页" : outputTypes.includes("main_image") ? "主图" : "详情页";
      const imagesPerDirection = outputTypes.length > 1
        ? `${mainImageCount}张主图（listType: main_image）和${detailImageCount}张详情页图（listType: detail_page）`
        : outputTypes[0] === "main_image"
          ? `${mainImageCount}张主图（listType: main_image）`
          : `${detailImageCount}张详情页图（listType: detail_page）`;
      const assetIdNote = validAssetIds.length > 0
        ? `可用的商品图片ID列表：${validAssetIds.join("、")}。每张图必须从这个列表中选择一个productAssetId。`
        : "暂无商品图片，productAssetId填null。";
      const userIdeasSection = userIdeas.trim()
        ? `\n\n【用户创意方向参考】\n${userIdeas.trim()}\n（请充分参考用户想法，但仍需生成${planCount}个差异化方向）`
        : "";

      const prompt = `请为以下商品设计${planCount}个差异化的视觉方向，用于生成${outputTypeLabel}图片。\n${planCount}个方向之间需有明显差异，例如：极简高端、温暖生活场景、数据驱动专业风。\n\n【商品信息】\n${productCtx}\n\n【商品图片视觉分析】\n${productImageCtx}\n\n【竞品分析洞察】\n${synthesisContent || "暂无竞品分析数据，请基于商品特性自行判断"}${userIdeasSection}\n\n${assetIdNote}\n\n输出格式（严格JSON，只包含directions数组）：\n{\n  "directions": [\n    {\n      "label": "方向A — 简短主题名（6字以内）",\n      "positioning": "核心定位和目标受众（2-3句话）",\n      "colorScheme": "完整配色方案（主色+辅色+点缀色）",\n      "layoutIntent": "版式和构图策略",\n      "copyStrategy": "文案风格和主要卖点侧重",\n      "imageList": [\n        {\n          "listType": "main_image",\n          "productAssetId": "使用哪张商品图片的ID",\n          "title": "图片标题（8字以内）",\n          "description": "图片核心内容（30字以内）",\n          "sellingPoints": ["卖点1", "卖点2", "卖点3"],\n          "suggestedCopy": "建议主标题文案（10-15字）",\n          "compositionIntent": "详细构图描述",\n          "lighting": "完整光照方案",\n          "angle": "精确拍摄视角",\n          "background": "背景详细描述",\n          "mood": "视觉情绪描述（3-6个形容词）",\n          "visualElements": "画面中所有视觉元素清单"\n        }\n      ]\n    }\n  ]\n}\n\n要求：每个方向生成${imagesPerDirection}；只输出JSON`;

      const SYSTEM_PROMPT = `你是一位顶级的电商视觉创意总监，擅长将商品特性与竞品洞察转化为可落地执行的视觉方案。请基于提供的商品信息和竞品分析，生成${planCount}个差异化设计方向，以严格的JSON格式输出，不包含任何其他内容。每个方向的图片列表需要包含非常丰富的视觉细节，以便直接驱动AI图片生成。`;

      // ── 5. Stream LLM output ──────────────────────────────────────────
      await emit({ type: "step", text: "正在生成设计方向，AI 思考中…" });

      let fullText = "";
      for await (const chunk of gatewayTextStream("design_plan", {
        scene: "design_plan",
        prompt,
        systemPrompt: SYSTEM_PROMPT,
      })) {
        if (chunk.text) {
          fullText += chunk.text;
          await emit({ type: "token", text: chunk.text });
        }
        if (chunk.done) break;
      }

      // ── 6. Parse and save directions ──────────────────────────────────
      await emit({ type: "step", text: "解析设计方向并保存…" });

      const match = fullText.match(/\{[\s\S]*\}/);
      let directions: Array<{ label: string; content: string }> = [];
      try {
        const parsed = JSON.parse(match?.[0] ?? fullText) as {
          directions?: Array<{ label?: string; [key: string]: unknown }>;
        };
        if (Array.isArray(parsed.directions)) {
          const now = new Date();
          for (const dir of parsed.directions.slice(0, planCount)) {
            await db.insert(designDirections).values({
              id: randomUUID(),
              generationTaskId: taskId,
              label: dir.label ?? "未命名方向",
              content: JSON.stringify(dir),
              createdAt: now,
            });
          }
          directions = parsed.directions.slice(0, planCount).map(d => ({
            label: d.label ?? "未命名方向",
            content: JSON.stringify(d),
          }));
        }
      } catch {
        await emit({ type: "error", message: "设计方向解析失败，模型返回格式错误，请重试" });
        return;
      }

      if (directions.length === 0) {
        await emit({ type: "error", message: "设计方向生成失败，未能解析到方向数据，请重试" });
        return;
      }

      await emit({ type: "done" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message }), event: "message" });
    }
  });
});

// POST /api/tasks/:taskId/generate-directions — enqueue design_plan job (kept for backward-compat)
tasksRouter.post("/:taskId/generate-directions", async (c) => {
  const taskId = c.req.param("taskId");
  const [task] = await db.select().from(generationTasks).where(eq(generationTasks.id, taskId));
  if (!task) return c.json({ error: "Not found" }, 404);

  const jobId = await enqueueJob({
    type: "design_plan",
    entityType: "generation_task",
    entityId: taskId,
    inputSnapshot: { taskId, productId: task.productId },
  });

  await db
    .update(generationTasks)
    .set({ currentStep: 2, updatedAt: new Date() })
    .where(eq(generationTasks.id, taskId));

  return c.json({ jobId }, 201);
});

// PATCH /api/tasks/:taskId/direction — record the user-selected direction
tasksRouter.patch("/:taskId/direction", async (c) => {
  const taskId = c.req.param("taskId");
  const body = await c.req.json<{ directionId: string }>();

  // Verify direction belongs to this task
  const [dir] = await db
    .select()
    .from(designDirections)
    .where(eq(designDirections.id, body.directionId));
  if (!dir || dir.generationTaskId !== taskId) return c.json({ error: "Not found" }, 404);

  // Store selected direction on the task (reuse configSnapshot field via updatedAt only)
  // We store the selection in a transient field — real commit happens in /plan
  await db
    .update(generationTasks)
    .set({ currentStep: 3, updatedAt: new Date() })
    .where(eq(generationTasks.id, taskId));

  return c.json({ ok: true });
});

// POST /api/tasks/directions/:directionId/chat — chat with a design direction to refine it
tasksRouter.post("/directions/:directionId/chat", async (c) => {
  const directionId = c.req.param("directionId");
  const body = await c.req.json<{
    message: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
  }>();

  const [dir] = await db
    .select()
    .from(designDirections)
    .where(eq(designDirections.id, directionId));
  if (!dir) return c.json({ error: "Not found" }, 404);

  const { gatewayCall } = await import("../gateway/index.js");

  const dirContent = (() => { try { return JSON.parse(dir.content) as Record<string, unknown>; } catch { return {}; } })();
  const systemPrompt = `你是一位电商视觉设计顾问。当前正在讨论的设计方向如下：

方向名称：${dir.label}
定位：${dirContent["positioning"] ?? ""}
配色方案：${dirContent["colorScheme"] ?? ""}
版式策略：${dirContent["layoutIntent"] ?? ""}
文案策略：${dirContent["copyStrategy"] ?? ""}
图片数量：${Array.isArray(dirContent["imageList"]) ? (dirContent["imageList"] as unknown[]).length : 0} 张

请根据用户的反馈帮助优化这个设计方向。如果用户要求修改方向内容，请在回复末尾附上更新后的完整JSON（使用代码块包裹，格式与原始方向一致，包含label/positioning/colorScheme/layoutIntent/copyStrategy/imageList）。如果用户只是询问或讨论，正常回答即可，无需输出JSON。`;

  // Flatten multi-turn history into a single prompt string
  const historyText = body.history.length > 0
    ? body.history.map(h => `${h.role === "user" ? "用户" : "助手"}：${h.content}`).join("\n\n") + "\n\n"
    : "";
  const prompt = `${historyText}用户：${body.message}`;

  let replyText = "";
  try {
    const result = await gatewayCall("design_plan", {
      scene: "design_plan",
      systemPrompt,
      prompt,
    });
    replyText = result.text ?? "";
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "LLM 调用失败" }, 500);
  }

  // Try to extract updated JSON content from the reply (wrapped in ```json ... ```)
  let updatedContent: Record<string, unknown> | null = null;
  const jsonMatch = replyText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]!) as Record<string, unknown>;
      if (parsed["label"] || parsed["positioning"] || parsed["imageList"]) {
        updatedContent = parsed;
        // Persist updated content to DB
        await db
          .update(designDirections)
          .set({ content: JSON.stringify(updatedContent) })
          .where(eq(designDirections.id, directionId));
      }
    } catch { /* ignore parse errors */ }
  }

  return c.json({ reply: replyText, updatedContent });
});


tasksRouter.post("/:taskId/plan", async (c) => {
  const taskId = c.req.param("taskId");
  const [task] = await db.select().from(generationTasks).where(eq(generationTasks.id, taskId));
  if (!task) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<{
    directionId: string;
    items: Array<{
      listType: "main_image" | "detail_page";
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
      productAssetId?: string | null;
      presetId: string;
    }>;
  }>();

  const now = new Date();

  // Next version number
  const maxVerResult = await db
    .select({ maxVer: max(designPlanVersions.versionNumber) })
    .from(designPlanVersions)
    .where(eq(designPlanVersions.generationTaskId, taskId));

  const versionNumber = (maxVerResult[0]?.maxVer ?? 0) + 1;
  const planVersionId = randomUUID();

  await db.insert(designPlanVersions).values({
    id: planVersionId,
    generationTaskId: taskId,
    selectedDirectionId: body.directionId,
    versionNumber,
    confirmedAt: now,
    createdAt: now,
  });

  // Create image items, each with a frozen preset snapshot
  for (let i = 0; i < body.items.length; i++) {
    const item = body.items[i]!;
    const [preset] = await db.select().from(outputPresets).where(eq(outputPresets.id, item.presetId));
    const presetSnapshot = JSON.stringify(preset ?? { width: 1000, height: 1000, format: "jpg", quality: 90 });

    await db.insert(imageItems).values({
      id: randomUUID(),
      designPlanVersionId: planVersionId,
      listType: item.listType,
      sortOrder: i,
      title: item.title,
      description: item.description ?? null,
      sellingPoints: item.sellingPoints ? JSON.stringify(item.sellingPoints) : null,
      suggestedCopy: item.suggestedCopy ?? null,
      compositionIntent: item.compositionIntent ?? null,
      lighting: item.lighting ?? null,
      angle: item.angle ?? null,
      background: item.background ?? null,
      mood: item.mood ?? null,
      visualElements: item.visualElements ?? null,
      productAssetId: item.productAssetId ?? null,
      referenceAssetIds: null,
      outputPresetSnapshot: presetSnapshot,
      createdAt: now,
      updatedAt: now,
    });
  }

  await db
    .update(generationTasks)
    .set({ currentStep: 4, updatedAt: now })
    .where(eq(generationTasks.id, taskId));

  const items = await db
    .select()
    .from(imageItems)
    .where(eq(imageItems.designPlanVersionId, planVersionId))
    .orderBy(imageItems.listType, imageItems.sortOrder);

  return c.json({ planVersionId, items }, 201);
});

// POST /api/tasks/:taskId/generate — enqueue image_generation job for each item
tasksRouter.post("/:taskId/generate", async (c) => {
  const taskId = c.req.param("taskId");
  const body = await c.req.json<{ planVersionId: string }>();

  const items = await db
    .select()
    .from(imageItems)
    .where(eq(imageItems.designPlanVersionId, body.planVersionId))
    .orderBy(imageItems.listType, imageItems.sortOrder);

  if (items.length === 0) return c.json({ error: "No items in plan" }, 422);

  const jobIds: string[] = [];
  for (const item of items) {
    const jobId = await enqueueJob({
      type: "image_generation",
      entityType: "image_item",
      entityId: item.id,
      inputSnapshot: { imageItemId: item.id, planVersionId: body.planVersionId },
    });
    jobIds.push(jobId);
  }

  await db
    .update(generationTasks)
    .set({ currentStep: 4, updatedAt: new Date() })
    .where(eq(generationTasks.id, taskId));

  return c.json({ jobIds }, 201);
});
