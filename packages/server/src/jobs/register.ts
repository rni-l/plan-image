import { registerHandler } from "./dispatcher.js";
import { handleCompetitorImageAnalysis } from "./handlers/competitor-analysis.js";
import { handleCompetitorSynthesis } from "./handlers/competitor-synthesis.js";
import { handleDesignPlan } from "./handlers/design-plan.js";
import { handleImageGeneration } from "./handlers/image-generation.js";

/** Register all job handlers. Call once on server startup. */
export function registerAllHandlers(): void {
  registerHandler("competitor_image_analysis", handleCompetitorImageAnalysis);
  registerHandler("competitor_synthesis",      handleCompetitorSynthesis);
  registerHandler("design_plan",               handleDesignPlan);
  registerHandler("image_generation",          handleImageGeneration);
  // image_edit, export — registered when implemented
}
