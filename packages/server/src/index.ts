import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ensureDataDirs } from "./lib/paths.js";
import { db } from "./db/index.js";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { securityMiddleware } from "./middleware/security.js";
import { productsRouter } from "./routes/products.js";
import { researchRouter } from "./routes/research.js";
import { tasksRouter } from "./routes/tasks.js";
import { settingsRouter } from "./routes/settings.js";
import { jobsRouter } from "./routes/jobs.js";
import { logsRouter } from "./routes/logs.js";
import { billingRouter } from "./routes/billing.js";
import { promptsRouter } from "./routes/prompts.js";
import { authMiddleware, authRouter } from "./routes/auth.js";
import { requestLoggerMiddleware } from "./middleware/request-logger.js";
import { recoverInterruptedJobs, startWorker, stopWorker } from "./jobs/worker.js";
import { seedDefaults } from "./db/seed.js";
import { registerAllHandlers } from "./jobs/register.js";

const PORT = Number(process.env.PORT ?? 9990);
const HOST = process.env["HOST"] ?? "127.0.0.1";
const WEB_DIST_DIR = process.env["WEB_DIST_DIR"] ?? path.resolve(process.cwd(), "packages", "web", "dist");

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------

ensureDataDirs();

// Run migrations synchronously before accepting requests
const migrationsFolder = path.join(import.meta.dirname, "db", "migrations");
migrate(db, { migrationsFolder });
console.log("✅ DB migrations applied");

registerAllHandlers();
await recoverInterruptedJobs();
await seedDefaults();
startWorker();

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono();

app.use("*", logger());

// Allow requests from the Vite dev server and the production static build
app.use(
  "*",
  cors({
    origin: [
      "http://localhost:9991",
      "http://127.0.0.1:9991",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowHeaders: ["Content-Type"],
    credentials: false,
  })
);

// Reject requests not originating from localhost
app.use("*", securityMiddleware);

// Railway uses this unauthenticated endpoint to determine whether the process
// is ready to receive traffic. It intentionally exposes no application data.
app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const api = new Hono();

api.use("*", requestLoggerMiddleware);
api.use("*", authMiddleware);

api.route("/products", productsRouter);
api.route("/research", researchRouter);
api.route("/tasks", tasksRouter);
api.route("/settings", settingsRouter);
api.route("/jobs", jobsRouter);
api.route("/logs", logsRouter);
api.route("/billing", billingRouter);
api.route("/prompts", promptsRouter);

app.route("/api/auth", authRouter);
app.route("/api", api);

// In production the server hosts the built Vite SPA and falls back to its
// entrypoint for client-side routes. API routes above take precedence.
app.use("/*", serveStatic({ root: WEB_DIST_DIR }));
app.get("/*", serveStatic({
  root: WEB_DIST_DIR,
  rewriteRequestPath: () => "/index.html",
}));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  console.log(`🚀 Server listening on http://${HOST}:${PORT}`);
});

// Graceful shutdown — stop accepting new jobs, let running ones finish
process.on("SIGTERM", () => { stopWorker(); process.exit(0); });
process.on("SIGINT",  () => { stopWorker(); process.exit(0); });
