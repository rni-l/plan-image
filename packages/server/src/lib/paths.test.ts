import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "private-plan-data-"));
const { ensureDataDirs, paths } = await import("./paths.js");

test("creates runtime data directories with owner-only permissions", () => {
  ensureDataDirs();
  assert.equal(statSync(paths.secrets).mode & 0o777, 0o700);
  assert.equal(statSync(paths.database).mode & 0o777, 0o700);
});
