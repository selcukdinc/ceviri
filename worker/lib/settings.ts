import type { CreditWeights } from "../../shared/credits";

export type Settings = Record<string, string>;

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

export function num(s: Settings, key: string, fallback: number): number {
  const v = Number(s[key]);
  return Number.isFinite(v) ? v : fallback;
}

export function weightsFrom(s: Settings): CreditWeights {
  return {
    jobBase: num(s, "credit.job_base", 2),
    textPage: num(s, "credit.text_page", 1),
    imagePage: num(s, "credit.image_page", 1.5),
    densePage: num(s, "credit.dense_page", 2),
    denseChars: num(s, "credit.dense_chars", 3000),
  };
}

export const EDITABLE_SETTINGS: Record<string, { label: string; min: number; max: number }> = {
  "credit.job_base": { label: "İş başı sabit kredi", min: 0, max: 100 },
  "credit.text_page": { label: "Metin sayfası", min: 0, max: 20 },
  "credit.image_page": { label: "Görselli sayfa", min: 0, max: 20 },
  "credit.dense_page": { label: "Yoğun metinli sayfa", min: 0, max: 20 },
  "credit.dense_chars": { label: "Yoğun sayfa eşiği (karakter)", min: 500, max: 20000 },
  "limits.unlimited_daily_pages": { label: "Sınırsız plan günlük sayfa tavanı", min: 1, max: 10000 },
  "limits.max_pages": { label: "Tek PDF en fazla sayfa", min: 1, max: 1000 },
  "limits.max_mb": { label: "Tek PDF en fazla boyut (MB)", min: 1, max: 100 },
};
