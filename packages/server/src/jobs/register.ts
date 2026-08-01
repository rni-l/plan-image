import { registerHandler } from "./dispatcher.js";
import { handleCompetitorImageAnalysis } from "./handlers/competitor-analysis.js";
import { handleCompetitorSynthesis } from "./handlers/competitor-synthesis.js";

/** Register all job handlers. Call once on server startup. */
export function registerAllHandlers(): void {
  registerHandler("competitor_image_analysis", handleCompetitorImageAnalysis);
  registerHandler("competitor_synthesis",      handleCompetitorSynthesis);
  // image_generation, image_edit, design_plan, export — registered when implemented
}
