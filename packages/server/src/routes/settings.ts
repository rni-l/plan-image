import { Hono } from "hono";
import { db } from "../db/index.js";
import {
  modelProviders,
  modelSceneRoutes,
  outputPresets,
} from "../db/schema.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { invalidateAdapterCache } from "../gateway/index.js";
import path from "node:path";
import { paths } from "../lib/paths.js";

export const settingsRouter = new Hono();

// ---------------------------------------------------------------------------
// Model providers
// ---------------------------------------------------------------------------

settingsRouter.get("/providers", async (c) => {
  const rows = await db.select().from(modelProviders);
  return c.json(rows); // keyHint only — full key never returned
});

settingsRouter.put("/providers/:name", async (c) => {
  const name = c.req.param("name") as "bailian" | "volcengine" | "gpt_proxy";
  // apiKey is optional: omit (or send empty) to update only baseUrl without touching the stored key
  const body = await c.req.json<{ apiKey?: string; baseUrl?: string; modelId?: string }>();

  const now = new Date();
  let keyHint: string | undefined;

  if (body.apiKey?.trim()) {
    // New key provided — persist to secrets file
    const secretsFile = path.join(paths.secrets, `${name}.json`);
    fs.writeFileSync(secretsFile, JSON.stringify({ apiKey: body.apiKey }), { mode: 0o600 });
    keyHint = body.apiKey.slice(-4);
  }

  const existing = await db
    .select()
    .from(modelProviders)
    .where(eq(modelProviders.name, name));

  if (existing.length > 0) {
    await db
      .update(modelProviders)
      .set({
        // Only flip isConfigured / keyHint when a new key was supplied
        ...(keyHint ? { isConfigured: true, keyHint } : {}),
        baseUrl: body.baseUrl ?? null,
        updatedAt: now,
      })
      .where(eq(modelProviders.name, name));
  } else {
    await db.insert(modelProviders).values({
      id: randomUUID(),
      name,
      baseUrl: body.baseUrl ?? null,
      isConfigured: keyHint ? true : false,
      keyHint: keyHint ?? null,
      updatedAt: now,
    });
  }

  const [row] = await db.select().from(modelProviders).where(eq(modelProviders.name, name));
  invalidateAdapterCache();
  return c.json(row);
});

// ---------------------------------------------------------------------------
// Scene routes
// ---------------------------------------------------------------------------

settingsRouter.get("/routes", async (c) => {
  const rows = await db.select().from(modelSceneRoutes);
  const providers = await db.select().from(modelProviders);
  const idToName = Object.fromEntries(providers.map((p) => [p.id, p.name]));

  // Enrich each route with the provider's human-readable name
  return c.json(
    rows.map((r) => ({
      ...r,
      providerName: r.providerId ? (idToName[r.providerId] ?? null) : null,
    }))
  );
});

settingsRouter.put("/routes/:scene", async (c) => {
  const scene = c.req.param("scene");
  const body = await c.req.json<{
    providerName: "bailian" | "volcengine" | "gpt_proxy";
    modelId: string;
    /**
     * Optional billing model ID. When the API request model (e.g. a Volcengine
     * endpoint ID) differs from the publicly priced model name, set this to the
     * pricing key (e.g. "seedream-4.5") so cost calculations join correctly.
     * Leave unset (or null) to bill under the request model name.
     */
    billingModelId?: string | null;
    parameters?: unknown;
  }>();
  const now = new Date();

  // Find or lazily create the provider record (key may not be set yet)
  let [provider] = await db
    .select()
    .from(modelProviders)
    .where(eq(modelProviders.name, body.providerName));

  if (!provider) {
    const newId = randomUUID();
    await db.insert(modelProviders).values({
      id: newId,
      name: body.providerName,
      isConfigured: false,
      keyHint: null,
      updatedAt: now,
    });
    [provider] = await db
      .select()
      .from(modelProviders)
      .where(eq(modelProviders.name, body.providerName));
  }

  if (!provider) return c.json({ error: "Failed to resolve provider" }, 500);

  const existing = await db
    .select()
    .from(modelSceneRoutes)
    .where(eq(modelSceneRoutes.scene, scene as import("../db/schema.js").SceneKey));

  if (existing.length > 0) {
    await db
      .update(modelSceneRoutes)
      .set({
        providerId: provider.id,
        modelId: body.modelId,
        billingModelId: body.billingModelId ?? null,
        parameters: body.parameters ? JSON.stringify(body.parameters) : null,
        updatedAt: now,
      })
      .where(eq(modelSceneRoutes.scene, scene as import("../db/schema.js").SceneKey));
  } else {
    await db.insert(modelSceneRoutes).values({
      id: randomUUID(),
      scene: scene as import("../db/schema.js").SceneKey,
      providerId: provider.id,
      modelId: body.modelId,
      billingModelId: body.billingModelId ?? null,
      parameters: body.parameters ? JSON.stringify(body.parameters) : null,
      updatedAt: now,
    });
  }

  const [row] = await db
    .select()
    .from(modelSceneRoutes)
    .where(eq(modelSceneRoutes.scene, scene as import("../db/schema.js").SceneKey));
  return c.json({ ...row, providerName: body.providerName });
});

// ---------------------------------------------------------------------------
// Output presets
// ---------------------------------------------------------------------------

settingsRouter.get("/presets", async (c) => {
  const rows = await db.select().from(outputPresets);
  return c.json(rows);
});

settingsRouter.post("/presets", async (c) => {
  const body = await c.req.json<{
    name: string;
    presetType: "main_image" | "detail_module";
    width: number;
    height: number;
    format?: "jpg" | "png";
    quality?: number;
    isDefault?: boolean;
  }>();
  const now = new Date();
  const id = randomUUID();

  await db.insert(outputPresets).values({
    id,
    name: body.name,
    presetType: body.presetType,
    width: body.width,
    height: body.height,
    format: body.format ?? "jpg",
    quality: body.quality ?? 90,
    isDefault: body.isDefault ?? false,
    createdAt: now,
    updatedAt: now,
  });

  const [row] = await db.select().from(outputPresets).where(eq(outputPresets.id, id));
  return c.json(row, 201);
});

settingsRouter.patch("/presets/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Partial<{
    name: string;
    width: number;
    height: number;
    format: "jpg" | "png";
    quality: number;
    isDefault: boolean;
  }>>();

  await db
    .update(outputPresets)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(outputPresets.id, id));

  const [row] = await db.select().from(outputPresets).where(eq(outputPresets.id, id));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

settingsRouter.delete("/presets/:id", async (c) => {
  const id = c.req.param("id");
  await db.delete(outputPresets).where(eq(outputPresets.id, id));
  return c.body(null, 204);
});
