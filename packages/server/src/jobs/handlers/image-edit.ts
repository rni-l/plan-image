import fs from "node:fs";
import path from "node:path";
import { db } from "../../db/index.js";
import { imageItems, imageVersions } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { gatewayCall } from "../../gateway/index.js";
import { saveImageAsset } from "../../lib/storage.js";
import { assetPath } from "../../lib/paths.js";
import { randomUUID } from "node:crypto";
import { resolveDefaultModelRoute, type ModelRouteSnapshot } from "../../gateway/model-route.js";

export interface ImageEditInput {
  /** The new placeholder imageVersion id — handler fills filePath/checksum here */
  versionId: string;
  /** The source imageVersion id to read the original image from */
  parentVersionId: string;
  /** Natural-language edit instruction */
  instruction: string;
  modelRoute: ModelRouteSnapshot;
}

/**
 * Wrap a raw user instruction into a structured edit prompt for image models.
 * The wrapper clarifies scope (masked region only), quality expectations, and
 * consistency constraints so the model avoids unintended global changes.
 */
export function buildEditPrompt(instruction: string): string {
  return `请对图片中遮罩标注的区域进行如下修改：${instruction}

编辑要求：
- 仅修改遮罩覆盖的区域，保持其他区域完全不变
- 修改后的区域与周围内容在光线、色调、材质上自然融合
- 保持整体构图风格和产品主体不受影响
- 输出专业电商图片品质，细节清晰，无明显接缝或不协调感`;
}

export async function handleImageEdit(
  jobId: string,
  inputRaw: unknown
): Promise<void> {
  const input = inputRaw as ImageEditInput;

  // -------------------------------------------------------------------------
  // 1. Load the placeholder version (needs maskPath + imageItemId)
  // -------------------------------------------------------------------------
  const [newVersion] = await db
    .select()
    .from(imageVersions)
    .where(eq(imageVersions.id, input.versionId));
  if (!newVersion) throw new Error(`imageVersion 不存在: ${input.versionId}`);
  if (!newVersion.maskPath) throw new Error(`遮罩路径缺失: ${input.versionId}`);

  // -------------------------------------------------------------------------
  // 2. Load the source version (needs filePath for the original image)
  // -------------------------------------------------------------------------
  const [parentVersion] = await db
    .select()
    .from(imageVersions)
    .where(eq(imageVersions.id, input.parentVersionId));
  if (!parentVersion) throw new Error(`源版本不存在: ${input.parentVersionId}`);

  // -------------------------------------------------------------------------
  // 3. Load image item for output preset dimensions
  // -------------------------------------------------------------------------
  const [item] = await db
    .select()
    .from(imageItems)
    .where(eq(imageItems.id, newVersion.imageItemId));
  if (!item) throw new Error(`图片项不存在: ${newVersion.imageItemId}`);

  let width = 1000;
  let height = 1000;
  try {
    const preset = JSON.parse(item.outputPresetSnapshot) as {
      width?: number;
      height?: number;
    };
    width  = preset.width  ?? 1000;
    height = preset.height ?? 1000;
  } catch { /* use defaults */ }

  // -------------------------------------------------------------------------
  // 4. Read source image → base64
  // -------------------------------------------------------------------------
  const srcAbsolute = assetPath(parentVersion.filePath);
  let srcBuf: Buffer;
  try {
    srcBuf = await fs.promises.readFile(srcAbsolute);
  } catch {
    throw new Error(`源图文件读取失败: ${parentVersion.filePath}`);
  }
  const sourceB64 = srcBuf.toString("base64");

  // -------------------------------------------------------------------------
  // 5. Read mask → base64
  // -------------------------------------------------------------------------
  const maskAbsolute = assetPath(newVersion.maskPath);
  let maskBuf: Buffer;
  try {
    maskBuf = await fs.promises.readFile(maskAbsolute);
  } catch {
    throw new Error(`遮罩文件读取失败: ${newVersion.maskPath}`);
  }
  const maskB64 = maskBuf.toString("base64");

  // -------------------------------------------------------------------------
  // 6. Call gateway image_edit with wrapped prompt
  // -------------------------------------------------------------------------
  const response = await gatewayCall(input.modelRoute ?? await resolveDefaultModelRoute("image_edit"), {
    scene: "image_edit",
    prompt: buildEditPrompt(input.instruction),
    images: [sourceB64],
    mask: maskB64,
    parameters: {
      task_type: "image_edit",
      size: `${width}x${height}`,
      n: 1,
    },
  }, jobId);

  if (!response.image) {
    throw new Error("图片编辑失败：模型未返回图片数据");
  }

  // -------------------------------------------------------------------------
  // 7. Save result image
  // -------------------------------------------------------------------------
  const buffer = Buffer.from(response.image, "base64");
  const resultId = randomUUID();
  const saved = await saveImageAsset(buffer, resultId, "generated");

  const now = new Date();

  // -------------------------------------------------------------------------
  // 8. Deselect all existing versions for this item, then update new version
  // -------------------------------------------------------------------------
  await db
    .update(imageVersions)
    .set({ isSelected: false })
    .where(eq(imageVersions.imageItemId, newVersion.imageItemId));

  await db
    .update(imageVersions)
    .set({
      filePath: saved.relativePath,
      checksum: saved.checksum,
      jobId,
      finalPrompt: buildEditPrompt(input.instruction),
      isSelected: true,
    })
    .where(eq(imageVersions.id, input.versionId));

  // -------------------------------------------------------------------------
  // 9. Touch imageItem updatedAt
  // -------------------------------------------------------------------------
  await db
    .update(imageItems)
    .set({ updatedAt: now })
    .where(eq(imageItems.id, newVersion.imageItemId));
}
