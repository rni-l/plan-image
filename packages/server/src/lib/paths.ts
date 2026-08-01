import path from "node:path";
import fs from "node:fs";

// All runtime data lives under .data/ in the project root (git-ignored).
// Override with DATA_DIR env var for custom installations.
export const projectRoot = path.resolve(import.meta.dirname, "../../../..");
export const dataDir = process.env["DATA_DIR"] ?? path.join(projectRoot, ".data");

export const paths = {
  database: path.join(dataDir, "database"),
  originals: path.join(dataDir, "assets", "originals"),
  generated: path.join(dataDir, "assets", "generated"),
  masks: path.join(dataDir, "assets", "masks"),
  exports: path.join(dataDir, "exports"),
  secrets: path.join(dataDir, "secrets"),
} as const;

/** Ensure all runtime data directories exist on startup. */
export function ensureDataDirs(): void {
  for (const dir of Object.values(paths)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Resolve an asset path relative to the data directory. */
export function assetPath(relativePath: string): string {
  return path.join(dataDir, relativePath);
}
