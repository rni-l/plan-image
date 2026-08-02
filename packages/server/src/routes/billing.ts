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
      promptTokens:       sql<number>`coalesce(sum(${modelCallLogs.promptTokens}), 0)`,
      completionTokens:   sql<number>`coalesce(sum(${modelCallLogs.completionTokens}), 0)`,
      // output_image_count is NULL on records logged before this column existed;
      // we also carry succeededCalls so we can fall back for those legacy rows.
      succeededCalls:     sql<number>`sum(case when ${modelCallLogs.status} = 'succeeded' then 1 else 0 end)`,
      outputImageCount:   sql<number>`coalesce(sum(${modelCallLogs.outputImageCount}), 0)`,
      inputImageCount:    sql<number>`coalesce(sum(${modelCallLogs.inputImageCount}), 0)`,
      isImageModel:       modelPricing.isImageModel,
      pricePerMInput:     modelPricing.pricePerMInputTokens,
      pricePerMOutput:    modelPricing.pricePerMOutputTokens,
      pricePerImage:      modelPricing.pricePerImage,
      pricePerInputImage: modelPricing.pricePerInputImage,
      currency:           modelPricing.currency,
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

  // Accumulate costs per currency, branching on billing model type
  let estimatedCostUsd = 0;
  let estimatedCostCny = 0;
  for (const r of costRows) {
    if (r.currency == null) continue; // no pricing record for this model
    let cost: number;
    if (r.isImageModel) {
      // For legacy log rows (before output_image_count column), the sum is 0.
      // Fall back to succeeded-call count — each successful image call produces 1 image.
      const effectiveOut = r.outputImageCount > 0 ? r.outputImageCount : r.succeededCalls;
      cost = effectiveOut           * (r.pricePerImage      ?? 0)
           + r.inputImageCount      * (r.pricePerInputImage ?? 0);
    } else {
      cost = (r.promptTokens     / 1_000_000) * (r.pricePerMInput  ?? 0)
           + (r.completionTokens / 1_000_000) * (r.pricePerMOutput ?? 0);
    }
    if (r.currency === "CNY") estimatedCostCny += cost;
    else                      estimatedCostUsd += cost;
  }

  return c.json({ ...agg, estimatedCostUsd, estimatedCostCny });
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
      outputImageCount:    sql<number>`coalesce(sum(${modelCallLogs.outputImageCount}), 0)`,
      inputImageCount:     sql<number>`coalesce(sum(${modelCallLogs.inputImageCount}), 0)`,
      avgDurationMs:       sql<number>`avg(${modelCallLogs.durationMs})`,
      isImageModel:        modelPricing.isImageModel,
      pricePerMInput:      modelPricing.pricePerMInputTokens,
      pricePerMOutput:     modelPricing.pricePerMOutputTokens,
      pricePerImage:       modelPricing.pricePerImage,
      pricePerInputImage:  modelPricing.pricePerInputImage,
      currency:            modelPricing.currency,
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

  const data = rows.map((r) => {
    if (r.currency == null) return { ...r, estimatedCost: null, currency: null };
    const effectiveOut = r.isImageModel && r.outputImageCount === 0
      ? r.succeededCalls
      : r.outputImageCount;
    const cost = r.isImageModel
      ? effectiveOut           * (r.pricePerImage      ?? 0)
      + r.inputImageCount      * (r.pricePerInputImage ?? 0)
      : (r.promptTokens     / 1_000_000) * (r.pricePerMInput  ?? 0)
      + (r.completionTokens / 1_000_000) * (r.pricePerMOutput ?? 0);
    return { ...r, estimatedCost: cost };
  });

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
    currency?: string;
    pricePerMInputTokens?: number;
    pricePerMCachedInputTokens?: number;
    pricePerMOutputTokens?: number;
    isImageModel?: boolean;
    pricePerImage?: number;
    pricePerInputImage?: number;
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
        currency:                     body.currency                     ?? "USD",
        pricePerMInputTokens:         body.pricePerMInputTokens         ?? 0,
        pricePerMCachedInputTokens:   body.pricePerMCachedInputTokens   ?? 0,
        pricePerMOutputTokens:        body.pricePerMOutputTokens        ?? 0,
        isImageModel:                 body.isImageModel                 ?? false,
        pricePerImage:                body.pricePerImage                ?? 0,
        pricePerInputImage:           body.pricePerInputImage           ?? 0,
        updatedAt: now,
      })
      .where(and(eq(modelPricing.provider, provider), eq(modelPricing.modelId, modelId)));
  } else {
    await db.insert(modelPricing).values({
      id: randomUUID(),
      provider,
      modelId,
      currency:                     body.currency                     ?? "USD",
      pricePerMInputTokens:         body.pricePerMInputTokens         ?? 0,
      pricePerMCachedInputTokens:   body.pricePerMCachedInputTokens   ?? 0,
      pricePerMOutputTokens:        body.pricePerMOutputTokens        ?? 0,
      isImageModel:                 body.isImageModel                 ?? false,
      pricePerImage:                body.pricePerImage                ?? 0,
      pricePerInputImage:           body.pricePerInputImage           ?? 0,
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
