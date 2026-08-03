import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Hono } from "hono";

const dataDir = mkdtempSync(path.join(tmpdir(), "prompt-template-api-"));
process.env["DATA_DIR"] = dataDir;

await import("../db/migrate.js");
const { seedDefaults } = await import("../db/seed.js");
const { settingsRouter } = await import("./settings.js");
const { promptsRouter } = await import("./prompts.js");
await seedDefaults();

const app = new Hono().route("/settings", settingsRouter).route("/prompts", promptsRouter);

test("lists the six built-in prompt templates", async () => {
  const response = await app.request("/settings/prompt-templates");
  assert.equal(response.status, 200);
  const templates = await response.json() as Array<{ id: string }>;
  assert.equal(templates.length, 6);
});

test("protects built-in templates from edits", async () => {
  const response = await app.request("/settings/prompt-templates/builtin-design-balanced", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "被修改" }),
  });
  assert.equal(response.status, 403);
});

test("creates custom templates and switches the type default atomically", async () => {
  const createdResponse = await app.request("/settings/prompt-templates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "design_plan",
      name: "我的方案模板",
      description: "测试",
      body: "为 {{product_name}} 生成 {{plan_count}} 个方案",
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as { id: string };

  const defaultResponse = await app.request(`/settings/prompt-templates/${created.id}/default`, {
    method: "POST",
  });
  assert.equal(defaultResponse.status, 200);

  const listResponse = await app.request("/settings/prompt-templates?type=design_plan");
  const templates = await listResponse.json() as Array<{ id: string; isDefault: boolean }>;
  assert.equal(templates.find((template) => template.id === created.id)?.isDefault, true);
  assert.equal(templates.filter((template) => template.isDefault).length, 1);

  const rejectedArchive = await app.request(`/settings/prompt-templates/${created.id}/archive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(rejectedArchive.status, 409);

  const archived = await app.request(`/settings/prompt-templates/${created.id}/archive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ replacementTemplateId: "builtin-design-balanced" }),
  });
  assert.equal(archived.status, 200);

  const activeList = await app.request("/settings/prompt-templates?type=design_plan");
  const activeTemplates = await activeList.json() as Array<{ id: string; isDefault: boolean }>;
  assert.equal(activeTemplates.some((template) => template.id === created.id), false);
  assert.equal(activeTemplates.find((template) => template.id === "builtin-design-balanced")?.isDefault, true);

  const archivedList = await app.request("/settings/prompt-templates?type=design_plan&includeArchived=true");
  const allTemplates = await archivedList.json() as Array<{ id: string; archivedAt: number | null }>;
  assert.ok(allTemplates.find((template) => template.id === created.id)?.archivedAt);
  const historicRender = await app.request("/prompts/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "design_plan",
      templateId: created.id,
      contextVariables: { product_name: "历史商品", plan_count: 3 },
    }),
  });
  assert.equal(historicRender.status, 200);
});
