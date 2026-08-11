import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  analysisVersions,
  competitorAssets,
  designDirections,
  designPlanVersions,
  generationTasks,
  imageAnalysisCards,
  imageItems,
  imageVersions,
  modelProviders,
  modelCallLogs,
  modelSceneRoutes,
  outputPresets,
  productAssets,
  products,
  productSpecifications,
  promptTemplates,
  sellingPoints,
  synthesisReports,
} from "../db/schema.js";
import { assetPath, dataDir, paths } from "./paths.js";

const execFileAsync = promisify(execFile);

export const TRANSFER_FORMAT_VERSION = 1;
export const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;
export const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;

export class TransferError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "TransferError";
  }
}

export type TransferManifest = {
  formatVersion: 1;
  kind: "project";
  createdAt: string;
  files: Array<{ path: string; bytes: number; checksum: string }>;
};

type ProjectTransferGraph = {
  product: typeof products.$inferSelect;
  productAssets: Array<typeof productAssets.$inferSelect>;
  specifications: Array<typeof productSpecifications.$inferSelect>;
  sellingPoints: Array<typeof sellingPoints.$inferSelect>;
  competitorAssets: Array<typeof competitorAssets.$inferSelect>;
  analysisVersions: Array<typeof analysisVersions.$inferSelect>;
  imageAnalysisCards: Array<typeof imageAnalysisCards.$inferSelect>;
  synthesisReports: Array<typeof synthesisReports.$inferSelect>;
  generationTasks: Array<typeof generationTasks.$inferSelect>;
  designDirections: Array<typeof designDirections.$inferSelect>;
  designPlanVersions: Array<typeof designPlanVersions.$inferSelect>;
  imageItems: Array<typeof imageItems.$inferSelect>;
  imageVersions: Array<typeof imageVersions.$inferSelect>;
  templates: Array<typeof promptTemplates.$inferSelect>;
};

type LoadedProjectGraph = Omit<ProjectTransferGraph, "product"> & {
  product: ProjectTransferGraph["product"] | null;
};

type StagedAsset = { sourcePath: string; targetPath: string; checksum: string };
type ZipEntry = { path: string; uncompressedBytes: number; isSymlink: boolean };

const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/);
const dateSchema = z.string().datetime().transform((value) => new Date(value));
const nullableDateSchema = dateSchema.nullable();
const idSchema = z.string().min(1).max(500);

const productRowSchema = z.object({
  id: idSchema,
  name: z.string(),
  notes: z.string().nullable(),
  archivedAt: nullableDateSchema,
  createdAt: dateSchema,
  updatedAt: dateSchema,
}).strict();

const productAssetRowSchema = z.object({
  id: idSchema,
  productId: idSchema,
  filePath: z.string(),
  checksum: checksumSchema,
  sortOrder: z.number().int(),
  analysis: z.string().nullable(),
  createdAt: dateSchema,
}).strict();

const specificationRowSchema = z.object({
  id: idSchema,
  productId: idSchema,
  label: z.string(),
  value: z.string(),
  sortOrder: z.number().int(),
}).strict();

const sellingPointRowSchema = z.object({
  id: idSchema,
  productId: idSchema,
  content: z.string(),
  sortOrder: z.number().int(),
}).strict();

const competitorAssetRowSchema = z.object({
  id: idSchema,
  productId: idSchema,
  filePath: z.string(),
  checksum: checksumSchema,
  originalName: z.string().nullable(),
  createdAt: dateSchema,
}).strict();

const analysisVersionRowSchema = z.object({
  id: idSchema,
  productId: idSchema,
  versionNumber: z.number().int(),
  competitorAssetIds: z.string(),
  createdAt: dateSchema,
}).strict();

