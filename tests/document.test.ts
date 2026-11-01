import { describe, expect, it } from "vitest";
import { assembleBody, figureMarkup, sanitizeFragment } from "../worker/lib/document";
import { normalizeFigures } from "../worker/workflow/translate";

describe("HTML temizleme", () => {
  it("script, olay öznitelikleri ve kod bloklarını kaldırır", () => {
    const s = sanitizeFragment('```html\n<section class="page"><h2 onclick="x()">A</h2><script>alert(1)</script><a href="javascript:x">l</a></section>\n```');
    expect(s).not.toContain("script");
    expect(s).not.toContain("onclick");
    expect(s).not.toContain("javascript:");
    expect(s).not.toContain("```");
    expect(s).toContain("<h2>A</h2>");
  });
});

describe("görsel yerleştirme", () => {
  const figs = [
    { page: 1, filename: "slide-01-fig-01-a.png", caption: "A", bbox: [100, 100, 500, 900] as [number, number, number, number] },
    { page: 2, filename: "slide-02-fig-01-b.png", caption: "B", bbox: null },
  ];
  const dims = new Map([[1, { page: 1, width: 960, height: 540 }]]);

  it("yer tutucuyu kırpılmış görselle değiştirir, unutulanı sayfa sonuna ekler", () => {
    const body = assembleBody(
      ['<section class="page" data-page="1"><p>x</p><figure data-fig="slide-01-fig-01-a.png"></figure></section><section class="page" data-page="2"><p>y</p></section>'],
      figs,
      (p) => `assets/page-00${p}.jpg`,
      dims,
    );
    expect(body).toContain('class="crop"');
    expect(body).toContain("assets/page-001.jpg");
    expect(body).toMatch(/<p>y<\/p><figure class="fig full"><img src="assets\/page-002.jpg"/);
  });

  it("geniş diyagram 'wide' sınıfı alır", () => {
    expect(figureMarkup(figs[0], "x.jpg", dims.get(1))).toContain("fig wide");
  });
});

describe("ön tarama normalizasyonu", () => {
  it("geçersiz sayfaları atar, dosya adlarını numaralar, bbox'u sınırlar", () => {
    const out = normalizeFigures(
      [
        { page: 3, caption: "TCP el sıkışma", slug: "tcp handshake", bbox: [10, 20, 400, 1200] },
        { page: 3, caption: "İkinci", slug: "second" },
        { page: 99, caption: "yok" },
      ],
      10,
    );
    expect(out).toHaveLength(2);
    expect(out[0].filename).toBe("slide-03-fig-01-tcp-handshake.png");
    expect(out[0].bbox).toEqual([10, 20, 400, 1000]);
    expect(out[1].filename).toBe("slide-03-fig-02-second.png");
  });
});
