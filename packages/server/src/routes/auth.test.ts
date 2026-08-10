import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Hono } from "hono";

process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "auth-api-"));
process.env["ADMIN_PASSWORD"] = "test-default-password";

const auth = await import("./auth.js").catch(() => null);

test("protects API routes and creates a fourteen-day session after login", async () => {
  assert.ok(auth, "auth routes must be available");
  if (!auth) return;

  await import("../db/migrate.js");
  const { db } = await import("../db/index.js");
  const schema = await import("../db/schema.js");

  const app = new Hono();
  app.route("/auth", auth.authRouter);
  app.use("/protected/*", auth.authMiddleware);
  app.get("/protected/ping", (c) => c.json({ ok: true }));

  const anonymous = await app.request("/protected/ping");
  assert.equal(anonymous.status, 401);

  const rejected = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "wrong-password" }),
  });
  assert.equal(rejected.status, 401);

  const login = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "test-default-password" }),
  });
  assert.equal(login.status, 200);

  const setCookie = login.headers.get("set-cookie");
  assert.ok(setCookie);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Max-Age=1209600/);
  const cookie = setCookie.split(";", 1)[0]!;

  const authenticated = await app.request("/protected/ping", {
    headers: { cookie },
  });
  assert.equal(authenticated.status, 200);

  await db.update(schema.authSessions).set({ expiresAt: new Date(Date.now() - 1_000) });
  const expired = await app.request("/protected/ping", { headers: { cookie } });
  assert.equal(expired.status, 401);
});