const imageAnalysisCardRowSchema = z.object({
  id: idSchema,
  analysisVersionId: idSchema,
  competitorAssetId: idSchema,
  modelOutput: z.string(),
  humanOverride: z.string().nullable(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
}).strict();

const synthesisReportRowSchema = z.object({
  id: idSchema,
  analysisVersionId: idSchema,
  content: z.string(),
  createdAt: dateSchema,
}).strict();

const generationTaskRowSchema = z.object({
  id: idSchema,
  productId: idSchema,
  analysisVersionId: idSchema,
  outputTypes: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  configSnapshot: z.string(),
  planDefaultTemplateId: idSchema.nullable(),
  imageDefaultTemplateId: idSchema.nullable(),
  latestPlanPromptSnapshot: z.string().nullable(),
  draftSelectedDirectionId: idSchema.nullable(),
  currentStep: z.number().int().min(1).max(4),
  createdAt: dateSchema,
  updatedAt: dateSchema,
}).strict();

const designDirectionRowSchema = z.object({
  id: idSchema,
  generationTaskId: idSchema,
  label: z.string(),
  content: z.string(),
  createdAt: dateSchema,
}).strict();

const designPlanVersionRowSchema = z.object({
  id: idSchema,
  generationTaskId: idSchema,
  selectedDirectionId: idSchema,
  versionNumber: z.number().int(),
  confirmedAt: nullableDateSchema,
  createdAt: dateSchema,
}).strict();

const imageItemRowSchema = z.object({
  id: idSchema,
  designPlanVersionId: idSchema,
  listType: z.enum(["main_image", "detail_page"]),
  sortOrder: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  sellingPoints: z.string().nullable(),
  suggestedCopy: z.string().nullable(),
  compositionIntent: z.string().nullable(),
  lighting: z.string().nullable(),
  angle: z.string().nullable(),
  background: z.string().nullable(),
  mood: z.string().nullable(),
  visualElements: z.string().nullable(),
  productAssetId: idSchema.nullable(),
  referenceAssetIds: z.string().nullable(),
  promptTemplateId: idSchema.nullable(),
  outputPresetSnapshot: z.string(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
}).strict();

const imageVersionRowSchema = z.object({
  id: idSchema,
  imageItemId: idSchema,
  filePath: z.string(),
  checksum: z.string(),
  generationType: z.enum(["initial", "regeneration", "inpaint"]),
  parentVersionId: idSchema.nullable(),
  jobId: z.string().nullable(),
  maskPath: z.string().nullable(),
  instruction: z.string().nullable(),
  promptTemplateId: idSchema.nullable(),
  finalPrompt: z.string().nullable(),
  polishInstruction: z.string().nullable(),
  isSelected: z.boolean(),
  createdAt: dateSchema,
}).strict();

const templateRowSchema = z.object({
  id: idSchema,
  type: z.enum(["design_plan", "image_generation"]),
  name: z.string(),
  description: z.string().nullable(),
  body: z.string(),
  isBuiltIn: z.boolean(),
  isDefault: z.boolean(),
  archivedAt: nullableDateSchema,
  createdAt: dateSchema,
  updatedAt: dateSchema,
}).strict();

const projectTransferGraphSchema = z.object({
  product: productRowSchema,
  productAssets: z.array(productAssetRowSchema),
  specifications: z.array(specificationRowSchema),
  sellingPoints: z.array(sellingPointRowSchema),
  competitorAssets: z.array(competitorAssetRowSchema),
  analysisVersions: z.array(analysisVersionRowSchema),
  imageAnalysisCards: z.array(imageAnalysisCardRowSchema),
  synthesisReports: z.array(synthesisReportRowSchema),
  generationTasks: z.array(generationTaskRowSchema),
  designDirections: z.array(designDirectionRowSchema),
  designPlanVersions: z.array(designPlanVersionRowSchema),
  imageItems: z.array(imageItemRowSchema),
  imageVersions: z.array(imageVersionRowSchema),
  templates: z.array(templateRowSchema),
}).strict();

const manifestSchema = z.object({
  formatVersion: z.literal(TRANSFER_FORMAT_VERSION),
  kind: z.literal("project"),
  createdAt: z.string().datetime(),
  files: z.array(z.object({
    path: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    checksum: checksumSchema,
  }).strict()),
}).strict();

const providerNameSchema = z.enum(["bailian", "volcengine", "gpt_proxy"]);

const configTransferSchema = z.object({
  formatVersion: z.literal(1),
  kind: z.literal("config"),
  providers: z.array(z.object({
    name: providerNameSchema,
    baseUrl: z.string().nullable(),
  })),
  routes: z.array(z.object({
    scene: z.enum([
      "competitor_image_analysis",
      "competitor_synthesis",
      "design_plan",
      "image_generation",
      "image_edit",
    ]),
    providerName: providerNameSchema.nullable(),
    modelId: z.string().nullable(),
    billingModelId: z.string().nullable(),
    parameters: z.string().nullable(),
    isDefault: z.boolean(),
  })),
  presets: z.array(z.object({
    name: z.string().min(1).max(100),
    presetType: z.enum(["main_image", "detail_module"]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    format: z.enum(["jpg", "png"]),
    quality: z.number().int().min(1).max(100),
    isDefault: z.boolean(),
  })),
  templates: z.array(z.object({
    type: z.enum(["design_plan", "image_generation"]),
    name: z.string().min(1).max(100),
    description: z.string().max(500).nullable(),
    body: z.string().min(1),
    isDefault: z.boolean(),
    archivedAt: z.number().int().nullable(),
  })),
});

export type ConfigTransfer = z.infer<typeof configTransferSchema>;

/** Export portable settings only; credentials and credential state remain local. */
export async function exportConfig(): Promise<ConfigTransfer> {
  const [providers, routes, presets, templates] = await Promise.all([
    db.select().from(modelProviders),
    db.select({ route: modelSceneRoutes, providerName: modelProviders.name })
      .from(modelSceneRoutes)
      .leftJoin(modelProviders, eq(modelSceneRoutes.providerId, modelProviders.id)),
    db.select().from(outputPresets),
    db.select().from(promptTemplates),
  ]);

  return {
    formatVersion: 1,
    kind: "config",
    providers: providers.map(({ name, baseUrl }) => ({ name, baseUrl })),
    routes: routes.map(({ route, providerName }) => ({
      scene: route.scene,
      providerName,
      modelId: route.modelId,
      billingModelId: route.billingModelId,
      parameters: route.parameters,
      isDefault: route.isDefault,
    })),
    presets: presets.map(({ id, createdAt, updatedAt, ...preset }) => preset),
    templates: templates
      .filter((template) => !template.isBuiltIn)
      .map(({ id, isBuiltIn, createdAt, updatedAt, archivedAt, ...template }) => ({
        ...template,
        archivedAt: archivedAt?.getTime() ?? null,
      })),
  };
}

/** Import portable settings without changing keys or their local configuration state. */
export async function importConfig(input: unknown): Promise<{ importedTemplates: number }> {
  const config = configTransferSchema.parse(input);

  return db.transaction((tx) => {
    const now = new Date();
    const currentProviders = tx.select().from(modelProviders).all();
    const providerIds = new Map(currentProviders.map((provider) => [provider.name, provider.id]));

    for (const provider of config.providers) {
      const id = providerIds.get(provider.name);
      if (id) {
        tx.update(modelProviders)
          .set({ baseUrl: provider.baseUrl, updatedAt: now })
          .where(eq(modelProviders.id, id))
          .run();
      } else {
        const newId = randomUUID();
        tx.insert(modelProviders).values({
          id: newId,
          name: provider.name,
          baseUrl: provider.baseUrl,
          isConfigured: false,
          keyHint: null,
          updatedAt: now,
        }).run();
        providerIds.set(provider.name, newId);
      }
    }

    tx.update(modelCallLogs).set({ modelRouteId: null }).run();
    tx.delete(modelSceneRoutes).run();
    tx.delete(outputPresets).run();

    if (config.routes.length) {
      tx.insert(modelSceneRoutes).values(config.routes.map((route) => ({
        id: randomUUID(),
        scene: route.scene,
        providerId: route.providerName ? providerIds.get(route.providerName) ?? null : null,
        modelId: route.modelId,
        billingModelId: route.billingModelId,
        parameters: route.parameters,
        isDefault: route.isDefault,
        updatedAt: now,
      }))).run();
    }

    if (config.presets.length) {
      tx.insert(outputPresets).values(config.presets.map((preset) => ({
        id: randomUUID(),
        ...preset,
        createdAt: now,
        updatedAt: now,
      }))).run();
    }

    const existingTemplates = tx.select().from(promptTemplates).all();
    const templateKeys = new Set(existingTemplates.map((template) => JSON.stringify([
      template.type,
      template.name,
      template.body,
    ])));
    const importedTemplates = config.templates.filter((candidate) => {
      const key = JSON.stringify([candidate.type, candidate.name, candidate.body]);
      if (templateKeys.has(key)) return false;
      templateKeys.add(key);
      return true;
    });

    if (importedTemplates.length) {
      tx.insert(promptTemplates).values(importedTemplates.map((template) => ({
        id: randomUUID(),
        ...template,
        archivedAt: template.archivedAt === null ? null : new Date(template.archivedAt),
        isBuiltIn: false,
        createdAt: now,
        updatedAt: now,
      }))).run();
    }

    return { importedTemplates: importedTemplates.length };
  });
}

function asTransferError(error: unknown, status: number, message: string): TransferError {
  if (error instanceof TransferError) return error;
  return new TransferError(status, `${message}${error instanceof Error ? `：${error.message}` : ""}`);
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new TransferError(422, `${label}不是有效 JSON`);
  }
}

function scrubSensitiveSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSensitiveSnapshot);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (["keyhint", "apikey", "api_key", "authorization", "jobid"].includes(normalized)) continue;
    result[key] = scrubSensitiveSnapshot(child);
  }
  return result;
}

