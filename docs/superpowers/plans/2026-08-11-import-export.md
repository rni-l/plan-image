# 配置与项目导入导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户可安全导入和导出不含密钥的环境配置，以及包含素材和完整历史的新项目 ZIP 包。

**Architecture:** 增加一个服务端 transfer 模块，集中管理包格式、校验、ZIP、文件清理与 ID 重映射；设置和商品路由只做 HTTP 输入输出。前端通过原始文件请求上传，避免将完整 ZIP 读入浏览器或服务端的 JSON/multipart 内存缓冲区。

**Tech Stack:** TypeScript、Hono、Drizzle/better-sqlite3、Node 22 文件流、`zip`/`unzip` 命令、React 19、Vite、node:test。

## Global Constraints

- 配置、项目包以及任务快照均不得包含 API 密钥或 `keyHint`。
- 配置导入必须保留当前环境的密钥文件和 `isConfigured`/`keyHint` 状态。
- 项目导入必须生成新 ID、从不覆盖现有项目，且不会恢复后台任务。
- 项目 ZIP 最大 500 MB；解压后的实际总文件体积最大 1 GB。
- 所有文件路径必须在受控临时目录或 `assets/{originals,generated,masks}` 下，拒绝绝对路径、`..` 和符号链接。
- 每项行为先写一个会失败的 node:test 测试，再写最小实现；每个任务结束时单独提交。

---

## File structure

| 文件 | 职责 |
| --- | --- |
| `packages/server/src/lib/transfer.ts` | 配置数据转换、项目 manifest、ZIP 生成/检查、文件校验、数据库导入与 ID 重映射。 |
| `packages/server/src/lib/transfer.test.ts` | 以独立临时 DATA_DIR 做配置与项目的往返、拒绝与回滚测试。 |
| `packages/server/src/routes/settings.ts` | 增加配置下载/原始 JSON 上传端点。 |
| `packages/server/src/routes/products.ts` | 在 `/:id` 前增加项目导入端点，以及项目 ZIP 下载端点。 |
| `packages/server/src/routes/transfer-routes.test.ts` | 端到端路由测试，包括原始文件上传和下载响应头。 |
| `packages/web/src/lib/api.ts` | 增加二进制下载、原始文件上传函数。 |
| `packages/web/src/pages/settings/SettingsPage.tsx` | 增加“数据迁移”设置入口和配置迁移面板。 |
| `packages/web/src/pages/products/ProductsPage.tsx` | 增加项目导入按钮、隐藏文件选择器与导入后的跳转。 |
| `packages/web/src/pages/products/ProductWorkbench.tsx` | 增加当前项目 ZIP 导出按钮。 |
| `Dockerfile` | 显式安装 `zip`、`unzip`。 |

## Manifest and interfaces

`transfer.ts` 是唯一知道文件格式的模块。导出项目的根目录固定为：

```text
manifest.json
project.json
assets/originals/<new-or-source-id>.<ext>
assets/generated/<new-or-source-id>.<ext>
assets/masks/<new-or-source-id>.png
```

必须使用如下接口，避免将数据库 ID 或运行时绝对路径泄露到 ZIP 格式中：

```ts
export const TRANSFER_FORMAT_VERSION = 1;
export const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024;
export const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;

export type TransferManifest = {
  formatVersion: 1;
  kind: "project";
  createdAt: string;
  files: Array<{ path: string; bytes: number; checksum: string }>;
};

export type ConfigTransfer = {
  formatVersion: 1;
  kind: "config";
  providers: Array<{ name: ProviderName; baseUrl: string | null }>;
  routes: Array<{ scene: SceneKey; providerName: ProviderName | null; modelId: string | null; billingModelId: string | null; parameters: string | null; isDefault: boolean }>;
  presets: Array<{ name: string; presetType: PresetType; width: number; height: number; format: ImageFormat; quality: number; isDefault: boolean }>;
  templates: Array<{ type: PromptTemplateType; name: string; description: string | null; body: string; isDefault: boolean; archivedAt: number | null }>;
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
type StagedAsset = { sourcePath: string; targetPath: string; checksum: string };

export async function exportConfig(): Promise<ConfigTransfer>;
export async function importConfig(input: unknown): Promise<{ importedTemplates: number }>;
export async function exportProjectArchive(productId: string): Promise<{ archivePath: string; cleanup: () => Promise<void> }>;
export async function importProjectArchive(archivePath: string): Promise<{ productId: string; productName: string; skippedIncompleteVersions: number }>;
```

