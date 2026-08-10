import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { db } from "../db/index.js";
import { authSessions } from "../db/schema.js";

export const SESSION_COOKIE_NAME = "private_plan_image_session";
export const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

const DEFAULT_ADMIN_PASSWORD = "admin123456";
const loginSchema = z.object({ password: z.string().min(1).max(1024) });

function configuredPassword() {
  return process.env["ADMIN_PASSWORD"] || DEFAULT_ADMIN_PASSWORD;
}

function passwordsMatch(password: string, expectedPassword: string) {
  const supplied = Buffer.from(password);
  const expected = Buffer.from(expectedPassword);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "Lax" as const,
    secure: process.env["NODE_ENV"] === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    expires: expiresAt,
  };
}

async function findValidSession(token: string | undefined) {
  if (!token) return null;

  const [session] = await db
    .select()
    .from(authSessions)
    .where(and(eq(authSessions.tokenHash, hashToken(token)), gt(authSessions.expiresAt, new Date())))
    .limit(1);
  return session ?? null;
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const session = await findValidSession(getCookie(c, SESSION_COOKIE_NAME));
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  await next();
};

export const authRouter = new Hono();

authRouter.post("/login", async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !passwordsMatch(parsed.data.password, configuredPassword())) {
    return c.json({ error: "密码不正确" }, 401);
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  const token = randomBytes(32).toString("base64url");

  await db.delete(authSessions).where(lt(authSessions.expiresAt, now));
  await db.insert(authSessions).values({ tokenHash: hashToken(token), expiresAt, createdAt: now });
  setCookie(c, SESSION_COOKIE_NAME, token, cookieOptions(expiresAt));

  return c.json({ expiresAt: expiresAt.toISOString() });
});

authRouter.get("/session", authMiddleware, async (c) => {
  const session = await findValidSession(getCookie(c, SESSION_COOKIE_NAME));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ expiresAt: session.expiresAt.toISOString() });
});

authRouter.post("/logout", authMiddleware, async (c) => {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (token) await db.delete(authSessions).where(eq(authSessions.tokenHash, hashToken(token)));
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
  return c.body(null, 204);
});
