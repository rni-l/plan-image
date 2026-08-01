import { Hono } from "hono";
import { db } from "../db/index.js";
import {
  generationTasks,
  designDirections,
  designPlanVersions,
  imageItems,
  imageVersions,
  outputPresets,
} from "../db/schema.js";
import { eq, desc, max } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { enqueueJob } from "../jobs/worker.js";

export const tasksRouter = new Hono();

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
