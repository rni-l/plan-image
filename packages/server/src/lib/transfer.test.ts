import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs, { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { eq, inArray } from "drizzle-orm";

process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "config-transfer-"));

await import("../db/migrate.js");
const { db } = await import("../db/index.js");
const schema = await import("../db/schema.js");
const { assetPath, ensureDataDirs, paths } = await import("./paths.js");
const {
  exportConfig,
  exportProjectArchive,
  importConfig,
  importProjectArchive,
  MAX_ARCHIVE_BYTES,
  MAX_EXTRACTED_BYTES,
  TransferError,
} = await import("./transfer.js");
const execFileAsync = promisify(execFile);

ensureDataDirs();

const configFixture = {
  formatVersion: 1,
  kind: "config",
  providers: [{ name: "gpt_proxy", baseUrl: "https://new-proxy.example" }],
  routes: [{
    scene: "image_generation",
    providerName: "gpt_proxy",
    modelId: "gpt-image-2",
    billingModelId: "gpt-image-2",
    parameters: '{"size":"1024x1024"}',
    isDefault: true,
  }],
  presets: [{
    name: "导入主图",
    presetType: "main_image",
    width: 1200,
    height: 1200,
    format: "png",
    quality: 95,
    isDefault: true,
  }],
  templates: [{
    type: "image_generation",
    name: "导入模板",
    description: "可携带的模板",
    body: "为 {{product_name}} 生成主图",
    isDefault: true,
    archivedAt: null,
  }],
} as const;

