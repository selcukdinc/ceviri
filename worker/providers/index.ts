import type { Env } from "../env";
import { GeminiProvider } from "./gemini";
import { GroqProvider, MockProvider, WorkersAiProvider } from "./text";
import { type ChunkInput, type TranslationProvider } from "./types";

export function buildProviders(env: Env, order: string): TranslationProvider[] {
  if (env.MOCK_AI === "1") return [new MockProvider()];
  const all: Record<string, TranslationProvider> = {
    gemini: new GeminiProvider(env),
    groq: new GroqProvider(env),
    workersai: new WorkersAiProvider(env),
  };
  return order
    .split(",")
    .map((s) => all[s.trim()])
    .filter((p): p is TranslationProvider => !!p && p.available());
}

export async function recordUsage(db: D1Database, provider: string, ok: boolean) {
  const day = new Date().toISOString().slice(0, 10);
  await db
    .prepare(
      `INSERT INTO provider_usage (day, provider, requests, failures) VALUES (?, ?, 1, ?)
       ON CONFLICT (day, provider) DO UPDATE SET requests = requests + 1, failures = failures + excluded.failures`,
    )
    .bind(day, provider, ok ? 0 : 1)
    .run();
}

/** Sağlayıcıları sırayla dener; kota/geçici hatada bir sonrakine geçer. */
export async function translateWithFallback(
  db: D1Database,
  providers: TranslationProvider[],
  input: ChunkInput,
): Promise<{ html: string; provider: string }> {
  const errors: string[] = [];
  for (const p of providers) {
    if (p.readsPdf && !input.geminiFileUri) continue;
    try {
      const html = await p.translateChunk(input);
      await recordUsage(db, p.id, true);
      return { html, provider: p.id };
    } catch (e) {
      await recordUsage(db, p.id, false);
      errors.push((e as Error).message);
      // Kalıcı hata da olsa sıradaki sağlayıcı denenir; hata mesajı biriktirilir.
    }
  }
  throw new Error(`Hiçbir çeviri sağlayıcısı yanıt vermedi: ${errors.join(" | ") || "yapılandırılmış sağlayıcı yok"}`);
}

export { GeminiProvider };
