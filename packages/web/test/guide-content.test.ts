import assert from "node:assert/strict";
import test from "node:test";
import { GUIDE_ROUTE, buildGuideLinks, selectGuideExamples } from "../src/pages/guide/guide-content.js";

test("selects the latest product and matching task", () => {
  const value = selectGuideExamples(
    [
      { id: "old", name: "旧商品", updatedAt: "2026-08-01T09:00:00.000Z" },
      { id: "new", name: "演示保温杯", updatedAt: "2026-08-02T09:00:00.000Z" },
    ],
    [
      { id: "t-new-old", productId: "new", productName: "演示保温杯", currentStep: 2, updatedAt: "2026-08-03T09:00:00.000Z" },
      { id: "t-new-latest", productId: "new", productName: "演示保温杯", currentStep: 3, updatedAt: "2026-08-04T09:00:00.000Z" },
      { id: "t-old", productId: "old", productName: "旧商品", currentStep: 4, updatedAt: "2026-08-05T09:00:00.000Z" },
    ],
  );
  assert.deepEqual(value, { product: { id: "new", name: "演示保温杯" }, task: { id: "t-new-latest", productId: "new", currentStep: 3 } });
});

test("does not pair a newer product with another product's task", () => {
  const examples = selectGuideExamples(
    [
      { id: "old", name: "旧商品", updatedAt: "2026-08-01T09:00:00.000Z" },
      { id: "new", name: "新商品", updatedAt: "2026-08-02T09:00:00.000Z" },
    ],
    [{ id: "t-old", productId: "old", productName: "旧商品", currentStep: 4, updatedAt: "2026-08-03T09:00:00.000Z" }],
  );

  assert.deepEqual(examples, { product: { id: "new", name: "新商品" }, task: null });
  assert.deepEqual(buildGuideLinks(examples), {
    product: "/products/new/info",
    research: "/products/new/research",
    task: "/products/new/tasks",
    export: "/task-center",
  });
});

test("falls back to the latest task only when no product exists", () => {
  const examples = selectGuideExamples([], [
    { id: "old", productId: "old-product", productName: "旧商品", currentStep: 2, updatedAt: "2026-08-01T09:00:00.000Z" },
    { id: "latest", productId: "new-product", productName: "新商品", currentStep: 4, updatedAt: "2026-08-02T09:00:00.000Z" },
  ]);

  assert.deepEqual(examples, { product: null, task: { id: "latest", productId: "new-product", currentStep: 4 } });
});

test("provides safe routes when no examples exist", () => {
  assert.deepEqual(buildGuideLinks({ product: null, task: null }), { product: "/products", research: "/products", task: "/products", export: "/task-center" });
  assert.equal(GUIDE_ROUTE, "/guide");
});
