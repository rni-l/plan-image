import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  modelProviders,
  modelCallLogs,
  modelSceneRoutes,
  outputPresets,
  promptTemplates,
} from "../db/schema.js";

const providerNameSchema = z.enum(["bailian", "volcengine", "gpt_proxy"]);

const configTransferSchema = z.object({
  formatVersion: z.literal(1),
  kind: z.literal("config"),
  providers: z.array(z.object({
    name: providerNameSchema,
    baseUrl: z.string().nullable(),
  })),
  routes: z.array(z.object({
    scene: z.enum([
      "competitor_image_analysis",
      "competitor_synthesis",
      "design_plan",
      "image_generation",
      "image_edit",
    ]),
    providerName: providerNameSchema.nullable(),
    modelId: z.string().nullable(),
    billingModelId: z.string().nullable(),
    parameters: z.string().nullable(),
    isDefault: z.boolean(),
  })),
  presets: z.array(z.object({
    name: z.string().min(1).max(100),
    presetType: z.enum(["main_image", "detail_module"]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    format: z.enum(["jpg", "png"]),
    quality: z.number().int().min(1).max(100),
    isDefault: z.boolean(),
  })),
  templates: z.array(z.object({
    type: z.enum(["design_plan", "image_generation"]),
    name: z.string().min(1).max(100),
    description: z.string().max(500).nullable(),
    body: z.string().min(1),
    isDefault: z.boolean(),
    archivedAt: z.number().int().nullable(),
  })),
});

export type ConfigTransfer = z.infer<typeof configTransferSchema>;

/** Export portable settings only; credentials and credential state remain local. */
export async function exportConfig(): Promise<ConfigTransfer> {
  const [providers, routes, presets, templates] = await Promise.all([
    db.select().from(modelProviders),
    db.select({ route: modelSceneRoutes, providerName: modelProviders.name })
      .from(modelSceneRoutes)
      .leftJoin(modelProviders, eq(modelSceneRoutes.providerId, modelProviders.id)),
    db.select().from(outputPresets),
    db.select().from(promptTemplates),
  ]);

  return {
    formatVersion: 1,
    kind: "config",
    providers: providers.map(({ name, baseUrl }) => ({ name, baseUrl })),
    routes: routes.map(({ route, providerName }) => ({
      scene: route.scene,
      providerName,
      modelId: route.modelId,
      billingModelId: route.billingModelId,
      parameters: route.parameters,
      isDefault: route.isDefault,
    })),
    presets: presets.map(({ id, createdAt, updatedAt, ...preset }) => preset),
    templates: templates
      .filter((template) => !template.isBuiltIn)
      .map(({ id, isBuiltIn, createdAt, updatedAt, archivedAt, ...template }) => ({
        ...template,
        archivedAt: archivedAt?.getTime() ?? null,
      })),
  };
}

/** Import portable settings without changing keys or their local configuration state. */
export async function importConfig(input: unknown): Promise<{ importedTemplates: number }> {
  const config = configTransferSchema.parse(input);

  return db.transaction((tx) => {
    const now = new Date();
    const currentProviders = tx.select().from(modelProviders).all();
    const providerIds = new Map(currentProviders.map((provider) => [provider.name, provider.id]));

    for (const provider of config.providers) {
      const id = providerIds.get(provider.name);
      if (id) {
        tx.update(modelProviders)
          .set({ baseUrl: provider.baseUrl, updatedAt: now })
          .where(eq(modelProviders.id, id))
          .run();
      } else {
        const newId = randomUUID();
        tx.insert(modelProviders).values({
          id: newId,
          name: provider.name,
          baseUrl: provider.baseUrl,
          isConfigured: false,
          keyHint: null,
          updatedAt: now,
        }).run();
        providerIds.set(provider.name, newId);
      }
    }

    tx.update(modelCallLogs).set({ modelRouteId: null }).run();
    tx.delete(modelSceneRoutes).run();
    tx.delete(outputPresets).run();

    if (config.routes.length) {
      tx.insert(modelSceneRoutes).values(config.routes.map((route) => ({
        id: randomUUID(),
        scene: route.scene,
        providerId: route.providerName ? providerIds.get(route.providerName) ?? null : null,
        modelId: route.modelId,
        billingModelId: route.billingModelId,
        parameters: route.parameters,
        isDefault: route.isDefault,
        updatedAt: now,
      }))).run();
    }

    if (config.presets.length) {
      tx.insert(outputPresets).values(config.presets.map((preset) => ({
        id: randomUUID(),
        ...preset,
        createdAt: now,
        updatedAt: now,
      }))).run();
    }

    const existingTemplates = tx.select().from(promptTemplates).all();
    const templateKeys = new Set(existingTemplates.map((template) => JSON.stringify([
      template.type,
      template.name,
      template.body,
    ])));
    const importedTemplates = config.templates.filter((candidate) => {
      const key = JSON.stringify([candidate.type, candidate.name, candidate.body]);
      if (templateKeys.has(key)) return false;
      templateKeys.add(key);
      return true;
    });

    if (importedTemplates.length) {
      tx.insert(promptTemplates).values(importedTemplates.map((template) => ({
        id: randomUUID(),
        ...template,
        archivedAt: template.archivedAt === null ? null : new Date(template.archivedAt),
        isBuiltIn: false,
        createdAt: now,
        updatedAt: now,
      }))).run();
    }

    return { importedTemplates: importedTemplates.length };
  });
}
