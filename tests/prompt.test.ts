import { describe, expect, it } from "vitest";
import { buildAgentFile, buildGuestPrompt, figureFileName, targetNames } from "../shared/prompt";
import type { PdfAnalysis } from "../shared/types";

describe("hedef dosya adları (eski normalize_target_names)", () => {
  it("chapter numarasını bulur", () => {
    expect(targetNames("Chapter_3_v8.2.pdf")).toEqual({ base: "chapter-3", html: "chapter-3-tr.html", figures: "chapter-3-figures.md" });
  });
  it("chapter yoksa slug üretir", () => {
    expect(targetNames("Sinyaller ve Sistemler Hafta 2.pdf").html).toBe("sinyaller-ve-sistemler-hafta-2-tr.html");
  });
});

describe("görsel adları", () => {
  it("slide-XX-fig-YY biçimi", () => {
    expect(figureFileName(3, 1, "Three-way handshake")).toBe("slide-03-fig-01-three-way-handshake.png");
    expect(figureFileName(124, 2, "")).toBe("slide-124-fig-02.png");
  });
});

describe("misafir promptu", () => {
  const a: PdfAnalysis = {
    fileName: "Chapter_2_v8.2.pdf",
    pageCount: 5,
    pages: [1, 2, 3, 4, 5].map((page) => ({ page, chars: 100, hasImages: page === 2 || page === 3, text: `Sayfa ${page}`, figureRefs: [] })),
  };
  it("dosya adlarını, görsel sayfalarını ve iki aşamayı içerir", () => {
    const p = buildGuestPrompt(a, { subject: "Computer Networking", targetLang: "tr", style: "exam" });
    expect(p).toContain("chapter-2-tr.html");
    expect(p).toContain("chapter-2-figures.md");
    expect(p).toContain("2-3");
    expect(p).toContain("Aşama 1");
    expect(p).toContain("Aşama 2");
  });
  it("ajan dosyası frontmatter içerir", () => {
    const f = buildAgentFile({ subject: "Computer Networking", targetLang: "tr", style: "exam" });
    expect(f.startsWith("---\nname: Computer Networking Türkçe Özet Uzmanı")).toBe(true);
  });
});
