# Private Plan Image

面向单个操作者的商品图策划、分析与 AI 生成工作台。它将商品资料、竞品素材、设计方向、生成任务和输出图片保存在本机，并可通过百炼、火山方舟或 GPT 中转服务调用模型。

> 当前版本定位为**本地单机应用**。完整系统不能直接部署到 Vercel；原因和云端改造路径见 [Vercel 部署评估与迁移指南](docs/deployment/vercel.md)。

## 功能

- 管理商品资料、商品图片和竞品素材
- 分析竞品并生成设计方向、设计方案和商品图
- 使用任务队列执行生成、重新生成和局部重绘
- 在设置页配置模型供应商与场景路由；密钥只保存在本机运行时目录
- 记录模型调用、任务状态与费用信息

## 技术栈

- 前端：React、Vite、Tailwind CSS
- 后端：Node.js、Hono、Drizzle ORM、SQLite
- 图像处理：Sharp
- 包管理：pnpm workspace

## 本地运行

### 前置条件

- Node.js 22 或更新版本
- pnpm 9 或更新版本
- 可访问至少一个已支持的模型供应商

### 安装与启动

```bash
pnpm install
cp packages/server/.env.example packages/server/.env
cp packages/web/.env.example packages/web/.env
```

编辑 `packages/server/.env`，设置一个强且唯一的管理员密码：

```dotenv
ADMIN_PASSWORD=replace-with-a-strong-unique-password
```

然后启动前后端：

```bash
pnpm dev
```

打开 `http://127.0.0.1:9991`，登录后在“设置”中配置模型供应商与 API Key。

## 数据与密钥安全

- 所有可变数据保存在 `.data/`：SQLite 数据库、上传/生成图片、导出文件和供应商密钥。
- `.data/` 与 `.env` 已由 Git 忽略；不要使用 `git add -f` 强制提交它们。
- 运行时目录在启动时被收紧为仅当前用户可访问。API Key 文件和本地 `.env` 文件应保持 `600` 权限。
- 模型 API Key 仅在设置页录入，切勿写入 `.env.example`、README、前端变量或 GitHub Actions 日志。

## 常用命令

```bash
# 本地开发
pnpm dev

# 生产构建
pnpm build

# 服务端测试
pnpm --filter server test

# 前端测试
pnpm test:web

# 生成并应用数据库迁移
pnpm db:generate
pnpm db:migrate
```

## 项目结构

```text
packages/
  server/     Hono API、SQLite、任务 worker 与模型网关
  web/        React/Vite 单页应用
docs/
  deployment/ 部署评估和运行手册
.data/        本地运行数据（不提交）
```

## 部署

- 本地单机部署：按上方“本地运行”操作。
- Vercel：先阅读 [Vercel 部署评估与迁移指南](docs/deployment/vercel.md)。当前仓库不能把完整应用直接部署为 Vercel 项目；需要先完成持久化、异步任务和跨域 API 的云端改造。

