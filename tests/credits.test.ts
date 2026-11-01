import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, estimateCredits, pageWeight } from "../shared/credits";

const text = { chars: 800, hasImages: false };
const img = { chars: 400, hasImages: true };
const dense = { chars: 4000, hasImages: false };

describe("kredi tahmini", () => {
  it("sayfa ağırlıkları: metin 1, görsel 1.5, yoğun 2", () => {
    expect(pageWeight(text)).toBe(1);
    expect(pageWeight(img)).toBe(1.5);
    expect(pageWeight(dense)).toBe(2);
    expect(pageWeight({ chars: 5000, hasImages: true })).toBe(2);
  });

  it("1 sayfalık PDF ≈ 3 kredi", () => {
    expect(estimateCredits([text]).total).toBe(3);
  });

  it("80 sayfalık, yarısı görselli sunu = 102 kredi", () => {
    const pages = [...Array(40).fill(text), ...Array(40).fill(img)];
    const e = estimateCredits(pages);
    expect(e.total).toBe(102);
    expect(e.textPages).toBe(40);
    expect(e.imagePages).toBe(40);
  });

  it("1 sayfa ile 80 sayfa aynı krediye eşit değil", () => {
    expect(estimateCredits([text]).total).toBeLessThan(estimateCredits(Array(80).fill(text)).total);
  });

  it("özel ağırlıklarla yukarı yuvarlar", () => {
    expect(estimateCredits([img], { ...DEFAULT_WEIGHTS, jobBase: 0 }).total).toBe(2);
  });
});