内部实现和测试使用以下固定名称，避免路由或测试绕过 transfer 模块：

```ts
export class TransferError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
type ZipEntry = { path: string; uncompressedBytes: number; isSymlink: boolean };
async function listZipEntries(archivePath: string): Promise<ZipEntry[]>;
async function loadProjectGraph(productId: string): Promise<ProjectTransferGraph>;
async function writeJson(targetPath: string, value: unknown): Promise<void>;
function sanitizeProjectGraph(graph: ProjectTransferGraph): ProjectTransferGraph;
async function copyGraphAssets(graph: ProjectTransferGraph, root: string): Promise<Array<{ path: string; bytes: number; checksum: string }>>;
function makeManifest(files: Array<{ path: string; bytes: number; checksum: string }>): TransferManifest;
async function assertFileSizeAtMost(filePath: string, maxBytes: number): Promise<void>;
function assertSafeArchiveEntry(entry: ZipEntry): void;
function assertListedUncompressedSizeAtMost(entries: ZipEntry[], maxBytes: number): void;
async function assertExtractedTreeSafeAndAtMost(root: string, maxBytes: number): Promise<void>;
async function readAndValidateProjectFiles(root: string): Promise<{ manifest: TransferManifest; graph: ProjectTransferGraph }>;
async function verifyManifestFiles(root: string, manifest: TransferManifest): Promise<void>;
async function stageImportedAssets(root: string, graph: ProjectTransferGraph): Promise<StagedAsset[]>;
async function persistImportedGraph(graph: ProjectTransferGraph, staged: StagedAsset[]): Promise<{ productId: string; productName: string; skippedIncompleteVersions: number }>;
export async function saveRawRequestBody(body: ReadableStream<Uint8Array> | null, directory: string, maxBytes: number): Promise<string>;
export function transferMessage(error: unknown): string;
export function transferStatus(error: unknown): 400 | 404 | 413 | 415 | 422 | 500;
```

The local test file defines `configFixture` as a complete `ConfigTransfer` literal; `insertCompleteProjectFixture`, `readProductGraph`, `sha256File`, `productCount`, `zipWith`, `zipWithSymlink`, `zipOver`, and `zipWithExtractedSizeOver` create files only under that test's `mkdtempSync` DATA_DIR, invoke `/usr/bin/zip` with `execFile`, and return the exact archive path used by the next assertion.

### Task 1: 配置包转换与密钥隔离

**Files:**
- Create: `packages/server/src/lib/transfer.ts`
- Create: `packages/server/src/lib/transfer.test.ts`

**Interfaces:**
- Consumes: `db`、`modelProviders`、`modelSceneRoutes`、`outputPresets`、`promptTemplates`。
- Produces: `exportConfig()` 和 `importConfig()`，供设置路由使用。

- [ ] **Step 1: Write the failing configuration tests**

```ts
test("exports portable configuration without secrets or key hints", async () => {
  await db.insert(schema.modelProviders).values({ id: "p", name: "gpt_proxy", baseUrl: "https://proxy.example", isConfigured: true, keyHint: "9876", updatedAt: new Date() });
  const exported = await exportConfig();
  assert.equal(JSON.stringify(exported).includes("9876"), false);
  assert.equal(JSON.stringify(exported).includes("apiKey"), false);
  assert.deepEqual(exported.providers, [{ name: "gpt_proxy", baseUrl: "https://proxy.example" }]);
});

test("imports routes and presets while retaining current key state", async () => {
  const result = await importConfig(configFixture);
  assert.equal(result.importedTemplates, 1);
  const [provider] = await db.select().from(schema.modelProviders).where(eq(schema.modelProviders.name, "gpt_proxy"));
  assert.equal(provider?.isConfigured, true);
  assert.equal(provider?.keyHint, "9876");
  assert.equal(provider?.baseUrl, "https://new-proxy.example");
});
```

