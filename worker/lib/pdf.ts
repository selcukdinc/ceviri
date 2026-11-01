import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "../env";
import { b64url } from "./crypto";

const jobKey = (jobId: string, name: string) => `jobs/${jobId}/${name}`;

/** Belgedeki assets/… görsellerini data URI olarak gömer (tarayıcı oturumu gerekmez). */
export async function inlineAssets(env: Env, jobId: string, html: string): Promise<string> {
  const names = [...new Set([...html.matchAll(/src="assets\/([^"]+)"/g)].map((m) => m[1]))];
  const map = new Map<string, string>();
  for (const name of names) {
    const obj = await env.FILES.get(jobKey(jobId, `pages/${name}`));
    if (!obj) continue;
    const b64 = b64url(await obj.arrayBuffer()).replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    map.set(name, `data:${obj.httpMetadata?.contentType ?? "image/jpeg"};base64,${padded}`);
  }
  return html.replace(/src="assets\/([^"]+)"/g, (m, name: string) => (map.has(name) ? `src="${map.get(name)}"` : m));
}

/** Cloudflare Browser Rendering ile A4 PDF üretir ve R2'ye yazar. */
export async function renderPdf(env: Env, jobId: string): Promise<void> {
  const htmlObj = await env.FILES.get(jobKey(jobId, "output.html"));
  if (!htmlObj) throw new Error("HTML bulunamadı");
  const html = await inlineAssets(env, jobId, await htmlObj.text());

  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 120_000 });
    await page.emulateMediaType("print");
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#888;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: "14mm", bottom: "16mm", left: "14mm", right: "14mm" },
    });
    await env.FILES.put(jobKey(jobId, "output.pdf"), pdf, { httpMetadata: { contentType: "application/pdf" } });
  } finally {
    await browser.close();
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM assets WHERE job_id = ? AND kind = 'pdf'").bind(jobId),
    env.DB.prepare("INSERT INTO assets (id, job_id, kind, r2_key, filename, created_at) VALUES (?, ?, 'pdf', ?, 'ceviri.pdf', ?)").bind(
      crypto.randomUUID(), jobId, jobKey(jobId, "output.pdf"), Date.now(),
    ),
  ]);
}
