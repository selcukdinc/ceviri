import { Hono } from "hono";
import type { AppEnv, SessionUser } from "../env";
import { createSession, destroySession, isAdminEmail, verifyTurnstile } from "../lib/auth";
import { hashPassword, newId, verifyPassword } from "../lib/crypto";
import { toPublicUser } from "../lib/user";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const authRoutes = new Hono<AppEnv>()
  .post("/register", async (c) => {
    const body = await c.req.json<{ email?: string; name?: string; password?: string; turnstile?: string }>();
    const email = (body.email ?? "").trim().toLowerCase();
    const name = (body.name ?? "").trim();
    const password = body.password ?? "";
    if (!EMAIL_RE.test(email)) return c.json({ error: "Geçerli bir e-posta girin." }, 400);
    if (name.length < 2 || name.length > 80) return c.json({ error: "Adınız 2-80 karakter olmalı." }, 400);
    if (password.length < 8 || password.length > 200) return c.json({ error: "Şifre en az 8 karakter olmalı." }, 400);
    if (!(await verifyTurnstile(c.env.TURNSTILE_SECRET, body.turnstile, c.req.header("cf-connecting-ip"))))
      return c.json({ error: "Robot doğrulaması başarısız." }, 400);

    const exists = await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
    if (exists) return c.json({ error: "Bu e-posta ile zaten bir hesap var." }, 409);

    const id = newId();
    const role = isAdminEmail(c.env, email) ? "admin" : "user";
    // Yeni hesaplar 0 kredi ile açılır: ledger'a hiçbir kayıt eklenmez.
    await c.env.DB.prepare(
      "INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(id, email, name, await hashPassword(password), role, Date.now())
      .run();
    await createSession(c, id);
    const user: SessionUser = {
      id, email, name, role, plan: "credits", plan_expires_at: null, daily_page_cap: null, disabled: 0,
    };
    return c.json({ user: await toPublicUser(c.env.DB, user) }, 201);
  })
  .post("/login", async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>();
    const email = (body.email ?? "").trim().toLowerCase();
    const row = await c.env.DB.prepare(
      "SELECT id, email, name, role, plan, plan_expires_at, daily_page_cap, disabled, password_hash FROM users WHERE email = ?",
    )
      .bind(email)
      .first<SessionUser & { password_hash: string }>();
    if (!row || !(await verifyPassword(body.password ?? "", row.password_hash)))
      return c.json({ error: "E-posta veya şifre hatalı." }, 401);
    if (row.disabled) return c.json({ error: "Hesabınız devre dışı bırakılmış." }, 403);
    await createSession(c, row.id);
    const { password_hash: _, ...user } = row;
    return c.json({ user: await toPublicUser(c.env.DB, user) });
  })
  .post("/logout", async (c) => {
    await destroySession(c);
    return c.json({ ok: true });
  })
  .get("/me", async (c) => {
    const u = c.get("user");
    return c.json({ user: u ? await toPublicUser(c.env.DB, u) : null });
  })
  .post("/password", async (c) => {
    const u = c.get("user");
    if (!u) return c.json({ error: "Giriş yapmalısınız." }, 401);
    const { current, next } = await c.req.json<{ current?: string; next?: string }>();
    const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(u.id).first<{ password_hash: string }>();
    if (!row || !(await verifyPassword(current ?? "", row.password_hash)))
      return c.json({ error: "Mevcut şifre hatalı." }, 400);
    if (!next || next.length < 8) return c.json({ error: "Yeni şifre en az 8 karakter olmalı." }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(next), u.id),
      c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id),
    ]);
    await createSession(c, u.id);
    return c.json({ ok: true });
  });
