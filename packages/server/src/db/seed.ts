import { db } from "./index.js";
import {
  outputPresets,
  modelSceneRoutes,
  modelPricing,
  type SceneKey,
} from "./schema.js";
import { eq, and } from "drizzle-orm";
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

  // -------------------------------------------------------------------------
  // Default model pricing — upsert so re-running seed never overwrites manual
  // edits, but ensures the records exist on a fresh install.
  //
  // Currency notes:
  //   CNY rows: prices in Chinese Yuan (¥) per unit
  //   USD rows: prices in US Dollar ($) per unit
  //
  // qwen3.7-plus rates are the current limited-time 8折 prices (as of 2026-08).
  // deepseek-v4-flash rates from DeepSeek API docs (2026-07).
  // gpt-image-2 uses a medium-quality 1024×1024 estimate ($0.053/image).
  // Seedream prices per official BytePlus ModelArk docs (2026-08).
  // -------------------------------------------------------------------------
  const DEFAULT_PRICING: Array<{
    provider: string;
    modelId: string;
    currency: string;
    pricePerMInputTokens: number;
    pricePerMCachedInputTokens: number;
    pricePerMOutputTokens: number;
    isImageModel: boolean;
    pricePerImage: number;
    pricePerInputImage: number;
  }> = [
    // --- 火山方舟 / 豆包 Seedream 图像模型 ---
    {
      provider: "volcengine",
      modelId: "seedream-4.5",
      currency: "CNY",
      pricePerMInputTokens: 0,
      pricePerMCachedInputTokens: 0,
      pricePerMOutputTokens: 0,
      isImageModel: true,
      pricePerImage: 0.25,        // 文生图 / 图生图 均 ¥0.25/张
      pricePerInputImage: 0,       // 图生图参考图不额外计费
    },
    {
      provider: "volcengine",
      modelId: "seedream-5.0-pro",
      currency: "CNY",
      pricePerMInputTokens: 0,
      pricePerMCachedInputTokens: 0,
      pricePerMOutputTokens: 0,
      isImageModel: true,
      pricePerImage: 0.30,        // 输出图 ¥0.30/张
      pricePerInputImage: 0.02,   // 输入参考图 ¥0.02/张
    },
    // --- 百炼 / 通义 qwen3.7-plus (限时8折, 2026-08) ---
    {
      provider: "bailian",
      modelId: "qwen3.7-plus",
      currency: "CNY",
      pricePerMInputTokens: 1.6,        // 原价 ¥2/M × 0.8
      pricePerMCachedInputTokens: 0.32, // 原价 ¥0.4/M × 0.8 (缓存命中)
      pricePerMOutputTokens: 6.4,       // 原价 ¥8/M × 0.8
      isImageModel: false,
      pricePerImage: 0,
      pricePerInputImage: 0,
    },
    // --- DeepSeek V4 Flash (通过 gpt_proxy 接入, 2026-07) ---
    {
      provider: "gpt_proxy",
      modelId: "deepseek-v4-flash",
      currency: "USD",
      pricePerMInputTokens: 0.14,       // cache miss input
      pricePerMCachedInputTokens: 0.0028, // cache hit input
      pricePerMOutputTokens: 0.28,
      isImageModel: false,
      pricePerImage: 0,
      pricePerInputImage: 0,
    },
    // --- GPT-Image-2 (通过 gpt_proxy 接入) ---
    // Token-based billing; pricePerImage is a medium-quality 1024×1024 estimate.
    // Actual cost = (promptTokens/1M × $5) + (completionTokens/1M × $30).
    {
      provider: "gpt_proxy",
      modelId: "gpt-image-2",
      currency: "USD",
      pricePerMInputTokens: 5.0,        // text input tokens
      pricePerMCachedInputTokens: 1.25, // cached text input tokens
      pricePerMOutputTokens: 30.0,      // image output tokens
      isImageModel: true,
      pricePerImage: 0.053,             // medium quality 1024×1024 estimate
      pricePerInputImage: 0,
    },
  ];

  for (const p of DEFAULT_PRICING) {
    const existing = await db
      .select({ id: modelPricing.id })
      .from(modelPricing)
      .where(and(eq(modelPricing.provider, p.provider), eq(modelPricing.modelId, p.modelId)));

    if (existing.length === 0) {
      await db.insert(modelPricing).values({
        id: randomUUID(),
        ...p,
        updatedAt: now,
      });
      console.log(`  ✅ Pricing seeded: ${p.provider}/${p.modelId}`);
    }
  }
}
