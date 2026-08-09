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
  backgroundJobs,
  promptTemplates,
} from "../db/schema.js";
import { eq, desc, max, lt, and, sql, inArray, isNotNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { enqueueJob } from "../jobs/worker.js";
import { paths, assetPath } from "../lib/paths.js";
import { gatewayStream, gatewayTextStream } from "../gateway/index.js";
import { resolveDefaultModelRoute, resolveModelRoute, snapshotSelectedModelRoute } from "../gateway/model-route.js";
import { renderDesignPlanPromptSnapshot, renderImageGenerationPromptSnapshot, validatePolishInstruction } from "../lib/prompt-service.js";
import { saveImageAsset } from "../lib/storage.js";

const execFileAsync = promisify(execFile);

export const tasksRouter = new Hono();

/** Normalize model JSON before persisting text columns; arrays are stored as JSON snapshots. */
function textOrJsonArray(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return JSON.stringify(value.filter((item): item is string => typeof item === "string"));
  return null;
}

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
        name:        generationTasks.name,
        description: generationTasks.description,
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
    modelRouteId?: string;
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
      modelRoute: await snapshotSelectedModelRoute("image_edit", body.modelRouteId),
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
  const body: { modelRouteId?: string } = await c.req.json<{ modelRouteId?: string }>().catch(() => ({}));
  const [item] = await db.select().from(imageItems).where(eq(imageItems.id, itemId));
  if (!item) return c.json({ error: "Not found" }, 404);

  const [active] = await db.select({ id: backgroundJobs.id }).from(backgroundJobs).where(and(
    eq(backgroundJobs.entityType, "image_item"),
    eq(backgroundJobs.entityId, itemId),
    inArray(backgroundJobs.status, ["queued", "running"]),
  )).limit(1);
  if (active) return c.json({ error: "该图片已有正在进行的生成任务" }, 409);

  const rendered = await renderImageGenerationPromptSnapshot({ imageItemId: itemId });
  const modelRoute = await snapshotSelectedModelRoute("image_generation", body.modelRouteId);
  const [latestVersion] = await db.select({ id: imageVersions.id }).from(imageVersions)
    .where(eq(imageVersions.imageItemId, itemId)).limit(1);
  const jobId = await enqueueJob({
    type: "image_generation",
    entityType: "image_item",
    entityId: itemId,
    inputSnapshot: {
      imageItemId: itemId,
      planVersionId: item.designPlanVersionId,
      finalPrompt: rendered.finalPrompt,
      promptTemplateId: rendered.templateId,
      polishInstruction: null,
      width: rendered.width,
      height: rendered.height,
      generationType: latestVersion ? "regeneration" : "initial",
      ...(modelRoute ? { modelRoute } : {}),
    },
  });

  return c.json({ jobId }, 201);
});

