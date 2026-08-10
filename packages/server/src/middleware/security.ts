import type { MiddlewareHandler } from "hono";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/** Railway sits behind a proxy, so remote access must be explicitly enabled. */
export function isRemoteAccessEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env["ALLOW_REMOTE"] === "true";
}

/**
 * Reject any request that doesn't originate from the local machine.
 * Local-only remains the safe default. Deployments behind Railway's proxy must
 * opt in with ALLOW_REMOTE=true and are still protected by application auth.
 */
export const securityMiddleware: MiddlewareHandler = async (c, next) => {
  // @hono/node-server exposes the raw socket via env
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } })
    ?.incoming;
  const remoteAddr = incoming?.socket?.remoteAddress ?? "";

  const allowed =
    isRemoteAccessEnabled() ||
    LOOPBACK.has(remoteAddr) ||
    remoteAddr.startsWith("::ffff:127.") ||
    remoteAddr === "";

  if (!allowed) {
    return c.json({ error: "Forbidden" }, 403);
  }

  await next();
};
