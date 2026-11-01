import { scanInstruction, translateInstruction } from "../../shared/prompt";
import type { Env } from "../env";
import { ProviderError, type ChunkInput, type TestResult, type TranslationProvider } from "./types";

const API = "https://generativelanguage.googleapis.com";

export interface ScanResult {
  sourceLang?: string;
  title?: string;
  pageCount?: number;
  figures: { page: number; caption: string; why?: string; slug?: string; bbox?: number[] }[];
}

export class GeminiProvider implements TranslationProvider {
  id = "gemini";
  readsPdf = true;
  constructor(private env: Env) {}

  available() {
    return !!this.env.GEMINI_API_KEY;
  }

  async test(): Promise<TestResult> {
    const t0 = Date.now();
    if (!this.env.GEMINI_API_KEY) return { ok: false, ms: 0, message: "GEMINI_API_KEY tanımlı değil (Worker secret olarak eklenmeli)." };
    try {
      const r = await fetch(`${API}/v1beta/models/${this.model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": this.env.GEMINI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Sadece OK yaz." }] }], generationConfig: { maxOutputTokens: 16 } }),
      });
      if (!r.ok) return { ok: false, ms: Date.now() - t0, message: `HTTP ${r.status}: ${(await r.text()).slice(0, 400)}` };
      return { ok: true, ms: Date.now() - t0, message: `Çalışıyor (${this.model})` };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, message: String((e as Error).message ?? e) };
    }
  }

  private get model() {
    return this.env.GEMINI_MODEL || "gemini-2.5-flash";
  }

  /** PDF'i Files API'ye yükler (48 saat saklanır) ve URI döndürür. */
  async uploadPdf(bytes: ArrayBuffer, displayName: string): Promise<string> {
    const start = await fetch(`${API}/upload/v1beta/files`, {
      method: "POST",
      headers: {
        "x-goog-api-key": this.env.GEMINI_API_KEY!,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
        "X-Goog-Upload-Header-Content-Type": "application/pdf",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName.slice(0, 100) } }),
    });
    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!start.ok || !uploadUrl) throw await this.error(start, "yükleme başlatılamadı");

    const up = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length": String(bytes.byteLength),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: bytes,
    });
    if (!up.ok) throw await this.error(up, "PDF yüklenemedi");
    const data = (await up.json()) as { file: { name: string; uri: string; state?: string } };

    // Dosya işlenene kadar bekle (genelde birkaç saniye)
    let state = data.file.state;
    for (let i = 0; i < 30 && state === "PROCESSING"; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const r = await fetch(`${API}/v1beta/${data.file.name}`, { headers: { "x-goog-api-key": this.env.GEMINI_API_KEY! } });
      state = ((await r.json()) as { state?: string }).state;
    }
    if (state === "FAILED") throw new ProviderError(this.id, "Gemini PDF'i işleyemedi", false);
    return data.file.uri;
  }

  async scan(fileUri: string, pageCount: number, targetLang: string): Promise<ScanResult> {
    const text = await this.generate(fileUri, scanInstruction(pageCount, targetLang), true);
    try {
      const parsed = JSON.parse(text) as ScanResult;
      return { ...parsed, figures: Array.isArray(parsed.figures) ? parsed.figures : [] };
    } catch {
      throw new ProviderError(this.id, "ön tarama yanıtı JSON değil");
    }
  }

  async translateChunk(input: ChunkInput): Promise<string> {
    if (!input.geminiFileUri) throw new ProviderError(this.id, "PDF yüklenmemiş", true);
    return this.generate(input.geminiFileUri, translateInstruction(input));
  }

  private async generate(fileUri: string, prompt: string, json = false): Promise<string> {
    const r = await fetch(`${API}/v1beta/models/${this.model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": this.env.GEMINI_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ file_data: { mime_type: "application/pdf", file_uri: fileUri } }, { text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 32768,
          ...(json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });
    if (!r.ok) throw await this.error(r, "üretim hatası");
    const data = (await r.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    };
    const out = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!out.trim()) throw new ProviderError(this.id, `boş yanıt (${data.candidates?.[0]?.finishReason ?? "?"})`);
    return out;
  }

  private async error(r: Response, what: string) {
    const body = (await r.text()).slice(0, 300);
    // 429 = kota; 5xx = geçici. 400/403 = yapılandırma hatası, ama yine de yedeğe geçmek güvenli.
    return new ProviderError(this.id, `${what} (HTTP ${r.status}) ${body}`, r.status === 429 || r.status >= 500 || r.status === 403);
  }
}
