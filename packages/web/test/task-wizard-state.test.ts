import assert from "node:assert/strict";
import test from "node:test";
import { shouldGenerateDirections } from "../src/lib/task-wizard-state.js";

test("a one-shot request generates even when old directions exist", () => {
  assert.equal(shouldGenerateDirections(true, 3), true);
});

test("revisiting step 2 loads existing directions without regenerating", () => {
  assert.equal(shouldGenerateDirections(false, 3), false);
});

test("a task without directions starts its initial generation", () => {
  assert.equal(shouldGenerateDirections(false, 0), true);
});
