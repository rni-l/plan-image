import { Hono } from "hono";
import { db } from "../db/index.js";
import {
  analysisVersions,
  competitorAssets,
  imageAnalysisCards,
  synthesisReports,
} from "../db/schema.js";
import { eq, desc, max } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { enqueueJob } from "../jobs/worker.js";

export const researchRouter = new Hono();

// GET /api/research/:productId/assets
researchRouter.get("/:productId/assets", async (c) => {
  const productId = c.req.param("productId");
  const rows = await db
    .select()
    .from(competitorAssets)
    .where(eq(competitorAssets.productId, productId))
    .orderBy(competitorAssets.createdAt);
  return c.json(rows);
});

// GET /api/research/:productId/versions
researchRouter.get("/:productId/versions", async (c) => {
  const productId = c.req.param("productId");
  const rows = await db
    .select()
    .from(analysisVersions)
    .where(eq(analysisVersions.productId, productId))
    .orderBy(desc(analysisVersions.versionNumber));
  return c.json(rows);
});

// POST /api/research/:productId/analyze
// Creates a new analysis version and enqueues one job per competitor asset
researchRouter.post("/:productId/analyze", async (c) => {
  const productId = c.req.param("productId");

  const assets = await db
    .select()
    .from(competitorAssets)
    .where(eq(competitorAssets.productId, productId))
    .orderBy(competitorAssets.createdAt);

  if (assets.length === 0) {
    return c.json({ error: "请先上传竞品素材" }, 422);
  }

  // Next version number
  const [{ maxVer }] = await db
    .select({ maxVer: max(analysisVersions.versionNumber) })
    .from(analysisVersions)
    .where(eq(analysisVersions.productId, productId));

  const versionNumber = (maxVer ?? 0) + 1;
  const versionId = randomUUID();
  const now = new Date();

  await db.insert(analysisVersions).values({
    id: versionId,
    productId,
    versionNumber,
    competitorAssetIds: JSON.stringify(assets.map((a) => a.id)),
    createdAt: now,
  });

  // Create one card + one job per asset
  const jobIds: string[] = [];
  for (const asset of assets) {
    const cardId = randomUUID();
    await db.insert(imageAnalysisCards).values({
      id: cardId,
      analysisVersionId: versionId,
      competitorAssetId: asset.id,
      modelOutput: "{}",
      humanOverride: null,
      createdAt: now,
      updatedAt: now,
    });

    const jobId = await enqueueJob({
      type: "competitor_image_analysis",
      entityType: "analysis_version",
      entityId: versionId,
      inputSnapshot: {
        productId,
        analysisVersionId: versionId,
        competitorAssetId: asset.id,
        cardId,
      },
    });
    jobIds.push(jobId);
  }

  const version = await db
    .select()
    .from(analysisVersions)
    .where(eq(analysisVersions.id, versionId));

  return c.json({ version: version[0], jobIds }, 201);
});

// POST /api/research/versions/:versionId/synthesize
researchRouter.post("/versions/:versionId/synthesize", async (c) => {
  const versionId = c.req.param("versionId");

  const [version] = await db
    .select()
    .from(analysisVersions)
    .where(eq(analysisVersions.id, versionId));
  if (!version) return c.json({ error: "Not found" }, 404);

  const jobId = await enqueueJob({
    type: "competitor_synthesis",
    entityType: "analysis_version",
    entityId: versionId,
    inputSnapshot: {
      productId: version.productId,
      analysisVersionId: versionId,
    },
  });

  return c.json({ jobId }, 201);
});

// GET /api/research/versions/:versionId — version detail with cards + report
researchRouter.get("/versions/:versionId", async (c) => {
  const versionId = c.req.param("versionId");

  const [version] = await db
    .select()
    .from(analysisVersions)
    .where(eq(analysisVersions.id, versionId));
  if (!version) return c.json({ error: "Not found" }, 404);

  const [cards, [report]] = await Promise.all([
    db
      .select()
      .from(imageAnalysisCards)
      .where(eq(imageAnalysisCards.analysisVersionId, versionId)),
    db
      .select()
      .from(synthesisReports)
      .where(eq(synthesisReports.analysisVersionId, versionId)),
  ]);

  return c.json({ ...version, cards, report: report ?? null });
});

// PATCH /api/research/cards/:cardId — save human override
researchRouter.patch("/cards/:cardId", async (c) => {
  const cardId = c.req.param("cardId");
  const body = await c.req.json<{ humanOverride: unknown }>();

  await db
    .update(imageAnalysisCards)
    .set({
      humanOverride: JSON.stringify(body.humanOverride),
      updatedAt: new Date(),
    })
    .where(eq(imageAnalysisCards.id, cardId));

  const [row] = await db
    .select()
    .from(imageAnalysisCards)
    .where(eq(imageAnalysisCards.id, cardId));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// GET /api/research/:productId/versions
researchRouter.get("/:productId/versions", async (c) => {
  const productId = c.req.param("productId");
  const rows = await db
    .select()
    .from(analysisVersions)
    .where(eq(analysisVersions.productId, productId))
    .orderBy(desc(analysisVersions.versionNumber));
  return c.json(rows);
});

// GET /api/research/versions/:versionId — version detail with cards + report
researchRouter.get("/versions/:versionId", async (c) => {
  const versionId = c.req.param("versionId");

  const [version] = await db
    .select()
    .from(analysisVersions)
    .where(eq(analysisVersions.id, versionId));
  if (!version) return c.json({ error: "Not found" }, 404);

  const [cards, [report]] = await Promise.all([
    db
      .select()
      .from(imageAnalysisCards)
      .where(eq(imageAnalysisCards.analysisVersionId, versionId)),
    db
      .select()
      .from(synthesisReports)
      .where(eq(synthesisReports.analysisVersionId, versionId)),
  ]);

  return c.json({ ...version, cards, report: report ?? null });
});

// PATCH /api/research/cards/:cardId — save human override
researchRouter.patch("/cards/:cardId", async (c) => {
  const cardId = c.req.param("cardId");
  const body = await c.req.json<{ humanOverride: unknown }>();

  await db
    .update(imageAnalysisCards)
    .set({
      humanOverride: JSON.stringify(body.humanOverride),
      updatedAt: new Date(),
    })
    .where(eq(imageAnalysisCards.id, cardId));

  const [row] = await db
    .select()
    .from(imageAnalysisCards)
    .where(eq(imageAnalysisCards.id, cardId));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});
