import type { MiddlewareHandler } from "hono";
import { db } from "../db/index.js";
import { apiRequestLogs } from "../db/schema.js";
import { randomUUID } from "node:crypto";

/**
 * Hono middleware that records every /api/* request into api_request_logs.
 * Logging failures are swallowed so they never affect the response.
 */
export const requestLoggerMiddleware: MiddlewareHandler = async (c, next) => {
  const startMs = Date.now();
  await next();
  const durationMs = Date.now() - startMs;

  db.insert(apiRequestLogs)
    .values({
      id: randomUUID(),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      statusCode: c.res.status,
      durationMs,
      createdAt: new Date(),
    })
    .catch(() => { /* never let logging break a response */ });
};