- [ ] **Step 2: Run the configuration tests and observe the expected missing-module failure**

Run: `pnpm --filter server exec tsx --test src/lib/transfer.test.ts`  
Expected: FAIL with `Cannot find module './transfer.js'` or missing `exportConfig`.

- [ ] **Step 3: Implement the configuration schema and exporter**

```ts
const providerNameSchema = z.enum(["bailian", "volcengine", "gpt_proxy"]);
const configTransferSchema = z.object({
  formatVersion: z.literal(1), kind: z.literal("config"),
  providers: z.array(z.object({ name: providerNameSchema, baseUrl: z.string().nullable() })),
  routes: z.array(z.object({ scene: z.enum(["competitor_image_analysis", "competitor_synthesis", "design_plan", "image_generation", "image_edit"]), providerName: providerNameSchema.nullable(), modelId: z.string().nullable(), billingModelId: z.string().nullable(), parameters: z.string().nullable(), isDefault: z.boolean() })),
  presets: z.array(z.object({ name: z.string().min(1).max(100), presetType: z.enum(["main_image", "detail_module"]), width: z.number().int().positive(), height: z.number().int().positive(), format: z.enum(["jpg", "png"]), quality: z.number().int().min(1).max(100), isDefault: z.boolean() })),
  templates: z.array(z.object({ type: z.enum(["design_plan", "image_generation"]), name: z.string().min(1).max(100), description: z.string().max(500).nullable(), body: z.string().min(1), isDefault: z.boolean(), archivedAt: z.number().int().nullable() })),
});

export async function exportConfig(): Promise<ConfigTransfer> {
  const [providers, routes, presets, templates] = await Promise.all([
    db.select().from(modelProviders),
    db.select({ route: modelSceneRoutes, providerName: modelProviders.name }).from(modelSceneRoutes).leftJoin(modelProviders, eq(modelSceneRoutes.providerId, modelProviders.id)),
    db.select().from(outputPresets),
    db.select().from(promptTemplates),
  ]);
  return {
    formatVersion: 1, kind: "config",
    providers: providers.map(({ name, baseUrl }) => ({ name, baseUrl })),
    routes: routes.map(({ route, providerName }) => ({ scene: route.scene, providerName, modelId: route.modelId, billingModelId: route.billingModelId, parameters: route.parameters, isDefault: route.isDefault })),
    presets: presets.map(({ id, createdAt, updatedAt, ...preset }) => preset),
    templates: templates.filter((template) => !template.isBuiltIn).map(({ id, isBuiltIn, createdAt, updatedAt, ...template }) => template),
  };
}
```

- [ ] **Step 4: Implement transactional configuration import**

```ts
export async function importConfig(input: unknown) {
  const config = configTransferSchema.parse(input);
  return db.transaction(async (tx) => {
    const now = new Date();
    const currentProviders = await tx.select().from(modelProviders);
    const providerIds = new Map(currentProviders.map((provider) => [provider.name, provider.id]));
    for (const provider of config.providers) {
      const id = providerIds.get(provider.name);
      if (id) await tx.update(modelProviders).set({ baseUrl: provider.baseUrl, updatedAt: now }).where(eq(modelProviders.id, id));
      else { const newId = randomUUID(); await tx.insert(modelProviders).values({ id: newId, name: provider.name, baseUrl: provider.baseUrl, isConfigured: false, keyHint: null, updatedAt: now }); providerIds.set(provider.name, newId); }
    }
    await tx.delete(modelSceneRoutes); await tx.delete(outputPresets);
    if (config.routes.length) await tx.insert(modelSceneRoutes).values(config.routes.map((route) => ({ id: randomUUID(), scene: route.scene, providerId: route.providerName ? providerIds.get(route.providerName) ?? null : null, modelId: route.modelId, billingModelId: route.billingModelId, parameters: route.parameters, isDefault: route.isDefault, updatedAt: now })));
    if (config.presets.length) await tx.insert(outputPresets).values(config.presets.map((preset) => ({ id: randomUUID(), ...preset, createdAt: now, updatedAt: now })));
    const existingTemplates = await tx.select().from(promptTemplates);
    const importedTemplates = config.templates.filter((candidate) => !existingTemplates.some((current) => current.type === candidate.type && current.name === candidate.name && current.body === candidate.body));
    if (importedTemplates.length) await tx.insert(promptTemplates).values(importedTemplates.map((template) => ({ id: randomUUID(), ...template, isBuiltIn: false, createdAt: now, updatedAt: now })));
    return { importedTemplates: importedTemplates.length };
  });
}
```

