import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Hono } from "hono";
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

// POST /api/tasks/:taskId/generate-directions — enqueue design_plan job
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

// POST /api/tasks/:taskId/plan — commit plan version + image items
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
