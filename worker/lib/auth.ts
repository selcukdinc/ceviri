import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, SessionUser } from "../env";
import { randomToken, sha256, newId } from "./crypto";

export const SESSION_COOKIE = "ceviri_sid";
const SESSION_DAYS = 30;

export async function createSession(c: Context<AppEnv>, userId: string) {
  const token = randomToken();
  const now = Date.now();
  const expires = now + SESSION_DAYS * 86400_000;
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), userId, expires, now)
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function destroySession(c: Context<AppEnv>) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Her istekte oturumu çözer; misafir için user = null. */
export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", null);
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const row = await c.env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.role, u.plan, u.plan_expires_at, u.daily_page_cap, u.disabled
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.expires_at > ?`,
    )
      .bind(await sha256(token), Date.now())
      .first<SessionUser>();
    if (row && !row.disabled) c.set("user", row);
  }
  await next();
};

/** Değiştiren isteklerde başka origin'den gelen çağrıları reddeder (CSRF koruması). */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "Geçersiz kaynak." }, 403);
  }
  await next();
};

const RANK = { guest: 0, user: 1, admin: 2 } as const;

/** RBAC: rotaya erişim için gereken en düşük rol. */
export function requireRole(min: "user" | "admin"): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const u = c.get("user");
    if (!u) return c.json({ error: "Bu işlem için giriş yapmalısınız." }, 401);
    if (RANK[u.role] < RANK[min]) return c.json({ error: "Bu işlem için yetkiniz yok." }, 403);
    await next();
  };
}

export function isAdminEmail(env: { ADMIN_EMAILS: string }, email: string) {
  return env.ADMIN_EMAILS.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export async function verifyTurnstile(secret: string | undefined, token: string | undefined, ip?: string) {
  if (!secret) return true; // Turnstile yapılandırılmadıysa atla
  if (!token) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const data = (await r.json()) as { success: boolean };
  return data.success;
}

export { newId };
