import assert from "node:assert/strict";
import fs, { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Hono } from "hono";

process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "transfer-routes-"));

await import("../db/migrate.js");
const { db } = await import("../db/index.js");
const schema = await import("../db/schema.js");
const { ensureDataDirs } = await import("../lib/paths.js");
const { exportProjectArchive, MAX_ARCHIVE_BYTES } = await import("../lib/transfer.js");
const { settingsRouter } = await import("./settings.js");
const { productsRouter } = await import("./products.js");

ensureDataDirs();

const app = new Hono()
  .route("/settings", settingsRouter)
  .route("/products", productsRouter);

const configFixture = {
  formatVersion: 1,
  kind: "config",
  providers: [],
  routes: [],
  presets: [],
  templates: [],
};

const now = new Date();
await db.insert(schema.products).values({
  id: "project-route-source",
  name: "导入测试商品",
  notes: null,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
});
const sourceArchive = await exportProjectArchive("project-route-source");

test("downloads config as attachment and imports JSON with a raw request body", async () => {
  const exported = await app.request("/settings/transfer/config");
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-disposition") ?? "", /configuration-export\.json/);
  assert.equal(exported.headers.get("cache-control"), "no-store");

  const imported = await app.request("/settings/transfer/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(configFixture),
  });
  assert.equal(imported.status, 200);

  const invalid = await app.request("/settings/transfer/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(invalid.status, 422);
});

test("imports a raw ZIP before dynamic product routes", async () => {
  const response = await app.request("/products/transfer/project", {
    method: "POST",
    headers: { "content-type": "application/zip" },
    body: await fs.promises.readFile(sourceArchive.archivePath),
  });

  assert.equal(response.status, 201);
  assert.equal((await response.json() as { productName: string }).productName, "导入测试商品");
});

test("streams a project download and rejects unsupported or oversized uploads", async () => {
  const exported = await app.request("/products/project-route-source/transfer/project");
  assert.equal(exported.status, 200);
  assert.equal(exported.headers.get("content-type"), "application/zip");
  assert.match(exported.headers.get("content-disposition") ?? "", /project-export\.zip/);
  assert.ok((await exported.arrayBuffer()).byteLength > 0);

  const unsupported = await app.request("/products/transfer/project", { method: "POST" });
  assert.equal(unsupported.status, 415);

  const oversized = await app.request("/products/transfer/project", {
    method: "POST",
    headers: {
      "content-type": "application/zip",
      "content-length": String(MAX_ARCHIVE_BYTES + 1),
    },
    body: new Uint8Array([0]),
  });
  assert.equal(oversized.status, 413);

  const enormousDeclaration = await app.request("/products/transfer/project", {
    method: "POST",
    headers: {
      "content-type": "application/zip",
      "content-length": "999999999999999999999999",
    },
    body: new Uint8Array([0]),
  });
  assert.equal(enormousDeclaration.status, 413);
});

test.after(async () => {
  await sourceArchive.cleanup();
});
