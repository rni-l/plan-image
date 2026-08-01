import { Hono } from "hono";
import { db } from "../db/index.js";
import {
  generationTasks,
  designDirections,
  designPlanVersions,
  imageItems,
  imageVersions,
} from "../db/schema.js";
import { eq, desc } from "drizzle-orm";

export const tasksRouter = new Hono();

// GET /api/tasks/:taskId — task with directions + active plan version
tasksRouter.get("/:taskId", async (c) => {
  const taskId = c.req.param("taskId");

  const [task] = await db
    .select()
    .from(generationTasks)
    .where(eq(generationTasks.id, taskId));
  if (!task) return c.json({ error: "Not found" }, 404);

  const [directions, planVersions] = await Promise.all([
    db
      .select()
      .from(designDirections)
      .where(eq(designDirections.generationTaskId, taskId)),
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

// PATCH /api/tasks/:taskId/step — persist current wizard step
tasksRouter.patch("/:taskId/step", async (c) => {
  const taskId = c.req.param("taskId");
  const body = await c.req.json<{ step: number }>();

  if (body.step < 1 || body.step > 4) {
    return c.json({ error: "Invalid step" }, 400);
  }

  await db
    .update(generationTasks)
    .set({ currentStep: body.step, updatedAt: new Date() })
    .where(eq(generationTasks.id, taskId));

  return c.body(null, 204);
});
