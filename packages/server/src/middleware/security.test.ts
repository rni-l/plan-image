import assert from "node:assert/strict";
import test from "node:test";
import * as security from "./security.js";

const isRemoteAccessEnabled = (env: Record<string, string | undefined>) => {
  const check = (security as Record<string, unknown>)["isRemoteAccessEnabled"];
  assert.equal(typeof check, "function", "production remote access must require an explicit configuration flag");
  return (check as (value: Record<string, string | undefined>) => boolean)(env);
};

test("enables remote access only when ALLOW_REMOTE is exactly true", () => {
  assert.equal(isRemoteAccessEnabled({}), false);
  assert.equal(isRemoteAccessEnabled({ ALLOW_REMOTE: "false" }), false);
  assert.equal(isRemoteAccessEnabled({ ALLOW_REMOTE: "true" }), true);
});