test("exports portable configuration without secrets or key hints", async () => {
  const now = new Date();
  await db.insert(schema.modelProviders).values({
    id: "p",
    name: "gpt_proxy",
    baseUrl: "https://proxy.example",
    isConfigured: true,
    keyHint: "9876",
    updatedAt: now,
  });
  await db.insert(schema.promptTemplates).values({
    id: "custom",
    type: "design_plan",
    name: "可导出模板",
    description: null,
    body: "为 {{product_name}} 设计方案",
    isBuiltIn: false,
    isDefault: false,
    archivedAt: new Date(1_700_000_000_000),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.promptTemplates).values({
    id: "builtin",
    type: "design_plan",
    name: "内置模板",
    description: null,
    body: "不应导出",
    isBuiltIn: true,
    isDefault: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  const exported = await exportConfig();

  assert.equal(JSON.stringify(exported).includes("9876"), false);
  assert.equal(JSON.stringify(exported).includes("apiKey"), false);
  assert.deepEqual(exported.providers, [{ name: "gpt_proxy", baseUrl: "https://proxy.example" }]);
  assert.deepEqual(exported.templates, [{
    type: "design_plan",
    name: "可导出模板",
    description: null,
    body: "为 {{product_name}} 设计方案",
    isDefault: false,
    archivedAt: 1_700_000_000_000,
  }]);
});

test("imports routes and presets while retaining current key state", async () => {
  const now = new Date();
  await db.insert(schema.modelSceneRoutes).values({
    id: "old-route",
    scene: "design_plan",
    providerId: "p",
    modelId: "old-model",
    billingModelId: null,
    parameters: null,
    isDefault: true,
    updatedAt: now,
  });
  await db.insert(schema.modelCallLogs).values({
    id: "historical-log",
    modelRouteId: "old-route",
    scene: "design_plan",
    provider: "gpt_proxy",
    model: "old-model",
    status: "succeeded",
    createdAt: now,
  });
  await db.insert(schema.outputPresets).values({
    id: "old-preset",
    name: "旧预设",
    presetType: "detail_module",
    width: 790,
    height: 1000,
    format: "jpg",
    quality: 90,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });

  const result = await importConfig(configFixture);

  assert.equal(result.importedTemplates, 1);
  const [provider] = await db.select().from(schema.modelProviders)
    .where(eq(schema.modelProviders.name, "gpt_proxy"));
  assert.equal(provider?.isConfigured, true);
  assert.equal(provider?.keyHint, "9876");
  assert.equal(provider?.baseUrl, "https://new-proxy.example");

  const routes = await db.select().from(schema.modelSceneRoutes);
  assert.deepEqual(routes.map(({ id, providerId, updatedAt, ...route }) => route), [{
    scene: "image_generation",
    modelId: "gpt-image-2",
    billingModelId: "gpt-image-2",
    parameters: '{"size":"1024x1024"}',
    isDefault: true,
  }]);
  assert.equal(routes[0]?.providerId, provider?.id);

  const [historicalLog] = await db.select().from(schema.modelCallLogs)
    .where(eq(schema.modelCallLogs.id, "historical-log"));
  assert.equal(historicalLog?.modelRouteId, null);

  const presets = await db.select().from(schema.outputPresets);
  assert.deepEqual(presets.map(({ id, createdAt, updatedAt, ...preset }) => preset), configFixture.presets);

  const [builtIn, archivedCustom] = await Promise.all([
    db.select().from(schema.promptTemplates).where(eq(schema.promptTemplates.id, "builtin")),
    db.select().from(schema.promptTemplates).where(eq(schema.promptTemplates.id, "custom")),
  ]);
  assert.equal(builtIn[0]?.isBuiltIn, true);
  assert.equal(archivedCustom[0]?.archivedAt?.getTime(), 1_700_000_000_000);
});

test("does not import duplicate custom templates", async () => {
  const result = await importConfig(configFixture);

  assert.equal(result.importedTemplates, 0);
  const templates = await db.select().from(schema.promptTemplates)
    .where(eq(schema.promptTemplates.name, "导入模板"));
  assert.equal(templates.length, 1);
});

test("deduplicates equivalent custom templates within one import package", async () => {
  const duplicate = {
    type: "design_plan",
    name: "包内重复模板",
    description: null,
    body: "为 {{product_name}} 提供设计方向",
    isDefault: false,
    archivedAt: null,
  } as const;
  const result = await importConfig({
    formatVersion: 1,
    kind: "config",
    providers: [],
    routes: [],
    presets: [],
    templates: [duplicate, duplicate],
  });

  assert.equal(result.importedTemplates, 1);
  const templates = await db.select().from(schema.promptTemplates)
    .where(eq(schema.promptTemplates.name, duplicate.name));
  assert.equal(templates.length, 1);
});

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await fs.promises.readFile(filePath)).digest("hex");
}

async function readProductGraph(productId: string) {
  const [product] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
  assert.ok(product);
  const [productAssets, specifications, sellingPoints, competitorAssets, analysisVersions, generationTasks] = await Promise.all([
    db.select().from(schema.productAssets).where(eq(schema.productAssets.productId, productId)),
    db.select().from(schema.productSpecifications).where(eq(schema.productSpecifications.productId, productId)),
    db.select().from(schema.sellingPoints).where(eq(schema.sellingPoints.productId, productId)),
    db.select().from(schema.competitorAssets).where(eq(schema.competitorAssets.productId, productId)),
    db.select().from(schema.analysisVersions).where(eq(schema.analysisVersions.productId, productId)),
    db.select().from(schema.generationTasks).where(eq(schema.generationTasks.productId, productId)),
  ]);
  const analysisIds = analysisVersions.map((row) => row.id);
  const taskIds = generationTasks.map((row) => row.id);
  const [imageAnalysisCards, synthesisReports, designDirections, designPlanVersions] = await Promise.all([
    analysisIds.length ? db.select().from(schema.imageAnalysisCards).where(inArray(schema.imageAnalysisCards.analysisVersionId, analysisIds)) : [],
    analysisIds.length ? db.select().from(schema.synthesisReports).where(inArray(schema.synthesisReports.analysisVersionId, analysisIds)) : [],
    taskIds.length ? db.select().from(schema.designDirections).where(inArray(schema.designDirections.generationTaskId, taskIds)) : [],
    taskIds.length ? db.select().from(schema.designPlanVersions).where(inArray(schema.designPlanVersions.generationTaskId, taskIds)) : [],
  ]);
  const planIds = designPlanVersions.map((row) => row.id);
  const imageItems = planIds.length
    ? await db.select().from(schema.imageItems).where(inArray(schema.imageItems.designPlanVersionId, planIds))
    : [];
  const itemIds = imageItems.map((row) => row.id);
  const imageVersions = itemIds.length
    ? await db.select().from(schema.imageVersions).where(inArray(schema.imageVersions.imageItemId, itemIds))
    : [];
  const templateIds = [...new Set([
    ...generationTasks.flatMap((row) => [row.planDefaultTemplateId, row.imageDefaultTemplateId]),
    ...imageItems.map((row) => row.promptTemplateId),
    ...imageVersions.map((row) => row.promptTemplateId),
  ].filter((id): id is string => id !== null))];
  const templates = templateIds.length
    ? await db.select().from(schema.promptTemplates).where(inArray(schema.promptTemplates.id, templateIds))
    : [];
  return {
    product,
    productAssets,
    specifications,
    sellingPoints,
    competitorAssets,
    analysisVersions,
    imageAnalysisCards,
    synthesisReports,
    generationTasks,
    designDirections,
    designPlanVersions,
    imageItems,
    imageVersions,
    templates,
  };
}

async function insertCompleteProjectFixture() {
  const prefix = randomUUID();
  const now = new Date();
  const ids = {
    product: `${prefix}-product`,
    productAsset: `${prefix}-product-asset`,
    specification: `${prefix}-specification`,
    sellingPoint: `${prefix}-selling-point`,
    competitorAsset: `${prefix}-competitor-asset`,
    analysis: `${prefix}-analysis`,
    card: `${prefix}-card`,
    report: `${prefix}-report`,
    planTemplate: `${prefix}-plan-template`,
    imageTemplate: `${prefix}-image-template`,
    task: `${prefix}-task`,
    direction: `${prefix}-direction`,
    plan: `${prefix}-plan`,
    item: `${prefix}-item`,
    imageVersion: `${prefix}-image-version`,
    incompleteVersion: `${prefix}-incomplete-version`,
  };
  const relativePaths = {
    product: `assets/originals/${prefix}-product.jpg`,
    competitor: `assets/originals/${prefix}-competitor.png`,
    generated: `assets/generated/${prefix}-generated.png`,
    mask: `assets/masks/${prefix}-mask.png`,
  };
  const productBytes = Buffer.from("source-product-image");
  const competitorBytes = Buffer.from("source-competitor-image");
  const generatedBytes = Buffer.from("source-generated-image");
  const maskBytes = Buffer.from("source-mask-image");
  await Promise.all(Object.values(paths).map((directory) => fs.promises.mkdir(directory, { recursive: true })));
  await Promise.all([
    fs.promises.writeFile(assetPath(relativePaths.product), productBytes),
    fs.promises.writeFile(assetPath(relativePaths.competitor), competitorBytes),
    fs.promises.writeFile(assetPath(relativePaths.generated), generatedBytes),
    fs.promises.writeFile(assetPath(relativePaths.mask), maskBytes),
  ]);
  const [productChecksum, competitorChecksum, generatedChecksum, maskChecksum] = await Promise.all([
    sha256File(assetPath(relativePaths.product)),
    sha256File(assetPath(relativePaths.competitor)),
    sha256File(assetPath(relativePaths.generated)),
    sha256File(assetPath(relativePaths.mask)),
  ]);

  await db.insert(schema.products).values({ id: ids.product, name: "完整迁移项目", notes: "保留完整历史", archivedAt: null, createdAt: now, updatedAt: now });
  await db.insert(schema.productAssets).values({ id: ids.productAsset, productId: ids.product, filePath: relativePaths.product, checksum: productChecksum, sortOrder: 0, analysis: '{"subject":"product"}', createdAt: now });
  await db.insert(schema.productSpecifications).values({ id: ids.specification, productId: ids.product, label: "容量", value: "1L", sortOrder: 0 });
  await db.insert(schema.sellingPoints).values({ id: ids.sellingPoint, productId: ids.product, content: "耐用", sortOrder: 0 });
  await db.insert(schema.competitorAssets).values({ id: ids.competitorAsset, productId: ids.product, filePath: relativePaths.competitor, checksum: competitorChecksum, originalName: "competitor.png", createdAt: now });
  await db.insert(schema.analysisVersions).values({ id: ids.analysis, productId: ids.product, versionNumber: 1, competitorAssetIds: JSON.stringify([ids.competitorAsset]), createdAt: now });
  await db.insert(schema.imageAnalysisCards).values({ id: ids.card, analysisVersionId: ids.analysis, competitorAssetId: ids.competitorAsset, modelOutput: '{"layout":"center"}', humanOverride: '{"layout":"left"}', createdAt: now, updatedAt: now });
  await db.insert(schema.synthesisReports).values({ id: ids.report, analysisVersionId: ids.analysis, content: '{"summary":"portable"}', createdAt: now });
  await db.insert(schema.promptTemplates).values([
    { id: ids.planTemplate, type: "design_plan", name: "项目方案模板", description: null, body: "方案 {{product_name}}", isBuiltIn: false, isDefault: false, archivedAt: null, createdAt: now, updatedAt: now },
    { id: ids.imageTemplate, type: "image_generation", name: "项目图片模板", description: null, body: "图片 {{product_name}}", isBuiltIn: false, isDefault: false, archivedAt: null, createdAt: now, updatedAt: now },
  ]);
  await db.insert(schema.generationTasks).values({
    id: ids.task,
    productId: ids.product,
    analysisVersionId: ids.analysis,
    outputTypes: '["main_image","detail_page"]',
    name: "完整任务",
    description: "迁移任务历史",
    configSnapshot: JSON.stringify({ providers: [{ id: "provider-source", name: "gpt_proxy", keyHint: "9876" }], routes: [], presets: [] }),
    planDefaultTemplateId: ids.planTemplate,
    imageDefaultTemplateId: ids.imageTemplate,
    latestPlanPromptSnapshot: "完整方案提示词",
    draftSelectedDirectionId: ids.direction,
    currentStep: 4,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.designDirections).values({ id: ids.direction, generationTaskId: ids.task, label: "方向A", content: '{"positioning":"premium"}', createdAt: now });
  await db.insert(schema.designPlanVersions).values({ id: ids.plan, generationTaskId: ids.task, selectedDirectionId: ids.direction, versionNumber: 1, confirmedAt: now, createdAt: now });
  await db.insert(schema.imageItems).values({
    id: ids.item,
    designPlanVersionId: ids.plan,
    listType: "main_image",
    sortOrder: 0,
    title: "主图",
    description: "完整主图",
    sellingPoints: '["耐用"]',
    suggestedCopy: "耐用之选",
    compositionIntent: "居中",
    lighting: "柔光",
    angle: "正面",
    background: "纯色",
    mood: "高级",
    visualElements: "产品与背景道具",
    productAssetId: ids.productAsset,
    referenceAssetIds: JSON.stringify([ids.productAsset]),
    promptTemplateId: ids.imageTemplate,
    outputPresetSnapshot: '{"width":1200,"height":1200,"format":"png"}',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.imageVersions).values([
    { id: ids.imageVersion, imageItemId: ids.item, filePath: relativePaths.generated, checksum: generatedChecksum, generationType: "inpaint", parentVersionId: null, jobId: `${prefix}-completed-job`, maskPath: relativePaths.mask, instruction: "替换背景", promptTemplateId: ids.imageTemplate, finalPrompt: "最终提示词", polishInstruction: "更高级", isSelected: true, createdAt: now },
    { id: ids.incompleteVersion, imageItemId: ids.item, filePath: "", checksum: "", generationType: "regeneration", parentVersionId: ids.imageVersion, jobId: `${prefix}-running-job`, maskPath: null, instruction: null, promptTemplateId: ids.imageTemplate, finalPrompt: null, polishInstruction: null, isSelected: false, createdAt: now },
  ]);

  return { productId: ids.product, ids, productBytes, competitorBytes, generatedBytes, maskChecksum };
}

async function productCount(): Promise<number> {
  return (await db.select().from(schema.products)).length;
}

async function tamperFirstAsset(archivePath: string): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(paths.exports, "tampered-project-"));
  const target = path.join(paths.exports, `tampered-${randomUUID()}.zip`);
  try {
    await execFileAsync("/usr/bin/unzip", ["-qq", archivePath, "-d", root]);
    const manifest = JSON.parse(await fs.promises.readFile(path.join(root, "manifest.json"), "utf8")) as {
      files: Array<{ path: string }>;
    };
    const asset = manifest.files.find((file) => file.path.startsWith("assets/"));
    assert.ok(asset);
    await fs.promises.writeFile(path.join(root, asset.path), "tampered-bytes");
    await execFileAsync("/usr/bin/zip", ["-q", "-r", target, "."], { cwd: root });
    return target;
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

test("round-trips a complete project with new IDs, image bytes and masks", async () => {
  const source = await insertCompleteProjectFixture();
  const archive = await exportProjectArchive(source.productId);
  try {
    const projectJson = (await execFileAsync("/usr/bin/unzip", ["-p", archive.archivePath, "project.json"], { encoding: "utf8" })).stdout;
    assert.equal(projectJson.includes("9876"), false);
    assert.equal(projectJson.includes("keyHint"), false);
    assert.equal(projectJson.includes("completed-job"), false);
    assert.equal(projectJson.includes(source.ids.incompleteVersion), false);

    const imported = await importProjectArchive(archive.archivePath);
    const importedGraph = await readProductGraph(imported.productId);
    const importedImage = importedGraph.imageVersions[0]!;
    assert.notEqual(imported.productId, source.productId);
    assert.equal(imported.productName, "完整迁移项目");
    assert.deepEqual([
      importedGraph.productAssets.length,
      importedGraph.specifications.length,
      importedGraph.sellingPoints.length,
      importedGraph.competitorAssets.length,
      importedGraph.analysisVersions.length,
      importedGraph.imageAnalysisCards.length,
      importedGraph.synthesisReports.length,
      importedGraph.generationTasks.length,
      importedGraph.designDirections.length,
      importedGraph.designPlanVersions.length,
      importedGraph.imageItems.length,
      importedGraph.imageVersions.length,
      importedGraph.templates.length,
    ], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2]);
    assert.deepEqual(await fs.promises.readFile(assetPath(importedGraph.productAssets[0]!.filePath)), source.productBytes);
    assert.deepEqual(await fs.promises.readFile(assetPath(importedGraph.competitorAssets[0]!.filePath)), source.competitorBytes);
    assert.deepEqual(await fs.promises.readFile(assetPath(importedImage.filePath)), source.generatedBytes);
    assert.equal(importedImage.maskPath && await sha256File(assetPath(importedImage.maskPath)), source.maskChecksum);
    assert.equal(importedImage.jobId, null);

    const importedTask = importedGraph.generationTasks[0]!;
    const importedDirection = importedGraph.designDirections[0]!;
    const importedPlan = importedGraph.designPlanVersions[0]!;
    const importedItem = importedGraph.imageItems[0]!;
    assert.equal(importedTask.productId, imported.productId);
    assert.equal(importedTask.analysisVersionId, importedGraph.analysisVersions[0]!.id);
    assert.equal(importedTask.draftSelectedDirectionId, importedDirection.id);
    assert.equal(importedPlan.selectedDirectionId, importedDirection.id);
    assert.equal(importedItem.productAssetId, importedGraph.productAssets[0]!.id);
    assert.deepEqual(JSON.parse(importedGraph.analysisVersions[0]!.competitorAssetIds), [importedGraph.competitorAssets[0]!.id]);
    assert.deepEqual(JSON.parse(importedItem.referenceAssetIds!), [importedGraph.productAssets[0]!.id]);
    assert.equal(importedGraph.templates.some((template) => template.id === importedTask.planDefaultTemplateId), true);
    assert.equal(importedGraph.templates.some((template) => template.id === importedTask.imageDefaultTemplateId), true);
    assert.equal(importedGraph.templates.some((template) => template.id === importedItem.promptTemplateId), true);
    assert.equal(JSON.stringify(JSON.parse(importedTask.configSnapshot)).includes("keyHint"), false);
    assert.equal(importedTask.latestPlanPromptSnapshot, "完整方案提示词");
    assert.equal(importedItem.visualElements, "产品与背景道具");
  } finally {
    await archive.cleanup();
  }
});

test("rejects a manifest hash mismatch without creating a product", async () => {
  const source = await insertCompleteProjectFixture();
  const archive = await exportProjectArchive(source.productId);
  const tamperedArchivePath = await tamperFirstAsset(archive.archivePath);
  const countBefore = await productCount();
  try {
    await assert.rejects(() => importProjectArchive(tamperedArchivePath), /校验失败/);
    assert.equal(await productCount(), countBefore);
  } finally {
    await archive.cleanup();
    await fs.promises.rm(tamperedArchivePath, { force: true });
  }
});

async function zipWithUnsafePath(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(paths.exports, "unsafe-path-fixture-"));
  const inside = path.join(root, "inside");
  const archivePath = path.join(paths.exports, `unsafe-path-${randomUUID()}.zip`);
  try {
    await fs.promises.mkdir(inside);
    await fs.promises.writeFile(path.join(root, "outside.txt"), "outside");
    await execFileAsync("/usr/bin/zip", ["-q", archivePath, "../outside.txt"], { cwd: inside });
    const names = (await execFileAsync("/usr/bin/unzip", ["-Z", "-1", archivePath], { encoding: "utf8" })).stdout;
    assert.match(names, /^\.\.\/outside\.txt$/m);
    return archivePath;
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

async function zipWithSymlink(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(paths.exports, "symlink-fixture-"));
  const archivePath = path.join(paths.exports, `symlink-${randomUUID()}.zip`);
  try {
    const directory = path.join(root, "assets", "originals");
    await fs.promises.mkdir(directory, { recursive: true });
    await fs.promises.writeFile(path.join(directory, "target.png"), "target");
    await fs.promises.symlink("target.png", path.join(directory, "link.png"));
    await execFileAsync("/usr/bin/zip", ["-q", "-y", archivePath, "assets/originals/link.png"], { cwd: root });
    return archivePath;
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

async function zipOverArchiveLimit(): Promise<string> {
  const archivePath = path.join(paths.exports, `oversize-${randomUUID()}.zip`);
  const handle = await fs.promises.open(archivePath, "w");
  try {
    await handle.truncate(MAX_ARCHIVE_BYTES + 1);
  } finally {
    await handle.close();
  }
  return archivePath;
}

async function zipWithListedSizeOverLimit(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(paths.exports, "listed-size-fixture-"));
  const archivePath = path.join(paths.exports, `listed-size-${randomUUID()}.zip`);
  try {
    await fs.promises.writeFile(path.join(root, "project.json"), "{}");
    await execFileAsync("/usr/bin/zip", ["-q", "-0", archivePath, "project.json"], { cwd: root });
    const archive = await fs.promises.readFile(archivePath);
    const centralHeader = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    assert.notEqual(centralHeader, -1);
    archive.writeUInt32LE(MAX_EXTRACTED_BYTES + 1, centralHeader + 24);
    await fs.promises.writeFile(archivePath, archive);
    return archivePath;
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

async function assertRejectedWithoutProductWrite(archivePath: string, expectedStatus?: number): Promise<void> {
  const countBefore = await productCount();
  try {
    await assert.rejects(
      () => importProjectArchive(archivePath),
      (error: unknown) => error instanceof TransferError && (expectedStatus === undefined || error.status === expectedStatus),
    );
    assert.equal(await productCount(), countBefore);
  } finally {
    await fs.promises.rm(archivePath, { force: true });
  }
}

test("rejects a parent-directory ZIP entry before database writes", async () => {
  await assertRejectedWithoutProductWrite(await zipWithUnsafePath());
});

test("rejects a ZIP symlink before database writes", async () => {
  await assertRejectedWithoutProductWrite(await zipWithSymlink());
});

test("rejects an archive larger than 500 MB before database writes", async () => {
  await assertRejectedWithoutProductWrite(await zipOverArchiveLimit(), 413);
});

test("rejects a listed extracted size larger than 1 GB before database writes", async () => {
  await assertRejectedWithoutProductWrite(await zipWithListedSizeOverLimit(), 413);
});
