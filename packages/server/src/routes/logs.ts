import { Hono } from "hono";
import { db } from "../db/index.js";
import { apiRequestLogs, modelCallLogs } from "../db/schema.js";
import { desc, sql, and, gte, lte, eq } from "drizzle-orm";

export const logsRouter = new Hono();

// ---------------------------------------------------------------------------
// GET /api/logs/api-requests
// Query params: page (1-based), limit, method, status (2xx/4xx/5xx), from, to
// ---------------------------------------------------------------------------
logsRouter.get("/api-requests", async (c) => {
  const page  = Math.max(1, Number(c.req.query("page")  ?? 1));
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const offset = (page - 1) * limit;
  const method = c.req.query("method")?.toUpperCase();
  const statusBucket = c.req.query("status"); // "2xx" | "4xx" | "5xx"
  const from = c.req.query("from"); // ISO string
  const to   = c.req.query("to");

  const filters = [];
  if (method) filters.push(eq(apiRequestLogs.method, method));
  if (from)   filters.push(gte(apiRequestLogs.createdAt, new Date(from)));
  if (to)     filters.push(lte(apiRequestLogs.createdAt, new Date(to)));
  if (statusBucket === "2xx") filters.push(sql`${apiRequestLogs.statusCode} >= 200 AND ${apiRequestLogs.statusCode} < 300`);
  if (statusBucket === "4xx") filters.push(sql`${apiRequestLogs.statusCode} >= 400 AND ${apiRequestLogs.statusCode} < 500`);
  if (statusBucket === "5xx") filters.push(sql`${apiRequestLogs.statusCode} >= 500`);

  const where = filters.length ? and(...filters) : undefined;

  const [rows, countResult] = await Promise.all([
    db.select().from(apiRequestLogs)
      .where(where)
      .orderBy(desc(apiRequestLogs.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(apiRequestLogs).where(where),
  ]);

  return c.json({ data: rows, total: countResult[0]?.count ?? 0, page, limit });
});

// ---------------------------------------------------------------------------
// GET /api/logs/llm-calls
// Query params: page, limit, provider, scene, status (succeeded|failed), from, to
// ---------------------------------------------------------------------------
logsRouter.get("/llm-calls", async (c) => {
  const page  = Math.max(1, Number(c.req.query("page")  ?? 1));
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const offset = (page - 1) * limit;
  const provider = c.req.query("provider");
  const scene    = c.req.query("scene");
  const status   = c.req.query("status"); // "succeeded" | "failed"
  const from = c.req.query("from");
  const to   = c.req.query("to");

  const filters = [];
  if (provider) filters.push(eq(modelCallLogs.provider, provider));
  if (scene)    filters.push(eq(modelCallLogs.scene, scene));
  if (status)   filters.push(eq(modelCallLogs.status, status));
  if (from)     filters.push(gte(modelCallLogs.createdAt, new Date(from)));
  if (to)       filters.push(lte(modelCallLogs.createdAt, new Date(to)));

  const where = filters.length ? and(...filters) : undefined;

  const [rows, countResult] = await Promise.all([
    db.select().from(modelCallLogs)
      .where(where)
      .orderBy(desc(modelCallLogs.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(modelCallLogs).where(where),
  ]);

  return c.json({ data: rows, total: countResult[0]?.count ?? 0, page, limit });
});
