import { Hono } from "hono";
import { estimateCredits, pageWeight } from "../../shared/credits";
import type { Figure, JobSummary, PdfAnalysis } from "../../shared/types";
import { LANGUAGES } from "../../shared/types";
import type { AppEnv, Env, SessionUser } from "../env";
import { requireRole } from "../lib/auth";
import { balanceOf, ledgerInsert, tryReserve, unlimitedActive, unlimitedPagesToday } from "../lib/credits";
import { newId } from "../lib/crypto";
import { inlineAssets, renderPdf } from "../lib/pdf";
import { loadSettings, num, weightsFrom } from "../lib/settings";
import { jobKey, pageImageName } from "../workflow/translate";

const DOC_CSP =
  "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'self'";

interface JobRow {
  id: string;
  user_id: string;
  title: string;
  pdf_key: string;
  page_count: number;
  estimate: number;
  charged: number | null;
  unlimited: number;
  status: JobSummary["status"];
  progress: number;
  stage_note: string | null;
  provider: string | null;
  provider_log: string | null;
  error: string | null;
  created_at: number;
  finished_at: number | null;
  has_html?: number;
  has_pdf?: number;
}

function parseLog(raw: string | null): string[] {
  try {
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function toSummary(r: JobRow): JobSummary {
  return {
    id: r.id,
    title: r.title,
    pageCount: r.page_count,
    estimate: r.estimate,
    charged: r.charged,
    unlimited: !!r.unlimited,
    status: r.status,
    progress: r.progress,
    stageNote: r.stage_note,
    provider: r.provider,
    providerLog: parseLog(r.provider_log),
    error: r.error,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    hasHtml: !!r.has_html,
    hasPdf: !!r.has_pdf,
  };
}

const JOB_SELECT = `SELECT j.*,
  EXISTS(SELECT 1 FROM assets a WHERE a.job_id = j.id AND a.kind = 'html') AS has_html,
  EXISTS(SELECT 1 FROM assets a WHERE a.job_id = j.id AND a.kind = 'pdf') AS has_pdf
  FROM jobs j`;

async function findOwnedJob(env: Env, user: SessionUser, id: string): Promise<JobRow | null> {
  const row = await env.DB.prepare(`${JOB_SELECT} WHERE j.id = ?`).bind(id).first<JobRow>();
  if (!row) return null;
  if (row.user_id !== user.id && user.role !== "admin") return null;
  return row;
}

/** İstemciden gelen analizi doğrular ve yalnızca gereken alanları tutar. */
function cleanAnalysis(raw: unknown, fileName: string, maxPages: number): PdfAnalysis | string {
  const a = raw as PdfAnalysis;
  if (!a || !Array.isArray(a.pages) || typeof a.pageCount !== "number") return "Analiz verisi geçersiz.";
  if (a.pageCount < 1 || a.pageCount > maxPages) return `PDF en fazla ${maxPages} sayfa olabilir.`;
  if (a.pages.length !== a.pageCount) return "Analiz sayfa sayısı tutarsız.";
  const pages = a.pages.map((p, i) => ({
    page: i + 1,
    chars: Math.max(0, Math.min(200_000, Math.round(Number(p.chars) || 0))),
    hasImages: !!p.hasImages,
    text: String(p.text ?? "").slice(0, 60_000),
    figureRefs: Array.isArray(p.figureRefs) ? p.figureRefs.slice(0, 20).map(String) : [],
    width: Number(p.width) || undefined,
    height: Number(p.height) || undefined,
  }));
  // Metin uzunluğu, bildirilen karakterden büyükse ona göre say (düşük bildirime karşı)
  for (const p of pages) p.chars = Math.max(p.chars, p.text.replace(/\s+/g, "").length);
  return { fileName, pageCount: a.pageCount, pages };
}

export const jobRoutes = new Hono<AppEnv>()
  .use(requireRole("user"))

  /** Yükleme öncesi tahmin: bakiye ve plan bilgisiyle birlikte. */
  .post("/estimate", async (c) => {
    const user = c.get("user")!;
    const { pages } = await c.req.json<{ pages: { chars: number; hasImages: boolean }[] }>();
    const settings = await loadSettings(c.env.DB);
    const est = estimateCredits(pages ?? [], weightsFrom(settings));
    const unlimited = unlimitedActive(user);
    const cap = user.daily_page_cap ?? num(settings, "limits.unlimited_daily_pages", 300);
    return c.json({
      estimate: est,
      balance: await balanceOf(c.env.DB, user.id),
      unlimited,
      dailyPagesUsed: unlimited ? await unlimitedPagesToday(c.env.DB, user.id) : 0,
      dailyPageCap: unlimited ? cap : null,
      maxPages: num(settings, "limits.max_pages", 400),
      maxMb: num(settings, "limits.max_mb", 50),
    });
  })

  .get("/", async (c) => {
    const user = c.get("user")!;
    const { results } = await c.env.DB.prepare(`${JOB_SELECT} WHERE j.user_id = ? ORDER BY j.created_at DESC LIMIT 100`)
      .bind(user.id)
      .all<JobRow>();
    return c.json({ jobs: results.map(toSummary) });
  })

  .post("/", async (c) => {
    const user = c.get("user")!;
    const env = c.env;
    const settings = await loadSettings(env.DB);
    const maxPages = num(settings, "limits.max_pages", 400);
    const maxBytes = num(settings, "limits.max_mb", 50) * 1024 * 1024;

    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "PDF dosyası eksik." }, 400);
    if (file.size > maxBytes) return c.json({ error: `PDF en fazla ${maxBytes / 1024 / 1024} MB olabilir.` }, 400);
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...head) !== "%PDF-") return c.json({ error: "Dosya geçerli bir PDF değil." }, 400);

    const targetLang = String(form.get("targetLang") ?? "tr");
    if (!LANGUAGES[targetLang]) return c.json({ error: "Desteklenmeyen hedef dil." }, 400);
    const title = (String(form.get("title") ?? "") || file.name).replace(/\.pdf$/i, "").slice(0, 120);

    let rawAnalysis: unknown;
    try {
      rawAnalysis = JSON.parse(String(form.get("analysis") ?? ""));
    } catch {
      return c.json({ error: "Analiz verisi okunamadı." }, 400);
    }
    const analysis = cleanAnalysis(rawAnalysis, file.name, maxPages);
    if (typeof analysis === "string") return c.json({ error: analysis }, 400);

    const weights = weightsFrom(settings);
    const est = estimateCredits(analysis.pages, weights);
    const unlimited = unlimitedActive(user);
    const jobId = newId();

    if (unlimited) {
      const cap = user.daily_page_cap ?? num(settings, "limits.unlimited_daily_pages", 300);
      const used = await unlimitedPagesToday(env.DB, user.id);
      if (used + analysis.pageCount > cap)
        return c.json({ error: `Günlük sayfa tavanınız ${cap}. Bugün ${used} sayfa kullandınız.` }, 429);
    }

    // Önce iş kaydı (rezervin job_id'si buna bağlı), sonra kredi rezervi
    const now = Date.now();
    const pdfKey = jobKey(jobId, "source.pdf");
    await env.DB.prepare(
      `INSERT INTO jobs (id, user_id, title, pdf_key, page_count, estimate, unlimited, target_lang, status, progress, stage_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, 'Sırada', ?)`,
    )
      .bind(jobId, user.id, title, pdfKey, analysis.pageCount, unlimited ? 0 : est.total, unlimited ? 1 : 0, targetLang, now)
      .run();

    if (!unlimited && !(await tryReserve(env.DB, user.id, est.total, jobId))) {
      await env.DB.prepare("DELETE FROM jobs WHERE id = ?").bind(jobId).run();
      const balance = await balanceOf(env.DB, user.id);
      return c.json({ error: `Yetersiz kredi: bu PDF ${est.total} kredi, bakiyeniz ${balance}.` }, 402);
    }

    try {
      await env.FILES.put(pdfKey, file, { httpMetadata: { contentType: "application/pdf" } });
      await env.FILES.put(jobKey(jobId, "analysis.json"), JSON.stringify(analysis), {
        httpMetadata: { contentType: "application/json" },
      });

      const stmts: D1PreparedStatement[] = analysis.pages.map((p) =>
        env.DB.prepare("INSERT INTO job_pages (job_id, page_no, weight, has_images, chars) VALUES (?, ?, ?, ?, ?)").bind(
          jobId, p.page, pageWeight(p, weights), p.hasImages ? 1 : 0, p.chars,
        ),
      );
      // Tarayıcıda oluşturulan sayfa görüntüleri (yalnızca görsel içeren sayfalar)
      for (const [name, value] of form.entries()) {
        if (!name.startsWith("page-") || !(value instanceof File)) continue;
        const pageNo = Number(name.slice(5));
        if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > analysis.pageCount) continue;
        if (value.size > 4 * 1024 * 1024) continue;
        const fname = pageImageName(pageNo);
        await env.FILES.put(jobKey(jobId, `pages/${fname}`), value, { httpMetadata: { contentType: "image/jpeg" } });
        stmts.push(
          env.DB.prepare("INSERT INTO assets (id, job_id, kind, r2_key, filename, created_at) VALUES (?, ?, 'page', ?, ?, ?)").bind(
            newId(), jobId, jobKey(jobId, `pages/${fname}`), fname, now,
          ),
        );
      }
      for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));

      const instance = await env.TRANSLATE.create({ id: jobId, params: { jobId } });
      await env.DB.prepare("UPDATE jobs SET workflow_id = ? WHERE id = ?").bind(instance.id, jobId).run();
    } catch (e) {
      // Başlatılamadıysa rezervi iade et
      await env.DB.batch([
        ...(unlimited ? [] : [ledgerInsert(env.DB, { userId: user.id, delta: est.total, type: "refund", jobId, note: "Başlatılamayan iş iadesi" })]),
        env.DB.prepare("UPDATE jobs SET status = 'failed', error = ?, charged = 0, finished_at = ? WHERE id = ?").bind(
          String((e as Error).message ?? e).slice(0, 500), Date.now(), jobId,
        ),
      ]);
      return c.json({ error: "İş başlatılamadı, kredi iade edildi." }, 500);
    }

    return c.json({ id: jobId, estimate: est }, 201);
  })

  .get("/:id", async (c) => {
    const job = await findOwnedJob(c.env, c.get("user")!, c.req.param("id"));
    if (!job) return c.json({ error: "İş bulunamadı." }, 404);
    const figObj = await c.env.FILES.get(jobKey(job.id, "figures.json"));
    const figures = figObj ? await figObj.json<Figure[]>() : [];
    return c.json({ job: toSummary(job), figures });
  })

  /** Çevrilmiş HTML (önizleme). Görseller göreli assets/… yolundan gelir. */
  .get("/:id/html", async (c) => {
    const job = await findOwnedJob(c.env, c.get("user")!, c.req.param("id"));
    if (!job) return c.json({ error: "İş bulunamadı." }, 404);
    const obj = await c.env.FILES.get(jobKey(job.id, "output.html"));
    if (!obj) return c.json({ error: "HTML henüz hazır değil." }, 404);
    const download = c.req.query("download") === "1";
    if (download) {
      // İndirilen dosya bağımsız olsun: görseller gömülü
      const html = await inlineAssets(c.env, job.id, await obj.text());
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(job.title)}-tr.html`,
        },
      });
    }
    return new Response(obj.body, {
      headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": DOC_CSP, "x-content-type-options": "nosniff" },
    });
  })

  .get("/:id/assets/:name", async (c) => {
    const job = await findOwnedJob(c.env, c.get("user")!, c.req.param("id"));
    const name = c.req.param("name");
    if (!job || !/^page-\d{3}\.jpg$/.test(name)) return c.json({ error: "Bulunamadı." }, 404);
    const obj = await c.env.FILES.get(jobKey(job.id, `pages/${name}`));
    if (!obj) return c.json({ error: "Bulunamadı." }, 404);
    return new Response(obj.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
  })

  .get("/:id/pdf", async (c) => {
    const job = await findOwnedJob(c.env, c.get("user")!, c.req.param("id"));
    if (!job) return c.json({ error: "İş bulunamadı." }, 404);
    const obj = await c.env.FILES.get(jobKey(job.id, "output.pdf"));
    if (!obj) return c.json({ error: "PDF henüz hazır değil." }, 404);
    return new Response(obj.body, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(job.title)}-tr.pdf`,
      },
    });
  })

  /** PDF'i yeniden üretmeyi dener (ücretsiz). */
  .post("/:id/render-pdf", async (c) => {
    const job = await findOwnedJob(c.env, c.get("user")!, c.req.param("id"));
    if (!job || job.status !== "done") return c.json({ error: "Yalnızca tamamlanmış işler için." }, 400);
    try {
      await renderPdf(c.env, job.id);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: `PDF oluşturulamadı: ${(e as Error).message}` }, 502);
    }
  })

  .delete("/:id", async (c) => {
    const job = await findOwnedJob(c.env, c.get("user")!, c.req.param("id"));
    if (!job) return c.json({ error: "İş bulunamadı." }, 404);
    if (job.status !== "done" && job.status !== "failed") return c.json({ error: "Devam eden iş silinemez." }, 409);
    let cursor: string | undefined;
    do {
      const list = await c.env.FILES.list({ prefix: `jobs/${job.id}/`, cursor });
      if (list.objects.length) await c.env.FILES.delete(list.objects.map((o) => o.key));
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
    // Kredi geçmişi korunur (job_id kalır), iş ve dosyaları silinir
    await c.env.DB.prepare("DELETE FROM jobs WHERE id = ?").bind(job.id).run();
    return c.json({ ok: true });
  });
