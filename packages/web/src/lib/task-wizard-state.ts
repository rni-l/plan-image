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
