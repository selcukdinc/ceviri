import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from "cloudflare:workers";
import { figureFileName } from "../../shared/prompt";
import type { Figure, PdfAnalysis } from "../../shared/types";
import type { Env } from "../env";
import { assembleBody, wrapDocument, type PageDims } from "../lib/document";
import { ledgerInsert } from "../lib/credits";
import { newId } from "../lib/crypto";
import { loadSettings } from "../lib/settings";
import { renderPdf } from "../lib/pdf";
import { buildProviders, effectiveEnv, GeminiProvider, recordUsage, translateWithFallback } from "../providers";

export interface TranslateParams {
  jobId: string;
}

interface JobRow {
  id: string;
  user_id: string;
  title: string;
  pdf_key: string;
  page_count: number;
  estimate: number;
  unlimited: number;
  target_lang: string;
}

export const CHUNK_PAGES = 6;
export const jobKey = (jobId: string, name: string) => `jobs/${jobId}/${name}`;
export const pageImageName = (page: number) => `page-${String(page).padStart(3, "0")}.jpg`;

const RETRY: WorkflowStepConfig = { retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }, timeout: "10 minutes" };

export class TranslateWorkflow extends WorkflowEntrypoint<Env, TranslateParams> {
  async run(event: WorkflowEvent<TranslateParams>, step: WorkflowStep) {
    const { jobId } = event.payload;
    const db = this.env.DB;

    const job = await step.do("load", async () => {
      const row = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first<JobRow>();
      if (!row) throw new Error("İş bulunamadı");
      return row;
    });

    const log: string[] = [];
    try {
      await this.setStatus(jobId, "scanning", 5, "PDF ön taranıyor");

      // 1) Gemini varsa PDF'i Files API'ye yükle
      const upload = await step.do("upload-pdf", RETRY, async () => {
        if (this.env.MOCK_AI === "1") return null;
        const gemini = new GeminiProvider(await effectiveEnv(this.env, db));
        if (!gemini.available()) return null;
        const obj = await this.env.FILES.get(job.pdf_key);
        if (!obj) throw new Error("Kaynak PDF bulunamadı");
        try {
          const uri = await gemini.uploadPdf(await obj.arrayBuffer(), job.title);
          await recordUsage(db, "gemini", true);
          return { uri, error: null as string | null };
        } catch (e) {
          const message = (e as Error).message ?? String(e);
          await recordUsage(db, "gemini", false, { error: `PDF yükleme: ${message}` });
          console.warn("Gemini yükleme başarısız, metin tabanlı yedeklere geçiliyor", e);
          return { uri: null as string | null, error: message };
        }
      });
      const geminiFileUri = upload && "uri" in upload ? upload.uri : null;
      if (upload && upload.error) log.push(`Gemini PDF yüklemesi başarısız: ${upload.error.slice(0, 300)} → metin tabanlı yedekler kullanıldı`);
      else if (!upload) log.push("Gemini anahtarı yok veya devre dışı → metin tabanlı yedekler kullanıldı");

      // 2) Ön tarama: korunacak görseller
      const scan = await step.do("scan", RETRY, async () => {
        const analysis = await this.analysis(jobId);
        let scanError: string | null = null;
        if (geminiFileUri) {
          try {
            const res = await new GeminiProvider(await effectiveEnv(this.env, db)).scan(geminiFileUri, job.page_count, job.target_lang);
            await recordUsage(db, "gemini", true);
            return { sourceLang: res.sourceLang ?? null, title: res.title ?? null, figures: normalizeFigures(res.figures, job.page_count), scanError: null as string | null };
          } catch (e) {
            scanError = (e as Error).message ?? String(e);
            await recordUsage(db, "gemini", false, { error: `Ön tarama: ${scanError}` });
            console.warn("Gemini ön tarama başarısız, yerel analiz kullanılıyor", e);
          }
        }
        // Yedek: tarayıcı analizinde görsel içeren sayfalar (tam sayfa)
        const figures: Figure[] = analysis.pages
          .filter((p) => p.hasImages)
          .map((p) => {
            const first = p.text.split(/\n/).map((s) => s.trim()).find((s) => s.length > 3) ?? "";
            return { page: p.page, filename: figureFileName(p.page, 1, first.slice(0, 40)), caption: first.slice(0, 120), bbox: null };
          });
        return { sourceLang: null, title: null, figures, scanError };
      });
      if (scan.scanError) log.push(`Gemini ön taraması başarısız: ${scan.scanError.slice(0, 300)} → görseller tarayıcı analizinden (tam sayfa) alındı`);

      await this.env.FILES.put(jobKey(jobId, "figures.json"), JSON.stringify(scan.figures, null, 2), {
        httpMetadata: { contentType: "application/json" },
      });
      await step.do("save-figures", async () => {
        await this.upsertAsset(jobId, "figures", jobKey(jobId, "figures.json"), "figures.json");
        if (scan.sourceLang) await db.prepare("UPDATE jobs SET source_lang = ? WHERE id = ?").bind(scan.sourceLang, jobId).run();
      });

      // 3) Sayfa gruplarını çevir
      const ranges: [number, number][] = [];
      for (let from = 1; from <= job.page_count; from += CHUNK_PAGES)
        ranges.push([from, Math.min(job.page_count, from + CHUNK_PAGES - 1)]);

      const providersUsed = new Set<string>();
      for (let i = 0; i < ranges.length; i++) {
        const [from, to] = ranges[i];
        const pct = 10 + Math.round((70 * i) / ranges.length);
        await this.setStatus(jobId, "translating", pct, `Sayfa ${from}-${to} çevriliyor`);
        const used = await step.do(`translate-${from}-${to}`, RETRY, async () => {
          const analysis = await this.analysis(jobId);
          const settings = await loadSettings(db);
          const providers = buildProviders(await effectiveEnv(this.env, db), settings["providers.order"] ?? "gemini,groq,workersai");
          const res = await translateWithFallback(db, providers, {
            from,
            to,
            targetLang: job.target_lang,
            pages: analysis.pages.filter((p) => p.page >= from && p.page <= to).map((p) => ({ page: p.page, text: p.text })),
            figures: scan.figures,
            geminiFileUri,
          });
          await this.env.FILES.put(jobKey(jobId, `chunks/${String(from).padStart(4, "0")}.html`), res.html);
          return { provider: res.provider, attempts: res.attempts };
        });
        providersUsed.add(used.provider);
        const problems = used.attempts.filter((a) => !a.ok);
        if (problems.length)
          log.push(`Sayfa ${from}-${to}: ${problems.map((a) => `${a.provider} ✗ (${a.error ?? a.skipped})`).join(", ")} → ${used.provider} ✓`);
      }
      await db.prepare("UPDATE jobs SET provider = ?, provider_log = ? WHERE id = ?").bind([...providersUsed].join(", "), JSON.stringify(log.slice(0, 40)), jobId).run();

      // 4) Birleştir
      await this.setStatus(jobId, "assembling", 82, "Belge birleştiriliyor");
      await step.do("assemble", RETRY, async () => {
        const analysis = await this.analysis(jobId);
        const dims = pageDims(analysis);
        const chunks: string[] = [];
        for (const [from] of ranges) {
          const obj = await this.env.FILES.get(jobKey(jobId, `chunks/${String(from).padStart(4, "0")}.html`));
          chunks.push(obj ? await obj.text() : "");
        }
        const available = await this.pageImagesAvailable(jobId);
        const body = assembleBody(chunks, scan.figures, (p) => (available.has(p) ? `assets/${pageImageName(p)}` : null), dims);
        const html = wrapDocument({
          title: scan.title || job.title,
          lang: job.target_lang,
          body,
          sourceName: job.title,
        });
        await this.env.FILES.put(jobKey(jobId, "output.html"), html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
        await this.upsertAsset(jobId, "html", jobKey(jobId, "output.html"), "ceviri.html");
      });

      // 5) PDF (başarısız olursa iş yine tamamlanır; kullanıcı tarayıcıdan yazdırabilir)
      await this.setStatus(jobId, "rendering", 90, "PDF oluşturuluyor");
      const pdfOk = await step.do("render-pdf", { retries: { limit: 2, delay: "30 seconds", backoff: "linear" }, timeout: "5 minutes" }, async () => {
        try {
          await renderPdf(this.env, jobId);
          return true;
        } catch (e) {
          console.warn("PDF oluşturulamadı", e);
          return false;
        }
      });

      // 6) Krediyi kesinleştir
      await step.do("settle", async () => {
        await this.settle(job, "done");
        await db
          .prepare("UPDATE jobs SET status = 'done', progress = 100, stage_note = ?, finished_at = ?, error = NULL WHERE id = ?")
          .bind(pdfOk ? "Tamamlandı" : "Tamamlandı (PDF'i önizlemeden yazdırabilirsiniz)", Date.now(), jobId)
          .run();
      });
    } catch (e) {
      const message = (e as Error)?.message ?? String(e);
      await step.do("fail", async () => {
        await this.settle(job, "failed");
        await db
          .prepare("UPDATE jobs SET status = 'failed', error = ?, stage_note = 'Başarısız, kredi iade edildi', finished_at = ?, provider_log = ? WHERE id = ?")
          .bind(message.slice(0, 1000), Date.now(), JSON.stringify(log.slice(0, 40)), jobId)
          .run();
      });
    }
  }

  /** Rezervi iade eder; başarılıysa gerçek tutarı düşer. Tekrar çalıştırılırsa ikinci kez işlem yapmaz. */
  private async settle(job: JobRow, outcome: "done" | "failed") {
    const db = this.env.DB;
    const already = await db
      .prepare("SELECT 1 FROM credit_ledger WHERE job_id = ? AND type IN ('consume', 'refund') LIMIT 1")
      .bind(job.id)
      .first();
    if (already) return;
    if (job.unlimited) {
      await db.prepare("UPDATE jobs SET charged = 0 WHERE id = ?").bind(job.id).run();
      return;
    }
    const stmts = [ledgerInsert(db, { userId: job.user_id, delta: job.estimate, type: "refund", jobId: job.id, note: outcome === "done" ? "Rezerv çözüldü" : "Başarısız iş iadesi" })];
    if (outcome === "done") {
      stmts.push(ledgerInsert(db, { userId: job.user_id, delta: -job.estimate, type: "consume", jobId: job.id, note: `${job.page_count} sayfa çeviri` }));
      stmts.push(db.prepare("UPDATE jobs SET charged = ? WHERE id = ?").bind(job.estimate, job.id));
    } else {
      stmts.push(db.prepare("UPDATE jobs SET charged = 0 WHERE id = ?").bind(job.id));
    }
    await db.batch(stmts);
  }

  private async setStatus(jobId: string, status: string, progress: number, note: string) {
    await this.env.DB.prepare("UPDATE jobs SET status = ?, progress = ?, stage_note = ? WHERE id = ?")
      .bind(status, progress, note, jobId)
      .run();
  }

  private async analysis(jobId: string): Promise<PdfAnalysis> {
    const obj = await this.env.FILES.get(jobKey(jobId, "analysis.json"));
    if (!obj) throw new Error("Analiz verisi bulunamadı");
    return obj.json<PdfAnalysis>();
  }

  private async pageImagesAvailable(jobId: string): Promise<Set<number>> {
    const { results } = await this.env.DB.prepare("SELECT filename FROM assets WHERE job_id = ? AND kind = 'page'")
      .bind(jobId)
      .all<{ filename: string }>();
    return new Set(results.map((r) => Number(r.filename.match(/(\d+)/)?.[1])));
  }

  private async upsertAsset(jobId: string, kind: string, key: string, filename: string) {
    await this.env.DB.batch([
      this.env.DB.prepare("DELETE FROM assets WHERE job_id = ? AND kind = ?").bind(jobId, kind),
      this.env.DB.prepare("INSERT INTO assets (id, job_id, kind, r2_key, filename, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
        newId(), jobId, kind, key, filename, Date.now(),
      ),
    ]);
  }
}

export function pageDims(a: PdfAnalysis): Map<number, PageDims> {
  const m = new Map<number, PageDims>();
  for (const p of a.pages) if (p.width && p.height) m.set(p.page, { page: p.page, width: p.width, height: p.height });
  return m;
}

export function normalizeFigures(
  raw: { page: number; caption: string; why?: string; slug?: string; bbox?: number[] }[],
  pageCount: number,
): Figure[] {
  const perPage = new Map<number, number>();
  const out: Figure[] = [];
  for (const f of raw) {
    const page = Math.round(Number(f.page));
    if (!Number.isFinite(page) || page < 1 || page > pageCount) continue;
    const idx = (perPage.get(page) ?? 0) + 1;
    perPage.set(page, idx);
    const bbox =
      Array.isArray(f.bbox) && f.bbox.length === 4 && f.bbox.every((n) => Number.isFinite(Number(n)))
        ? (f.bbox.map((n) => Math.max(0, Math.min(1000, Math.round(Number(n))))) as [number, number, number, number])
        : null;
    out.push({
      page,
      filename: figureFileName(page, idx, f.slug || f.caption || ""),
      caption: String(f.caption ?? "").slice(0, 200),
      why: f.why ? String(f.why).slice(0, 200) : undefined,
      bbox: bbox && bbox[2] > bbox[0] && bbox[3] > bbox[1] ? bbox : null,
    });
  }
  return out.slice(0, 300);
}
