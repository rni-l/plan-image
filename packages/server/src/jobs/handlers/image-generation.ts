import { db } from "../../db/index.js";
import { imageItems, imageVersions } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { gatewayCall } from "../../gateway/index.js";
import { saveImageAsset } from "../../lib/storage.js";
import { loadPromptContext } from "../../lib/image-prompt.js";
import { randomUUID } from "node:crypto";

export interface ImageGenerationInput {
  imageItemId: string;
  planVersionId: string;
}

export async function handleImageGeneration(
  jobId: string,
  inputRaw: unknown
): Promise<void> {
  const input = inputRaw as ImageGenerationInput;

  const { prompt, width, height, productImageBase64 } = await loadPromptContext(input.imageItemId);

  // Call image generation via gateway, passing the product photo as a reference image
  const response = await gatewayCall(
    "image_generation",
    {
      scene: "image_generation",
      prompt,
      ...(productImageBase64 ? { images: [productImageBase64] } : {}),
      parameters: {
        task_type: "image_gen",
        size: `${width}x${height}`,
        n: 1,
      },
    },
    jobId
  );

  if (!response.image) {
    throw new Error("图片生成失败：模型未返回图片数据");
  }

  // Save generated image to disk
  const buffer = Buffer.from(response.image, "base64");
  const assetId = randomUUID();
  const saved = await saveImageAsset(buffer, assetId, "generated");

  const now = new Date();

  // Deselect any existing versions for this item
  await db
    .update(imageVersions)
    .set({ isSelected: false })
    .where(eq(imageVersions.imageItemId, input.imageItemId));

  // Create new version (selected)
  await db.insert(imageVersions).values({
    id: assetId,
    imageItemId: input.imageItemId,
    filePath: saved.relativePath,
    checksum: saved.checksum,
    generationType: "initial",
    parentVersionId: null,
    jobId,
    maskPath: null,
    instruction: null,
    isSelected: true,
    createdAt: now,
  });

  // Update item's updatedAt
  await db
    .update(imageItems)
    .set({ updatedAt: now })
    .where(eq(imageItems.id, input.imageItemId));
}

