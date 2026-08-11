import assert from "node:assert/strict";
import fs, { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { Hono } from "hono";

process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "transfer-routes-"));
process.env["ADMIN_PASSWORD"] = "transfer-route-password";

await import("../db/migrate.js");
const { db } = await import("../db/index.js");
const schema = await import("../db/schema.js");
const { ensureDataDirs } = await import("../lib/paths.js");
const {
  createProjectArchiveResponse,
  exportProjectArchive,
  MAX_ARCHIVE_BYTES,
  saveRawRequestBody,
} = await import("../lib/transfer.js");
const { authMiddleware, authRouter } = await import("./auth.js");
const { settingsRouter } = await import("./settings.js");
const { productsRouter } = await import("./products.js");

ensureDataDirs();

const app = new Hono()
  .route("/settings", settingsRouter)
  .route("/products", productsRouter);

const authenticatedApp = new Hono();
authenticatedApp.route("/auth", authRouter);
authenticatedApp.use("/settings/*", authMiddleware);
authenticatedApp.use("/products/*", authMiddleware);
authenticatedApp.route("/settings", settingsRouter);
authenticatedApp.route("/products", productsRouter);

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

  const malformed = await app.request("/settings/transfer/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 422);
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
  assert.equal(exported.headers.get("cache-control"), "no-store");
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

test("rejects an observed oversized chunked body and removes its partial temporary ZIP", async () => {
  const uploadDir = await fs.promises.mkdtemp(path.join(tmpdir(), "transfer-stream-limit-"));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4]));
      controller.close();
    },
  });

  try {
    await assert.rejects(
      () => saveRawRequestBody(body, uploadDir, 3),
      (error: unknown) => (error as { status?: number }).status === 413,
    );
    assert.deepEqual(await fs.promises.readdir(uploadDir), []);
  } finally {
    await fs.promises.rm(uploadDir, { recursive: true, force: true });
  }
});

function deferredCleanup() {
  let resolve!: () => void;
  const completed = new Promise<void>((next) => { resolve = next; });
  return { completed, resolve };
}

async function waitForCleanup(completed: Promise<void>): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      completed,
      new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("archive cleanup was not called")), 1_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

test("cleans up project archive streams after completion and source errors", async () => {
  const completedCleanup = deferredCleanup();
  const completed = createProjectArchiveResponse({
    archivePath: "completed.zip",
    cleanup: async () => { completedCleanup.resolve(); },
  }, () => Readable.from([Buffer.from("zip")]));
  assert.equal(completed.headers.get("cache-control"), "no-store");
  assert.deepEqual(Buffer.from(await completed.arrayBuffer()), Buffer.from("zip"));
  await waitForCleanup(completedCleanup.completed);

  const failedCleanup = deferredCleanup();
  const failed = createProjectArchiveResponse({
    archivePath: "failed.zip",
    cleanup: async () => { failedCleanup.resolve(); },
  }, () => new Readable({
    read() { this.destroy(new Error("source read failed")); },
  }));
  await assert.rejects(() => failed.arrayBuffer(), /source read failed/);
  await waitForCleanup(failedCleanup.completed);
});

test("applies the production auth middleware to transfer endpoints", async () => {
  assert.equal((await authenticatedApp.request("/settings/transfer/config")).status, 401);
  assert.equal((await authenticatedApp.request("/products/transfer/project", {
    method: "POST",
    headers: { "content-type": "application/zip" },
    body: new Uint8Array([0]),
  })).status, 401);

  const login = await authenticatedApp.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "transfer-route-password" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  assert.equal((await authenticatedApp.request("/settings/transfer/config", {
    headers: { cookie },
  })).status, 200);
});

test.after(async () => {
  await sourceArchive.cleanup();
});
