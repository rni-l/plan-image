import type { PromptTemplateType } from "./prompt-service.js";

export interface BuiltInPromptTemplate {
  id: string;
  type: PromptTemplateType;
  name: string;
  description: string;
  body: string;
  isDefault: boolean;
}

const DESIGN_SHARED = `

【商品信息】
商品名称：{{product_name}}
商品备注：{{product_notes}}
规格参数：{{product_specifications}}
核心卖点：{{selling_points}}

【商品图片视觉分析】
{{product_visual_analysis}}

【竞品分析洞察】
{{competitor_insights}}
{{#if user_ideas}}
【用户创意想法】
{{user_ideas}}
{{/if}}

请生成 {{plan_count}} 个差异化方向。每个方向包含 {{main_image_count}} 张主图和 {{detail_image_count}} 张详情页图；本任务输出类型为：{{output_types}}。
可用商品素材 ID：{{product_asset_ids}}。每张图片必须选择合适的 productAssetId；没有可用素材时填 null。
每个图片项都要写明构图、光照、视角、背景、氛围、视觉元素和要强调的卖点，描述必须具体到可以直接驱动图片模型。`;

const IMAGE_SHARED = `

【方案风格】
方向：{{direction_label}}
定位：{{direction_positioning}}
配色：{{direction_color_scheme}}
版式：{{direction_layout_intent}}
文案策略：{{direction_copy_strategy}}

【图片任务】
类型：{{image_list_type}}
标题：{{image_title}}
用途：{{image_description}}
构图：{{image_composition_intent}}
光照：{{image_lighting}}
视角：{{image_angle}}
背景：{{image_background}}
氛围：{{image_mood}}
视觉元素：{{image_visual_elements}}
重点卖点：{{image_selling_points}}
{{#if image_suggested_copy}}画面文案：{{image_suggested_copy}}{{/if}}

【商品依据】
商品：{{product_name}}
商品外观：{{product_visual_description}}
商品规格：{{product_specifications}}
商品卖点：{{product_selling_points}}
商品素材 ID：{{product_asset_id}}
补充参考素材 ID：{{reference_asset_ids}}

输出尺寸：{{width}}×{{height}}，画幅比例 {{aspect_ratio}}。`;

export const BUILT_IN_PROMPT_TEMPLATES: readonly BuiltInPromptTemplate[] = [
  {
    id: "builtin-design-balanced",
    type: "design_plan",
    name: "均衡转化",
    description: "兼顾商品真实性、卖点传达与电商点击转化的通用方案。",
    isDefault: true,
    body: `以转化效率为核心，为商品制定兼顾识别度、信息清晰度和视觉吸引力的完整电商视觉方案。方向之间要有清晰差异，同时确保每个方向都能稳定落地。${DESIGN_SHARED}`,
  },
  {
    id: "builtin-design-differentiated",
    type: "design_plan",
    name: "竞品差异化",
    description: "优先利用竞品共性与空白机会建立差异化视觉表达。",
    isDefault: false,
    body: `以竞品差异化为第一优先级。先识别行业视觉惯例、同质化风险和可占领的表达空白，再为商品建立辨识度强、仍符合购买心智的视觉方向。避免简单复刻竞品。${DESIGN_SHARED}`,
  },
  {
    id: "builtin-design-premium",
    type: "design_plan",
    name: "品牌高端化",
    description: "强化品牌资产、材质价值和高级审美的一致性。",
    isDefault: false,
    body: `以品牌高端化为核心，强调克制、有秩序的视觉层级，准确表现商品材质与工艺价值。所有方向都要具备品牌延展性，避免廉价促销感和无依据的奢华符号。${DESIGN_SHARED}`,
  },
  {
    id: "builtin-image-commerce",
    type: "image_generation",
    name: "电商标准",
    description: "主体清晰、卖点突出、适合常规电商页面的稳定生成模板。",
    isDefault: true,
    body: `生成一张专业电商商业图片。商品是绝对视觉主体，信息层级清楚，构图干净，光影自然，卖点表达直接且有购买吸引力。${IMAGE_SHARED}`,
  },
  {
    id: "builtin-image-authentic",
    type: "image_generation",
    name: "真实性优先",
    description: "最大限度保持商品外观、材质、比例和细节真实。",
    isDefault: false,
    body: `生成一张以商品真实性为最高优先级的专业图片。严格依据参考图保持商品结构、比例、颜色、材质和细节；环境与道具只能服务于商品展示，不得遮挡或误导。${IMAGE_SHARED}`,
  },
  {
    id: "builtin-image-atmosphere",
    type: "image_generation",
    name: "场景氛围强化",
    description: "在不牺牲商品真实性的前提下强化场景叙事和情绪。",
    isDefault: false,
    body: `生成一张场景叙事鲜明的专业电商图片。在忠实还原商品的前提下，通过空间、光线、色彩和道具建立统一氛围，让使用场景和情绪价值可被直观感知。${IMAGE_SHARED}`,
  },
] as const;