- [ ] **Step 5: Run the configuration tests and the existing settings suite**

Run: `pnpm --filter server exec tsx --test src/lib/transfer.test.ts src/routes/model-routes.test.ts src/routes/prompt-templates.test.ts`  
Expected: PASS with all configuration tests green.

- [ ] **Step 6: Commit the isolated configuration capability**

```bash
git add packages/server/src/lib/transfer.ts packages/server/src/lib/transfer.test.ts
git commit -m "feat: add portable configuration transfer"
```

### Task 2: 项目 ZIP 导出与安全导入

**Files:**
- Modify: `packages/server/src/lib/transfer.ts`
- Modify: `packages/server/src/lib/transfer.test.ts`

**Interfaces:**
- Consumes: all project aggregate tables and `assetPath`, `paths` from `lib/paths.ts`.
- Produces: `exportProjectArchive()` and `importProjectArchive()` for product routes.

- [ ] **Step 1: Write a fixture-backed failing round-trip test**

```ts
test("round-trips a complete project with new IDs, image bytes and masks", async () => {
  const source = await insertCompleteProjectFixture(); // product, assets, analysis, task, plan, item, image version and mask
  const archive = await exportProjectArchive(source.productId);
  const imported = await importProjectArchive(archive.archivePath);
  const importedGraph = await readProductGraph(imported.productId);
  const importedImage = importedGraph.imageVersions[0]!;
  assert.notEqual(imported.productId, source.productId);
  assert.equal(importedGraph.imageVersions.length, 1);
  assert.deepEqual(await fs.promises.readFile(assetPath(importedImage.filePath)), source.generatedBytes);
  assert.equal(importedImage.maskPath && await sha256File(assetPath(importedImage.maskPath)), source.maskChecksum);
  await archive.cleanup();
});

test("rejects a manifest hash mismatch without creating a product", async () => {
  const countBefore = await productCount();
  await assert.rejects(() => importProjectArchive(tamperedArchivePath), /校验失败/);
  assert.equal(await productCount(), countBefore);
});
```

- [ ] **Step 2: Run only the project transfer tests and observe failure**

Run: `pnpm --filter server exec tsx --test src/lib/transfer.test.ts`  
Expected: FAIL because project archive functions are not implemented.

- [ ] **Step 3: Implement archive construction with a versioned manifest**

```ts
export async function exportProjectArchive(productId: string) {
  const graph = await loadProjectGraph(productId);
  if (!graph.product) throw new TransferError(404, "项目不存在");
  const workDir = await fs.promises.mkdtemp(path.join(paths.exports, "project-export-"));
  await writeJson(path.join(workDir, "project.json"), sanitizeProjectGraph(graph));
  const files = await copyGraphAssets(graph, workDir); // copies only verified DB paths into assets/*
  await writeJson(path.join(workDir, "manifest.json"), makeManifest(files));
  const archivePath = path.join(paths.exports, `project-${randomUUID()}.zip`);
  await execFileAsync("/usr/bin/zip", ["-q", "-r", archivePath, "."], { cwd: workDir });
  return { archivePath, cleanup: () => Promise.all([fs.promises.rm(workDir, { recursive: true, force: true }), fs.promises.rm(archivePath, { force: true })]).then(() => undefined) };
}
```

