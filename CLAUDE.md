# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start both server and web in dev mode (recommended)
pnpm dev

# Build everything for production
pnpm build

# Run only one package
pnpm --filter server dev
pnpm --filter web dev

# Database: after changing schema.ts, generate then apply migrations
pnpm db:generate   # writes SQL to packages/server/src/db/migrations/
pnpm db:migrate    # applies pending migrations to .data/database/app.db
```

No test framework is configured in this repository.

## Architecture Overview

pnpm monorepo with two packages: `packages/server` (Hono/Node API) and `packages/web` (Vite/React SPA).

**Ports**
- Server: `127.0.0.1:9990` (never `0.0.0.0` — local-only by design)
- Web dev server: `5173`, proxies `/api` → `9990`
- Web production / preview: `9991`

### Server (`packages/server`)

**Boot sequence** (`src/index.ts`): ensure data dirs → run DB migrations → register job handlers → recover interrupted jobs → seed defaults → start job worker → start HTTP server.

**Database** (`src/db/`): Drizzle ORM + better-sqlite3. Single schema file at `src/db/schema.ts` — the source of truth for all tables. DB lives at `.data/database/app.db`. Migrations are applied synchronously on every boot.

**Runtime data** (`.data/`, git-ignored): all mutable files go here. Layout managed by `src/lib/paths.ts`. Override the root with `DATA_DIR` env var.

```
.data/
  database/      # app.db
  assets/
    originals/   # uploaded product / competitor images
    generated/   # AI-generated image outputs
    masks/       # inpaint masks
  exports/
  secrets/       # <provider>.json API key files
```

**Gateway layer** (`src/gateway/`): routes AI calls through three provider adapters — `bailian`, `volcengine`, `gpt_proxy`. All job handlers call `gatewayCall(scene, req, jobId)` (or the streaming variants `gatewayTextStream` / `gatewayStream`). The gateway resolves the configured model for the scene, checks that the adapter declares the required capability, sends the request, and writes a `model_call_logs` row on both success and failure.

- Adapter instances are cached; call `invalidateAdapterCache()` after saving a provider config change.
- API keys are read at call time from `.data/secrets/<provider>.json` via `src/gateway/secrets.ts` — never stored in the DB.
- `modelSceneRoutes.billingModelId` decouples the vendor-specific request model ID (e.g. a Volcengine endpoint UUID) from the canonical model name used to look up pricing in `model_pricing`.

**Job system** (`src/jobs/`): in-process poll loop (2 s interval, max 3 concurrent jobs). Job types: `competitor_image_analysis`, `competitor_synthesis`, `design_plan`, `image_generation`, `image_edit`. Each type has a handler in `src/jobs/handlers/`; all are registered at boot in `src/jobs/register.ts`. To add a job type: add it to the `JobType` union in `schema.ts`, write a handler, and register it in `register.ts`. Jobs left in `running` state on restart are marked `interrupted`.

**Routes** (`src/routes/`): each file maps to one `/api/<resource>` prefix. Route handlers enqueue jobs or read from the DB directly; they do not call the gateway directly.

### Web (`packages/web`)

React 19 + React Router v7 + Tailwind CSS v4. ShadCN/UI primitives live in `src/components/ui/`. The `@` alias resolves to `src/`.

**Routing** (`src/router.tsx`): all pages nest under `AppShell`. Key routes:
- `/products` — product list
- `/products/:productId/:tab` — `ProductWorkbench` with tabs: `info`, `research`, `tasks`
- `/tasks/:taskId/step/:step` — 4-step `TaskWizard` (design direction → plan → generation → review)
- `/task-center` — all running / completed tasks
- `/settings/:section` — model routing and output preset config
- `/billing`, `/logs`

**API client** (`src/lib/api.ts`): typed wrapper over `fetch` for all `/api` calls.

### Domain model (data flow)

```
Product
  └─ ProductAssets (uploaded images, vision-analysed)
  └─ ProductSpecifications, SellingPoints
  └─ CompetitorAssets
       └─ AnalysisVersion
            └─ ImageAnalysisCards (per-competitor, LLM output + human override)
            └─ SynthesisReport
            └─ GenerationTask
                 └─ DesignDirections (LLM-generated options)
                 └─ DesignPlanVersion (selected direction, confirmed = immutable)
                      └─ ImageItems (main_image / detail_page, with generation params)
                           └─ ImageVersions (initial / regeneration / inpaint)
```

`configSnapshot` on `GenerationTask` and `outputPresetSnapshot` on `ImageItem` freeze the model routing and output settings at creation time so later config changes don't affect in-flight work.
