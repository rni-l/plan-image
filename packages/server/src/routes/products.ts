import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  products,
  productAssets,
  productSpecifications,
  sellingPoints,
  competitorAssets,
} from "../db/schema.js";
import { eq, isNull, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { saveImageAsset, UploadError } from "../lib/storage.js";
import { gatewayCall } from "../gateway/index.js";

export const productsRouter = new Hono();

// GET /api/products — list non-archived products
productsRouter.get("/", async (c) => {
  const rows = await db
    .select()
    .from(products)
    .where(isNull(products.archivedAt))
    .orderBy(desc(products.updatedAt));
  return c.json(rows);
});

// POST /api/products — create product
const createSchema = z.object({
  name: z.string().min(1).max(200),
  notes: z.string().optional(),
});

productsRouter.post("/", zValidator("json", createSchema), async (c) => {
  const body = c.req.valid("json");
  const now = new Date();
  const id = randomUUID();

  await db.insert(products).values({
    id,
    name: body.name,
    notes: body.notes ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const [row] = await db.select().from(products).where(eq(products.id, id));
  return c.json(row, 201);
});

// GET /api/products/assets/file?path= — must be before /:id to avoid route conflict
productsRouter.get("/assets/file", async (c) => {
  const rel = c.req.query("path");
  if (!rel) return c.json({ error: "Missing path" }, 400);

  const normalized = rel.replace(/\\/g, "/");
  if (!normalized.startsWith("assets/") && !normalized.startsWith("exports/")) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const { assetPath } = await import("../lib/paths.js");
  const abs = assetPath(normalized);

  try {
    const buf = await fs.promises.readFile(abs);
    const ext = abs.split(".").pop()?.toLowerCase() ?? "jpg";
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return new Response(buf, {
      headers: { "Content-Type": mime, "Cache-Control": "private, max-age=31536000" },
    });
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});

// GET /api/products/:id — single product with assets + specs + selling points
productsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");

  const [product] = await db.select().from(products).where(eq(products.id, id));
  if (!product) return c.json({ error: "Not found" }, 404);

  const [assets, specs, points] = await Promise.all([
    db.select().from(productAssets).where(eq(productAssets.productId, id)).orderBy(productAssets.sortOrder),
    db.select().from(productSpecifications).where(eq(productSpecifications.productId, id)).orderBy(productSpecifications.sortOrder),
    db.select().from(sellingPoints).where(eq(sellingPoints.productId, id)).orderBy(sellingPoints.sortOrder),
  ]);

  return c.json({ ...product, assets, specifications: specs, sellingPoints: points });
});

// PATCH /api/products/:id
const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  notes: z.string().optional(),
});

productsRouter.patch("/:id", zValidator("json", updateSchema), async (c) => {
  const id = c.req.param("id");
  const body = c.req.valid("json");

  await db
    .update(products)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(products.id, id));

  const [row] = await db.select().from(products).where(eq(products.id, id));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// DELETE /api/products/:id — archive (soft delete)
productsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await db
    .update(products)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(products.id, id));
  return c.body(null, 204);
});

// PUT /api/products/:id/specs — replace all specs atomically
productsRouter.put("/:id/specs", async (c) => {
  const productId = c.req.param("id");
  const body = await c.req.json<{ specs: Array<{ label: string; value: string }> }>();

  // better-sqlite3 is synchronous — transaction callback must be sync too
  db.transaction((tx) => {
    tx.delete(productSpecifications).where(eq(productSpecifications.productId, productId));
    for (let i = 0; i < body.specs.length; i++) {
      const s = body.specs[i];
      if (!s) continue;
      tx.insert(productSpecifications).values({
        id: randomUUID(),
        productId,
        label: s.label,
        value: s.value,
        sortOrder: i,
      });
    }
  });
  return c.body(null, 204);
});

