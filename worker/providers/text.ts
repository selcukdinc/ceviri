import { translateTextInstruction } from "../../shared/prompt";
import type { Env } from "../env";
import { ProviderError, type ChunkInput, type TestResult, type TranslationProvider } from "./types";

/** Metin tabanlı sağlayıcılar için ortak kullanıcı mesajı. */
export function textChunkMessage(input: ChunkInput): string {
  const parts: string[] = [];
  for (const p of input.pages) {
    const figs = input.figures.filter((f) => f.page === p.page);
    parts.push(
      `### SAYFA ${p.page}\n` +
        (p.text.trim() || "(bu sayfada metin yok)") +
        (figs.length
          ? `\n[Bu sayfadaki görseller için tam olarak şu etiketleri uygun yere koy: ${figs
              .map((f) => `<figure data-fig="${f.filename}"></figure>`)
              .join(" ")}]`
          : ""),
    );
  }
  return (
    `Her "### SAYFA N" bölümü için <section class="page" data-page="N"> aç ve çevirisini içine yaz.\n\n` +
    parts.join("\n\n")
  );
}

/** Metin tabanlı sağlayıcıların istek/dakika token sınırlarına takılmamak için sayfaları küçük gruplara böler. */
export function batchPages(input: ChunkInput, maxChars: number): ChunkInput[] {
  const out: ChunkInput[] = [];
  let cur: ChunkInput["pages"] = [];
  let size = 0;
  const flush = () => {
    if (!cur.length) return;
    out.push({ ...input, from: cur[0].page, to: cur[cur.length - 1].page, pages: cur });
    cur = [];
    size = 0;
  };
  for (const p of input.pages) {
    const text = p.text.length > maxChars ? p.text.slice(0, maxChars) : p.text;
    if (cur.length && size + text.length > maxChars) flush();
    cur.push({ page: p.page, text });
    size += text.length;
  }
  flush();
  return out;
}

export class GroqProvider implements TranslationProvider {
  id = "groq";
  readsPdf = false;
  lastInfo: string | null = null;
  constructor(private env: Env) {}
  available() {
    return !!this.env.GROQ_API_KEY;
  }

  private captureLimits(r: Response) {
    const g = (k: string) => r.headers.get(k);
    const parts = [
      g("x-ratelimit-remaining-requests") && `kalan istek: ${g("x-ratelimit-remaining-requests")}/${g("x-ratelimit-limit-requests")}`,
      g("x-ratelimit-remaining-tokens") && `kalan token: ${g("x-ratelimit-remaining-tokens")}/${g("x-ratelimit-limit-tokens")}`,
    ].filter(Boolean);
    if (parts.length) this.lastInfo = parts.join(" · ");
  }

  async test(): Promise<TestResult> {
    const t0 = Date.now();
    if (!this.env.GROQ_API_KEY) return { ok: false, ms: 0, message: "GROQ_API_KEY tanımlı değil (Worker secret olarak eklenmeli)." };
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.env.GROQ_MODEL || "llama-3.3-70b-versatile", max_tokens: 8, messages: [{ role: "user", content: "Sadece OK yaz." }] }),
      });
      this.captureLimits(r);
      if (!r.ok) return { ok: false, ms: Date.now() - t0, message: `HTTP ${r.status}: ${(await r.text()).slice(0, 400)}` };
      return { ok: true, ms: Date.now() - t0, message: `Çalışıyor (${this.env.GROQ_MODEL || "llama-3.3-70b-versatile"})${this.lastInfo ? ` · ${this.lastInfo}` : ""}` };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, message: String((e as Error).message ?? e) };
    }
  }

  async translateChunk(input: ChunkInput): Promise<string> {
    // Ücretsiz katmanın dakikalık token sınırı küçük: ~5000 karakterlik gruplar
    const parts: string[] = [];
    for (const b of batchPages(input, 5000)) parts.push(await this.translateBatch(b));
    return parts.join("\n");
  }

  private async translateBatch(input: ChunkInput): Promise<string> {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        temperature: 0.2,
        messages: [
          { role: "system", content: translateTextInstruction(input.targetLang) },
          { role: "user", content: textChunkMessage(input) },
        ],
      }),
    });
    this.captureLimits(r);
    if (!r.ok) {
      const body = (await r.text()).slice(0, 300);
      throw new ProviderError(this.id, `HTTP ${r.status} ${body}`, r.status === 429 || r.status >= 500 || r.status === 413);
    }
    const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const out = data.choices?.[0]?.message?.content ?? "";
    if (!out.trim()) throw new ProviderError(this.id, "boş yanıt");
    return out;
  }
}

export class WorkersAiProvider implements TranslationProvider {
  id = "workersai";
  readsPdf = false;
  constructor(private env: Env) {}
  available() {
    return !!this.env.AI;
  }

  async test(): Promise<TestResult> {
    const t0 = Date.now();
    if (!this.env.AI) return { ok: false, ms: 0, message: "AI bağı (binding) tanımlı değil." };
    try {
      await this.env.AI.run(this.env.WORKERS_AI_MODEL as keyof AiModels, { messages: [{ role: "user", content: "Sadece OK yaz." }], max_tokens: 8 } as never);
      return { ok: true, ms: Date.now() - t0, message: `Çalışıyor (${this.env.WORKERS_AI_MODEL}). Günlük ücretsiz limit: 10.000 neuron; kalan değer Cloudflare panelinde (AI → Workers AI) görünür.` };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, message: String((e as Error).message ?? e) };
    }
  }

  async translateChunk(input: ChunkInput): Promise<string> {
    const parts: string[] = [];
    for (const b of batchPages(input, 4000)) parts.push(await this.translateBatch(b));
    return parts.join("\n");
  }

  private async translateBatch(input: ChunkInput): Promise<string> {
    try {
      const res = (await this.env.AI.run(this.env.WORKERS_AI_MODEL as keyof AiModels, {
        messages: [
          { role: "system", content: translateTextInstruction(input.targetLang) },
          { role: "user", content: textChunkMessage(input) },
        ],
        max_tokens: 8192,
      } as never)) as { response?: string };
      const out = res.response ?? "";
      if (!out.trim()) throw new ProviderError(this.id, "boş yanıt");
      return out;
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError(this.id, String((e as Error)?.message ?? e));
    }
  }
}

/** Yerel geliştirme ve testler için: gerçek API çağırmadan HTML üretir. */
export class MockProvider implements TranslationProvider {
  id = "mock";
  readsPdf = false;
  available() {
    return true;
  }
  async test(): Promise<TestResult> {
    return { ok: true, ms: 0, message: "Sahte sağlayıcı (MOCK_AI=1)" };
  }
  async translateChunk(input: ChunkInput): Promise<string> {
    return input.pages
      .map((p) => {
        const figs = input.figures
          .filter((f) => f.page === p.page)
          .map((f) => `<figure data-fig="${f.filename}"></figure>`)
          .join("");
        const lines = p.text.split(/\n+/).filter(Boolean);
        const title = escapeHtml(lines[0] ?? `Sayfa ${p.page}`);
        const body = lines
          .slice(1)
          .map((l) => `<li>[TR] ${escapeHtml(l)}</li>`)
          .join("");
        return `<section class="page" data-page="${p.page}"><h2>${title}</h2><ul>${body}</ul>${figs}</section>`;
      })
      .join("\n");
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}