function sanitizeConfigSnapshot(snapshot: string): string {
  const parsed = parseJson(snapshot, "任务配置快照");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TransferError(422, "任务配置快照必须是 JSON 对象");
  }
  return JSON.stringify(scrubSensitiveSnapshot(parsed));
}

function sanitizeGraphSecrets(graph: ProjectTransferGraph): ProjectTransferGraph {
  return {
    ...graph,
    generationTasks: graph.generationTasks.map((task) => ({
      ...task,
      configSnapshot: sanitizeConfigSnapshot(task.configSnapshot),
    })),
    imageVersions: graph.imageVersions.map((version) => ({ ...version, jobId: null })),
  };
}

function sanitizeProjectGraph(graph: ProjectTransferGraph): ProjectTransferGraph {
  const sanitized = sanitizeGraphSecrets(graph);
  return {
    ...sanitized,
    imageVersions: sanitized.imageVersions.filter((version) => version.filePath.length > 0),
  };
}

async function loadProjectGraph(productId: string): Promise<LoadedProjectGraph> {
  const [product] = await db.select().from(products).where(eq(products.id, productId));
  if (!product) {
    return {
      product: null,
      productAssets: [],
      specifications: [],
      sellingPoints: [],
      competitorAssets: [],
      analysisVersions: [],
      imageAnalysisCards: [],
      synthesisReports: [],
      generationTasks: [],
      designDirections: [],
      designPlanVersions: [],
      imageItems: [],
      imageVersions: [],
      templates: [],
    };
  }

  const [projectAssets, specifications, points, competitors, analyses, tasks] = await Promise.all([
    db.select().from(productAssets).where(eq(productAssets.productId, productId)),
    db.select().from(productSpecifications).where(eq(productSpecifications.productId, productId)),
    db.select().from(sellingPoints).where(eq(sellingPoints.productId, productId)),
    db.select().from(competitorAssets).where(eq(competitorAssets.productId, productId)),
    db.select().from(analysisVersions).where(eq(analysisVersions.productId, productId)),
    db.select().from(generationTasks).where(eq(generationTasks.productId, productId)),
  ]);
  const analysisIds = analyses.map((row) => row.id);
  const taskIds = tasks.map((row) => row.id);
  const [cards, reports, directions, plans] = await Promise.all([
    analysisIds.length
      ? db.select().from(imageAnalysisCards).where(inArray(imageAnalysisCards.analysisVersionId, analysisIds))
      : Promise.resolve([]),
    analysisIds.length
      ? db.select().from(synthesisReports).where(inArray(synthesisReports.analysisVersionId, analysisIds))
      : Promise.resolve([]),
    taskIds.length
      ? db.select().from(designDirections).where(inArray(designDirections.generationTaskId, taskIds))
      : Promise.resolve([]),
    taskIds.length
      ? db.select().from(designPlanVersions).where(inArray(designPlanVersions.generationTaskId, taskIds))
      : Promise.resolve([]),
  ]);
  const planIds = plans.map((row) => row.id);
  const items = planIds.length
    ? await db.select().from(imageItems).where(inArray(imageItems.designPlanVersionId, planIds))
    : [];
  const itemIds = items.map((row) => row.id);
  const versions = itemIds.length
    ? await db.select().from(imageVersions).where(inArray(imageVersions.imageItemId, itemIds))
    : [];
  const templateIds = [...new Set([
    ...tasks.flatMap((row) => [row.planDefaultTemplateId, row.imageDefaultTemplateId]),
    ...items.map((row) => row.promptTemplateId),
    ...versions.map((row) => row.promptTemplateId),
  ].filter((id): id is string => id !== null))];
  const templates = templateIds.length
    ? await db.select().from(promptTemplates).where(inArray(promptTemplates.id, templateIds))
    : [];

  return {
    product,
    productAssets: projectAssets,
    specifications,
    sellingPoints: points,
    competitorAssets: competitors,
    analysisVersions: analyses,
    imageAnalysisCards: cards,
    synthesisReports: reports,
    generationTasks: tasks,
    designDirections: directions,
    designPlanVersions: plans,
    imageItems: items,
    imageVersions: versions,
    templates,
  };
}

async function writeJson(targetPath: string, value: unknown): Promise<void> {
  await fs.promises.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const handle = await fs.promises.open(filePath, "r");
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk);
  } finally {
    await handle.close().catch(() => undefined);
  }
  return hash.digest("hex");
}

function isInside(candidate: string, root: string): boolean {
  return candidate.startsWith(`${root}${path.sep}`);
}

function assertPortableAssetPath(relativePath: string, expectedDirectory: "originals" | "generated" | "masks"): string {
  if (!relativePath || relativePath.includes("\\") || path.posix.isAbsolute(relativePath)) {
    throw new TransferError(422, "素材路径不安全");
  }
  const normalized = path.posix.normalize(relativePath);
  const prefix = `assets/${expectedDirectory}/`;
  if (normalized !== relativePath || !normalized.startsWith(prefix) || normalized === prefix) {
    throw new TransferError(422, "素材路径不在允许目录中");
  }
  return normalized;
}

async function regularFileMetadata(filePath: string, relativePath: string): Promise<{ path: string; bytes: number; checksum: string }> {
  const stat = await fs.promises.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new TransferError(422, "项目素材不是普通文件");
  return { path: relativePath, bytes: stat.size, checksum: await sha256File(filePath) };
}

