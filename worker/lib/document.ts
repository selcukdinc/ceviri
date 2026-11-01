import type { Figure } from "../../shared/types";

/** Model çıktısındaki Markdown kod bloklarını ve tehlikeli içeriği temizler. */
export function sanitizeFragment(html: string): string {
  let s = html.trim();
  s = s.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "");
  s = s.replace(/<(script|style|iframe|object|embed|noscript|template)[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<(script|style|iframe|object|embed|link|meta|base|form|input|button)\b[^>]*\/?>/gi, "");
  s = s.replace(/<\/?(html|head|body)\b[^>]*>/gi, "");
  s = s.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/\s+style\s*=\s*("[^"]*"|'[^']*')/gi, "");
  s = s.replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
  return s;
}

export interface PageDims {
  page: number;
  width: number;
  height: number;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}

/**
 * Bir görseli, sayfa görüntüsünden CSS ile kırparak gösterir.
 * bbox yoksa sayfanın tamamı gösterilir (eski projedeki sayfa ekran görüntüsü davranışı).
 */
export function figureMarkup(f: Figure, imgSrc: string | null, dims?: PageDims): string {
  const caption = `<figcaption><span class="fig-name">${esc(f.filename)}</span> ${esc(f.caption)}</figcaption>`;
  if (!imgSrc) return `<figure class="fig missing">${caption}</figure>`;
  const b = f.bbox;
  if (!b || !dims) {
    return `<figure class="fig full"><img src="${imgSrc}" alt="${esc(f.caption)}" loading="eager">${caption}</figure>`;
  }
  // Kenarlara %1.5 pay bırak
  const pad = 15;
  const ymin = Math.max(0, b[0] - pad);
  const xmin = Math.max(0, b[1] - pad);
  const ymax = Math.min(1000, b[2] + pad);
  const xmax = Math.min(1000, b[3] + pad);
  const bw = xmax - xmin;
  const bh = ymax - ymin;
  if (bw < 30 || bh < 30) {
    return `<figure class="fig full"><img src="${imgSrc}" alt="${esc(f.caption)}" loading="eager">${caption}</figure>`;
  }
  const ratio = ((bw / 1000) * dims.width) / ((bh / 1000) * dims.height);
  const shape = ratio > 1.6 ? "wide" : ratio < 0.8 ? "tall" : "std";
  const imgStyle = [
    `width:${((1000 / bw) * 100).toFixed(3)}%`,
    `left:${((-xmin / bw) * 100).toFixed(3)}%`,
    `top:${((-ymin / bh) * 100).toFixed(3)}%`,
  ].join(";");
  return (
    `<figure class="fig ${shape}"><div class="crop" style="aspect-ratio:${ratio.toFixed(4)}">` +
    `<img src="${imgSrc}" alt="${esc(f.caption)}" style="${imgStyle}" loading="eager"></div>${caption}</figure>`
  );
}

/** Parçaları birleştirir ve görsel yer tutucularını gerçek görsellerle değiştirir. */
export function assembleBody(
  chunks: string[],
  figures: Figure[],
  imageSrcForPage: (page: number) => string | null,
  dims: Map<number, PageDims>,
): string {
  let body = chunks.map(sanitizeFragment).join("\n");
  const placed = new Set<string>();
  body = body.replace(/<figure\s+data-fig="([^"]+)"\s*>\s*<\/figure>/gi, (_m, name: string) => {
    const f = figures.find((x) => x.filename === name);
    if (!f || placed.has(name)) return "";
    placed.add(name);
    return figureMarkup(f, imageSrcForPage(f.page), dims.get(f.page));
  });
  // Modelin yerleştirmeyi unuttuğu görselleri ilgili sayfa bölümünün sonuna ekle
  for (const f of figures) {
    if (placed.has(f.filename)) continue;
    const markup = figureMarkup(f, imageSrcForPage(f.page), dims.get(f.page));
    const re = new RegExp(`(<section[^>]*data-page="${f.page}"[^>]*>[\\s\\S]*?)(</section>)`, "i");
    if (re.test(body)) body = body.replace(re, `$1${markup}$2`);
    else body += `\n<section class="page" data-page="${f.page}">${markup}</section>`;
    placed.add(f.filename);
  }
  return body;
}

