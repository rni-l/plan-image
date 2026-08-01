import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { paths } from "./paths.js";

export type AssetCategory = "originals" | "generated" | "masks" | "exports";

const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export interface SavedAsset {
  /** Path relative to dataDir — stored in DB */
  relativePath: string;
  /** Absolute path on disk */
  absolutePath: string;
  /** SHA-256 hex */
  checksum: string;
  /** sharp format string */
  format: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Validate and atomically write an uploaded image buffer.
 * Uses temp-file + rename to avoid partial writes.
 */
export async function saveImageAsset(
  buffer: Buffer,
  assetId: string,
  category: AssetCategory
): Promise<SavedAsset> {
  if (buffer.length > MAX_BYTES) {
    throw new UploadError("FILE_TOO_LARGE", "文件超过 20 MB 限制");
  }

  // Lazy-import sharp (native module)
  const sharp = (await import("sharp")).default;
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new UploadError("INVALID_IMAGE", "无法解析图片，请确认文件格式正确");
  }

  const format = meta.format ?? "";
  if (!ALLOWED_FORMATS.has(format)) {
    throw new UploadError(
      "UNSUPPORTED_FORMAT",
      `不支持的格式 ${format}，请上传 JPEG / PNG / WEBP`
    );
  }

  const ext = format === "jpeg" ? "jpg" : format;
  const filename = `${assetId}.${ext}`;
  const dir = paths[category];
  const finalPath = path.join(dir, filename);
  const tmpPath = finalPath + ".tmp";

  // Write to temp file first
  await fs.promises.writeFile(tmpPath, buffer);

  // Compute checksum
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

  // Atomic rename
  await fs.promises.rename(tmpPath, finalPath);

  return {
    relativePath: path.join("assets", category, filename),
    absolutePath: finalPath,
    checksum,
    format,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    bytes: buffer.length,
  };
}

export class UploadError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "UploadError";
  }
}

/**
 * Read a saved asset as a Buffer, verifying its checksum.
 * Throws if the file is missing or checksum mismatch.
 */
export async function readAndVerifyAsset(
  relativePath: string,
  expectedChecksum: string
): Promise<Buffer> {
  const { dataDir } = await import("./paths.js");
  const absolutePath = path.join(dataDir, relativePath);

  let buf: Buffer;
  try {
    buf = await fs.promises.readFile(absolutePath);
  } catch {
    throw new Error(`资产文件丢失：${relativePath}`);
  }

  const actual = crypto.createHash("sha256").update(buf).digest("hex");
  if (actual !== expectedChecksum) {
    throw new Error(`资产文件校验失败：${relativePath}`);
  }

  return buf;
}
