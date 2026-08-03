import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Hono } from "hono";

process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "generation-snapshot-"));
await import("../db/migrate.js");
const { seedDefaults } = await import("../db/seed.js");
const { db } = await import("../db/index.js");
const schema = await import("../db/schema.js");
const { tasksRouter } = await import("./tasks.js");
const { stopWorker } = await import("../jobs/worker.js");
await seedDefaults();
stopWorker();

const now = new Date();
await db.insert(schema.products).values({ id: "product-1", name: "榨汁杯", notes: null, archivedAt: null, createdAt: now, updatedAt: now });
await db.insert(schema.analysisVersions).values({ id: "analysis-1", productId: "product-1", versionNumber: 1, competitorAssetIds: "[]", createdAt: now });
await db.insert(schema.generationTasks).values({
  id: "task-1",
  productId: "product-1",
  analysisVersionId: "analysis-1",
  outputTypes: "[\"main_image\"]",
  configSnapshot: "{}",
  planDefaultTemplateId: "builtin-design-balanced",
  imageDefaultTemplateId: "builtin-image-commerce",
  currentStep: 3,
  createdAt: now,
  updatedAt: now,
});
await db.insert(schema.designDirections).values({
  id: "direction-1",
  generationTaskId: "task-1",
  label: "清爽方向",
  content: JSON.stringify({ positioning: "年轻便携", colorScheme: "清爽绿色", imageList: [] }),
  createdAt: now,
});
await db.insert(schema.designPlanVersions).values({
  id: "plan-1",
  generationTaskId: "task-1",
  selectedDirectionId: "direction-1",
  versionNumber: 1,
  confirmedAt: now,
  createdAt: now,
});
await db.insert(schema.imageItems).values({
  id: "item-1",
  designPlanVersionId: "plan-1",
  listType: "main_image",
  sortOrder: 0,
  title: "清爽主图",
  description: "突出便携",
  sellingPoints: "[\"便携\"]",
  suggestedCopy: "随时鲜榨",
  compositionIntent: "商品居中",
  lighting: "柔和自然光",
  angle: "前侧45度",
  background: "浅绿色背景",
  mood: "清爽",
  visualElements: "商品与水果",
  productAssetId: null,
  referenceAssetIds: null,
  promptTemplateId: null,
  outputPresetSnapshot: JSON.stringify({ width: 1000, height: 1000, format: "jpg", quality: 90 }),
  createdAt: now,
  updatedAt: now,
});

const app = new Hono().route("/tasks", tasksRouter);

test("freezes every image prompt before enqueue and rejects duplicate active generation", async () => {
  const first = await app.request("/tasks/task-1/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ planVersionId: "plan-1" }),
  });
  assert.equal(first.status, 201);

  const jobs = await db.select().from(schema.backgroundJobs);
  assert.equal(jobs.length, 1);
  const snapshot = JSON.parse(jobs[0]!.inputSnapshot!) as {
    finalPrompt?: string;
    promptTemplateId?: string;
    generationType?: string;
  };
  assert.equal(snapshot.promptTemplateId, "builtin-image-commerce");
  assert.equal(snapshot.generationType, "initial");
  assert.match(snapshot.finalPrompt ?? "", /真实外观/);
  assert.match(snapshot.finalPrompt ?? "", /清爽主图/);

  const duplicate = await app.request("/tasks/task-1/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ planVersionId: "plan-1" }),
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await db.select().from(schema.backgroundJobs)).length, 1);

  await db.update(schema.backgroundJobs).set({ status: "succeeded", finishedAt: new Date() });
  await db.insert(schema.imageVersions).values({
    id: "version-1", imageItemId: "item-1", filePath: "assets/generated/original.jpg",
    checksum: "checksum", generationType: "initial", parentVersionId: null, jobId: jobs[0]!.id,
    maskPath: null, instruction: null, promptTemplateId: "builtin-image-commerce",
    finalPrompt: "原始快照", polishInstruction: null, isSelected: true, createdAt: now,
  });
  const regenerate = await app.request("/tasks/task-1/generate", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ planVersionId: "plan-1" }),
  });
  assert.equal(regenerate.status, 201);
  const allJobs = await db.select().from(schema.backgroundJobs);
  const regenerationSnapshot = JSON.parse(allJobs.at(-1)!.inputSnapshot!) as { generationType: string };
  assert.equal(regenerationSnapshot.generationType, "regeneration");
  const [originalVersion] = await db.select().from(schema.imageVersions);
  assert.equal(originalVersion!.finalPrompt, "原始快照");
});

test("POST image stream rejects an item with an active generation job", async () => {
  const response = await app.request("/tasks/items/item-1/generate-stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 409);
});

test("persists the draft direction selection and protects confirmed directions", async () => {
  const selected = await app.request("/tasks/task-1/direction", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ directionId: "direction-1" }),
  });
  assert.equal(selected.status, 200);
  const [task] = await db.select().from(schema.generationTasks);
  assert.equal(task!.draftSelectedDirectionId, "direction-1");

  const updateConfirmed = await app.request("/tasks/directions/direction-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proposal: { label: "不可修改", positioning: "x", imageList: [] } }),
  });
  assert.equal(updateConfirmed.status, 409);

  await db.insert(schema.designDirections).values({
    id: "direction-2",
    generationTaskId: "task-1",
    label: "草稿方向",
    content: JSON.stringify({ label: "草稿方向", positioning: "旧", imageList: [] }),
    createdAt: now,
  });
  const rejectIncomplete = await app.request("/tasks/directions/direction-2", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proposal: { label: "字段不完整", imageList: [] } }),
  });
  assert.equal(rejectIncomplete.status, 400);

  const updateDraft = await app.request("/tasks/directions/direction-2", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proposal: {
      label: "更新方向",
      positioning: "新",
      colorScheme: "绿色",
      layoutIntent: "居中",
      copyStrategy: "短句",
      imageList: [{
        listType: "main_image",
        productAssetId: null,
        title: "清爽主图",
        description: "突出便携",
        sellingPoints: ["便携"],
        suggestedCopy: "随时鲜榨",
        compositionIntent: "商品居中",
        lighting: "柔和自然光",
        angle: "前侧45度",
        background: "浅绿色背景",
        mood: "清爽",
        visualElements: "商品与水果",
      }],
    } }),
  });
  assert.equal(updateDraft.status, 200);
  const updated = await updateDraft.json() as { label: string; content: string };
  assert.equal(updated.label, "更新方向");
  assert.equal((JSON.parse(updated.content) as { positioning: string }).positioning, "新");
});
