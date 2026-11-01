import type { PdfAnalysis } from "./types";
import { LANGUAGES } from "./types";

/** Eski projedeki normalize_target_names mantığı. */
export function targetNames(pdfFileName: string): { base: string; html: string; figures: string } {
  const base = pdfFileName.replace(/\.[^.]+$/, "");
  const chapter = base.match(/chapter[_\- ]?(\d+)/i);
  if (chapter) {
    const n = chapter[1];
    return { base: `chapter-${n}`, html: `chapter-${n}-tr.html`, figures: `chapter-${n}-figures.md` };
  }
  const slug =
    base
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ı/g, "i")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "belge";
  return { base: slug, html: `${slug}-tr.html`, figures: `${slug}-figures.md` };
}

export function figureFileName(page: number, index: number, desc: string): string {
  const slug = desc
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const pp = String(page).padStart(2, "0");
  const ii = String(index).padStart(2, "0");
  return `slide-${pp}-fig-${ii}${slug ? `-${slug}` : ""}.png`;
}

export interface GuestPromptOptions {
  subject: string;
  targetLang: string;
  style: "exam" | "full";
}

function langName(code: string) {
  return LANGUAGES[code] ?? code;
}

/** Görsel içerdiği tespit edilen sayfalar için ön tarama tablosu (Markdown). */
export function figureCandidatesMarkdown(a: PdfAnalysis): string {
  const rows = a.pages.filter((p) => p.hasImages || p.figureRefs.length > 0);
  if (rows.length === 0) return "_Görsel içeren sayfa tespit edilmedi._";
  const lines = ["| Sayfa | Önerilen dosya adı | Not |", "|---|---|---|"];
  for (const p of rows) {
    const firstLine = p.text.split(/\n/).map((s) => s.trim()).find((s) => s.length > 3) ?? "";
    const name = p.figureRefs[0] ?? figureFileName(p.page, 1, firstLine.slice(0, 40));
    lines.push(`| ${p.page} | \`${name}\` | ${firstLine.slice(0, 70).replace(/\|/g, "/")} |`);
  }
  return lines.join("\n");
}

/** Misafirin kendi IDE ajanına yapıştıracağı prompt (eski build_prompt'un genişletilmiş hali). */
export function buildGuestPrompt(a: PdfAnalysis, o: GuestPromptOptions): string {
  const t = targetNames(a.fileName);
  const lang = langName(o.targetLang);
  const imagePages = a.pages.filter((p) => p.hasImages).map((p) => p.page);
  const styleLine =
    o.style === "exam"
      ? `- İçeriği teknik ve sınav odaklı bir ${lang} özet olarak yaz: kavram tanımları, formüller, karşılaştırmalar ve "sınavda dikkat" kutuları kullan.`
      : `- İçeriği sayfa sayfa, eksiksiz ve teknik kayıp olmadan ${lang} diline çevir.`;

  return [
    `Aşağıdaki görevi iki aşamada yerine getir.`,
    ``,
    `Kaynak PDF: ${a.fileName} (${a.pageCount} sayfa)`,
    `Konu: ${o.subject || "PDF içeriğinden çıkar"}`,
    `Üretilecek HTML dosyası: ${t.html}`,
    `Üretilecek görsel listesi: ${t.figures}`,
    ``,
    `## Aşama 1 — Ön tarama`,
    `- PDF'i analiz et ve final belgede mutlaka korunması gereken görselleri tablo halinde çıkar.`,
    `- Sütunlar: Sayfa | Görsel konusu | Neden önemli? | Kaydedilecek dosya adı.`,
    `- Dosya adı biçimi: slide-XX-fig-YY-kisa-aciklama.png (XX sayfa, YY o sayfadaki sıra).`,
    imagePages.length
      ? `- Ön analize göre görsel içeren sayfalar: ${compressRanges(imagePages)}.`
      : `- Ön analiz görsel içeren sayfa bulamadı; yine de diyagram/şekil olan sayfaları kontrol et.`,
    `- Listeyi ${t.figures} dosyasına her satır "Slayt X — dosya-adi.png — kısa açıklama" olacak şekilde yaz.`,
    `- Bu aşamada çeviriye başlama; görselleri hazırlamamı bekle.`,
    ``,
    `## Aşama 2 — HTML üretimi ("Görselleri hazırladım" dediğimde)`,
    styleLine,
    `- Başlıkları, alt başlıkları, madde listelerini ve önemli terimleri açık biçimde ver; terimlerin orijinal karşılığını parantez içinde koru.`,
    `- Görselleri <img src="figures/DOSYA_ADI.png"> ile ilgili bölüme yerleştir; geniş diyagramlar tam genişlik, dikey görseller ortalanmış dar blok olsun.`,
    `- HTML'i A4 sayfa yapısında üret: her sayfa <section class="page"> olsun, @page { size: A4 } ve yazdırma CSS'i ekle.`,
    `- Tek, bağımsız bir ${t.html} dosyası üret (CSS gömülü).`,
    ``,
    `## Aşama 3 — PDF (isteğe bağlı)`,
    `- Tarayıcıda yazdır → PDF olarak kaydet: "Arka plan grafikleri" açık, "Üstbilgi/altbilgi" kapalı, ölçek %100.`,
  ].join("\n");
}

