export type Role = "guest" | "user" | "admin";
export type Plan = "credits" | "unlimited";

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  plan: Plan;
  planExpiresAt: number | null;
  balance: number;
  unlimitedActive: boolean;
}

/** Tarayıcıda pdf.js ile çıkarılan sayfa bilgisi. */
export interface PageInfo {
  page: number;
  chars: number;
  hasImages: boolean;
  text: string;
  figureRefs: string[];
  /** Sayfa boyutu (PDF birimi), görsel kırpma oranı için */
  width?: number;
  height?: number;
}

export interface PdfAnalysis {
  fileName: string;
  pageCount: number;
  pages: PageInfo[];
}

export type JobStatus =
  | "queued"
  | "scanning"
  | "translating"
  | "assembling"
  | "rendering"
  | "done"
  | "failed";

export interface JobSummary {
  id: string;
  title: string;
  pageCount: number;
  estimate: number;
  charged: number | null;
  unlimited: boolean;
  status: JobStatus;
  progress: number;
  stageNote: string | null;
  provider: string | null;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
  hasHtml: boolean;
  hasPdf: boolean;
}

/** Ön taramada belirlenen ve korunacak görsel. bbox 0..1000 ölçeğinde [ymin, xmin, ymax, xmax]. */
export interface Figure {
  page: number;
  filename: string;
  caption: string;
  why?: string;
  bbox?: [number, number, number, number] | null;
}

export const LANGUAGES: Record<string, string> = {
  tr: "Türkçe",
  en: "İngilizce",
  de: "Almanca",
  fr: "Fransızca",
  es: "İspanyolca",
  it: "İtalyanca",
  ru: "Rusça",
  ar: "Arapça",
};
