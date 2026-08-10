# Vercel 部署评估与迁移指南

## 结论

**当前代码不能将完整应用直接部署到 Vercel。** 本项目的 ADR 明确将第一版定义为单机本地应用；直接导入仓库并点击 Deploy 会得到一个不完整、不可持久化或不可访问的应用。

可以在完成下文“迁移清单”后，将 **React/Vite 前端** 部署到 Vercel，并把 API、worker、数据库和文件存储部署在带持久化能力的服务上。Vercel 官方也建议需要写文件的函数使用对象存储而不是函数本地文件系统；函数实例会按请求伸缩，并可能缩容至零。[Vercel Functions 文件指南](https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions) 和 [Functions 生命周期](https://vercel.com/docs/functions) 可作为背景资料。

## 当前阻塞项

| 当前实现 | 代码位置 | 为什么阻止直接部署 |
| --- | --- | --- |
| SQLite 数据库位于 `.data/database/app.db` | `packages/server/src/db/index.ts` | Vercel Function 没有可作为业务数据库的持久本地磁盘；多实例也不能共享 SQLite 文件。 |
| 上传素材、生成图片、导出文件、密钥均位于 `.data/` | `packages/server/src/lib/paths.ts` | 文件需要跨调用和跨部署持久保存，不能依赖函数本地文件。 |
| 任务 worker 在启动时常驻、每两秒轮询 | `packages/server/src/jobs/worker.ts` | Function 按请求调用并可能缩容，不能承载常驻 worker。 |
| 后端固定监听 `127.0.0.1` 且拒绝非本机来源 | `packages/server/src/index.ts`、`packages/server/src/middleware/security.ts` | Vercel 与公网客户端无法访问 API。 |
| 前端将 API 固定为同源 `/api` | `packages/web/src/lib/api.ts` | Vercel 前端无法在不改代码的情况下指向独立 API 域名。 |
| 图像上传/生成可能超过 Function 请求体和执行时间限制 | 路由与任务处理器 | Vercel Function 的请求/响应体及执行时间有平台限制；长任务应使用异步队列或工作流。 |

## 推荐目标架构

```text
浏览器
  │
  ├── Vercel：React/Vite 静态前端
  │      VITE_API_ORIGIN=https://api.example.com
  │
  └── 持久化后端服务（单一区域）
         ├── Hono API
         ├── 独立 worker / 队列消费者
         ├── 托管 PostgreSQL
         ├── 对象存储（原图、生成图、导出文件）
         └── Secret Manager / 平台环境变量（供应商 API Key）
```

建议将后端、worker、数据库与对象存储部署在同一区域，以减少图片传输及模型任务状态读写的延迟。前端仅保留可公开的 `VITE_*` 构建变量；任何模型 API Key、管理员密码、数据库连接串都只能配置在后端平台的受保护环境变量或 Secret Manager 中。

## 迁移清单

在创建 Vercel 项目前，完成以下代码与基础设施改造：

1. **数据库**：将 Drizzle 的 SQLite 驱动和迁移迁移至托管 PostgreSQL；迁移现有数据，并为生产环境设置备份与恢复策略。
2. **文件存储**：将 `originals`、`generated`、`masks`、`exports` 改为对象存储；上传采用签名 URL，数据库只保存对象键或 URL。
3. **密钥管理**：停止把供应商密钥写入 `.data/secrets/*.json`，改用后端的 Secret Manager 或加密凭据存储。永远不要把它们置于 `VITE_*` 变量。
4. **任务执行**：将内存轮询 worker 改为持久队列消费者。可选用 Vercel Queues/Workflow 或外部队列；任务处理必须幂等并支持重试。Vercel Queues 提供持久消息、重试和至少一次投递，但仍需要改造当前 worker 模型。[Vercel Queues](https://vercel.com/docs/queues) 目前处于 Beta。
5. **API 跨域与认证**：使 API 基址由前端构建变量 `VITE_API_ORIGIN` 配置；后端只允许指定 Vercel 域名的 CORS 来源，并重新设计生产环境的公网访问控制、Cookie 的 `Secure`/`SameSite` 属性和 CSRF 防护。
6. **网络监听**：后端部署到适合常驻 HTTP/worker 的平台后，允许其由平台反向代理访问；保留可信代理与来源校验，不能简单移除访问控制。
7. **上传限制与任务时长**：大图改用浏览器直传对象存储；API 只接收元数据和任务请求。对长模型调用使用队列/工作流，不要把任务完成依赖在单个 HTTP Function 生命周期内。
8. **可观测性**：将应用日志、错误追踪、任务指标和审计日志接入云端服务；继续对 API Key、密码、Token 等字段脱敏。

完成以上迁移并通过集成测试后，才可按下一节部署前端。

## 前端部署到 Vercel（迁移完成后）

1. 将仓库推送到 GitHub，创建一个 **Vercel Project** 并导入该仓库。
2. 将 Project 的 **Root Directory** 设置为 `packages/web`。Vercel 支持 monorepo 项目分别选择 Root Directory；如构建需读取根目录工作区文件，启用“Include source files outside of the Root Directory”。参见 [Vercel Monorepo 文档](https://vercel.com/docs/monorepos)。
3. 在项目环境变量中设置：

   ```dotenv
   VITE_API_ORIGIN=https://api.example.com
   ```

   该变量是公开的前端 API 地址，不得填入密钥。为 Preview 和 Production 分别设置对应的 API 域名。
4. 使用 Vercel 自动识别的 Vite 构建配置，或显式设置：

   ```text
   Install Command: pnpm install --frozen-lockfile
   Build Command: pnpm build
   Output Directory: dist
   ```

   上述命令和输出路径都以 `packages/web` 这个 Root Directory 为基准。Vercel 对 Vite 的环境变量使用 `VITE_` 前缀。[Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)
5. 在后端配置 Vercel 的生产域名和 Preview 域名为允许来源；验证登录、上传、SSE、任务创建、图片展示和登出。
6. 将 GitHub 仓库连接至 Vercel。之后推送生产分支会触发生产部署，其他分支生成 Preview 部署。[Git 集成部署](https://vercel.com/docs/git)

## 暂不建议的做法

- 不要把 `.data/`、`.env`、数据库文件或供应商密钥提交到 GitHub 或放进 Vercel 的静态产物。
- 不要在 Vercel Function 中继续使用本地 SQLite 作为生产数据库。
- 不要依赖 Function 进程执行常驻轮询 worker。
- 不要把 `ADMIN_PASSWORD`、模型 API Key、数据库 URL 放到 `VITE_*` 环境变量。
- 不要在没有经过跨域、认证和上传安全评估的情况下，直接移除本项目的本机访问限制。

## 当前可行方案

在迁移完成前，请使用本机部署：

```bash
pnpm install
cp packages/server/.env.example packages/server/.env
cp packages/web/.env.example packages/web/.env
# 在 packages/server/.env 中设置 ADMIN_PASSWORD
pnpm dev
```

访问 `http://127.0.0.1:9991`。这是当前 ADR 与代码实现支持的运行方式。
