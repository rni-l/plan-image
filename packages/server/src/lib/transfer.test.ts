import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";

process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "config-transfer-"));

await import("../db/migrate.js");
const { db } = await import("../db/index.js");
const schema = await import("../db/schema.js");
const { exportConfig, importConfig } = await import("./transfer.js");

const configFixture = {
  formatVersion: 1,
  kind: "config",
  providers: [{ name: "gpt_proxy", baseUrl: "https://new-proxy.example" }],
  routes: [{
    scene: "image_generation",
    providerName: "gpt_proxy",
    modelId: "gpt-image-2",
    billingModelId: "gpt-image-2",
    parameters: '{"size":"1024x1024"}',
    isDefault: true,
  }],
  presets: [{
    name: "导入主图",
    presetType: "main_image",
    width: 1200,
    height: 1200,
    format: "png",
    quality: 95,
    isDefault: true,
  }],
  templates: [{
    type: "image_generation",
    name: "导入模板",
    description: "可携带的模板",
    body: "为 {{product_name}} 生成主图",
    isDefault: true,
    archivedAt: null,
  }],
} as const;

test("exports portable configuration without secrets or key hints", async () => {
  const now = new Date();
  await db.insert(schema.modelProviders).values({
    id: "p",
    name: "gpt_proxy",
    baseUrl: "https://proxy.example",
    isConfigured: true,
    keyHint: "9876",
    updatedAt: now,
  });
  await db.insert(schema.promptTemplates).values({
    id: "custom",
    type: "design_plan",
    name: "可导出模板",
    description: null,
    body: "为 {{product_name}} 设计方案",
    isBuiltIn: false,
    isDefault: false,
    archivedAt: new Date(1_700_000_000_000),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.promptTemplates).values({
    id: "builtin",
    type: "design_plan",
    name: "内置模板",
    description: null,
    body: "不应导出",
    isBuiltIn: true,
    isDefault: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  const exported = await exportConfig();

  assert.equal(JSON.stringify(exported).includes("9876"), false);
  assert.equal(JSON.stringify(exported).includes("apiKey"), false);
  assert.deepEqual(exported.providers, [{ name: "gpt_proxy", baseUrl: "https://proxy.example" }]);
  assert.deepEqual(exported.templates, [{
    type: "design_plan",
    name: "可导出模板",
    description: null,
    body: "为 {{product_name}} 设计方案",
    isDefault: false,
    archivedAt: 1_700_000_000_000,
  }]);
});

test("imports routes and presets while retaining current key state", async () => {
  const now = new Date();
  await db.insert(schema.modelSceneRoutes).values({
    id: "old-route",
    scene: "design_plan",
    providerId: "p",
    modelId: "old-model",
    billingModelId: null,
    parameters: null,
    isDefault: true,
    updatedAt: now,
  });
  await db.insert(schema.modelCallLogs).values({
    id: "historical-log",
    modelRouteId: "old-route",
    scene: "design_plan",
    provider: "gpt_proxy",
    model: "old-model",
    status: "succeeded",
    createdAt: now,
  });
  await db.insert(schema.outputPresets).values({
    id: "old-preset",
    name: "旧预设",
    presetType: "detail_module",
    width: 790,
    height: 1000,
    format: "jpg",
    quality: 90,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });

  const result = await importConfig(configFixture);

  assert.equal(result.importedTemplates, 1);
  const [provider] = await db.select().from(schema.modelProviders)
    .where(eq(schema.modelProviders.name, "gpt_proxy"));
  assert.equal(provider?.isConfigured, true);
  assert.equal(provider?.keyHint, "9876");
  assert.equal(provider?.baseUrl, "https://new-proxy.example");

  const routes = await db.select().from(schema.modelSceneRoutes);
  assert.deepEqual(routes.map(({ id, providerId, updatedAt, ...route }) => route), [{
    scene: "image_generation",
    modelId: "gpt-image-2",
    billingModelId: "gpt-image-2",
    parameters: '{"size":"1024x1024"}',
    isDefault: true,
  }]);
  assert.equal(routes[0]?.providerId, provider?.id);

  const [historicalLog] = await db.select().from(schema.modelCallLogs)
    .where(eq(schema.modelCallLogs.id, "historical-log"));
  assert.equal(historicalLog?.modelRouteId, null);

  const presets = await db.select().from(schema.outputPresets);
  assert.deepEqual(presets.map(({ id, createdAt, updatedAt, ...preset }) => preset), configFixture.presets);

  const [builtIn, archivedCustom] = await Promise.all([
    db.select().from(schema.promptTemplates).where(eq(schema.promptTemplates.id, "builtin")),
    db.select().from(schema.promptTemplates).where(eq(schema.promptTemplates.id, "custom")),
  ]);
  assert.equal(builtIn[0]?.isBuiltIn, true);
  assert.equal(archivedCustom[0]?.archivedAt?.getTime(), 1_700_000_000_000);
});

test("does not import duplicate custom templates", async () => {
  const result = await importConfig(configFixture);

  assert.equal(result.importedTemplates, 0);
  const templates = await db.select().from(schema.promptTemplates)
    .where(eq(schema.promptTemplates.name, "导入模板"));
  assert.equal(templates.length, 1);
});

test("deduplicates equivalent custom templates within one import package", async () => {
  const duplicate = {
    type: "design_plan",
    name: "包内重复模板",
    description: null,
    body: "为 {{product_name}} 提供设计方向",
    isDefault: false,
    archivedAt: null,
  } as const;
  const result = await importConfig({
    formatVersion: 1,
    kind: "config",
    providers: [],
    routes: [],
    presets: [],
    templates: [duplicate, duplicate],
  });

  assert.equal(result.importedTemplates, 1);
  const templates = await db.select().from(schema.promptTemplates)
    .where(eq(schema.promptTemplates.name, duplicate.name));
  assert.equal(templates.length, 1);
});