export function wrapDocument(opts: { title: string; lang: string; body: string; sourceName: string }): string {
  return `<!doctype html>
<html lang="${esc(opts.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<style>${DOCUMENT_CSS}</style>
</head>
<body>
<header class="doc-head">
  <h1>${esc(opts.title)}</h1>
  <p class="doc-meta">Kaynak: ${esc(opts.sourceName)} · ceviri.selcukdinc.dev</p>
</header>
<main>
${opts.body}
</main>
</body>
</html>`;
}

export const DOCUMENT_CSS = `
@page { size: A4; margin: 14mm 14mm 16mm; }
:root { --ink:#1b1f24; --muted:#5b6470; --accent:#2f5bd3; --line:#e3e6ea; --soft:#f5f7fa; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: var(--ink); background: #eef0f3; font: 10.5pt/1.55 "Inter", "Segoe UI", system-ui, -apple-system, sans-serif; }
.doc-head { max-width: 210mm; margin: 0 auto; padding: 18mm 14mm 4mm; background: #fff; }
.doc-head h1 { margin: 0 0 4px; font-size: 20pt; line-height: 1.2; color: var(--accent); }
.doc-meta { margin: 0; color: var(--muted); font-size: 9pt; }
main { max-width: 210mm; margin: 0 auto 24px; background: #fff; padding: 0 14mm 14mm; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
section.page { padding: 8mm 0 4mm; border-top: 1px solid var(--line); }
section.page:first-child { border-top: 0; }
section.page::before { content: "s. " attr(data-page); float: right; color: var(--muted); font-size: 8pt; }
h2 { font-size: 14pt; margin: 0 0 6px; color: var(--ink); }
h3 { font-size: 11.5pt; margin: 12px 0 4px; color: var(--accent); }
p { margin: 0 0 8px; }
ul, ol { margin: 0 0 8px; padding-left: 20px; }
li { margin: 2px 0; }
code { font: 9.5pt/1.4 ui-monospace, "SFMono-Regular", Menlo, monospace; background: var(--soft); padding: 1px 4px; border-radius: 3px; }
pre { background: var(--soft); padding: 8px 10px; border-radius: 6px; overflow-x: auto; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 10px; font-size: 9.5pt; }
th, td { border: 1px solid var(--line); padding: 4px 6px; text-align: left; vertical-align: top; }
th { background: var(--soft); }
blockquote { margin: 8px 0; padding: 6px 10px; border-left: 3px solid var(--accent); background: var(--soft); }
figure.fig { margin: 10px auto 12px; break-inside: avoid; page-break-inside: avoid; }
figure.fig.wide, figure.fig.full { width: 100%; }
figure.fig.std { width: 78%; }
figure.fig.tall { width: 52%; }
figure.fig img { display: block; max-width: none; }
figure.fig.full img { width: 100%; height: auto; border: 1px solid var(--line); }
.crop { position: relative; width: 100%; overflow: hidden; border: 1px solid var(--line); border-radius: 4px; background: #fff; }
.crop img { position: absolute; height: auto; }
figcaption { margin-top: 4px; color: var(--muted); font-size: 8.5pt; text-align: center; }
.fig-name { font-family: ui-monospace, Menlo, monospace; font-size: 7.5pt; display: block; opacity: .75; }
figure.missing { padding: 12px; border: 1px dashed var(--line); text-align: center; }
@media print {
  body { background: #fff; }
  .doc-head, main { box-shadow: none; max-width: none; padding-left: 0; padding-right: 0; }
  .doc-head { padding-top: 0; }
  h2, h3 { break-after: avoid; page-break-after: avoid; }
}
@media (max-width: 640px) {
  .doc-head, main { padding-left: 16px; padding-right: 16px; }
  figure.fig.std, figure.fig.tall { width: 100%; }
}
`;
