import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { db } from "./index.js";

const migrationsFolder = path.join(import.meta.dirname, "migrations");

migrate(db, { migrationsFolder });
console.log("✅ Migrations applied");
