import type { PageInfo } from "./types";

export interface CreditWeights {
  jobBase: number;
  textPage: number;
  imagePage: number;
  densePage: number;
  denseChars: number;
}

export const DEFAULT_WEIGHTS: CreditWeights = {
  jobBase: 2,
  textPage: 1,
  imagePage: 1.5,
  densePage: 2,
  denseChars: 3000,
};

type PageLike = Pick<PageInfo, "chars" | "hasImages">;

/** Bir sayfanın ağırlığı: yoğun metin > görsel > düz metin (en yüksek olan geçerli). */
export function pageWeight(p: PageLike, w: CreditWeights = DEFAULT_WEIGHTS): number {
  if (p.chars > w.denseChars) return Math.max(w.densePage, p.hasImages ? w.imagePage : 0);
  if (p.hasImages) return w.imagePage;
  return w.textPage;
}

export interface Estimate {
  total: number;
  base: number;
  textPages: number;
  imagePages: number;
  densePages: number;
}

export function estimateCredits(pages: PageLike[], w: CreditWeights = DEFAULT_WEIGHTS): Estimate {
  let sum = 0;
  let textPages = 0;
  let imagePages = 0;
  let densePages = 0;
  for (const p of pages) {
    sum += pageWeight(p, w);
    if (p.chars > w.denseChars) densePages++;
    else if (p.hasImages) imagePages++;
    else textPages++;
  }
  return {
    total: Math.ceil(w.jobBase + sum),
    base: w.jobBase,
    textPages,
    imagePages,
    densePages,
  };
}
