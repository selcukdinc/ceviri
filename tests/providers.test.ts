import { describe, expect, it } from "vitest";
import { batchPages } from "../worker/providers/text";

const base = { from: 1, to: 6, targetLang: "tr", figures: [] };

describe("metin sağlayıcıları için sayfa gruplama", () => {
  it("sayfaları karakter sınırına göre bölerken sırayı korur", () => {
    const pages = [1, 2, 3, 4, 5, 6].map((page) => ({ page, text: "x".repeat(2000) }));
    const batches = batchPages({ ...base, pages }, 5000);
    expect(batches.map((b) => b.pages.map((p) => p.page))).toEqual([[1, 2], [3, 4], [5, 6]]);
    expect(batches.map((b) => [b.from, b.to])).toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  it("sınırı aşan tek sayfayı kırpar ama atlamaz", () => {
    const [b] = batchPages({ ...base, pages: [{ page: 7, text: "y".repeat(20000) }] }, 5000);
    expect(b.pages[0].text).toHaveLength(5000);
  });

  it("boş girdide grup üretmez", () => {
    expect(batchPages({ ...base, pages: [] }, 5000)).toEqual([]);
  });
});
