/**
 * A generation request is one-shot. Once consumed, revisiting Step 2 should
 * show persisted directions; a task with no directions still needs its first
 * generation even when opened directly.
 */
export function shouldGenerateDirections(
  generateRequested: boolean,
  existingDirectionCount: number,
): boolean {
  return generateRequested || existingDirectionCount === 0;
}

/** Model-generated JSON is untrusted at runtime; normalize optional text lists before submitting API payloads. */
export function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}
