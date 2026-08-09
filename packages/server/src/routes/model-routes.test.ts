import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Hono } from "hono";

process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "model-routes-api-"));
await import("../db/migrate.js");
const { seedDefaults } = await import("../db/seed.js");
const { settingsRouter } = await import("./settings.js");
await seedDefaults();

const app = new Hono().route("/settings", settingsRouter);

test("keeps the existing scene route and supports multiple routes with one default", async () => {
  const initialResponse = await app.request("/settings/routes?scene=design_plan");
  assert.equal(initialResponse.status, 200);
  const initial = await initialResponse.json() as Array<{ id: string; isDefault: boolean }>;
  assert.equal(initial.length, 1);
  assert.equal(initial[0]?.isDefault, true);

  const createResponse = await app.request("/settings/routes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scene: "design_plan", providerName: "bailian", modelId: "qwen-plus" }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json() as { id: string; isDefault: boolean };
  assert.equal(created.isDefault, false);

  const defaultResponse = await app.request(`/settings/routes/${created.id}/default`, { method: "POST" });
  assert.equal(defaultResponse.status, 200);

  const routesResponse = await app.request("/settings/routes?scene=design_plan");
  const routes = await routesResponse.json() as Array<{ id: string; isDefault: boolean }>;
  assert.equal(routes.length, 2);
  assert.equal(routes.filter((route) => route.isDefault).length, 1);
  assert.equal(routes.find((route) => route.id === created.id)?.isDefault, true);
});

test("rejects deleting the last default route for a scene", async () => {
  const listResponse = await app.request("/settings/routes?scene=image_edit");
  const [onlyRoute] = await listResponse.json() as Array<{ id: string }>;
  const response = await app.request(`/settings/routes/${onlyRoute!.id}`, { method: "DELETE" });
  assert.equal(response.status, 409);
});
