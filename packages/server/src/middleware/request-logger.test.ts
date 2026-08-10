import assert from "node:assert/strict";
import test from "node:test";
import * as requestLogger from "./request-logger.js";

const sanitizeBody = (body: string) => {
  const sanitize = (requestLogger as Record<string, unknown>)["sanitizeBody"];
  assert.equal(typeof sanitize, "function", "request bodies must be sanitizable before logging");
  return (sanitize as (value: string) => string)(body);
};

const sanitizeQuery = (query: string) => {
  const sanitize = (requestLogger as Record<string, unknown>)["sanitizeQuery"];
  assert.equal(typeof sanitize, "function", "query parameters must be sanitizable before logging");
  return (sanitize as (value: string) => string)(query);
};

test("redacts sensitive JSON fields at every nesting level", () => {
  const body = JSON.stringify({
    apiKey: "provider-key",
    name: "bailian",
    nested: { password: "admin-password", access_token: "session-token" },
  });

  assert.deepEqual(JSON.parse(sanitizeBody(body)), {
    apiKey: "[redacted]",
    name: "bailian",
    nested: { password: "[redacted]", access_token: "[redacted]" },
  });
});

test("redacts sensitive query parameters", () => {
  assert.equal(sanitizeQuery("?page=2&token=session-token&filter=recent"), "?page=2&token=%5Bredacted%5D&filter=recent");
});