// POST /api/tasks/items/:itemId/generate-stream
// Request-body SSE endpoint: freezes the submitted prompt, creates a traceable
// running job, streams previews, and only writes a version after final success.
tasksRouter.post("/items/:itemId/generate-stream", async (c) => {
  const itemId = c.req.param("itemId");
  const body: {
    templateId?: string | null;
    editablePrompt?: string;
    polishInstruction?: string | null;
    modelRouteId?: string;
  } = await c.req.json<{
    templateId?: string | null;
    editablePrompt?: string;
    polishInstruction?: string | null;
    modelRouteId?: string;
  }>().catch(() => ({}));

  const [item] = await db.select().from(imageItems).where(eq(imageItems.id, itemId));
  if (!item) return c.json({ error: "图片项不存在" }, 404);
  const [active] = await db.select({ id: backgroundJobs.id }).from(backgroundJobs).where(and(
    eq(backgroundJobs.entityType, "image_item"),
    eq(backgroundJobs.entityId, itemId),
    inArray(backgroundJobs.status, ["queued", "running"]),
  )).limit(1);
  if (active) return c.json({ error: "该图片已有正在进行的生成任务" }, 409);

  let polishInstruction: string | null = null;
  try {
    polishInstruction = body.polishInstruction ? validatePolishInstruction(body.polishInstruction) : null;
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  let rendered: Awaited<ReturnType<typeof renderImageGenerationPromptSnapshot>>;
  try {
    rendered = await renderImageGenerationPromptSnapshot({
      imageItemId: itemId,
      ...(body.templateId !== undefined ? { templateId: body.templateId } : {}),
      ...(body.editablePrompt !== undefined ? { editablePrompt: body.editablePrompt } : {}),
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 422);
  }

  const [existingVersion] = await db.select({ id: imageVersions.id }).from(imageVersions)
    .where(eq(imageVersions.imageItemId, itemId)).limit(1);
  const generationType = existingVersion ? "regeneration" as const : "initial" as const;
  let selectedModelRoute;
  try {
    selectedModelRoute = body.modelRouteId ? await resolveModelRoute("image_generation", body.modelRouteId) : await resolveDefaultModelRoute("image_generation");
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
  const jobId = randomUUID();
  await db.insert(backgroundJobs).values({
    id: jobId,
    type: "image_generation",
    status: "running",
    entityType: "image_item",
    entityId: itemId,
    inputSnapshot: JSON.stringify({
      imageItemId: itemId,
      planVersionId: item.designPlanVersionId,
      finalPrompt: rendered.finalPrompt,
      promptTemplateId: rendered.templateId,
      polishInstruction,
      width: rendered.width,
      height: rendered.height,
      generationType,
      modelRoute: selectedModelRoute,
    }),
    startedAt: new Date(),
    createdAt: new Date(),
  });

  return streamSSE(c, async (stream) => {
    try {
      let lastB64 = "";

      // Stream progressive frames from the model, passing the product photo as reference
      for await (const chunk of gatewayStream(selectedModelRoute, {
        scene: "image_generation",
        prompt: rendered.finalPrompt,
        ...(rendered.productImageBase64 ? { images: [rendered.productImageBase64] } : {}),
        parameters: {
          task_type: "image_gen",
          size: `${rendered.width}x${rendered.height}`,
          n: 1,
        },
      }, jobId)) {
        lastB64 = chunk.b64;
        await stream.writeSSE({
          data: JSON.stringify({ type: "progress", b64: chunk.b64 }),
          event: "message",
        });
        if (chunk.done) break;
      }

      if (!lastB64) throw new Error("模型未返回图片数据");
      const buffer = Buffer.from(lastB64, "base64");
      const assetId = randomUUID();
      const saved = await saveImageAsset(buffer, assetId, "generated");
      const now = new Date();

      await db.update(imageVersions).set({ isSelected: false })
        .where(eq(imageVersions.imageItemId, itemId));
      await db.insert(imageVersions).values({
        id: assetId,
        imageItemId: itemId,
        filePath: saved.relativePath,
        checksum: saved.checksum,
        generationType,
        parentVersionId: null,
        jobId,
        maskPath: null,
        instruction: null,
        promptTemplateId: rendered.templateId,
        finalPrompt: rendered.finalPrompt,
        polishInstruction,
        isSelected: true,
        createdAt: now,
      });
      await db.update(imageItems).set({ updatedAt: now }).where(eq(imageItems.id, itemId));
      await db.update(backgroundJobs).set({ status: "succeeded", finishedAt: now })
        .where(eq(backgroundJobs.id, jobId));
      await stream.writeSSE({
        data: JSON.stringify({ type: "done", versionId: assetId, jobId }),
        event: "message",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.update(backgroundJobs).set({
        status: "failed",
        errorType: "unknown",
        errorMessage: message,
        finishedAt: new Date(),
      }).where(eq(backgroundJobs.id, jobId));
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

// GET /api/tasks/:taskId/preview-images — 返回最新方案版本中已生成的缩略图路径（最多6张）
tasksRouter.get("/:taskId/preview-images", async (c) => {
  const taskId = c.req.param("taskId");

  const [latest] = await db
    .select()
    .from(designPlanVersions)
    .where(eq(designPlanVersions.generationTaskId, taskId))
    .orderBy(desc(designPlanVersions.versionNumber))
    .limit(1);

  if (!latest) return c.json({ images: [] });

  const itemList = await db
    .select()
    .from(imageItems)
    .where(eq(imageItems.designPlanVersionId, latest.id))
    .orderBy(imageItems.listType, imageItems.sortOrder)
    .limit(6);

  const images: Array<{ itemId: string; filePath: string; title: string }> = [];
  for (const item of itemList) {
    const vs = await db
      .select()
      .from(imageVersions)
      .where(eq(imageVersions.imageItemId, item.id))
      .orderBy(desc(imageVersions.createdAt));
    const selected = vs.find((v) => v.isSelected) ?? vs[0];
    if (selected?.filePath) {
      images.push({ itemId: item.id, filePath: selected.filePath, title: item.title });
    }
  }

  return c.json({ images });
});

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

// POST /api/tasks/:taskId/generate-directions-stream — request-body SSE
tasksRouter.post("/:taskId/generate-directions-stream", async (c) => {
  const taskId = c.req.param("taskId");
  const body: {
    userIdeas?: string;
    planCount?: number;
    mainImageCount?: number;
    detailImageCount?: number;
    templateId?: string | null;
    editablePrompt?: string;
    modelRouteId?: string;
    productAnalysisRouteId?: string;
  } = await c.req.json<{
    userIdeas?: string;
    planCount?: number;
    mainImageCount?: number;
    detailImageCount?: number;
    templateId?: string | null;
    editablePrompt?: string;
    modelRouteId?: string;
    productAnalysisRouteId?: string;
  }>().catch(() => ({}));
  const userIdeas = body.userIdeas ?? "";
  const planCount = Math.min(5, Math.max(2, Number(body.planCount ?? 3)));
  const mainImageCount = Math.max(1, Math.floor(Number(body.mainImageCount ?? 3)) || 1);
  const detailImageCount = Math.max(1, Math.floor(Number(body.detailImageCount ?? 3)) || 1);
  let selectedModelRoute;
  let selectedProductAnalysisRoute;
  try {
    selectedModelRoute = body.modelRouteId ? await resolveModelRoute("design_plan", body.modelRouteId) : await resolveDefaultModelRoute("design_plan");
    selectedProductAnalysisRoute = body.productAnalysisRouteId ? await resolveModelRoute("competitor_image_analysis", body.productAnalysisRouteId) : await resolveDefaultModelRoute("competitor_image_analysis");
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  return streamSSE(c, async (stream) => {
    const emit = async (event: Record<string, unknown>) => {
      await stream.writeSSE({ data: JSON.stringify(event), event: "message" });
    };
    let streamJobId: string | null = null;

    try {
      // ── 1. Load task ──────────────────────────────────────────────────
      const [task] = await db.select().from(generationTasks).where(eq(generationTasks.id, taskId));
      if (!task) { await emit({ type: "error", message: "任务不存在" }); return; }

      // Mark task as step 2
      await db.update(generationTasks)
        .set({ currentStep: 2, updatedAt: new Date() })
        .where(eq(generationTasks.id, taskId));

      // ── 2. Analyse product images ─────────────────────────────────────
      const { productAssets, productSpecifications, sellingPoints,
              analysisVersions: analysisVersionsTable, synthesisReports,
              imageAnalysisCards } = await import("../db/schema.js");
      const { analyseAndPersistAsset } = await import("../lib/product-analysis.js");

      const rawAssets = await db.select().from(productAssets)
        .where(eq(productAssets.productId, task.productId))
        .orderBy(productAssets.sortOrder);

      await emit({ type: "step", text: `正在分析商品图片（${rawAssets.length} 张）…` });

      const assets = await Promise.all(rawAssets.map(async (a, i) => {
        const parsedAnalysis = await analyseAndPersistAsset(a, false, selectedProductAnalysisRoute);
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

      const legacyPrompt = `请为以下商品设计${planCount}个差异化的视觉方向，用于生成${outputTypeLabel}图片。\n${productCtx}\n${productImageCtx}\n${synthesisContent}\n${userIdeasSection}\n${assetIdNote}\n每个方向生成${imagesPerDirection}`;

      const SYSTEM_PROMPT = `你是一位顶级的电商视觉创意总监，擅长将商品特性与竞品洞察转化为可落地执行的视觉方案。请基于提供的商品信息和竞品分析，生成${planCount}个差异化设计方向，以严格的JSON格式输出，不包含任何其他内容。每个方向的图片列表需要包含非常丰富的视觉细节，以便直接驱动AI图片生成。`;

      const renderedPrompt = await renderDesignPlanPromptSnapshot({
        taskId,
        ...(body.templateId !== undefined ? { templateId: body.templateId } : {}),
        ...(body.editablePrompt !== undefined ? { editablePrompt: body.editablePrompt } : {}),
        options: { userIdeas, planCount, mainImageCount, detailImageCount },
      });
      const prompt = renderedPrompt.finalPrompt || legacyPrompt;
      await db.update(generationTasks).set({
        planDefaultTemplateId: renderedPrompt.templateId,
        latestPlanPromptSnapshot: prompt,
        updatedAt: new Date(),
      }).where(eq(generationTasks.id, taskId));
      streamJobId = randomUUID();
      await db.insert(backgroundJobs).values({
        id: streamJobId,
        type: "design_plan",
        status: "running",
        entityType: "generation_task",
        entityId: taskId,
        inputSnapshot: JSON.stringify({
          taskId,
          finalPrompt: prompt,
          promptTemplateId: renderedPrompt.templateId,
          userIdeas,
          planCount,
          mainImageCount,
          detailImageCount,
          modelRoute: selectedModelRoute,
          productAnalysisRoute: selectedProductAnalysisRoute,
        }),
        startedAt: new Date(),
        createdAt: new Date(),
      });

      // ── 5. Stream LLM output ──────────────────────────────────────────
      await emit({ type: "step", text: "正在生成设计方向，AI 思考中…" });

      let fullText = "";
      for await (const chunk of gatewayTextStream(selectedModelRoute, {
        scene: "design_plan",
        prompt,
        systemPrompt: SYSTEM_PROMPT,
      }, streamJobId)) {
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
          const confirmedPlans = await db.select({ directionId: designPlanVersions.selectedDirectionId })
            .from(designPlanVersions)
            .where(and(
              eq(designPlanVersions.generationTaskId, taskId),
              isNotNull(designPlanVersions.confirmedAt),
            ));
          const protectedIds = new Set(confirmedPlans.map((plan) => plan.directionId));
          const staleDirections = await db.select({ id: designDirections.id }).from(designDirections)
            .where(eq(designDirections.generationTaskId, taskId));
          for (const stale of staleDirections) {
            if (!protectedIds.has(stale.id)) {
              await db.delete(designDirections).where(eq(designDirections.id, stale.id));
            }
          }
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
          await db.update(generationTasks).set({ draftSelectedDirectionId: null, updatedAt: now })
            .where(eq(generationTasks.id, taskId));
        }
      } catch {
        if (streamJobId) await db.update(backgroundJobs).set({
          status: "failed", errorType: "invalid_response",
          errorMessage: "设计方向解析失败，模型返回格式错误", finishedAt: new Date(),
        }).where(eq(backgroundJobs.id, streamJobId));
        await emit({ type: "error", message: "设计方向解析失败，模型返回格式错误，请重试" });
        return;
      }

      if (directions.length === 0) {
        if (streamJobId) await db.update(backgroundJobs).set({
          status: "failed", errorType: "invalid_response",
          errorMessage: "未能解析到方向数据", finishedAt: new Date(),
        }).where(eq(backgroundJobs.id, streamJobId));
        await emit({ type: "error", message: "设计方向生成失败，未能解析到方向数据，请重试" });
        return;
      }

      if (streamJobId) await db.update(backgroundJobs).set({ status: "succeeded", finishedAt: new Date() })
        .where(eq(backgroundJobs.id, streamJobId));
      await emit({ type: "done" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (streamJobId) await db.update(backgroundJobs).set({
        status: "failed", errorType: "unknown", errorMessage: message, finishedAt: new Date(),
      }).where(eq(backgroundJobs.id, streamJobId));
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message }), event: "message" });
    }
  });
});

// POST /api/tasks/:taskId/generate-directions — enqueue design_plan job (kept for backward-compat)
tasksRouter.post("/:taskId/generate-directions", async (c) => {
  const taskId = c.req.param("taskId");
  const body: { modelRouteId?: string; productAnalysisRouteId?: string } = await c.req.json<{ modelRouteId?: string; productAnalysisRouteId?: string }>().catch(() => ({}));
  const [task] = await db.select().from(generationTasks).where(eq(generationTasks.id, taskId));
  if (!task) return c.json({ error: "Not found" }, 404);

  const modelRoute = await snapshotSelectedModelRoute("design_plan", body.modelRouteId);
  const productAnalysisRoute = await snapshotSelectedModelRoute("competitor_image_analysis", body.productAnalysisRouteId);
  const jobId = await enqueueJob({
    type: "design_plan",
    entityType: "generation_task",
    entityId: taskId,
    inputSnapshot: {
      taskId,
      productId: task.productId,
      ...(modelRoute ? { modelRoute } : {}),
      ...(productAnalysisRoute ? { productAnalysisRoute } : {}),
    },
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
    .set({ currentStep: 3, draftSelectedDirectionId: body.directionId, updatedAt: new Date() })
    .where(eq(generationTasks.id, taskId));

  return c.json({ ok: true });
});

async function directionIsConfirmed(directionId: string): Promise<boolean> {
  const [confirmed] = await db.select({ id: designPlanVersions.id })
    .from(designPlanVersions)
    .where(and(
      eq(designPlanVersions.selectedDirectionId, directionId),
      isNotNull(designPlanVersions.confirmedAt),
    ))
    .limit(1);
  return Boolean(confirmed);
}

function parseDirectionProposal(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const proposal = value as Record<string, unknown>;
  const requiredDirectionFields = [
    "label", "positioning", "colorScheme", "layoutIntent", "copyStrategy",
  ];
  if (!requiredDirectionFields.every((field) => typeof proposal[field] === "string")) return null;
  if (!Array.isArray(proposal["imageList"]) || proposal["imageList"].length === 0) return null;

  const requiredImageStringFields = [
    "title", "description", "suggestedCopy", "compositionIntent", "lighting",
    "angle", "background", "mood", "visualElements",
  ];
  for (const rawItem of proposal["imageList"]) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return null;
    const item = rawItem as Record<string, unknown>;
    if (item["listType"] !== "main_image" && item["listType"] !== "detail_page") return null;
    if (!requiredImageStringFields.every((field) => typeof item[field] === "string")) return null;
    if (!Array.isArray(item["sellingPoints"]) || !item["sellingPoints"].every((point) => typeof point === "string")) return null;
    if (!("productAssetId" in item) || (item["productAssetId"] !== null && typeof item["productAssetId"] !== "string")) return null;
  }
  return proposal;
}

// POST /api/tasks/directions/:directionId/polish — return a proposal only.
tasksRouter.post("/directions/:directionId/polish", async (c) => {
  const directionId = c.req.param("directionId");
  const [direction] = await db.select().from(designDirections)
    .where(eq(designDirections.id, directionId));
  if (!direction) return c.json({ error: "方向不存在" }, 404);
  if (await directionIsConfirmed(directionId)) {
    return c.json({ error: "该方向已被确认方案引用，不能修改" }, 409);
  }
  const body = await c.req.json<{ instruction: string; modelRouteId?: string }>();
  let instruction: string;
  try {
    instruction = validatePolishInstruction(body.instruction ?? "");
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
  if (!instruction) return c.json({ error: "请输入润色意见" }, 400);
  try {
    const { gatewayCall } = await import("../gateway/index.js");
    const response = await gatewayCall(body.modelRouteId ? await resolveModelRoute("design_plan", body.modelRouteId) : await resolveDefaultModelRoute("design_plan"), {
      scene: "design_plan",
      systemPrompt: "你是电商视觉方案编辑。按用户意见修改方向，返回更新后的完整严格 JSON，不要输出 Markdown 或解释。必须保留 label、positioning、colorScheme、layoutIntent、copyStrategy、imageList 以及 imageList 内的全部字段。",
      prompt: `【当前方向】\n${direction.content}\n\n【修改意见】\n${instruction}`,
    });
    const match = response.text?.match(/\{[\s\S]*\}/);
    const proposal = parseDirectionProposal(JSON.parse(match?.[0] ?? response.text ?? ""));
    if (!proposal) return c.json({ error: "模型返回的方向结构不完整" }, 502);
    return c.json({ proposal });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

// PATCH /api/tasks/directions/:directionId — confirm and persist a proposal.
tasksRouter.patch("/directions/:directionId", async (c) => {
  const directionId = c.req.param("directionId");
  const [direction] = await db.select().from(designDirections)
    .where(eq(designDirections.id, directionId));
  if (!direction) return c.json({ error: "方向不存在" }, 404);
  if (await directionIsConfirmed(directionId)) {
    return c.json({ error: "该方向已被确认方案引用，不能修改" }, 409);
  }
  const body = await c.req.json<{ proposal: unknown }>();
  const proposal = parseDirectionProposal(body.proposal);
  if (!proposal) return c.json({ error: "方向提案结构不完整" }, 400);
  await db.update(designDirections).set({
    label: String(proposal["label"]),
    content: JSON.stringify(proposal),
  }).where(eq(designDirections.id, directionId));
  const [updated] = await db.select().from(designDirections)
    .where(eq(designDirections.id, directionId));
  return c.json(updated);
});

// POST /api/tasks/directions/:directionId/chat — chat with a design direction to refine it
tasksRouter.post("/directions/:directionId/chat", async (c) => {
  const directionId = c.req.param("directionId");
  const body = await c.req.json<{
    message: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    modelRouteId?: string;
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
    const result = await gatewayCall(body.modelRouteId ? await resolveModelRoute("design_plan", body.modelRouteId) : await resolveDefaultModelRoute("design_plan"), {
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
    imageTemplateId?: string | null;
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
      visualElements?: unknown;
      productAssetId?: string | null;
      presetId: string;
      promptTemplateId?: string | null;
    }>;
  }>();

  const [selectedDirection] = await db.select().from(designDirections)
    .where(eq(designDirections.id, body.directionId));
  if (!selectedDirection || selectedDirection.generationTaskId !== taskId) {
    return c.json({ error: "所选方向不存在或不属于当前任务" }, 400);
  }
  if (body.imageTemplateId) {
    const [template] = await db.select().from(promptTemplates)
      .where(eq(promptTemplates.id, body.imageTemplateId));
    if (!template || template.type !== "image_generation" || template.archivedAt) {
      return c.json({ error: "图片默认模板无效" }, 400);
    }
  }

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
      visualElements: textOrJsonArray(item.visualElements),
      productAssetId: item.productAssetId ?? null,
      referenceAssetIds: null,
      promptTemplateId: item.promptTemplateId ?? null,
      outputPresetSnapshot: presetSnapshot,
      createdAt: now,
      updatedAt: now,
    });
  }

  await db
    .update(generationTasks)
    .set({
      currentStep: 4,
      draftSelectedDirectionId: body.directionId,
      ...(body.imageTemplateId !== undefined ? { imageDefaultTemplateId: body.imageTemplateId } : {}),
      updatedAt: now,
    })
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
  const body = await c.req.json<{ planVersionId: string; modelRouteId?: string }>();

  const items = await db
    .select()
    .from(imageItems)
    .where(eq(imageItems.designPlanVersionId, body.planVersionId))
    .orderBy(imageItems.listType, imageItems.sortOrder);

  if (items.length === 0) return c.json({ error: "No items in plan" }, 422);

  const active = await db.select({ entityId: backgroundJobs.entityId }).from(backgroundJobs).where(and(
    eq(backgroundJobs.entityType, "image_item"),
    inArray(backgroundJobs.entityId, items.map((item) => item.id)),
    inArray(backgroundJobs.status, ["queued", "running"]),
  ));
  if (active.length > 0) return c.json({ error: "部分图片已有正在进行的生成任务" }, 409);

  // Render every prompt before enqueueing anything. Promise rejection leaves the
  // batch untouched, which prevents partially queued batches.
  let frozen: Array<Awaited<ReturnType<typeof renderImageGenerationPromptSnapshot>>>;
  try {
    frozen = await Promise.all(items.map((item) =>
      renderImageGenerationPromptSnapshot({ imageItemId: item.id })
    ));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 422);
  }

  const existingVersions = await db.select({ itemId: imageVersions.imageItemId })
    .from(imageVersions)
    .where(inArray(imageVersions.imageItemId, items.map((item) => item.id)));
  const itemsWithVersions = new Set(existingVersions.map((version) => version.itemId));

  const jobIds: string[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    const snapshot = frozen[index]!;
    const jobId = await enqueueJob({
      type: "image_generation",
      entityType: "image_item",
      entityId: item.id,
      inputSnapshot: {
        imageItemId: item.id,
        planVersionId: body.planVersionId,
        finalPrompt: snapshot.finalPrompt,
        promptTemplateId: snapshot.templateId,
        polishInstruction: null,
        width: snapshot.width,
        height: snapshot.height,
        generationType: itemsWithVersions.has(item.id) ? "regeneration" : "initial",
        modelRoute: await snapshotSelectedModelRoute("image_generation", body.modelRouteId),
      },
    });
    jobIds.push(jobId);
  }

  await db
    .update(generationTasks)
    .set({ currentStep: 4, updatedAt: new Date() })
    .where(eq(generationTasks.id, taskId));

  return c.json({ jobIds }, 201);
});