async function copyGraphAssets(
  graph: ProjectTransferGraph,
  root: string,
): Promise<Array<{ path: string; bytes: number; checksum: string }>> {
  const requested = new Map<string, { directory: "originals" | "generated" | "masks"; checksum?: string }>();
  const add = (relativePath: string, directory: "originals" | "generated" | "masks", checksum?: string) => {
    const safePath = assertPortableAssetPath(relativePath, directory);
    const existing = requested.get(safePath);
    if (existing && (existing.directory !== directory || (existing.checksum && checksum && existing.checksum !== checksum))) {
      throw new TransferError(422, "项目素材引用冲突");
    }
    const resolvedChecksum = existing?.checksum ?? checksum;
    requested.set(safePath, { directory, ...(resolvedChecksum !== undefined ? { checksum: resolvedChecksum } : {}) });
  };
  for (const row of graph.productAssets) add(row.filePath, "originals", row.checksum);
  for (const row of graph.competitorAssets) add(row.filePath, "originals", row.checksum);
  for (const row of graph.imageVersions) {
    add(row.filePath, "generated", row.checksum);
    if (row.maskPath) add(row.maskPath, "masks");
  }

  const files: Array<{ path: string; bytes: number; checksum: string }> = [];
  for (const [relativePath, expected] of requested) {
    const sourcePath = assetPath(relativePath);
    const expectedRoot = path.resolve(paths[expected.directory]);
    const resolvedSource = path.resolve(sourcePath);
    if (!isInside(resolvedSource, expectedRoot)) throw new TransferError(422, "项目素材路径越界");
    const [realSource, realRoot] = await Promise.all([
      fs.promises.realpath(resolvedSource),
      fs.promises.realpath(expectedRoot),
    ]).catch((error) => { throw asTransferError(error, 422, "项目素材缺失"); });
    if (!isInside(realSource, realRoot)) throw new TransferError(422, "项目素材路径越界");

    const destination = path.resolve(root, ...relativePath.split("/"));
    if (!isInside(destination, path.resolve(root))) throw new TransferError(422, "项目素材目标路径越界");
    await fs.promises.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.promises.copyFile(realSource, destination, fs.constants.COPYFILE_EXCL);
    const metadata = await regularFileMetadata(destination, relativePath);
    if (expected.checksum && metadata.checksum !== expected.checksum) {
      throw new TransferError(422, "项目素材校验失败");
    }
    files.push(metadata);
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function makeManifest(files: Array<{ path: string; bytes: number; checksum: string }>): TransferManifest {
  return {
    formatVersion: TRANSFER_FORMAT_VERSION,
    kind: "project",
    createdAt: new Date().toISOString(),
    files: [...files].sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export async function exportProjectArchive(productId: string): Promise<{ archivePath: string; cleanup: () => Promise<void> }> {
  const loaded = await loadProjectGraph(productId);
  if (!loaded.product) throw new TransferError(404, "项目不存在");
  const graph = sanitizeProjectGraph(loaded as ProjectTransferGraph);
  await fs.promises.mkdir(paths.exports, { recursive: true, mode: 0o700 });
  const workDir = await fs.promises.mkdtemp(path.join(paths.exports, "project-export-"));
  const archivePath = path.join(paths.exports, `project-${randomUUID()}.zip`);
  const cleanup = async () => {
    await Promise.all([
      fs.promises.rm(workDir, { recursive: true, force: true }),
      fs.promises.rm(archivePath, { force: true }),
    ]);
  };
  try {
    const assetFiles = await copyGraphAssets(graph, workDir);
    const projectPath = path.join(workDir, "project.json");
    await writeJson(projectPath, graph);
    const projectFile = await regularFileMetadata(projectPath, "project.json");
    await writeJson(path.join(workDir, "manifest.json"), makeManifest([projectFile, ...assetFiles]));
    await execFileAsync("/usr/bin/zip", ["-q", "-r", archivePath, "."], { cwd: workDir });
    return { archivePath, cleanup };
  } catch (error) {
    await cleanup();
    throw asTransferError(error, 500, "项目导出失败");
  }
}

async function assertFileSizeAtMost(filePath: string, maxBytes: number): Promise<void> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(filePath);
  } catch (error) {
    throw asTransferError(error, 400, "无法读取项目包");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new TransferError(400, "项目包必须是普通文件");
  if (stat.size > maxBytes) throw new TransferError(413, "项目包超过 500 MB 大小限制");
}

async function listZipEntries(archivePath: string): Promise<ZipEntry[]> {
  let stdout: string;
  try {
    const result = await execFileAsync("/usr/bin/unzip", ["-Z", "-l", archivePath], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (error) {
    throw asTransferError(error, 422, "项目 ZIP 损坏或无法读取");
  }

  const entries: ZipEntry[] = [];
  const entryPattern = /^([dl-][rwxStTs-]{9})\s+\d+\.\d+\s+\S+\s+(\d+)\s+\S+\s+\d+\s+\S+\s+\S+\s+\S+\s+(.+)$/;
  for (const line of stdout.split(/\r?\n/)) {
    const match = entryPattern.exec(line);
    if (!match) continue;
    const uncompressedBytes = Number(match[2]);
    if (!Number.isSafeInteger(uncompressedBytes) || uncompressedBytes < 0) {
      throw new TransferError(422, "项目 ZIP 条目大小无效");
    }
    entries.push({
      path: match[3]!,
      uncompressedBytes,
      isSymlink: match[1]!.startsWith("l"),
    });
  }
  const declaredCount = /number of entries:\s*(\d+)/.exec(stdout)?.[1];
  if (declaredCount === undefined || Number(declaredCount) !== entries.length || entries.length === 0) {
    throw new TransferError(422, "项目 ZIP 条目列表无效");
  }
  return entries;
}

function assertSafeArchiveEntry(entry: ZipEntry): void {
  const entryPath = entry.path;
  if (
    entry.isSymlink
    || !entryPath
    || entryPath.includes("\\")
    || entryPath.includes("\0")
    || /[\r\n]/.test(entryPath)
    || path.posix.isAbsolute(entryPath)
    || /^[a-zA-Z]:/.test(entryPath)
  ) {
    throw new TransferError(422, "项目 ZIP 包含不安全路径或符号链接");
  }
  const normalized = path.posix.normalize(entryPath);
  if (normalized !== entryPath || entryPath.split("/").includes("..")) {
    throw new TransferError(422, "项目 ZIP 包含不安全路径");
  }

  if (entryPath.endsWith("/")) {
    if (!["assets/", "assets/originals/", "assets/generated/", "assets/masks/"].includes(entryPath)) {
      throw new TransferError(422, "项目 ZIP 包含非白名单目录");
    }
    return;
  }
  if (entryPath === "manifest.json" || entryPath === "project.json") return;
  const assetMatch = /^assets\/(originals|generated|masks)\/([^/]+)$/.exec(entryPath);
  if (!assetMatch || assetMatch[2] === "." || assetMatch[2] === "..") {
    throw new TransferError(422, "项目 ZIP 包含非白名单文件");
  }
}

function assertListedUncompressedSizeAtMost(entries: ZipEntry[], maxBytes: number): void {
  let total = 0;
  for (const entry of entries) {
    total += entry.uncompressedBytes;
    if (!Number.isSafeInteger(total) || total > maxBytes) {
      throw new TransferError(413, "项目 ZIP 解压后超过 1 GB 大小限制");
    }
  }
}

async function walkExtractedTree(root: string): Promise<Array<{ path: string; bytes: number }>> {
  const files: Array<{ path: string; bytes: number }> = [];
  const visit = async (directory: string): Promise<void> => {
    const children = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const stat = await fs.promises.lstat(absolute);
      const archivePath = child.isDirectory() ? `${relative}/` : relative;
      assertSafeArchiveEntry({ path: archivePath, uncompressedBytes: stat.size, isSymlink: stat.isSymbolicLink() });
      if (stat.isDirectory()) await visit(absolute);
      else if (stat.isFile()) files.push({ path: relative, bytes: stat.size });
      else throw new TransferError(422, "项目 ZIP 解压后包含特殊文件");
    }
  };
  await visit(root);
  return files;
}

async function assertExtractedTreeSafeAndAtMost(root: string, maxBytes: number): Promise<void> {
  const files = await walkExtractedTree(root);
  let total = 0;
  for (const file of files) {
    total += file.bytes;
    if (!Number.isSafeInteger(total) || total > maxBytes) {
      throw new TransferError(413, "项目 ZIP 实际解压后超过 1 GB 大小限制");
    }
  }
}

function uniqueIds<T extends { id: string }>(rows: T[], label: string): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new TransferError(422, `${label}包含重复 ID`);
    ids.add(row.id);
  }
  return ids;
}

function parseIdArray(value: string, label: string): string[] {
  const result = z.array(idSchema).safeParse(parseJson(value, label));
  if (!result.success) throw new TransferError(422, `${label}必须是 ID 数组`);
  return result.data;
}

function assertJson(value: string | null, label: string): void {
  if (value !== null) parseJson(value, label);
}

function validateProjectGraph(graph: ProjectTransferGraph): void {
  const productId = graph.product.id;
  const productAssetIds = uniqueIds(graph.productAssets, "商品素材");
  uniqueIds(graph.specifications, "商品规格");
  uniqueIds(graph.sellingPoints, "商品卖点");
  const competitorAssetIds = uniqueIds(graph.competitorAssets, "竞品素材");
  const analysisIds = uniqueIds(graph.analysisVersions, "分析版本");
  uniqueIds(graph.imageAnalysisCards, "分析卡片");
  uniqueIds(graph.synthesisReports, "综合报告");
  const taskIds = uniqueIds(graph.generationTasks, "生成任务");
  const directionIds = uniqueIds(graph.designDirections, "设计方向");
  const planIds = uniqueIds(graph.designPlanVersions, "设计方案");
  const itemIds = uniqueIds(graph.imageItems, "图片项");
  const versionIds = uniqueIds(graph.imageVersions, "图片版本");
  const templateIds = uniqueIds(graph.templates, "提示词模板");
  const directionsById = new Map(graph.designDirections.map((row) => [row.id, row]));
  const plansById = new Map(graph.designPlanVersions.map((row) => [row.id, row]));
  const itemsById = new Map(graph.imageItems.map((row) => [row.id, row]));
  const templatesById = new Map(graph.templates.map((row) => [row.id, row]));

  for (const row of [...graph.productAssets, ...graph.specifications, ...graph.sellingPoints, ...graph.competitorAssets]) {
    if (row.productId !== productId) throw new TransferError(422, "项目业务数据关联不完整");
  }
  for (const row of graph.productAssets) {
    assertPortableAssetPath(row.filePath, "originals");
    assertJson(row.analysis, "商品素材分析");
  }
  for (const row of graph.competitorAssets) assertPortableAssetPath(row.filePath, "originals");
  for (const row of graph.analysisVersions) {
    if (row.productId !== productId) throw new TransferError(422, "分析版本不属于当前项目");
    for (const assetId of parseIdArray(row.competitorAssetIds, "竞品素材引用")) {
      if (!competitorAssetIds.has(assetId)) throw new TransferError(422, "竞品素材引用不完整");
    }
  }
  for (const row of graph.imageAnalysisCards) {
    if (!analysisIds.has(row.analysisVersionId) || !competitorAssetIds.has(row.competitorAssetId)) {
      throw new TransferError(422, "分析卡片关联不完整");
    }
    assertJson(row.modelOutput, "分析卡片结果");
    assertJson(row.humanOverride, "分析卡片人工修订");
  }
  for (const row of graph.synthesisReports) {
    if (!analysisIds.has(row.analysisVersionId)) throw new TransferError(422, "综合报告关联不完整");
    assertJson(row.content, "综合报告");
  }
  for (const row of graph.generationTasks) {
    if (row.productId !== productId || !analysisIds.has(row.analysisVersionId)) {
      throw new TransferError(422, "生成任务关联不完整");
    }
    const outputTypes = z.array(z.enum(["main_image", "detail_page"])).safeParse(parseJson(row.outputTypes, "输出类型"));
    if (!outputTypes.success) throw new TransferError(422, "输出类型无效");
    assertJson(row.configSnapshot, "任务配置快照");
    if (row.planDefaultTemplateId && templatesById.get(row.planDefaultTemplateId)?.type !== "design_plan") {
      throw new TransferError(422, "方案提示词模板关联不完整");
    }
    if (row.imageDefaultTemplateId && templatesById.get(row.imageDefaultTemplateId)?.type !== "image_generation") {
      throw new TransferError(422, "图片提示词模板关联不完整");
    }
    if (row.draftSelectedDirectionId) {
      const direction = directionsById.get(row.draftSelectedDirectionId);
      if (!direction || direction.generationTaskId !== row.id) throw new TransferError(422, "草稿方向关联不完整");
    }
  }
  for (const row of graph.designDirections) {
    if (!taskIds.has(row.generationTaskId)) throw new TransferError(422, "设计方向关联不完整");
    assertJson(row.content, "设计方向内容");
  }
  for (const row of graph.designPlanVersions) {
    const direction = directionsById.get(row.selectedDirectionId);
    if (!taskIds.has(row.generationTaskId) || !direction || direction.generationTaskId !== row.generationTaskId) {
      throw new TransferError(422, "设计方案关联不完整");
    }
  }
  for (const row of graph.imageItems) {
    if (!planIds.has(row.designPlanVersionId)) throw new TransferError(422, "图片项关联不完整");
    if (row.productAssetId && !productAssetIds.has(row.productAssetId)) throw new TransferError(422, "图片项商品素材引用不完整");
    if (row.referenceAssetIds) {
      for (const assetId of parseIdArray(row.referenceAssetIds, "图片参考素材")) {
        if (!productAssetIds.has(assetId)) throw new TransferError(422, "图片参考素材引用不完整");
      }
    }
    if (row.promptTemplateId && templatesById.get(row.promptTemplateId)?.type !== "image_generation") {
      throw new TransferError(422, "图片项提示词模板关联不完整");
    }
    assertJson(row.sellingPoints, "图片项卖点");
    assertJson(row.outputPresetSnapshot, "输出预设快照");
  }
  for (const row of graph.imageVersions) {
    if (!itemIds.has(row.imageItemId)) throw new TransferError(422, "图片版本关联不完整");
    if (row.parentVersionId) {
      const parent = graph.imageVersions.find((candidate) => candidate.id === row.parentVersionId);
      if (!parent || parent.imageItemId !== row.imageItemId) throw new TransferError(422, "图片父版本关联不完整");
    }
    if (row.promptTemplateId && templatesById.get(row.promptTemplateId)?.type !== "image_generation") {
      throw new TransferError(422, "图片版本提示词模板关联不完整");
    }
    if (row.filePath) {
      assertPortableAssetPath(row.filePath, "generated");
      if (!checksumSchema.safeParse(row.checksum).success) throw new TransferError(422, "图片版本校验值无效");
      if (row.maskPath) assertPortableAssetPath(row.maskPath, "masks");
    } else if (row.checksum || row.maskPath) {
      throw new TransferError(422, "未完成图片版本包含无效素材引用");
    }
  }

  for (const row of graph.templates) {
    if (!templateIds.has(row.id)) throw new TransferError(422, "提示词模板无效");
  }
  for (const row of graph.imageVersions) {
    if (row.parentVersionId && !versionIds.has(row.parentVersionId)) throw new TransferError(422, "图片父版本缺失");
  }
  for (const row of graph.imageItems) {
    const plan = plansById.get(row.designPlanVersionId);
    if (!plan) throw new TransferError(422, "图片项方案缺失");
  }
  for (const row of graph.imageVersions) {
    if (!itemsById.has(row.imageItemId)) throw new TransferError(422, "图片版本图片项缺失");
  }
}

function expectedManifestPaths(graph: ProjectTransferGraph): Set<string> {
  const expected = new Set<string>(["project.json"]);
  for (const row of graph.productAssets) expected.add(row.filePath);
  for (const row of graph.competitorAssets) expected.add(row.filePath);
  for (const row of graph.imageVersions) {
    if (!row.filePath) continue;
    expected.add(row.filePath);
    if (row.maskPath) expected.add(row.maskPath);
  }
  return expected;
}

async function readJsonFile(filePath: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    throw asTransferError(error, 422, `${label}损坏`);
  }
}

async function readAndValidateProjectFiles(root: string): Promise<{ manifest: TransferManifest; graph: ProjectTransferGraph }> {
  const manifestResult = manifestSchema.safeParse(await readJsonFile(path.join(root, "manifest.json"), "项目清单"));
  if (!manifestResult.success) throw new TransferError(422, "项目清单格式或版本无效");
  const graphResult = projectTransferGraphSchema.safeParse(await readJsonFile(path.join(root, "project.json"), "项目数据"));
  if (!graphResult.success) throw new TransferError(422, "项目数据格式无效");
  const graph = sanitizeGraphSecrets(graphResult.data);
  validateProjectGraph(graph);

  const expected = expectedManifestPaths(graph);
  const listed = new Set<string>();
  for (const file of manifestResult.data.files) {
    assertSafeArchiveEntry({ path: file.path, uncompressedBytes: file.bytes, isSymlink: false });
    if (file.path === "manifest.json" || listed.has(file.path)) throw new TransferError(422, "项目清单包含重复或非法文件");
    listed.add(file.path);
  }
  if (listed.size !== expected.size || [...expected].some((filePath) => !listed.has(filePath))) {
    throw new TransferError(422, "项目清单与业务素材不一致");
  }
  return { manifest: manifestResult.data, graph };
}

async function verifyManifestFiles(root: string, manifest: TransferManifest): Promise<void> {
  const listed = new Set<string>();
  for (const file of manifest.files) {
    if (listed.has(file.path)) throw new TransferError(422, "项目清单包含重复文件");
    listed.add(file.path);
    const absolute = path.resolve(root, ...file.path.split("/"));
    if (!isInside(absolute, path.resolve(root))) throw new TransferError(422, "项目清单路径越界");
    let metadata: { path: string; bytes: number; checksum: string };
    try {
      metadata = await regularFileMetadata(absolute, file.path);
    } catch (error) {
      throw asTransferError(error, 422, "项目文件缺失或校验失败");
    }
    if (metadata.bytes !== file.bytes || metadata.checksum !== file.checksum) {
      throw new TransferError(422, `项目文件校验失败：${file.path}`);
    }
  }
  const extracted = await walkExtractedTree(root);
  const actual = new Set(extracted.filter((file) => file.path !== "manifest.json").map((file) => file.path));
  if (actual.size !== listed.size || [...actual].some((filePath) => !listed.has(filePath))) {
    throw new TransferError(422, "项目 ZIP 包含未声明或缺失文件");
  }
}

function safeAssetExtension(relativePath: string, fallback: string): string {
  const extension = path.posix.extname(relativePath).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : fallback;
}

async function stageImportedAssets(root: string, graph: ProjectTransferGraph): Promise<StagedAsset[]> {
  const requested = new Map<string, { directory: "originals" | "generated" | "masks"; checksum?: string }>();
  const add = (relativePath: string, directory: "originals" | "generated" | "masks", checksum?: string) => {
    const safePath = assertPortableAssetPath(relativePath, directory);
    const existing = requested.get(safePath);
    if (existing && (existing.directory !== directory || (existing.checksum && checksum && existing.checksum !== checksum))) {
      throw new TransferError(422, "导入素材引用冲突");
    }
    const resolvedChecksum = existing?.checksum ?? checksum;
    requested.set(safePath, { directory, ...(resolvedChecksum !== undefined ? { checksum: resolvedChecksum } : {}) });
  };
  for (const row of graph.productAssets) add(row.filePath, "originals", row.checksum);
  for (const row of graph.competitorAssets) add(row.filePath, "originals", row.checksum);
  for (const row of graph.imageVersions) {
    if (!row.filePath) continue;
    add(row.filePath, "generated", row.checksum);
    if (row.maskPath) add(row.maskPath, "masks");
  }

  const staged: StagedAsset[] = [];
  for (const [relativePath, expected] of requested) {
    const sourcePath = path.resolve(root, ...relativePath.split("/"));
    if (!isInside(sourcePath, path.resolve(root))) throw new TransferError(422, "导入素材路径越界");
    const checksum = await sha256File(sourcePath);
    if (expected.checksum && checksum !== expected.checksum) {
      throw new TransferError(422, "导入素材与业务校验值不一致");
    }
    const fallback = expected.directory === "masks" ? ".png" : ".bin";
    const targetPath = path.join(paths[expected.directory], `${randomUUID()}${safeAssetExtension(relativePath, fallback)}`);
    staged.push({ sourcePath, targetPath, checksum });
  }
  return staged;
}

function remapRequired(idMap: Map<string, string>, sourceId: string, label: string): string {
  const targetId = idMap.get(sourceId);
  if (!targetId) throw new TransferError(422, `${label}关联无法重映射`);
  return targetId;
}

function remapOptional(idMap: Map<string, string>, sourceId: string | null, label: string): string | null {
  return sourceId === null ? null : remapRequired(idMap, sourceId, label);
}

function remapJsonValue(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === "string") return idMap.get(value) ?? value;
  if (Array.isArray(value)) return value.map((child) => remapJsonValue(child, idMap));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remapJsonValue(child, idMap)]));
}

