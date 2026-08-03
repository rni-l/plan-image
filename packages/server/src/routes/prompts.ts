import { Hono } from "hono";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { promptTemplates, type PromptTemplateType } from "../db/schema.js";
import { gatewayCall } from "../gateway/index.js";
import {
  DESIGN_PLAN_LOCKED_SUFFIX,
  IMAGE_GENERATION_LOCKED_SUFFIX,
  allowedVariablesFor,
  composeFinalPrompt,
  parameterizePrompt,
  renderPromptTemplate,
  renderDesignPlanPromptSnapshot,
  renderImageGenerationPromptSnapshot,
  validatePolishInstruction,
  type PromptVariables,
} from "../lib/prompt-service.js";

export const promptsRouter = new Hono();

function isType(value: unknown): value is PromptTemplateType {
  return value === "design_plan" || value === "image_generation";
}

function lockedSuffixFor(type: PromptTemplateType): string {
  return type === "design_plan" ? DESIGN_PLAN_LOCKED_SUFFIX : IMAGE_GENERATION_LOCKED_SUFFIX;
}

async function resolveTemplate(type: PromptTemplateType, templateId?: string) {
  if (templateId) {
    const [template] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, templateId));
    if (!template || template.type !== type) return undefined;
    return template;
  }
  const [template] = await db.select().from(promptTemplates)
    .where(and(
      eq(promptTemplates.type, type),
      eq(promptTemplates.isDefault, true),
      isNull(promptTemplates.archivedAt),
    ))
    .orderBy(asc(promptTemplates.createdAt))
    .limit(1);
  return template;
}

promptsRouter.post("/render", async (c) => {
  const body = await c.req.json<{
    type: string;
    templateId?: string;
    templateBody?: string;
    editablePrompt?: string;
    contextVariables?: PromptVariables;
    taskId?: string;
    imageItemId?: string;
    options?: {
      userIdeas?: string;
      planCount?: number;
      mainImageCount?: number;
      detailImageCount?: number;
    };
  }>();
  if (!isType(body.type)) return c.json({ error: "无效的 Prompt 类型" }, 400);

  try {
    if (!body.contextVariables) {
      if (body.type === "design_plan" && body.taskId) {
        const rendered = await renderDesignPlanPromptSnapshot({
          taskId: body.taskId,
          ...(body.templateId !== undefined ? { templateId: body.templateId } : {}),
          ...(body.templateBody !== undefined ? { templateBody: body.templateBody } : {}),
          ...(body.editablePrompt !== undefined ? { editablePrompt: body.editablePrompt } : {}),
          ...(body.options !== undefined ? { options: body.options } : {}),
        });
        return c.json({ type: body.type, ...rendered });
      }
      if (body.type === "image_generation" && body.imageItemId) {
        const rendered = await renderImageGenerationPromptSnapshot({
          imageItemId: body.imageItemId,
          ...(body.templateId !== undefined ? { templateId: body.templateId } : {}),
          ...(body.templateBody !== undefined ? { templateBody: body.templateBody } : {}),
          ...(body.editablePrompt !== undefined ? { editablePrompt: body.editablePrompt } : {}),
        });
        return c.json({
          type: body.type,
          templateId: rendered.templateId,
          templateName: rendered.templateName,
          editablePrompt: rendered.editablePrompt,
          lockedSuffix: rendered.lockedSuffix,
          finalPrompt: rendered.finalPrompt,
          contextVariables: rendered.contextVariables,
        });
      }
      return c.json({ error: "必须提供 contextVariables，或提供对应的 taskId/imageItemId" }, 400);
    }

    const template = await resolveTemplate(body.type, body.templateId);
    if (!body.templateBody && !template) return c.json({ error: "模板不存在或类型不匹配" }, 404);
    const variables = body.contextVariables ?? {};
    const contextVariables = Object.fromEntries(
      allowedVariablesFor(body.type).map((name) => [name, variables[name] == null ? "" : String(variables[name])]),
    );
    const rendered = body.editablePrompt !== undefined
      ? composeFinalPrompt(body.editablePrompt, lockedSuffixFor(body.type), contextVariables)
      : renderPromptTemplate({
          templateBody: body.templateBody ?? template!.body,
          variables,
          allowedVariables: allowedVariablesFor(body.type),
          lockedSuffix: lockedSuffixFor(body.type),
        });
    return c.json({
      templateId: template?.id ?? null,
      templateName: template?.name ?? null,
      type: body.type,
      ...rendered,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

promptsRouter.post("/polish", async (c) => {
  const body = await c.req.json<{
    type: string;
    editablePrompt: string;
    instruction: string;
  }>();
  if (!isType(body.type)) return c.json({ error: "无效的 Prompt 类型" }, 400);
  let instruction: string;
  try {
    instruction = validatePolishInstruction(body.instruction ?? "");
    composeFinalPrompt(body.editablePrompt ?? "", lockedSuffixFor(body.type));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
  if (!instruction) return c.json({ error: "请输入润色意见" }, 400);

  try {
    const response = await gatewayCall("design_plan", {
      scene: "design_plan",
      systemPrompt: "你是 Prompt 编辑专家。根据用户意见润色可编辑 Prompt 正文。只输出完整的润色后正文，不要输出解释、Markdown 或固定契约；不得删减用户明确提供的事实。",
      prompt: `【当前可编辑 Prompt】\n${body.editablePrompt}\n\n【润色意见】\n${instruction}`,
    });
    const proposal = response.text?.trim();
    if (!proposal) return c.json({ error: "模型未返回润色提案" }, 502);
    composeFinalPrompt(proposal, lockedSuffixFor(body.type));
    return c.json({ proposal });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

promptsRouter.post("/parameterize", async (c) => {
  const body = await c.req.json<{
    type: string;
    text: string;
    contextVariables: Record<string, string>;
  }>();
  if (!isType(body.type)) return c.json({ error: "无效的 Prompt 类型" }, 400);
  const parameterizedBody = parameterizePrompt(
    body.text ?? "",
    body.contextVariables ?? {},
    allowedVariablesFor(body.type),
  );
  try {
    renderPromptTemplate({
      templateBody: parameterizedBody,
      variables: body.contextVariables ?? {},
      allowedVariables: allowedVariablesFor(body.type),
      lockedSuffix: lockedSuffixFor(body.type),
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
  return c.json({ parameterizedBody });
});
