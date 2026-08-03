import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Hono } from "hono";

process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "prompts-api-"));
await import("../db/migrate.js");
const { seedDefaults } = await import("../db/seed.js");
const { promptsRouter } = await import("./prompts.js");
await seedDefaults();

const app = new Hono().route("/prompts", promptsRouter);

test("renders a template into editable, locked, and final prompt sections", async () => {
  const response = await app.request("/prompts/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "image_generation",
      templateId: "builtin-image-commerce",
      contextVariables: {
        product_name: "榨汁杯",
        image_title: "清爽主图",
        width: 1000,
        height: 1000,
        aspect_ratio: "1:1",
      },
    }),
  });
  assert.equal(response.status, 200);
  const rendered = await response.json() as {
    templateId: string;
    editablePrompt: string;
    lockedSuffix: string;
    finalPrompt: string;
  };
  assert.equal(rendered.templateId, "builtin-image-commerce");
  assert.match(rendered.editablePrompt, /榨汁杯/);
  assert.match(rendered.lockedSuffix, /真实外观/);
  assert.equal(rendered.finalPrompt, `${rendered.editablePrompt}\n\n${rendered.lockedSuffix}`);
});

test("parameterizes known values for save-as-template confirmation", async () => {
  const response = await app.request("/prompts/parameterize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "design_plan",
      text: "为榨汁杯生成3个方向",
      contextVariables: { product_name: "榨汁杯", plan_count: "3" },
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { parameterizedBody: "为{{product_name}}生成{{plan_count}}个方向" });
});
