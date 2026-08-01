import { db } from "./index.js";
import {
  outputPresets,
  modelSceneRoutes,
  type SceneKey,
} from "./schema.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const DEFAULT_PRESETS = [
  {
    name: "主图标准",
    presetType: "main_image" as const,
    width: 1000,
    height: 1000,
    format: "jpg" as const,
    quality: 90,
    isDefault: true,
  },
  {
    name: "详情页模块",
    presetType: "detail_module" as const,
    width: 790,
    height: 1000,
    format: "jpg" as const,
    quality: 90,
    isDefault: true,
  },
];

const SCENE_KEYS: SceneKey[] = [
  "competitor_image_analysis",
  "competitor_synthesis",
  "design_plan",
  "image_generation",
  "image_edit",
];

/** Run once on startup to ensure default rows exist. Idempotent. */
export async function seedDefaults(): Promise<void> {
  const now = new Date();

  // Default output presets — only insert if none exist
  const existingPresets = await db.select({ id: outputPresets.id }).from(outputPresets).limit(1);
  if (existingPresets.length === 0) {
    for (const preset of DEFAULT_PRESETS) {
      await db.insert(outputPresets).values({
        id: randomUUID(),
        ...preset,
        createdAt: now,
        updatedAt: now,
      });
    }
    console.log("✅ Default output presets seeded");
  }

  // Scene route stubs — insert empty rows so the settings page can show them
  for (const scene of SCENE_KEYS) {
    const existing = await db
      .select({ id: modelSceneRoutes.id })
      .from(modelSceneRoutes)
      .where(eq(modelSceneRoutes.scene, scene));

    if (existing.length === 0) {
      await db.insert(modelSceneRoutes).values({
        id: randomUUID(),
        scene,
        providerId: null,
        modelId: null,
        parameters: null,
        updatedAt: now,
      });
    }
  }
}
