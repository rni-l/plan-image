import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { paths } from "../lib/paths.js";
import * as schema from "./schema.js";

function createDb() {
  const dbPath = path.join(paths.database, "app.db");
  fs.mkdirSync(paths.database, { recursive: true });

  const sqlite = new Database(dbPath);
  // Enable WAL mode for better concurrent read performance
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  return drizzle(sqlite, { schema });
}

// Singleton — module is only evaluated once
export const db = createDb();
export type DB = typeof db;