// PUT /api/products/:id/selling-points — replace all selling points atomically
productsRouter.put("/:id/selling-points", async (c) => {
  const productId = c.req.param("id");
  const body = await c.req.json<{ sellingPoints: string[] }>();

  // better-sqlite3 is synchronous — transaction callback must be sync too
  db.transaction((tx) => {
    tx.delete(sellingPoints).where(eq(sellingPoints.productId, productId));
    for (let i = 0; i < body.sellingPoints.length; i++) {
      const content = body.sellingPoints[i];
      if (content === undefined) continue;
      tx.insert(sellingPoints).values({
        id: randomUUID(),
        productId,
        content,
        sortOrder: i,
      });
    }
  });
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Product reference images (assets/originals)
// ---------------------------------------------------------------------------

// POST /api/products/:id/assets — upload one product reference image
productsRouter.post("/:id/assets", async (c) => {
  const productId = c.req.param("id");
  const [product] = await db.select().from(products).where(eq(products.id, productId));
  if (!product) return c.json({ error: "Product not found" }, 404);

  const body = await c.req.parseBody();
  const file = body["file"];
  if (!file || typeof file === "string") {
    return c.json({ error: "Missing file field" }, 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const assetId = randomUUID();

  try {
    const saved = await saveImageAsset(buffer, assetId, "originals");

    // Count existing assets to set sort order
    const existing = await db
      .select({ id: productAssets.id })
      .from(productAssets)
      .where(eq(productAssets.productId, productId));

    await db.insert(productAssets).values({
      id: assetId,
      productId,
      filePath: saved.relativePath,
      checksum: saved.checksum,
      sortOrder: existing.length,
      createdAt: new Date(),
    });

    await db
      .update(products)
      .set({ updatedAt: new Date() })
      .where(eq(products.id, productId));

    const [row] = await db.select().from(productAssets).where(eq(productAssets.id, assetId));
    return c.json(row, 201);
  } catch (err) {
    if (err instanceof UploadError) {
      return c.json({ error: err.message, code: err.code }, 422);
    }
    throw err;
  }
});

// PATCH /api/products/:id/assets/reorder — update sort orders
productsRouter.patch("/:id/assets/reorder", async (c) => {
  const productId = c.req.param("id");
  const body = await c.req.json<{ ids: string[] }>();

  for (let i = 0; i < body.ids.length; i++) {
    const assetId = body.ids[i];
    if (assetId) {
      await db
        .update(productAssets)
        .set({ sortOrder: i })
        .where(eq(productAssets.id, assetId));
    }
  }
  await db.update(products).set({ updatedAt: new Date() }).where(eq(products.id, productId));
  return c.body(null, 204);
});

// DELETE /api/products/:id/assets/:assetId
productsRouter.delete("/:id/assets/:assetId", async (c) => {
  const assetId = c.req.param("assetId");
  const [asset] = await db.select().from(productAssets).where(eq(productAssets.id, assetId));
  if (!asset) return c.json({ error: "Not found" }, 404);

  // TODO: check no active jobs depend on this asset before deleting
  const { assetPath } = await import("../lib/paths.js");
  try { fs.unlinkSync(assetPath(asset.filePath)); } catch { /* already gone */ }

  await db.delete(productAssets).where(eq(productAssets.id, assetId));
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Competitor images
// ---------------------------------------------------------------------------

// POST /api/products/:id/competitor-assets
productsRouter.post("/:id/competitor-assets", async (c) => {
  const productId = c.req.param("id");
  const [product] = await db.select().from(products).where(eq(products.id, productId));
  if (!product) return c.json({ error: "Product not found" }, 404);

  const body = await c.req.parseBody();
  const file = body["file"];
  if (!file || typeof file === "string") {
    return c.json({ error: "Missing file field" }, 400);
  }

  const assetId = randomUUID();
  const originalName = typeof file === "object" ? (file as File).name : "unknown";
  const buffer = Buffer.from(await (file as File).arrayBuffer());

  try {
    const saved = await saveImageAsset(buffer, assetId, "originals");

    await db.insert(competitorAssets).values({
      id: assetId,
      productId,
      filePath: saved.relativePath,
      checksum: saved.checksum,
      originalName,
      createdAt: new Date(),
    });

    const [row] = await db.select().from(competitorAssets).where(eq(competitorAssets.id, assetId));
    return c.json(row, 201);
  } catch (err) {
    if (err instanceof UploadError) {
      return c.json({ error: err.message, code: err.code }, 422);
    }
    throw err;
  }
});

// DELETE /api/products/:id/competitor-assets/:assetId
productsRouter.delete("/:id/competitor-assets/:assetId", async (c) => {
  const assetId = c.req.param("assetId");
  const [asset] = await db.select().from(competitorAssets).where(eq(competitorAssets.id, assetId));
  if (!asset) return c.json({ error: "Not found" }, 404);

  const { assetPath } = await import("../lib/paths.js");
  try { fs.unlinkSync(assetPath(asset.filePath)); } catch { /* already gone */ }

  await db.delete(competitorAssets).where(eq(competitorAssets.id, assetId));
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// AI extraction: parse raw text into structured product info
// ---------------------------------------------------------------------------

const extractInfoSchema = z.object({
  rawText: z.string().min(1).max(20000),
});

// POST /api/products/:id/extract-info
productsRouter.post("/:id/extract-info", zValidator("json", extractInfoSchema), async (c) => {
  const productId = c.req.param("id");
  const [product] = await db.select().from(products).where(eq(products.id, productId));
  if (!product) return c.json({ error: "Not found" }, 404);

  const { rawText } = c.req.valid("json");

  const systemPrompt = `你是商品信息提取助手。从用户提供的原始文本中提取商品规格参数、核心卖点和备注，以JSON格式返回。

返回格式（仅JSON，无任何解释）：
{
  "specs": [{ "label": "参数名", "value": "参数值" }],
  "sellingPoints": ["卖点1", "卖点2"],
  "notes": "其他补充信息，无则为空字符串"
}

提取规则：
- specs：明确的规格数据，如尺寸、材质、重量、颜色、容量、型号、认证等
- sellingPoints：产品优势、功能特性、差异化卖点，每条简短清晰（20字以内为佳）
- notes：无法归入上述两类的补充说明，可为空字符串`;

  let result;
  try {
    result = await gatewayCall("competitor_synthesis", {
      scene: "competitor_synthesis",
      prompt: rawText,
      systemPrompt,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "模型调用失败";
    return c.json({ error: msg }, 502);
  }

  const text = result.text ?? "";
  // Robustly extract JSON block from model output
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return c.json({ error: "模型返回格式错误，请重试" }, 502);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      specs?: Array<{ label: string; value: string }>;
      sellingPoints?: string[];
      notes?: string;
    };
    return c.json({
      specs:         Array.isArray(parsed.specs)         ? parsed.specs         : [],
      sellingPoints: Array.isArray(parsed.sellingPoints) ? parsed.sellingPoints : [],
      notes:         typeof parsed.notes === "string"    ? parsed.notes         : "",
    });
  } catch {
    return c.json({ error: "解析模型响应失败，请重试" }, 502);
  }
});

