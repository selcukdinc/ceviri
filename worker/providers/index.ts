import type { Env } from "../env";
import { GeminiProvider } from "./gemini";
import { GroqProvider, MockProvider, WorkersAiProvider } from "./text";
import { type ChunkInput, type TranslationProvider } from "./types";

export function buildProviders(env: Env, order: string): TranslationProvider[] {
  if (env.MOCK_AI === "1") return [new MockProvider()];
  const all = allProviders(env);
  return order
    .split(",")
    .map((s) => all[s.trim()])
    .filter((p): p is TranslationProvider => !!p && p.available());
}

/** Admin panelinden seçilen model adlarını (settings: model.<sağlayıcı>) ortam değişkenlerinin üzerine uygular. */
export async function effectiveEnv(env: Env, db: D1Database): Promise<Env> {
  const { results } = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'model.%'").all<{ key: string; value: string }>();
  const m = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    ...env,
    GEMINI_MODEL: m["model.gemini"] || env.GEMINI_MODEL,
    GROQ_MODEL: m["model.groq"] || env.GROQ_MODEL,
    WORKERS_AI_MODEL: m["model.workersai"] || env.WORKERS_AI_MODEL,
  };
}

export const PROVIDER_IDS = ["gemini", "groq", "workersai"] as const;

export function allProviders(env: Env): Record<string, TranslationProvider> {
  return { gemini: new GeminiProvider(env), groq: new GroqProvider(env), workersai: new WorkersAiProvider(env) };
}

/** Sağlayıcı çağrısının sonucunu günlük sayaçlara ve son-durum tablosuna yazar. */
export async function recordUsage(db: D1Database, provider: string, ok: boolean, opts: { error?: string; info?: string | null } = {}) {
  const day = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const error = opts.error?.slice(0, 600) ?? null;
  // 429 sonrası kısa süre (günlük kotaysa gün sonuna kadar) bu sağlayıcıyı atla
  let until: number | null = null;
  if (!ok && error && /\b429\b|RESOURCE_EXHAUSTED|rate.?limit/i.test(error)) {
    const daily = /per.?day|daily|PerDay/i.test(error);
    const midnight = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    until = daily ? midnight.getTime() : now + 60_000;
  }
  await db.batch([
    db
      .prepare(
        `INSERT INTO provider_usage (day, provider, requests, failures, last_error, last_error_at) VALUES (?1, ?2, 1, ?3, ?4, ?5)
         ON CONFLICT (day, provider) DO UPDATE SET requests = requests + 1, failures = failures + excluded.failures,
           last_error = COALESCE(excluded.last_error, last_error), last_error_at = COALESCE(excluded.last_error_at, last_error_at)`,
      )
      .bind(day, provider, ok ? 0 : 1, error, error ? now : null),
    db
      .prepare(
        `INSERT INTO provider_status (provider, last_ok_at, last_error, last_error_at, quota_info, quota_info_at, rate_limited_until)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (provider) DO UPDATE SET
           last_ok_at = COALESCE(excluded.last_ok_at, last_ok_at),
           last_error = COALESCE(excluded.last_error, last_error),
           last_error_at = COALESCE(excluded.last_error_at, last_error_at),
           quota_info = COALESCE(excluded.quota_info, quota_info),
           quota_info_at = COALESCE(excluded.quota_info_at, quota_info_at),
           rate_limited_until = CASE WHEN ?8 = 1 THEN excluded.rate_limited_until ELSE rate_limited_until END`,
      )
      .bind(provider, ok ? now : null, error, error ? now : null, opts.info ?? null, opts.info ? now : null, until, ok || until ? 1 : 0),
  ]);
}

export interface Attempt {
  provider: string;
  ok: boolean;
  error?: string;
  skipped?: string;
}

/** Sağlayıcıları sırayla dener; kota/geçici hatada bir sonrakine geçer. Tüm denemeleri döndürür. */
export async function translateWithFallback(
  db: D1Database,
  providers: TranslationProvider[],
  input: ChunkInput,
): Promise<{ html: string; provider: string; attempts: Attempt[] }> {
  const attempts: Attempt[] = [];
  const { results: status } = await db
    .prepare("SELECT provider, rate_limited_until FROM provider_status WHERE rate_limited_until > ?")
    .bind(Date.now())
    .all<{ provider: string; rate_limited_until: number }>();
  const limited = new Set(status.map((s) => s.provider));

  // Hepsi kota beklemesindeyse yine de hepsini dene
  const candidates = providers.filter((p) => !(p.readsPdf && !input.geminiFileUri));
  const runnable = candidates.filter((p) => !limited.has(p.id));
  const order = runnable.length ? runnable : candidates;

  for (const p of providers) {
    if (p.readsPdf && !input.geminiFileUri) attempts.push({ provider: p.id, ok: false, skipped: "PDF Gemini'ye yüklenemedi" });
    else if (!order.includes(p)) attempts.push({ provider: p.id, ok: false, skipped: "kota beklemesinde" });
  }

  for (const p of order) {
    try {
      const html = await p.translateChunk(input);
      await recordUsage(db, p.id, true, { info: p.lastInfo });
      attempts.push({ provider: p.id, ok: true });
      return { html, provider: p.id, attempts };
    } catch (e) {
      const message = (e as Error).message;
      await recordUsage(db, p.id, false, { error: message, info: p.lastInfo });
      attempts.push({ provider: p.id, ok: false, error: message.slice(0, 300) });
    }
  }
  const detail = attempts.map((a) => `${a.provider}: ${a.error ?? a.skipped}`).join(" | ");
  throw new Error(`Hiçbir çeviri sağlayıcısı yanıt vermedi: ${detail || "yapılandırılmış sağlayıcı yok"}`);
}

export { GeminiProvider };
