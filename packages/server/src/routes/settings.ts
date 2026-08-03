import { Hono } from "hono";
import { db } from "../db/index.js";
import {
  modelProviders,
  modelSceneRoutes,
  outputPresets,
  promptTemplates,
  type PromptTemplateType,
} from "../db/schema.js";
import { and, asc, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { invalidateAdapterCache } from "../gateway/index.js";
import path from "node:path";
import { paths } from "../lib/paths.js";
import { allowedVariablesFor, validateTemplateBody } from "../lib/prompt-service.js";

export const settingsRouter = new Hono();

function isPromptTemplateType(value: string): value is PromptTemplateType {
  return value === "design_plan" || value === "image_generation";
}

function validateTemplateFields(input: {
  type: PromptTemplateType;
  name: string;
  description?: string | null;
  body: string;
}): void {
  if (!input.name.trim()) throw new Error("模板名称不能为空");
  if (input.name.trim().length > 100) throw new Error("模板名称不能超过 100 字");
  if ((input.description?.length ?? 0) > 500) throw new Error("模板说明不能超过 500 字");
  validateTemplateBody(input.body, allowedVariablesFor(input.type));
}

async function setDefaultPromptTemplate(id: string): Promise<typeof promptTemplates.$inferSelect | undefined> {
  const [template] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, id));
  if (!template || template.archivedAt) return undefined;
  await db.update(promptTemplates)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(eq(promptTemplates.type, template.type));
  await db.update(promptTemplates)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(eq(promptTemplates.id, id));
  const [updated] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, id));
  return updated;
}

// ---------------------------------------------------------------------------
// Prompt templates
// ---------------------------------------------------------------------------

settingsRouter.get("/prompt-templates", async (c) => {
  const rawType = c.req.query("type");
  if (rawType && !isPromptTemplateType(rawType)) return c.json({ error: "无效的模板类型" }, 400);
  const type: PromptTemplateType | undefined = rawType && isPromptTemplateType(rawType) ? rawType : undefined;
  const includeArchived = c.req.query("includeArchived") === "true";
  const filters = [];
  if (type) filters.push(eq(promptTemplates.type, type));
  if (!includeArchived) filters.push(isNull(promptTemplates.archivedAt));
  const rows = await db.select().from(promptTemplates)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(promptTemplates.type), asc(promptTemplates.isBuiltIn), asc(promptTemplates.createdAt));
  return c.json(rows);
});

settingsRouter.post("/prompt-templates", async (c) => {
  const body = await c.req.json<{
    type: string;
    name: string;
    description?: string | null;
    body: string;
    isDefault?: boolean;
  }>();
  if (!isPromptTemplateType(body.type)) return c.json({ error: "无效的模板类型" }, 400);
  try {
    validateTemplateFields({
      type: body.type,
      name: body.name ?? "",
      body: body.body ?? "",
      ...(body.description !== undefined ? { description: body.description } : {}),
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  const id = randomUUID();
  const now = new Date();
  await db.insert(promptTemplates).values({
    id,
    type: body.type,
    name: body.name.trim(),
    description: body.description?.trim() || null,
    body: body.body,
    isBuiltIn: false,
    isDefault: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  if (body.isDefault) await setDefaultPromptTemplate(id);
  const [created] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, id));
  return c.json(created, 201);
});

settingsRouter.patch("/prompt-templates/:id", async (c) => {
  const id = c.req.param("id");
  const [existing] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, id));
  if (!existing) return c.json({ error: "模板不存在" }, 404);
  if (existing.isBuiltIn) return c.json({ error: "内置模板只读，请复制后修改" }, 403);
  if (existing.archivedAt) return c.json({ error: "已归档模板不能修改" }, 409);

  const body = await c.req.json<Partial<{ name: string; description: string | null; body: string }>>();
  const next = {
    type: existing.type,
    name: body.name ?? existing.name,
    description: body.description === undefined ? existing.description : body.description,
    body: body.body ?? existing.body,
  };
  try {
    validateTemplateFields(next);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
  await db.update(promptTemplates).set({
    name: next.name.trim(),
    description: next.description?.trim() || null,
    body: next.body,
    updatedAt: new Date(),
  }).where(eq(promptTemplates.id, id));
  const [updated] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, id));
  return c.json(updated);
});

settingsRouter.post("/prompt-templates/:id/copy", async (c) => {
  const id = c.req.param("id");
  const [source] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, id));
  if (!source) return c.json({ error: "模板不存在" }, 404);
  const body: { name?: string } = await c.req.json<{ name?: string }>().catch(() => ({}));
  const now = new Date();
  const copyId = randomUUID();
  await db.insert(promptTemplates).values({
    id: copyId,
    type: source.type,
    name: body.name?.trim() || `${source.name}（副本）`,
    description: source.description,
    body: source.body,
    isBuiltIn: false,
    isDefault: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  const [created] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, copyId));
  return c.json(created, 201);
});

settingsRouter.post("/prompt-templates/:id/default", async (c) => {
  const updated = await setDefaultPromptTemplate(c.req.param("id"));
  if (!updated) return c.json({ error: "模板不存在或已归档" }, 404);
  return c.json(updated);
});

settingsRouter.post("/prompt-templates/:id/archive", async (c) => {
  const id = c.req.param("id");
  const [template] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, id));
  if (!template) return c.json({ error: "模板不存在" }, 404);
  if (template.isBuiltIn) return c.json({ error: "内置模板不能归档" }, 403);
  if (template.archivedAt) return c.json(template);
  const body: { replacementTemplateId?: string } = await c.req.json<{ replacementTemplateId?: string }>().catch(() => ({}));
  if (template.isDefault && !body.replacementTemplateId) {
    return c.json({ error: "归档默认模板前必须指定替代默认模板" }, 409);
  }
  if (body.replacementTemplateId) {
    const [replacement] = await db.select().from(promptTemplates)
      .where(eq(promptTemplates.id, body.replacementTemplateId));
    if (!replacement || replacement.type !== template.type || replacement.archivedAt || replacement.id === id) {
      return c.json({ error: "替代模板不存在、类型不符或已归档" }, 400);
    }
    await setDefaultPromptTemplate(replacement.id);
  }
  await db.update(promptTemplates).set({
    isDefault: false,
    archivedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(promptTemplates.id, id));
  const [archived] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, id));
  return c.json(archived);
});

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
