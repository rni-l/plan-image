import assert from "node:assert/strict";
import test from "node:test";
import { GUIDE_ROUTE, buildGuideLinks, selectGuideExamples } from "../src/pages/guide/guide-content.js";

test("selects the latest product and matching task", () => {
  const value = selectGuideExamples(
    [{ id: "old", name: "旧商品", updatedAt: 10 }, { id: "new", name: "演示保温杯", updatedAt: 20 }],
    [{ id: "t-old", productId: "old", productName: "旧商品", currentStep: 4, updatedAt: 30 }, { id: "t-new", productId: "new", productName: "演示保温杯", currentStep: 3, updatedAt: 40 }],
  );
  assert.deepEqual(value, { product: { id: "new", name: "演示保温杯" }, task: { id: "t-new", productId: "new", currentStep: 3 } });
});

test("provides safe routes when no examples exist", () => {
  assert.deepEqual(buildGuideLinks({ product: null, task: null }), { product: "/products", research: "/products", task: "/products", export: "/task-center" });
  assert.equal(GUIDE_ROUTE, "/guide");
});