`sanitizeProjectGraph` must remove `backgroundJobs`, `modelCallLogs`, `apiRequestLogs`, `jobId` values and provider `keyHint` from parsed `configSnapshot`; it must skip image versions with no `filePath`.

- [ ] **Step 4: Implement pre-write ZIP validation and graph import**

```ts
export async function importProjectArchive(archivePath: string) {
  await assertFileSizeAtMost(archivePath, MAX_ARCHIVE_BYTES);
  const temp = await fs.promises.mkdtemp(path.join(paths.exports, "project-import-"));
  try {
    const entries = await listZipEntries(archivePath);
    entries.forEach(assertSafeArchiveEntry);
    assertListedUncompressedSizeAtMost(entries, MAX_EXTRACTED_BYTES);
    await execFileAsync("/usr/bin/unzip", ["-qq", archivePath, "-d", temp]);
    await assertExtractedTreeSafeAndAtMost(temp, MAX_EXTRACTED_BYTES);
    const { manifest, graph } = await readAndValidateProjectFiles(temp);
    await verifyManifestFiles(temp, manifest);
    const staged = await stageImportedAssets(temp, graph);
    return await persistImportedGraph(graph, staged); // creates all new UUIDs and rewrites FK/JSON references
  } finally {
    await fs.promises.rm(temp, { recursive: true, force: true });
  }
}
```

`persistImportedGraph` must first create an ID map for products, assets, analysis versions, cards, reports, tasks, directions, plans, image items, image versions and imported templates. It then inserts rows in foreign-key order inside `db.transaction`. Move staged files into `paths.originals`, `paths.generated`, and `paths.masks` using temp-name + rename; on any failure remove every moved path and rethrow.

- [ ] **Step 5: Add rejection tests before finalizing implementation**

```ts
for (const archive of [zipWith("../outside.txt"), zipWithSymlink(), zipOver(MAX_ARCHIVE_BYTES), zipWithExtractedSizeOver(MAX_EXTRACTED_BYTES)]) {
  await assert.rejects(() => importProjectArchive(archive), TransferError);
  assert.equal(await productCount(), countBefore);
}
```

- [ ] **Step 6: Run the complete transfer suite**

Run: `pnpm --filter server exec tsx --test src/lib/transfer.test.ts`  
Expected: PASS for configuration round trip, project round trip, hash failure, unsafe path, symlink and size-limit cases.

- [ ] **Step 7: Commit project transfer support**

```bash
git add packages/server/src/lib/transfer.ts packages/server/src/lib/transfer.test.ts
git commit -m "feat: add complete project archive transfer"
```

### Task 3: HTTP routes and streamed file input/output

**Files:**
- Modify: `packages/server/src/routes/settings.ts`
- Modify: `packages/server/src/routes/products.ts`
- Create: `packages/server/src/routes/transfer-routes.test.ts`

**Interfaces:**
- Consumes: the four transfer service functions.
- Produces: `GET/POST /settings/transfer/config` and `GET /products/:id/transfer/project`, `POST /products/transfer/project`.

- [ ] **Step 1: Write failing route tests**

```ts
test("downloads config as attachment and imports JSON with a raw request body", async () => {
  const exported = await app.request("/settings/transfer/config");
  assert.match(exported.headers.get("content-disposition") ?? "", /configuration-export\.json/);
  const imported = await app.request("/settings/transfer/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(configFixture) });
  assert.equal(imported.status, 200);
});

test("imports a raw ZIP before dynamic product routes", async () => {
  const response = await app.request("/products/transfer/project", { method: "POST", headers: { "content-type": "application/zip" }, body: await fs.promises.readFile(archivePath) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).productName, "导入测试商品");
});
```

- [ ] **Step 2: Run route tests and observe missing endpoints**

