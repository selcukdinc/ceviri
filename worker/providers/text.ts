import { translateTextInstruction } from "../../shared/prompt";
import type { Env } from "../env";
import { ProviderError, type ChunkInput, type TranslationProvider } from "./types";

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

export class GroqProvider implements TranslationProvider {
  id = "groq";
  readsPdf = false;
  constructor(private env: Env) {}
  available() {
    return !!this.env.GROQ_API_KEY;
  }
  async translateChunk(input: ChunkInput): Promise<string> {
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
  async translateChunk(input: ChunkInput): Promise<string> {
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
