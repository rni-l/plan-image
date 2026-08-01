import { Hono } from "hono";
import { db } from "../db/index.js";
import { modelCallLogs, modelPricing } from "../db/schema.js";
import { desc, sql, eq, and, gte, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export const billingRouter = new Hono();

// ---------------------------------------------------------------------------
// GET /api/billing/summary
// Returns aggregate totals: calls, tokens, estimated cost
// ---------------------------------------------------------------------------
billingRouter.get("/summary", async (c) => {
  const from = c.req.query("from");
  const to   = c.req.query("to");

  const filters = [];
  if (from) filters.push(gte(modelCallLogs.createdAt, new Date(from)));
  if (to)   filters.push(lte(modelCallLogs.createdAt, new Date(to)));
  const where = filters.length ? and(...filters) : undefined;

  const [agg] = await db
    .select({
      totalCalls:        sql<number>`count(*)`,
      succeededCalls:    sql<number>`sum(case when ${modelCallLogs.status} = 'succeeded' then 1 else 0 end)`,
      failedCalls:       sql<number>`sum(case when ${modelCallLogs.status} = 'failed'    then 1 else 0 end)`,
      totalPromptTokens: sql<number>`coalesce(sum(${modelCallLogs.promptTokens}), 0)`,
      totalCompTokens:   sql<number>`coalesce(sum(${modelCallLogs.completionTokens}), 0)`,
      totalTokens:       sql<number>`coalesce(sum(${modelCallLogs.totalTokens}), 0)`,
    })
    .from(modelCallLogs)
    .where(where);

  // Compute estimated cost via joined pricing
  const costRows = await db
    .select({
      promptTokens:          sql<number>`coalesce(sum(l.prompt_tokens), 0)`,
      completionTokens:      sql<number>`coalesce(sum(l.completion_tokens), 0)`,
      pricePerMInput:        modelPricing.pricePerMInputTokens,
      pricePerMOutput:       modelPricing.pricePerMOutputTokens,
    })
    .from(modelCallLogs)
    .leftJoin(
      modelPricing,
      and(
        eq(modelPricing.provider, modelCallLogs.provider),
        eq(modelPricing.modelId,  modelCallLogs.model)
      )
    )
    .where(where)
    .groupBy(modelCallLogs.provider, modelCallLogs.model);

    const estimatedCostUsd = costRows.reduce((sum, r) => {
    if (r.pricePerMInput == null) return sum;
    return (
      sum +
      (r.promptTokens     / 1_000_000) * r.pricePerMInput +
      (r.completionTokens / 1_000_000) * (r.pricePerMOutput ?? 0)
    );
  }, 0);

  return c.json({ ...agg, estimatedCostUsd });
});

// ---------------------------------------------------------------------------
// GET /api/billing/by-model
// Returns per-provider+model breakdown
// ---------------------------------------------------------------------------
billingRouter.get("/by-model", async (c) => {
  const from = c.req.query("from");
  const to   = c.req.query("to");

  const filters = [];
  if (from) filters.push(gte(modelCallLogs.createdAt, new Date(from)));
  if (to)   filters.push(lte(modelCallLogs.createdAt, new Date(to)));
  const where = filters.length ? and(...filters) : undefined;

  const rows = await db
    .select({
      provider:            modelCallLogs.provider,
      model:               modelCallLogs.model,
      totalCalls:          sql<number>`count(*)`,
      succeededCalls:      sql<number>`sum(case when ${modelCallLogs.status} = 'succeeded' then 1 else 0 end)`,
      failedCalls:         sql<number>`sum(case when ${modelCallLogs.status} = 'failed'    then 1 else 0 end)`,
      promptTokens:        sql<number>`coalesce(sum(${modelCallLogs.promptTokens}), 0)`,
      completionTokens:    sql<number>`coalesce(sum(${modelCallLogs.completionTokens}), 0)`,
      totalTokens:         sql<number>`coalesce(sum(${modelCallLogs.totalTokens}), 0)`,
      avgDurationMs:       sql<number>`avg(${modelCallLogs.durationMs})`,
      pricePerMInput:      modelPricing.pricePerMInputTokens,
      pricePerMOutput:     modelPricing.pricePerMOutputTokens,
    })
    .from(modelCallLogs)
    .leftJoin(
      modelPricing,
      and(
        eq(modelPricing.provider, modelCallLogs.provider),
        eq(modelPricing.modelId,  modelCallLogs.model)
      )
    )
    .where(where)
    .groupBy(modelCallLogs.provider, modelCallLogs.model)
    .orderBy(desc(sql`count(*)`));

  const data = rows.map((r) => ({
    ...r,
    estimatedCostUsd:
      r.pricePerMInput != null
        ? (r.promptTokens     / 1_000_000) * r.pricePerMInput +
          (r.completionTokens / 1_000_000) * (r.pricePerMOutput ?? 0)
        : null,
  }));

  return c.json({ data });
});

// ---------------------------------------------------------------------------
// GET /api/billing/pricing  — list all pricing config
// ---------------------------------------------------------------------------
billingRouter.get("/pricing", async (c) => {
  const rows = await db
    .select()
    .from(modelPricing)
    .orderBy(modelPricing.provider, modelPricing.modelId);
  return c.json({ data: rows });
});

// ---------------------------------------------------------------------------
// PUT /api/billing/pricing/:provider/:modelId  — upsert a pricing record
// Body: { pricePerMInputTokens, pricePerMOutputTokens, isImageModel, pricePerImage }
// ---------------------------------------------------------------------------
billingRouter.put("/pricing/:provider/:modelId", async (c) => {
  const { provider, modelId } = c.req.param();
  const body = (await c.req.json()) as {
    pricePerMInputTokens?: number;
    pricePerMOutputTokens?: number;
    isImageModel?: boolean;
    pricePerImage?: number;
  };

  const now = new Date();

  // Try update first, then insert
  const existing = await db
    .select({ id: modelPricing.id })
    .from(modelPricing)
    .where(and(eq(modelPricing.provider, provider), eq(modelPricing.modelId, modelId)));

  if (existing.length > 0) {
    await db
      .update(modelPricing)
      .set({
        pricePerMInputTokens:  body.pricePerMInputTokens  ?? 0,
        pricePerMOutputTokens: body.pricePerMOutputTokens ?? 0,
        isImageModel:          body.isImageModel          ?? false,
        pricePerImage:         body.pricePerImage         ?? 0,
        updatedAt: now,
      })
      .where(and(eq(modelPricing.provider, provider), eq(modelPricing.modelId, modelId)));
  } else {
    await db.insert(modelPricing).values({
      id: randomUUID(),
      provider,
      modelId,
      pricePerMInputTokens:  body.pricePerMInputTokens  ?? 0,
      pricePerMOutputTokens: body.pricePerMOutputTokens ?? 0,
      isImageModel:          body.isImageModel          ?? false,
      pricePerImage:         body.pricePerImage         ?? 0,
      updatedAt: now,
    });
  }

  const [row] = await db
    .select()
    .from(modelPricing)
    .where(and(eq(modelPricing.provider, provider), eq(modelPricing.modelId, modelId)));

  return c.json(row);
});

// ---------------------------------------------------------------------------
// DELETE /api/billing/pricing/:provider/:modelId
// ---------------------------------------------------------------------------
billingRouter.delete("/pricing/:provider/:modelId", async (c) => {
  const { provider, modelId } = c.req.param();
  await db
    .delete(modelPricing)
    .where(and(eq(modelPricing.provider, provider), eq(modelPricing.modelId, modelId)));
  return c.json({ ok: true });
});