Run: `pnpm --filter server exec tsx --test src/routes/transfer-routes.test.ts`  
Expected: FAIL with 404 responses.

- [ ] **Step 3: Add settings endpoints with strict content type and error mapping**

```ts
settingsRouter.get("/transfer/config", async (c) => c.json(await exportConfig(), 200, {
  "Content-Disposition": "attachment; filename=configuration-export.json",
  "Cache-Control": "no-store",
}));
settingsRouter.post("/transfer/config", async (c) => {
  if (!c.req.header("content-type")?.startsWith("application/json")) return c.json({ error: "请上传配置 JSON 文件" }, 415);
  try { return c.json(await importConfig(await c.req.json())); }
  catch (error) { return c.json({ error: transferMessage(error) }, transferStatus(error)); }
});
```

- [ ] **Step 4: Add product endpoints before `/:id` and use a bounded stream**

```ts
productsRouter.post("/transfer/project", async (c) => {
  if (c.req.header("content-type") !== "application/zip") return c.json({ error: "请上传 ZIP 项目包" }, 415);
  const upload = await saveRawRequestBody(c.req.raw.body, paths.exports, MAX_ARCHIVE_BYTES);
  try { return c.json(await importProjectArchive(upload), 201); }
  catch (error) { return c.json({ error: transferMessage(error) }, transferStatus(error)); }
  finally { await fs.promises.rm(upload, { force: true }); }
});
productsRouter.get("/:id/transfer/project", async (c) => {
  const archive = await exportProjectArchive(c.req.param("id"));
  const source = fs.createReadStream(archive.archivePath);
  source.once("close", () => { void archive.cleanup(); });
  const stream = Readable.toWeb(source) as ReadableStream;
  return new Response(stream, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename=project-export.zip`, "Cache-Control": "no-store" } });
});
```

`saveRawRequestBody` must reject a stated or observed body size above 500 MB and write using `pipeline(Readable.fromWeb(body), byteLimitTransform, createWriteStream(tempPath, { mode: 0o600 }))`.

- [ ] **Step 5: Run route and existing product/settings tests**

Run: `pnpm --filter server exec tsx --test src/routes/transfer-routes.test.ts src/routes/model-routes.test.ts src/routes/prompt-templates.test.ts src/routes/generation-snapshot.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit the HTTP boundary**

```bash
git add packages/server/src/routes/settings.ts packages/server/src/routes/products.ts packages/server/src/routes/transfer-routes.test.ts packages/server/src/lib/transfer.ts
git commit -m "feat: expose import export API routes"
```

### Task 4: 数据迁移与项目入口 UI

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/pages/settings/SettingsPage.tsx`
- Modify: `packages/web/src/pages/products/ProductsPage.tsx`
- Modify: `packages/web/src/pages/products/ProductWorkbench.tsx`

**Interfaces:**
- Consumes: the four transfer routes from Task 3.
- Produces: `api.download()` and `api.uploadRawFile()` used by the UI.

- [ ] **Step 1: Write failing API-helper tests or type checks**

Add a small `packages/web/test/api-transfer.test.ts` that stubs `fetch` and verifies `uploadRawFile("/products/transfer/project", file, "application/zip")` sends the unmodified `File`, sets `Content-Type: application/zip`, and uses `credentials: "include"`.

- [ ] **Step 2: Run the new web test to verify it fails**

Run: `pnpm --filter server exec tsx --test ../../packages/web/test/api-transfer.test.ts`  
Expected: FAIL because the helper does not yet exist.

- [ ] **Step 3: Add binary API helpers**

```ts
uploadRawFile: async <T>(path: string, file: File, contentType: string): Promise<T> => {
  const res = await fetch(`${BASE}${path}`, { method: "POST", credentials: "include", headers: { "Content-Type": contentType }, body: file });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.json() as Promise<T>;
},
download: (path: string, filename: string) => {
  const anchor = document.createElement("a"); anchor.href = `${BASE}${path}`; anchor.download = filename; anchor.click();
},
```

- [ ] **Step 4: Add the settings migration page**

Extend `SECTIONS` with `{ to: "/settings/transfer", label: "数据迁移" }`, render `TransferSection` for that section, and use this concrete interaction:

```tsx
<Button variant="outline" onClick={() => api.download("/settings/transfer/config", "configuration-export.json")}>
  <Download size={14} /> 导出配置
