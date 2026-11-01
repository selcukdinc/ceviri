import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireRole } from "../lib/auth";
import { ledgerInsert } from "../lib/credits";
import { EDITABLE_SETTINGS, loadSettings } from "../lib/settings";
import { allProviders, effectiveEnv, GeminiProvider, PROVIDER_IDS, recordUsage } from "../providers";
import { GroqProvider } from "../providers/text";
import { toSummary } from "./jobs";

const PROVIDERS = ["gemini", "groq", "workersai"];

export const adminRoutes = new Hono<AppEnv>()
  .use(requireRole("admin"))

  .get("/users", async (c) => {
    const q = `%${(c.req.query("q") ?? "").trim()}%`;
    const { results } = await c.env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.role, u.plan, u.plan_expires_at AS planExpiresAt,
              u.daily_page_cap AS dailyPageCap, u.disabled, u.created_at AS createdAt,
              COALESCE((SELECT SUM(delta) FROM credit_ledger l WHERE l.user_id = u.id), 0) AS balance,
              (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id) AS jobCount,
              (SELECT COALESCE(SUM(page_count), 0) FROM jobs j WHERE j.user_id = u.id AND j.status = 'done') AS pagesDone
         FROM users u
        WHERE u.email LIKE ?1 OR u.name LIKE ?1
        ORDER BY u.created_at DESC LIMIT 200`,
    )
      .bind(q)
      .all();
    return c.json({ users: results });
  })

  /** Elle kredi yükleme (pozitif) veya düşme (negatif). Her hareket not ve admin kimliğiyle kaydedilir. */
  .post("/users/:id/credits", async (c) => {
    const admin = c.get("user")!;
    const { amount, note } = await c.req.json<{ amount: number; note?: string }>();
    const n = Math.trunc(Number(amount));
    if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 1_000_000) return c.json({ error: "Geçersiz miktar." }, 400);
    const target = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(c.req.param("id")).first();
    if (!target) return c.json({ error: "Kullanıcı bulunamadı." }, 404);
    await ledgerInsert(c.env.DB, {
      userId: c.req.param("id"),
      delta: n,
      type: n > 0 ? "grant" : "adjust",
      note: (note ?? "").trim().slice(0, 200) || (n > 0 ? "Admin kredi yüklemesi" : "Admin düzeltmesi"),
      actorId: admin.id,
    }).run();
    return c.json({ ok: true });
  })

  .post("/users/:id/plan", async (c) => {
    const body = await c.req.json<{ plan: "credits" | "unlimited"; expiresAt?: number | null; dailyPageCap?: number | null }>();
    if (!["credits", "unlimited"].includes(body.plan)) return c.json({ error: "Geçersiz plan." }, 400);
    const expires = body.plan === "unlimited" && body.expiresAt ? Number(body.expiresAt) : null;
    const cap = body.dailyPageCap ? Math.max(1, Math.trunc(Number(body.dailyPageCap))) : null;
    const res = await c.env.DB.prepare("UPDATE users SET plan = ?, plan_expires_at = ?, daily_page_cap = ? WHERE id = ?")
      .bind(body.plan, expires, cap, c.req.param("id"))
      .run();
    if (!res.meta.changes) return c.json({ error: "Kullanıcı bulunamadı." }, 404);
    return c.json({ ok: true });
  })

  .post("/users/:id/role", async (c) => {
    const admin = c.get("user")!;
    const { role } = await c.req.json<{ role: "user" | "admin" }>();
    if (!["user", "admin"].includes(role)) return c.json({ error: "Geçersiz rol." }, 400);
    if (c.req.param("id") === admin.id && role !== "admin") return c.json({ error: "Kendi admin yetkinizi kaldıramazsınız." }, 400);
    await c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, c.req.param("id")).run();
    return c.json({ ok: true });
  })

  .post("/users/:id/disable", async (c) => {
    const admin = c.get("user")!;
    const { disabled } = await c.req.json<{ disabled: boolean }>();
    if (c.req.param("id") === admin.id) return c.json({ error: "Kendi hesabınızı devre dışı bırakamazsınız." }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET disabled = ? WHERE id = ?").bind(disabled ? 1 : 0, c.req.param("id")),
      ...(disabled ? [c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(c.req.param("id"))] : []),
    ]);
    return c.json({ ok: true });
  })

  .get("/users/:id/ledger", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT l.id, l.delta, l.type, l.note, l.job_id AS jobId, l.created_at AS createdAt, a.email AS actorEmail, j.title AS jobTitle
         FROM credit_ledger l
         LEFT JOIN users a ON a.id = l.actor_id
         LEFT JOIN jobs j ON j.id = l.job_id
        WHERE l.user_id = ? ORDER BY l.created_at DESC LIMIT 300`,
    )
      .bind(c.req.param("id"))
      .all();
    return c.json({ entries: results });
  })

  .get("/jobs", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT j.*, u.email AS user_email,
         EXISTS(SELECT 1 FROM assets a WHERE a.job_id = j.id AND a.kind = 'html') AS has_html,
         EXISTS(SELECT 1 FROM assets a WHERE a.job_id = j.id AND a.kind = 'pdf') AS has_pdf
         FROM jobs j JOIN users u ON u.id = j.user_id ORDER BY j.created_at DESC LIMIT 100`,
    ).all<Parameters<typeof toSummary>[0] & { user_email: string }>();
    return c.json({ jobs: results.map((r) => ({ ...toSummary(r), userEmail: r.user_email })) });
  })

  .get("/settings", async (c) => {
    const s = await loadSettings(c.env.DB);
    return c.json({
      settings: Object.entries(EDITABLE_SETTINGS).map(([key, meta]) => ({ key, ...meta, value: Number(s[key]) })),
      providerOrder: (s["providers.order"] ?? PROVIDERS.join(",")).split(","),
    });
  })

  .put("/settings", async (c) => {
    const body = await c.req.json<{ values?: Record<string, number>; providerOrder?: string[] }>();
    const stmts: D1PreparedStatement[] = [];
    for (const [key, raw] of Object.entries(body.values ?? {})) {
      const meta = EDITABLE_SETTINGS[key];
      const v = Number(raw);
      if (!meta || !Number.isFinite(v) || v < meta.min || v > meta.max)
        return c.json({ error: `${meta?.label ?? key}: geçersiz değer.` }, 400);
      stmts.push(c.env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(key, String(v)));
    }
    if (body.providerOrder) {
      const order = body.providerOrder.filter((p) => PROVIDERS.includes(p));
      if (!order.length) return c.json({ error: "En az bir sağlayıcı seçilmeli." }, 400);
      stmts.push(c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('providers.order', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(order.join(",")));
    }
    if (stmts.length) await c.env.DB.batch(stmts);
    return c.json({ ok: true });
  })

  /** Sağlayıcı sağlığı: anahtar var mı, son hata, bugünkü kullanım, kota bilgisi. */
  .get("/providers", async (c) => {
    const day = new Date().toISOString().slice(0, 10);
    const [status, usage, settings] = await Promise.all([
      c.env.DB.prepare("SELECT * FROM provider_status").all<{
        provider: string; last_ok_at: number | null; last_error: string | null; last_error_at: number | null;
        quota_info: string | null; quota_info_at: number | null; rate_limited_until: number | null;
      }>(),
      c.env.DB.prepare("SELECT provider, requests, failures, last_error FROM provider_usage WHERE day = ?").bind(day).all<{ provider: string; requests: number; failures: number }>(),
      loadSettings(c.env.DB),
    ]);
    const order = (settings["providers.order"] ?? PROVIDER_IDS.join(",")).split(",");
    const env = await effectiveEnv(c.env, c.env.DB);
    const meta: Record<string, { name: string; secret: string; model: string; keyPresent: boolean; quotaUrl: string; quotaHint: string }> = {
      gemini: {
        name: "Google Gemini", secret: "GEMINI_API_KEY", model: env.GEMINI_MODEL, keyPresent: !!c.env.GEMINI_API_KEY,
        quotaUrl: "https://aistudio.google.com/usage", quotaHint: "Gemini kalan kota bilgisini API üzerinden vermez; kullanım ve limitler AI Studio'da görünür.",
      },
      groq: {
        name: "Groq", secret: "GROQ_API_KEY", model: env.GROQ_MODEL, keyPresent: !!c.env.GROQ_API_KEY,
        quotaUrl: "https://console.groq.com/settings/limits", quotaHint: "Kalan istek/token değeri her çağrıdan sonra buraya yansır.",
      },
      workersai: {
        name: "Workers AI", secret: "(AI bağı)", model: env.WORKERS_AI_MODEL, keyPresent: !!c.env.AI,
        quotaUrl: "https://dash.cloudflare.com/?to=/:account/ai/workers-ai", quotaHint: "Günlük 10.000 ücretsiz neuron; kalan değer Cloudflare panelinde.",
      },
    };
    return c.json({
      mock: c.env.MOCK_AI === "1",
      providers: PROVIDER_IDS.map((id) => {
        const st = status.results.find((r) => r.provider === id);
        const u = usage.results.find((r) => r.provider === id);
        return {
          id, ...meta[id],
          position: order.indexOf(id) + 1 || null,
          todayRequests: u?.requests ?? 0,
          todayFailures: u?.failures ?? 0,
          lastOkAt: st?.last_ok_at ?? null,
          lastError: st?.last_error ?? null,
          lastErrorAt: st?.last_error_at ?? null,
          quotaInfo: st?.quota_info ?? null,
          quotaInfoAt: st?.quota_info_at ?? null,
          rateLimitedUntil: st?.rate_limited_until && st.rate_limited_until > Date.now() ? st.rate_limited_until : null,
        };
      }),
    });
  })

  /** Anahtarın erişebildiği modelleri canlı listeler (Gemini, Groq). */
  .get("/providers/:id/models", async (c) => {
    const id = c.req.param("id");
    try {
      if (id === "gemini") return c.json({ models: await new GeminiProvider(c.env).listModels() });
      if (id === "groq") return c.json({ models: await new GroqProvider(c.env).listModels() });
      return c.json({ models: [] });
    } catch (e) {
      return c.json({ error: `Model listesi alınamadı: ${(e as Error).message}` }, 502);
    }
  })

  .post("/providers/:id/model", async (c) => {
    const id = c.req.param("id");
    const { model } = await c.req.json<{ model: string }>();
    if (!(PROVIDER_IDS as readonly string[]).includes(id)) return c.json({ error: "Bilinmeyen sağlayıcı." }, 404);
    if (!/^[\w./:@-]{1,120}$/.test(model ?? "")) return c.json({ error: "Geçersiz model adı." }, 400);
    await c.env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .bind(`model.${id}`, model)
      .run();
    return c.json({ ok: true });
  })

  /** Küçük bir gerçek istekle sağlayıcıyı sınar; sonucu durum tablosuna da yazar. */
  .post("/providers/:id/test", async (c) => {
    const id = c.req.param("id");
    if (!(PROVIDER_IDS as readonly string[]).includes(id)) return c.json({ error: "Bilinmeyen sağlayıcı." }, 404);
    const provider = allProviders(await effectiveEnv(c.env, c.env.DB))[id];
    const result = await provider.test();
    await recordUsage(c.env.DB, id, result.ok, { error: result.ok ? undefined : `Test: ${result.message}`, info: provider.lastInfo });
    return c.json(result);
  })

  .get("/stats", async (c) => {
    const since = new Date(Date.now() - 13 * 86400_000).toISOString().slice(0, 10);
    const [usage, totals] = await Promise.all([
      c.env.DB.prepare("SELECT day, provider, requests, failures FROM provider_usage WHERE day >= ? ORDER BY day").bind(since).all(),
      c.env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM users) AS users,
                (SELECT COUNT(*) FROM jobs) AS jobs,
                (SELECT COUNT(*) FROM jobs WHERE status NOT IN ('done','failed')) AS running,
                (SELECT COALESCE(SUM(page_count),0) FROM jobs WHERE status = 'done') AS pages,
                (SELECT COALESCE(-SUM(delta),0) FROM credit_ledger WHERE type = 'consume') AS creditsSpent,
                (SELECT COALESCE(SUM(delta),0) FROM credit_ledger WHERE type = 'grant') AS creditsGranted`,
      ).first(),
    ]);
    return c.json({
      usage: usage.results,
      totals,
      configured: {
        gemini: !!c.env.GEMINI_API_KEY,
        groq: !!c.env.GROQ_API_KEY,
        workersai: !!c.env.AI,
        mock: c.env.MOCK_AI === "1",
        turnstile: !!c.env.TURNSTILE_SECRET,
      },
    });
  });
