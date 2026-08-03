import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_PROMPT_TEMPLATES } from "./prompt-templates.js";
import { allowedVariablesFor, validateTemplateBody } from "./prompt-service.js";

test("defines six stable built-in templates with one default per type", () => {
  assert.equal(BUILT_IN_PROMPT_TEMPLATES.length, 6);
  assert.deepEqual(
    BUILT_IN_PROMPT_TEMPLATES.map((template) => template.id),
    [
      "builtin-design-balanced",
      "builtin-design-differentiated",
      "builtin-design-premium",
      "builtin-image-commerce",
      "builtin-image-authentic",
      "builtin-image-atmosphere",
    ],
  );

  for (const type of ["design_plan", "image_generation"] as const) {
    const templates = BUILT_IN_PROMPT_TEMPLATES.filter((template) => template.type === type);
    assert.equal(templates.length, 3);
    assert.equal(templates.filter((template) => template.isDefault).length, 1);
    for (const template of templates) {
      validateTemplateBody(template.body, allowedVariablesFor(type));
    }
  }
});