function remapJson(value: string, idMap: Map<string, string>, label: string): string {
  return JSON.stringify(remapJsonValue(parseJson(value, label), idMap));
}

function remapNullableJson(value: string | null, idMap: Map<string, string>, label: string): string | null {
  return value === null ? null : remapJson(value, idMap, label);
}

function stagedAssetFor(staged: StagedAsset[], relativePath: string): StagedAsset {
  const suffix = `${path.sep}${relativePath.split("/").join(path.sep)}`;
  const match = staged.find((candidate) => candidate.sourcePath.endsWith(suffix));
  if (!match) throw new TransferError(422, `导入素材未暂存：${relativePath}`);
  return match;
}

function runtimeRelativePath(targetPath: string, expectedDirectory: "originals" | "generated" | "masks"): string {
  const relative = path.relative(dataDir, targetPath).split(path.sep).join("/");
  return assertPortableAssetPath(relative, expectedDirectory);
}

function makeIdMap(rows: Array<{ id: string }>): Map<string, string> {
  return new Map(rows.map((row) => [row.id, randomUUID()]));
}

async function persistImportedGraph(
  graph: ProjectTransferGraph,
  staged: StagedAsset[],
): Promise<{ productId: string; productName: string; skippedIncompleteVersions: number }> {
  const productId = randomUUID();
  const productAssetIdMap = makeIdMap(graph.productAssets);
  const specificationIdMap = makeIdMap(graph.specifications);
  const sellingPointIdMap = makeIdMap(graph.sellingPoints);
  const competitorAssetIdMap = makeIdMap(graph.competitorAssets);
  const analysisIdMap = makeIdMap(graph.analysisVersions);
  const cardIdMap = makeIdMap(graph.imageAnalysisCards);
  const reportIdMap = makeIdMap(graph.synthesisReports);
  const taskIdMap = makeIdMap(graph.generationTasks);
  const directionIdMap = makeIdMap(graph.designDirections);
  const planIdMap = makeIdMap(graph.designPlanVersions);
  const itemIdMap = makeIdMap(graph.imageItems);
  const completeVersions = graph.imageVersions.filter((row) => row.filePath.length > 0);
  const versionIdMap = makeIdMap(completeVersions);
  const templateIdMap = makeIdMap(graph.templates);
  const allIdMap = new Map<string, string>([
    [graph.product.id, productId],
    ...productAssetIdMap,
    ...specificationIdMap,
    ...sellingPointIdMap,
    ...competitorAssetIdMap,
    ...analysisIdMap,
    ...cardIdMap,
    ...reportIdMap,
    ...taskIdMap,
    ...directionIdMap,
    ...planIdMap,
    ...itemIdMap,
    ...versionIdMap,
    ...templateIdMap,
  ]);
  const pendingMoves = staged.map((asset) => ({
    ...asset,
    tempPath: `${asset.targetPath}.import-${randomUUID()}.tmp`,
  }));
  const cleanupPaths = () => {
    for (const asset of pendingMoves) {
      for (const candidate of [asset.tempPath, asset.targetPath]) {
        try { fs.rmSync(candidate, { force: true }); } catch { /* best-effort rollback cleanup */ }
      }
    }
  };

  try {
    for (const asset of pendingMoves) {
      fs.mkdirSync(path.dirname(asset.targetPath), { recursive: true, mode: 0o700 });
      fs.copyFileSync(asset.sourcePath, asset.tempPath, fs.constants.COPYFILE_EXCL);
    }

    const result = db.transaction((tx) => {
      if (graph.templates.length) {
        tx.insert(promptTemplates).values(graph.templates.map((row) => ({
          ...row,
          id: remapRequired(templateIdMap, row.id, "提示词模板"),
          isBuiltIn: false,
          isDefault: false,
        }))).run();
      }
      tx.insert(products).values({
        ...graph.product,
        id: productId,
        archivedAt: null,
      }).run();
      if (graph.productAssets.length) {
        tx.insert(productAssets).values(graph.productAssets.map((row) => ({
          ...row,
          id: remapRequired(productAssetIdMap, row.id, "商品素材"),
          productId,
          filePath: runtimeRelativePath(stagedAssetFor(staged, row.filePath).targetPath, "originals"),
          analysis: remapNullableJson(row.analysis, allIdMap, "商品素材分析"),
        }))).run();
      }
      if (graph.specifications.length) {
        tx.insert(productSpecifications).values(graph.specifications.map((row) => ({
          ...row,
          id: remapRequired(specificationIdMap, row.id, "商品规格"),
          productId,
        }))).run();
      }
      if (graph.sellingPoints.length) {
        tx.insert(sellingPoints).values(graph.sellingPoints.map((row) => ({
          ...row,
          id: remapRequired(sellingPointIdMap, row.id, "商品卖点"),
          productId,
        }))).run();
      }
      if (graph.competitorAssets.length) {
        tx.insert(competitorAssets).values(graph.competitorAssets.map((row) => ({
          ...row,
          id: remapRequired(competitorAssetIdMap, row.id, "竞品素材"),
          productId,
          filePath: runtimeRelativePath(stagedAssetFor(staged, row.filePath).targetPath, "originals"),
        }))).run();
      }
      if (graph.analysisVersions.length) {
        tx.insert(analysisVersions).values(graph.analysisVersions.map((row) => ({
          ...row,
          id: remapRequired(analysisIdMap, row.id, "分析版本"),
          productId,
          competitorAssetIds: JSON.stringify(parseIdArray(row.competitorAssetIds, "竞品素材引用").map((id) =>
            remapRequired(competitorAssetIdMap, id, "竞品素材"))),
        }))).run();
      }
      if (graph.imageAnalysisCards.length) {
        tx.insert(imageAnalysisCards).values(graph.imageAnalysisCards.map((row) => ({
          ...row,
          id: remapRequired(cardIdMap, row.id, "分析卡片"),
          analysisVersionId: remapRequired(analysisIdMap, row.analysisVersionId, "分析版本"),
          competitorAssetId: remapRequired(competitorAssetIdMap, row.competitorAssetId, "竞品素材"),
          modelOutput: remapJson(row.modelOutput, allIdMap, "分析卡片结果"),
          humanOverride: remapNullableJson(row.humanOverride, allIdMap, "分析卡片人工修订"),
        }))).run();
      }
      if (graph.synthesisReports.length) {
        tx.insert(synthesisReports).values(graph.synthesisReports.map((row) => ({
          ...row,
          id: remapRequired(reportIdMap, row.id, "综合报告"),
          analysisVersionId: remapRequired(analysisIdMap, row.analysisVersionId, "分析版本"),
          content: remapJson(row.content, allIdMap, "综合报告"),
        }))).run();
      }
      if (graph.generationTasks.length) {
        tx.insert(generationTasks).values(graph.generationTasks.map((row) => ({
          ...row,
          id: remapRequired(taskIdMap, row.id, "生成任务"),
          productId,
          analysisVersionId: remapRequired(analysisIdMap, row.analysisVersionId, "分析版本"),
          configSnapshot: remapJson(row.configSnapshot, allIdMap, "任务配置快照"),
          planDefaultTemplateId: remapOptional(templateIdMap, row.planDefaultTemplateId, "方案提示词模板"),
          imageDefaultTemplateId: remapOptional(templateIdMap, row.imageDefaultTemplateId, "图片提示词模板"),
          latestPlanPromptSnapshot: row.latestPlanPromptSnapshot,
          draftSelectedDirectionId: remapOptional(directionIdMap, row.draftSelectedDirectionId, "草稿方向"),
        }))).run();
      }
      if (graph.designDirections.length) {
        tx.insert(designDirections).values(graph.designDirections.map((row) => ({
          ...row,
          id: remapRequired(directionIdMap, row.id, "设计方向"),
          generationTaskId: remapRequired(taskIdMap, row.generationTaskId, "生成任务"),
          content: remapJson(row.content, allIdMap, "设计方向内容"),
        }))).run();
      }
      if (graph.designPlanVersions.length) {
        tx.insert(designPlanVersions).values(graph.designPlanVersions.map((row) => ({
          ...row,
          id: remapRequired(planIdMap, row.id, "设计方案"),
          generationTaskId: remapRequired(taskIdMap, row.generationTaskId, "生成任务"),
          selectedDirectionId: remapRequired(directionIdMap, row.selectedDirectionId, "设计方向"),
        }))).run();
      }
      if (graph.imageItems.length) {
        tx.insert(imageItems).values(graph.imageItems.map((row) => ({
          ...row,
          id: remapRequired(itemIdMap, row.id, "图片项"),
          designPlanVersionId: remapRequired(planIdMap, row.designPlanVersionId, "设计方案"),
          productAssetId: remapOptional(productAssetIdMap, row.productAssetId, "商品素材"),
          referenceAssetIds: row.referenceAssetIds === null ? null : JSON.stringify(
            parseIdArray(row.referenceAssetIds, "图片参考素材").map((id) => remapRequired(productAssetIdMap, id, "商品素材")),
          ),
          promptTemplateId: remapOptional(templateIdMap, row.promptTemplateId, "图片提示词模板"),
          outputPresetSnapshot: remapJson(row.outputPresetSnapshot, allIdMap, "输出预设快照"),
        }))).run();
      }
      if (completeVersions.length) {
        tx.insert(imageVersions).values(completeVersions.map((row) => ({
          ...row,
          id: remapRequired(versionIdMap, row.id, "图片版本"),
          imageItemId: remapRequired(itemIdMap, row.imageItemId, "图片项"),
          filePath: runtimeRelativePath(stagedAssetFor(staged, row.filePath).targetPath, "generated"),
          parentVersionId: row.parentVersionId && versionIdMap.has(row.parentVersionId)
            ? remapRequired(versionIdMap, row.parentVersionId, "图片父版本")
            : null,
          jobId: null,
          maskPath: row.maskPath
            ? runtimeRelativePath(stagedAssetFor(staged, row.maskPath).targetPath, "masks")
            : null,
          promptTemplateId: remapOptional(templateIdMap, row.promptTemplateId, "图片提示词模板"),
        }))).run();
      }
      for (const asset of pendingMoves) fs.renameSync(asset.tempPath, asset.targetPath);
      return {
        productId,
        productName: graph.product.name,
        skippedIncompleteVersions: graph.imageVersions.length - completeVersions.length,
      };
    });
    return result;
  } catch (error) {
    cleanupPaths();
    throw asTransferError(error, 422, "项目导入失败");
  }
}

