import { useState } from "react";
import type { PdfAnalysis } from "../../shared/types";
import { analyzePdf, openPdf, type PdfDoc } from "../lib/pdf";
import { Alert, Button, Dropzone, Progress } from "./ui";

export interface PickedPdf {
  file: File;
  doc: PdfDoc;
  analysis: PdfAnalysis;
}

/** PDF seçtirir ve tarayıcıda analiz eder. */
export function PdfPicker({ onReady, maxMb = 50, hint }: { onReady: (p: PickedPdf) => void; maxMb?: number; hint?: string }) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string>();

  async function handle(file: File) {
    setError(undefined);
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return setError("Lütfen bir PDF dosyası seçin.");
    if (file.size > maxMb * 1024 * 1024) return setError(`PDF en fazla ${maxMb} MB olabilir.`);
    try {
      setProgress({ done: 0, total: 1 });
      const doc = await openPdf(file);
      const analysis = await analyzePdf(doc, file.name, (done, total) => setProgress({ done, total }));
      setProgress(null);
      onReady({ file, doc, analysis });
    } catch (e) {
      setProgress(null);
      setError(`PDF okunamadı: ${(e as Error).message}`);
    }
  }

  if (progress)
    return (
      <div className="rounded-xl border border-line bg-surface p-6">
        <p className="mb-3 text-sm font-medium">
          PDF analiz ediliyor… {progress.done}/{progress.total} sayfa
        </p>
        <Progress value={(progress.done / progress.total) * 100} />
      </div>
    );

  return (
    <div className="space-y-3">
      <Dropzone onFile={handle} hint={hint} />
      {error && (
        <Alert>
          {error}{" "}
          <Button variant="ghost" size="sm" onClick={() => setError(undefined)}>Tamam</Button>
        </Alert>
      )}
    </div>
  );
}

export function AnalysisSummary({ a, fileSize }: { a: PdfAnalysis; fileSize: number }) {
  const imagePages = a.pages.filter((p) => p.hasImages).length;
  const chars = a.pages.reduce((s, p) => s + p.chars, 0);
  const items = [
    ["Sayfa", a.pageCount],
    ["Görselli sayfa", imagePages],
    ["Karakter", chars.toLocaleString("tr-TR")],
    ["Boyut", fileSize < 1024 * 1024 ? `${Math.max(1, Math.round(fileSize / 1024))} KB` : `${(fileSize / 1024 / 1024).toFixed(1)} MB`],
  ] as const;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-lg bg-surface-2 px-3 py-2">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="text-lg font-semibold tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
