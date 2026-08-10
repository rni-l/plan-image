# Railway POC 部署指南

本方案将前端、Hono API、SQLite 和任务 worker 部署为 Railway 的单个 Docker 服务。它适合单实例 POC，不需要迁移 `DATA_DIR`、SQLite 或轮询 worker。

## 1. 推送仓库

确认 GitHub 仓库不包含 `.data/`、`.env`、密钥、生成图片或本地数据库。Dockerfile 会构建前端并由后端在同一个域名下提供静态页面和 `/api`。

## 2. 创建 Railway 服务和 Volume

1. 在 Railway 新建 Project，选择 **Deploy from GitHub repo** 并选择此仓库。
2. Railway 会使用根目录的 `Dockerfile` 构建镜像。
3. 为该服务添加 Volume，挂载路径填写：`/data`。
4. 保持单实例运行。SQLite 与本地文件只能由一个服务实例安全读写。

Railway Volume 是持久目录；本应用通过 `DATA_DIR=/data` 保存数据库、上传图片、生成图片、导出文件和本地密钥。

## 3. 配置 Railway 环境变量

在 Railway 服务的 Variables 中添加：

```dotenv
ADMIN_PASSWORD=replace-with-a-strong-unique-password
ALLOW_REMOTE=true
NODE_ENV=production
DATA_DIR=/data
HOST=0.0.0.0
WEB_DIST_DIR=/app/packages/web/dist
```

- `PORT` 由 Railway 自动注入；不要手动固定。
- `ADMIN_PASSWORD` 是唯一应用登录密码，必须使用强密码。
- 不要在 Railway Variables 中填模型 API Key。首次登录后在应用设置页录入；密钥将写入 Volume 内的 `/data/secrets/`。

## 4. 部署与验证

1. 点击 Deploy，等待 Railway Healthcheck 请求 `/health` 成功。
2. 点击 Railway 生成的公开域名，确认登录页能加载。
3. 用 `ADMIN_PASSWORD` 登录，在设置页配置一个模型供应商。
4. 上传一张测试图片，创建一次任务，并确认刷新页面后任务、图片和设置仍存在。
5. 触发一次 Redeploy 后再次检查数据仍存在，确认 Volume 挂载正确。

## 5. 备份与限制

- 定期从 `/data` 备份 SQLite 数据库和资产文件；POC 不应只依赖单份 Volume。
- 不要扩展为多个副本，也不要将 API 与 worker 拆为不同服务后继续共享该 SQLite 文件。
- Railway 服务会对公网开放；应用使用管理员密码保护，但若需按个人精确授权，应在 POC 后增加独立账号或接入访问网关。