/** Misafirin IDE'sine (.github/agents/ vb.) koyacağı ajan tanımı. */
export function buildAgentFile(o: GuestPromptOptions): string {
  const lang = langName(o.targetLang);
  const subject = o.subject || "Teknik ders";
  return [
    `---`,
    `name: ${subject} ${lang} Özet Uzmanı`,
    `description: ${subject} sunumlarını ve PDF notlarını teknik kayıp olmadan ${lang} diline çevirir, önemli görselleri ön taramayla belirler ve yazdırılabilir HTML üretir.`,
    `---`,
    ``,
    `# ${subject} — ${lang} Özet Uzmanı`,
    ``,
    `Sen ${subject} alanında uzman bir teknik çevirmensin. Görevin, kullanıcının verdiği PDF sunularını ${lang} diline teknik kayıp olmadan çevirmek ve sınava hazırlığa uygun, yazdırılabilir bir HTML belgesi üretmek.`,
    ``,
    `## Çalışma biçimi`,
    `1. **Ön tarama:** PDF'i analiz et; korunması gereken görselleri "Sayfa | Görsel konusu | Neden önemli? | Dosya adı | Hedef klasör" tablosuyla ver. Çeviriye başlama.`,
    `2. **HTML üretimi:** Kullanıcı "görselleri hazırladım" dediğinde ${lang} HTML'i üret.`,
    ``,
    `## Kurallar`,
    `- Görsel adları: \`slide-XX-fig-YY-kisa-aciklama.png\`, klasör: \`figure-assets/<bölüm>/\`.`,
    `- Teknik terimlerin orijinalini ilk geçtiği yerde parantez içinde koru (ör. "tıkanıklık denetimi (congestion control)").`,
    `- Her A4 sayfa \`<section class="page">\`; geniş diyagramlar tam genişlik, dikey görseller dar ve ortalı, standart görseller dengeli grid.`,
    `- Bir sayfa çok az taşıyorsa içeriği hafifçe küçült; bozuk sayfa sonlarından kaçın.`,
    `- CSS'i dosyaya göm, dış bağımlılık kullanma; \`@media print\` ve \`@page { size: A4; margin: 12mm }\` ekle.`,
    `- Emin olmadığın çeviriyi uydurma; orijinal terimi bırak ve "(çeviri notu)" ekle.`,
  ].join("\n");
}

function compressRanges(nums: number[]): string {
  const out: string[] = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    const n = nums[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    out.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  return out.join(", ");
}

/* ------------------------------------------------------------------ */
/* Sunucu tarafı (otomatik hat) talimatları                            */
/* ------------------------------------------------------------------ */

export function scanInstruction(pageCount: number, targetLang: string): string {
  return [
    `Sen bir PDF ön tarama aracısın. Ekteki PDF ${pageCount} sayfadır.`,
    `Görevin: final ${langName(targetLang)} belgede korunması gereken önemli görselleri (diyagram, şekil, grafik, tablo görüntüsü) belirlemek.`,
    `Logo, dekoratif arka plan ve tekrarlayan şablon öğelerini alma.`,
    `Yalnızca JSON döndür, şu yapıda:`,
    `{"sourceLang":"en","title":"belge başlığı (${langName(targetLang)})","figures":[{"page":3,"caption":"kısa ${langName(targetLang)} açıklama","why":"neden önemli","slug":"kisa-ingilizce-aciklama","bbox":[ymin,xmin,ymax,xmax]}]}`,
    `bbox, görselin sayfa üzerindeki konumudur; 0-1000 ölçeğinde normalize edilmiş tam sayılar kullan.`,
  ].join("\n");
}

export function translateInstruction(opts: {
  from: number;
  to: number;
  targetLang: string;
  figures: { page: number; filename: string; caption: string }[];
}): string {
  const lang = langName(opts.targetLang);
  const figs = opts.figures.filter((f) => f.page >= opts.from && f.page <= opts.to);
  return [
    `Ekteki PDF'in YALNIZCA ${opts.from}-${opts.to}. sayfalarını ${lang} diline çevir.`,
    `Çıktı: yalnızca HTML parçası (<html>, <head>, <body> YOK, Markdown kod bloğu YOK).`,
    `Kurallar:`,
    `- Her kaynak sayfa için bir <section class="page" data-page="N"> aç ve içine başlık (h2/h3), paragraf, liste ve tablolarla içeriği yaz.`,
    `- Teknik terimlerin orijinalini ilk geçtiğinde parantez içinde koru.`,
    `- Anlamı koru, içerik ekleme veya çıkarma yapma; slayt notu tarzı kısa maddeleri düzgün cümleler veya maddeler olarak ver.`,
    `- Formülleri <code> veya <pre> içinde koru.`,
    figs.length
      ? `- Şu görselleri ilgili sayfanın uygun yerine tam olarak bu etiketle yerleştir: <figure data-fig="DOSYA_ADI"></figure>. Görseller:\n${figs
          .map((f) => `  • sayfa ${f.page}: ${f.filename} — ${f.caption}`)
          .join("\n")}`
      : `- Bu sayfa aralığında yerleştirilecek görsel yok; görsel etiketi ekleme.`,
    `- Stil (style) özniteliği veya <style> etiketi kullanma; yalnızca anlamsal HTML.`,
  ].join("\n");
}

/** Yedek sağlayıcılar (PDF okuyamayanlar) için metin tabanlı talimat. */
export function translateTextInstruction(targetLang: string): string {
  const lang = langName(targetLang);
  return [
    `Sana bir PDF sayfasından çıkarılmış ham metin verilecek. Bunu ${lang} diline çevir ve anlamsal HTML parçası olarak döndür.`,
    `Yalnızca HTML döndür (h2/h3, p, ul/li, table, code). <html>/<body>/<style> ve Markdown kod bloğu kullanma.`,
    `Teknik terimlerin orijinalini ilk geçtiğinde parantez içinde koru. Uydurma içerik ekleme.`,
  ].join("\n");
}
