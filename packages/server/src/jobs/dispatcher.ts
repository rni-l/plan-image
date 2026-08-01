import type { JobType } from "../db/schema.js";

// Each handler receives the jobId and the frozen inputSnapshot.
// Throw to signal failure; return to signal success.
export type JobHandler = (jobId: string, input: unknown) => Promise<void>;

const handlers: Partial<Record<JobType, JobHandler>> = {};

export function registerHandler(type: JobType, handler: JobHandler): void {
  handlers[type] = handler;
}

export async function dispatch(type: JobType, jobId: string, input: unknown): Promise<void> {
  const handler = handlers[type];
  if (!handler) {
    throw new Error(`No handler registered for job type: ${type}`);
  }
  await handler(jobId, input);
}