export async function importProjectArchive(
  archivePath: string,
): Promise<{ productId: string; productName: string; skippedIncompleteVersions: number }> {
  await assertFileSizeAtMost(archivePath, MAX_ARCHIVE_BYTES);
  await fs.promises.mkdir(paths.exports, { recursive: true, mode: 0o700 });
  const temp = await fs.promises.mkdtemp(path.join(paths.exports, "project-import-"));
  try {
    const entries = await listZipEntries(archivePath);
    const entryNames = new Set<string>();
    for (const entry of entries) {
      assertSafeArchiveEntry(entry);
      if (entryNames.has(entry.path)) throw new TransferError(422, "项目 ZIP 包含重复条目");
      entryNames.add(entry.path);
    }
    assertListedUncompressedSizeAtMost(entries, MAX_EXTRACTED_BYTES);
    try {
      await execFileAsync("/usr/bin/unzip", ["-qq", archivePath, "-d", temp]);
    } catch (error) {
      throw asTransferError(error, 422, "项目 ZIP 解压失败");
    }
    await assertExtractedTreeSafeAndAtMost(temp, MAX_EXTRACTED_BYTES);
    const { manifest, graph } = await readAndValidateProjectFiles(temp);
    await verifyManifestFiles(temp, manifest);
    const staged = await stageImportedAssets(temp, graph);
    return await persistImportedGraph(graph, staged);
  } finally {
    await fs.promises.rm(temp, { recursive: true, force: true });
  }
}
