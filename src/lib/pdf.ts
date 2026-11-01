import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PageInfo, PdfAnalysis } from "../../shared/types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const IMAGE_OPS = new Set([
  pdfjs.OPS.paintImageXObject,
  pdfjs.OPS.paintInlineImageXObject,
  pdfjs.OPS.paintImageMaskXObject,
  pdfjs.OPS.paintImageXObjectRepeat,
]);
/** Bu kadar vektör yolu çizen sayfa diyagram içeriyor sayılır (slaytlardaki şemalar çoğunlukla vektördür). */
const VECTOR_DIAGRAM_THRESHOLD = 40;
const FIG_REF = /slide-\d{1,3}-fig-\d{1,3}[a-z0-9-]*\.(?:png|jpe?g)/gi;

export type PdfDoc = pdfjs.PDFDocumentProxy;

export async function openPdf(file: File): Promise<PdfDoc> {
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
}

/** PDF'i tamamen tarayıcıda analiz eder: sayfa metni, karakter sayısı, görsel/diyagram varlığı. */
export async function analyzePdf(
  doc: PdfDoc,
  fileName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<PdfAnalysis> {
  const pages: PageInfo[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.str + (item.hasEOL ? "\n" : " ");
    }
    text = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
    const ops = await page.getOperatorList();
    let images = 0;
    let paths = 0;
    for (const fn of ops.fnArray) {
      if (IMAGE_OPS.has(fn)) images++;
      else if (fn === pdfjs.OPS.constructPath) paths++;
    }
    const vp = page.getViewport({ scale: 1 });
    pages.push({
      page: i,
      text,
      chars: text.replace(/\s+/g, "").length,
      hasImages: images > 0 || paths >= VECTOR_DIAGRAM_THRESHOLD,
      figureRefs: [...new Set(text.match(FIG_REF) ?? [])],
      width: Math.round(vp.width),
      height: Math.round(vp.height),
    });
    page.cleanup();
    onProgress?.(i, doc.numPages);
  }
  return { fileName, pageCount: doc.numPages, pages };
}

/** Bir sayfayı JPEG olarak çizer (görsellerin kırpılacağı kaynak). */
export async function renderPageJpeg(doc: PdfDoc, pageNo: number, maxWidth = 1800): Promise<Blob> {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, maxWidth / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Sayfa çizilemedi"))), "image/jpeg", 0.85),
  );
}
