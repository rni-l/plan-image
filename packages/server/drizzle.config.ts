import { defineConfig } from "drizzle-kit";
import path from "node:path";

// Resolve project root relative to this config file (packages/server → project root)
const projectRoot = path.resolve(__dirname, "../..");
const dbPath = path.join(projectRoot, ".data", "database", "app.db");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
});