</Button>
<input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleConfigFile} />
```

`handleConfigFile` must call `window.confirm("导入将替换模型路由和输出预设；不会修改当前 API 密钥。是否继续？")`, parse JSON locally only for syntax feedback, invoke `api.uploadRawFile("/settings/transfer/config", file, "application/json")`, clear the input, and show success/error toast.

- [ ] **Step 5: Add project import/export controls**

In `ProductsPage` place a secondary “导入项目” button beside “新建商品”; accept only `.zip`, call `api.uploadRawFile("/products/transfer/project", file, "application/zip")`, then `navigate(`/products/${result.productId}/info`)` and toast `已导入「${result.productName}」，未恢复未完成后台任务`.

In `ProductWorkbench` add this header action next to the breadcrumb:

```tsx
<Button size="sm" variant="outline" onClick={() => api.download(`/products/${productId}/transfer/project`, `${product?.name ?? "project"}-export.zip`)}>
  <Download size={14} /> 导出项目
</Button>
```

- [ ] **Step 6: Run web tests and build**

Run: `pnpm test:web && pnpm --filter web build`  
Expected: PASS and a successful Vite production build.

- [ ] **Step 7: Commit UI integration**

```bash
git add packages/web/src/lib/api.ts packages/web/src/pages/settings/SettingsPage.tsx packages/web/src/pages/products/ProductsPage.tsx packages/web/src/pages/products/ProductWorkbench.tsx packages/web/test/api-transfer.test.ts
git commit -m "feat: add import export controls"
```

### Task 5: Production image and final verification

**Files:**
- Modify: `Dockerfile`
- Modify: `README.md`

**Interfaces:**
- Consumes: all server routes and UI controls above.
- Produces: container image that always includes the archive utilities, plus operator documentation.

- [ ] **Step 1: Write the failing deployment assertion**

Add a concise README command under deployment verification: `docker run --rm <image> sh -c 'command -v zip && command -v unzip'`. Before Dockerfile modification, run the equivalent against the current built base to record missing utilities when absent.

- [ ] **Step 2: Install runtime ZIP tooling explicitly**

```dockerfile
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends zip unzip \
  && rm -rf /var/lib/apt/lists/*
```

Keep this before dependency installation so the runtime image is reproducible. Document the two export formats, no-secret behavior, archive limits, and the fact that incomplete jobs are not resumed.

- [ ] **Step 3: Run all automated verification commands**

Run: `pnpm --filter server test && pnpm test:web && pnpm build && git diff --check`  
Expected: all node:test suites pass, both TypeScript builds succeed, and `git diff --check` produces no output.

- [ ] **Step 4: Build and inspect the production image**

Run: `docker build -t private-plan-image:transfer-check . && docker run --rm private-plan-image:transfer-check sh -c 'command -v zip && command -v unzip'`  
Expected: Docker build exits 0 and prints paths for both `/usr/bin/zip` and `/usr/bin/unzip`.

- [ ] **Step 5: Commit final production support**

```bash
git add Dockerfile README.md
git commit -m "chore: include archive tooling in production image"
```

## Self-review

- **Spec coverage:** Task 1 covers no-secret configuration exchange and key preservation; Task 2 covers complete project data, ID remapping, archive checks and cleanup; Task 3 provides authenticated HTTP boundaries and bounded raw uploads; Task 4 provides all requested UI entry points; Task 5 makes Railway tooling explicit and verifies delivery.
- **Placeholder scan:** every test command, file path, function name, failure mode, and error status is explicit.
- **Type consistency:** all routes consume the four `transfer.ts` public functions; browser upload paths match route paths; project import always returns `productId`, `productName`, and `skippedIncompleteVersions`.
