import assert from "node:assert/strict";
import test from "node:test";
import { api } from "../src/lib/api.ts";

test("uploadRawFile sends the original file as an authenticated ZIP request", async () => {
  const file = new File(["project archive"], "project-export.zip", { type: "application/zip" });
  const originalFetch = globalThis.fetch;
  let requestInit: RequestInit | undefined;

  globalThis.fetch = async (input, init) => {
    assert.equal(input, "/api/products/transfer/project");
    requestInit = init;
    return new Response(JSON.stringify({ productId: "product-1", productName: "Imported product" }), {
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await api.uploadRawFile<{ productId: string; productName: string }>(
      "/products/transfer/project",
      file,
      "application/zip",
    );

    assert.deepEqual(result, { productId: "product-1", productName: "Imported product" });
    assert.equal(requestInit?.method, "POST");
    assert.equal(requestInit?.credentials, "include");
    assert.equal((requestInit?.headers as Record<string, string>)["Content-Type"], "application/zip");
    assert.equal(requestInit?.body, file);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
