import type { MiddlewareHandler } from "hono";
import { db } from "../db/index.js";
import { apiRequestLogs } from "../db/schema.js";
import { randomUUID } from "node:crypto";

const REDACTED = "[redacted]";
const SENSITIVE_FIELD_NAMES = new Set([
  "apikey",
  "authorization",
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "clientsecret",
]);

function isSensitiveFieldName(name: string): boolean {
  return SENSITIVE_FIELD_NAMES.has(name.replace(/[-_]/g, "").toLowerCase());
}

function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      isSensitiveFieldName(key) ? REDACTED : redactJson(nestedValue),
    ])
  );
}

/**
 * Remove secrets and replace base64 data-URI strings with size placeholders
 * before request data reaches the persistent log.
 */
export function sanitizeBody(text: string): string {
  const withoutBinary = text.replace(
    /data:[^;,"'\s]{1,80};base64,[A-Za-z0-9+/=]{200,}/g,
    (m) => `[base64 ~${Math.round(m.length * 0.75 / 1024)}KB]`
  );

  try {
    return JSON.stringify(redactJson(JSON.parse(withoutBinary)));
  } catch {
    return withoutBinary;
  }
}

/** Redact sensitive URL query parameters before logging them. */
export function sanitizeQuery(query: string): string {
  if (!query) return "";

  const params = new URLSearchParams(query);
  for (const key of params.keys()) {
    if (isSensitiveFieldName(key)) params.set(key, REDACTED);
  }
  const sanitized = params.toString();
  return sanitized ? `?${sanitized}` : "";
}

/**
 * Hono middleware that records every /api/* request into api_request_logs.
 * Captures: query string, sanitized request body, and response body for errors.
 * Logging failures are swallowed so they never affect the response.
 */
export const requestLoggerMiddleware: MiddlewareHandler = async (c, next) => {
  const startMs = Date.now();
  const url = new URL(c.req.url);

  // ── Capture request body BEFORE next() consumes the stream ──────────────
  let requestBody: string | null = null;
  const ct = c.req.header("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const raw = await c.req.raw.clone().text();
      requestBody = sanitizeBody(raw);
    } else if (ct.includes("multipart/form-data")) {
      requestBody = "[multipart/form-data upload]";
    }
  } catch { /* ignore read errors */ }

  await next();

  const durationMs = Date.now() - startMs;

  // ── Capture response body for non-2xx (useful for debugging errors) ──────
  let responseBody: string | null = null;
  if (c.res.status >= 400) {
    try {
      const text = await c.res.clone().text();
      responseBody = text.length > 3000 ? text.slice(0, 3000) + "…" : text;
    } catch { /* ignore */ }
  }

  db.insert(apiRequestLogs)
    .values({
      id: randomUUID(),
      method: c.req.method,
      path: url.pathname,
      queryString: sanitizeQuery(url.search) || null,
      requestBody,
      responseBody,
      statusCode: c.res.status,
      durationMs,
      createdAt: new Date(),
    })
    .catch(() => { /* never let logging break a response */ });
};
