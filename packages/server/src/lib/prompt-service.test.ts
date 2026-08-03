import assert from "node:assert/strict";
import test from "node:test";
import {
  DESIGN_PLAN_LOCKED_SUFFIX,
  IMAGE_GENERATION_LOCKED_SUFFIX,
  parameterizePrompt,
  renderPromptTemplate,
  validatePolishInstruction,
  validateTemplateBody,
} from "./prompt-service.js";

const allowed = ["product_name", "user_ideas", "width"] as const;

test("renders variables and optional conditional blocks", () => {
  const rendered = renderPromptTemplate({
    templateBody: "商品：{{product_name}}{{#if user_ideas}}\n想法：{{user_ideas}}{{/if}}\n宽度：{{width}}",
    variables: { product_name: "便携榨汁杯", user_ideas: "夏日清爽", width: 1000 },
    allowedVariables: allowed,
    lockedSuffix: IMAGE_GENERATION_LOCKED_SUFFIX,
  });

  assert.equal(rendered.editablePrompt, "商品：便携榨汁杯\n想法：夏日清爽\n宽度：1000");
  assert.equal(rendered.lockedSuffix, IMAGE_GENERATION_LOCKED_SUFFIX);
  assert.equal(rendered.finalPrompt, `${rendered.editablePrompt}\n\n${IMAGE_GENERATION_LOCKED_SUFFIX}`);
  assert.deepEqual(rendered.contextVariables, {
    product_name: "便携榨汁杯",
    user_ideas: "夏日清爽",
    width: "1000",
  });
});

test("renders missing optional values as empty text and omits their condition block", () => {
  const rendered = renderPromptTemplate({
    templateBody: "{{product_name}}-{{user_ideas}}{{#if user_ideas}}不应出现{{/if}}",
    variables: { product_name: "商品" },
    allowedVariables: allowed,
    lockedSuffix: DESIGN_PLAN_LOCKED_SUFFIX,
  });

  assert.equal(rendered.editablePrompt, "商品-");
});

test("rejects unknown variables", () => {
  assert.throws(
    () => validateTemplateBody("{{unknown}}", allowed),
    /未知变量.*unknown/,
  );
});

test("rejects unclosed and nested conditional blocks", () => {
  assert.throws(
    () => validateTemplateBody("{{#if user_ideas}}内容", allowed),
    /未闭合/,
  );
  assert.throws(
    () => validateTemplateBody("{{#if user_ideas}}{{#if width}}内容{{\/if}}{{\/if}}", allowed),
    /不支持嵌套/,
  );
});

test("enforces template, final prompt, and polish instruction limits", () => {
  assert.throws(() => validateTemplateBody("x".repeat(20_001), allowed), /20,000/);
  assert.throws(() => renderPromptTemplate({
    templateBody: "x".repeat(20_000),
    variables: {},
    allowedVariables: allowed,
    lockedSuffix: "y".repeat(10_001),
  }), /30,000/);
  assert.throws(() => validatePolishInstruction("x".repeat(1_001)), /1,000/);
});

test("parameterizes known rendered values using the longest value first", () => {
  const result = parameterizePrompt(
    "便携榨汁杯，尺寸1000；便携榨汁杯再次出现",
    { product_name: "便携榨汁杯", width: "1000", user_ideas: "" },
    allowed,
  );

  assert.equal(result, "{{product_name}}，尺寸{{width}}；{{product_name}}再次出现");
});

test("locked contracts contain the required immutable guarantees", () => {
  assert.match(DESIGN_PLAN_LOCKED_SUFFIX, /严格 JSON/);
  assert.match(IMAGE_GENERATION_LOCKED_SUFFIX, /真实外观/);
  assert.match(IMAGE_GENERATION_LOCKED_SUFFIX, /输出尺寸/);
});
