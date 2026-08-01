import type { MiddlewareHandler } from "hono";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Reject any request that doesn't originate from the local machine.
 * This is a defence-in-depth measure; the server also only binds to 127.0.0.1.
 */
export const securityMiddleware: MiddlewareHandler = async (c, next) => {
  // @hono/node-server exposes the raw socket via env
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } })
    ?.incoming;
  const remoteAddr = incoming?.socket?.remoteAddress ?? "";

  const allowed =
    LOOPBACK.has(remoteAddr) ||
    remoteAddr.startsWith("::ffff:127.") ||
    remoteAddr === "";

  if (!allowed) {
    return c.json({ error: "Forbidden" }, 403);
  }

  await next();
};
