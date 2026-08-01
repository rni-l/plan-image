import { Hono } from "hono";
import { db } from "../db/index.js";
import { backgroundJobs } from "../db/schema.js";
import { eq, desc, inArray } from "drizzle-orm";

export const jobsRouter = new Hono();

// GET /api/jobs/:id
jobsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const [row] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// GET /api/jobs?entityType=image_item&entityId=xxx
jobsRouter.get("/", async (c) => {
  const entityType = c.req.query("entityType");
  const entityId = c.req.query("entityId");

  const rows = await db
    .select()
    .from(backgroundJobs)
    .where(
      entityType && entityId
        ? inArray(backgroundJobs.entityId, [entityId])
        : undefined
    )
    .orderBy(desc(backgroundJobs.createdAt))
    .limit(100);

  return c.json(rows);
});

// POST /api/jobs/:id/cancel
jobsRouter.post("/:id/cancel", async (c) => {
  const id = c.req.param("id");
  const [job] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id));
  if (!job) return c.json({ error: "Not found" }, 404);

  if (job.status !== "queued" && job.status !== "running") {
    return c.json({ error: "Job is not cancellable" }, 409);
  }

  await db
    .update(backgroundJobs)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(eq(backgroundJobs.id, id));

  return c.body(null, 204);
});
