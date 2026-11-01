import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Figure, JobSummary } from "../../shared/types";
import { Alert, Badge, Button, Card, CardHeader, Progress } from "../components/ui";
import { api, formatDate } from "../lib/api";
import { useAuth } from "../lib/auth";
import { STATUS } from "./Dashboard";

export default function JobDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { refresh } = useAuth();
  const [job, setJob] = useState<JobSummary | null>(null);
  const [figures, setFigures] = useState<Figure[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ job: JobSummary; figures: Figure[] }>(`/jobs/${id}`);
      setJob(r.job);
      setFigures(r.figures);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const running = job && job.status !== "done" && job.status !== "failed";
  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      const t = setInterval(load, 3000);
      return () => clearInterval(t);
    }
    if (wasRunning.current && job) {
      wasRunning.current = false;
      void refresh(); // kredi kesinleşti/iade edildi
    }
  }, [running, job, load, refresh]);

  if (error && !job) return <Alert>{error}</Alert>;
  if (!job) return <p className="text-muted">Yükleniyor…</p>;
  const st = STATUS[job.status];

  async function renderPdf() {
    setBusy("pdf");
    setError(undefined);
    try {
      await api(`/jobs/${id}/render-pdf`, { method: "POST" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm("Bu çeviri ve tüm dosyaları silinsin mi? Kredi geçmişi korunur.")) return;
    setBusy("delete");
    try {
      await api(`/jobs/${id}`, { method: "DELETE" });
      nav("/panel");
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/panel" className="text-sm text-muted hover:text-ink">← Panel</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 truncate text-2xl font-semibold">{job.title}</h1>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted">
          {formatDate(job.createdAt)} · {job.pageCount} sayfa ·{" "}
          {job.unlimited ? "sınırsız plan" : job.charged != null ? `${job.charged} kredi harcandı` : `${job.estimate} kredi rezerve`}
          {job.provider && ` · ${job.provider}`}
        </p>
      </div>

      {running && (
        <Card className="space-y-3 p-5">
          <div className="flex justify-between text-sm">
            <span>{job.stageNote ?? "İşleniyor"}…</span>
            <span className="tabular-nums text-muted">%{job.progress}</span>
          </div>
          <Progress value={job.progress} />
          <p className="text-xs text-muted">Sayfayı kapatabilirsiniz; çeviri arka planda devam eder.</p>
        </Card>
      )}

      {job.status === "failed" && (
        <Alert>
          Çeviri tamamlanamadı{job.unlimited ? "" : " ve rezerve edilen kredi iade edildi"}. {job.error && <span className="block text-xs opacity-80">{job.error}</span>}
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}

      {job.status === "done" && (
        <div className="flex flex-wrap gap-2">
          {job.hasPdf ? (
            <a href={`/api/jobs/${id}/pdf`} className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink hover:opacity-90">PDF indir</a>
          ) : (
            <Button onClick={renderPdf} loading={busy === "pdf"}>PDF oluştur</Button>
          )}
          <a href={`/api/jobs/${id}/html?download=1`} className="inline-flex h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-2">HTML indir</a>
          <a href={`/api/jobs/${id}/html`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-2">
            Yeni sekmede aç / yazdır
          </a>
          {job.hasPdf && (
            <Button variant="ghost" onClick={async () => { await renderPdf(); setFrameKey((k) => k + 1); }} loading={busy === "pdf"}>
              PDF'i yeniden oluştur
            </Button>
          )}
          <Button variant="ghost" className="text-bad" onClick={remove} loading={busy === "delete"}>Sil</Button>
        </div>
      )}

      {job.status === "done" && job.hasHtml && (
        <Card className="overflow-hidden">
          <CardHeader title="Önizleme" />
          <iframe key={frameKey} title="Çeviri önizlemesi" src={`/api/jobs/${id}/html`} className="h-[75vh] w-full bg-white" />
        </Card>
      )}

      {figures.length > 0 && (
        <Card>
          <CardHeader title="Korunan görseller" desc="Ön taramada belirlenen ve belgeye yerleştirilen görseller" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-2 font-medium">Sayfa</th>
                  <th className="px-2 py-2 font-medium">Dosya adı</th>
                  <th className="px-5 py-2 font-medium">Açıklama</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {figures.map((f) => (
                  <tr key={f.filename}>
                    <td className="px-5 py-2 tabular-nums">{f.page}</td>
                    <td className="px-2 py-2 font-mono text-xs">{f.filename}</td>
                    <td className="px-5 py-2 text-muted">{f.caption}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {job.status === "failed" && (
        <Button variant="ghost" className="text-bad" onClick={remove} loading={busy === "delete"}>Bu kaydı sil</Button>
      )}
    </div>
  );
}
