import { db } from "../db/index.js";
import { backgroundJobs, type JobType, type JobStatus } from "../db/schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { dispatch } from "./dispatcher.js";

const POLL_INTERVAL_MS = 2_000;
const MAX_CONCURRENT = 3;

let running = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;

// ---------------------------------------------------------------------------
// Startup: mark any jobs that were left in 'running' as 'interrupted'
// ---------------------------------------------------------------------------
export async function recoverInterruptedJobs(): Promise<void> {
  const result = await db
    .update(backgroundJobs)
    .set({ status: "interrupted", finishedAt: new Date() })
    .where(eq(backgroundJobs.status, "running"));
  const count = (result as unknown as { changes: number }).changes ?? 0;
  if (count > 0) {
    console.log(`⚠️  Marked ${count} interrupted job(s) from previous run`);
  }
}

// ---------------------------------------------------------------------------
// Enqueue a new job (call this from route handlers)
// ---------------------------------------------------------------------------
export async function enqueueJob(opts: {
  type: JobType;
  entityType?: string;
  entityId?: string;
  inputSnapshot: unknown;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(backgroundJobs).values({
    id,
    type: opts.type,
    status: "queued",
    entityType: opts.entityType ?? null,
    entityId: opts.entityId ?? null,
    inputSnapshot: JSON.stringify(opts.inputSnapshot),
    createdAt: new Date(),
  });
  scheduleImmediatePoll();
  return id;
}

// ---------------------------------------------------------------------------
// Worker loop
// ---------------------------------------------------------------------------
export function startWorker(): void {
  if (pollTimer !== null) return;
  schedulePoll(POLL_INTERVAL_MS);
  console.log("✅ Job worker started");
}

export function stopWorker(): void {
  shuttingDown = true;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function schedulePoll(ms: number): void {
  if (shuttingDown) return;
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    await tick();
    schedulePoll(POLL_INTERVAL_MS);
  }, ms);
}

function scheduleImmediatePoll(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  schedulePoll(0);
}

async function tick(): Promise<void> {
  if (running >= MAX_CONCURRENT) return;

  // Fetch up to (MAX_CONCURRENT - running) queued jobs
  const slots = MAX_CONCURRENT - running;
  const queued = await db
    .select()
    .from(backgroundJobs)
    .where(eq(backgroundJobs.status, "queued"))
    .orderBy(backgroundJobs.createdAt)
    .limit(slots);

  for (const job of queued) {
    // Check again in case cancelled between poll and now
    const [fresh] = await db
      .select({ status: backgroundJobs.status })
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, job.id));
    if (fresh?.status !== "queued") continue;

    running++;
    executeJob(job.id, job.type as JobType, job.inputSnapshot).finally(() => {
      running--;
    });
  }
}

async function executeJob(
  jobId: string,
  type: JobType,
  inputSnapshotRaw: string | null
): Promise<void> {
  // Mark as running
  await db
    .update(backgroundJobs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(backgroundJobs.id, jobId));

  const input = inputSnapshotRaw ? JSON.parse(inputSnapshotRaw) : {};

  try {
    await dispatch(type, jobId, input);

    // Check if cancelled while running
    const [job] = await db
      .select({ status: backgroundJobs.status })
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, jobId));

    if (job?.status === "cancelled") return; // honour cancel

    await db
      .update(backgroundJobs)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(backgroundJobs.id, jobId));
  } catch (err) {
    const { errorType, errorMessage } = normalizeError(err);
    await db
      .update(backgroundJobs)
      .set({ status: "failed", finishedAt: new Date(), errorType, errorMessage })
      .where(and(
        eq(backgroundJobs.id, jobId),
        inArray(backgroundJobs.status, ["running", "queued"])
      ));
    console.error(`Job ${jobId} (${type}) failed [${errorType}]:`, errorMessage);
  }
}

// ---------------------------------------------------------------------------
// Error normalisation
// ---------------------------------------------------------------------------
const ERROR_TYPE_MAP: Array<[RegExp, string]> = [
  [/401|unauthorized|auth/i,  "authentication_failed"],
  [/429|rate.?limit/i,        "rate_limited"],
  [/timeout|timed out/i,      "timeout"],
  [/content.?filtered|safety/i, "content_rejected"],
  [/unsupported|capability/i, "capability_not_supported"],
  [/invalid.?response/i,      "invalid_response"],
];

function normalizeError(err: unknown): { errorType: string; errorMessage: string } {
  const msg = err instanceof Error ? err.message : String(err);
  for (const [pattern, type] of ERROR_TYPE_MAP) {
    if (pattern.test(msg)) return { errorType: type, errorMessage: msg };
  }
  return { errorType: "unknown", errorMessage: msg };
}
