import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Estimate } from "../../shared/credits";
import type { JobSummary } from "../../shared/types";
import { LANGUAGES } from "../../shared/types";
import { AnalysisSummary, PdfPicker, type PickedPdf } from "../components/PdfPicker";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Progress, Select, Stat, Tabs } from "../components/ui";
import { api, formatDate, uploadWithProgress } from "../lib/api";
import { useAuth } from "../lib/auth";
import { renderPageJpeg } from "../lib/pdf";

export const STATUS: Record<JobSummary["status"], { label: string; tone: "neutral" | "accent" | "ok" | "warn" | "bad" }> = {
  queued: { label: "Sırada", tone: "neutral" },
  scanning: { label: "Ön tarama", tone: "accent" },
  translating: { label: "Çevriliyor", tone: "accent" },
  assembling: { label: "Birleştiriliyor", tone: "accent" },
  rendering: { label: "PDF hazırlanıyor", tone: "accent" },
  done: { label: "Tamamlandı", tone: "ok" },
  failed: { label: "Başarısız", tone: "bad" },
};

interface Quote {
  estimate: Estimate;
  balance: number;
  unlimited: boolean;
  dailyPagesUsed: number;
  dailyPageCap: number | null;
  maxPages: number;
  maxMb: number;
}

interface LedgerEntry {
  id: string;
  delta: number;
  type: string;
  note: string | null;
  jobId: string | null;
  jobTitle: string | null;
  createdAt: number;
}

export const LEDGER_TYPES: Record<string, string> = {
  grant: "Yükleme",
  reserve: "Rezerv",
  consume: "Harcama",
  refund: "İade",
  adjust: "Düzeltme",
};

export default function Dashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"jobs" | "ledger">("jobs");
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);

  const loadJobs = useCallback(async () => {
    const r = await api<{ jobs: JobSummary[] }>("/jobs");
    setJobs(r.jobs);
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  // Devam eden iş varsa listeyi periyodik yenile
  useEffect(() => {
    if (!jobs?.some((j) => j.status !== "done" && j.status !== "failed")) return;
    const t = setInterval(loadJobs, 4000);
    return () => clearInterval(t);
  }, [jobs, loadJobs]);

  if (!user) return null;
  const running = jobs?.filter((j) => j.status !== "done" && j.status !== "failed").length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Merhaba, {user.name.split(" ")[0]}</h1>
        <p className="mt-1 text-muted">PDF yükleyin; ön tarama, çeviri ve PDF üretimi otomatik yapılır.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Bakiye"
          value={user.unlimitedActive ? "Sınırsız" : `${user.balance} kredi`}
          hint={
            user.unlimitedActive
              ? user.planExpiresAt ? `Bitiş: ${formatDate(user.planExpiresAt)}` : "Süresiz"
              : user.balance === 0 ? "Kredi tanımlaması için yöneticiyle iletişime geçin" : undefined
          }
        />
        <Stat label="Toplam çeviri" value={jobs?.length ?? "–"} />
        <Stat label="Devam eden" value={running} />
      </div>

      <NewJob onCreated={loadJobs} />

      <Card>
        <CardHeader
          title="Geçmiş"
          action={<Tabs value={tab} onChange={setTab} items={[{ value: "jobs", label: "Çeviriler" }, { value: "ledger", label: "Kredi hareketleri" }]} />}
        />
        {tab === "jobs" ? <JobList jobs={jobs} /> : <Ledger />}
      </Card>
    </div>
  );
}

function NewJob({ onCreated }: { onCreated: () => void }) {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const [picked, setPicked] = useState<PickedPdf | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [title, setTitle] = useState("");
  const [lang, setLang] = useState("tr");
  const [phase, setPhase] = useState<{ label: string; pct: number } | null>(null);
  const [error, setError] = useState<string>();

  async function onPicked(p: PickedPdf) {
    setPicked(p);
    setTitle(p.file.name.replace(/\.pdf$/i, ""));
    setError(undefined);
    try {
      setQuote(await api<Quote>("/jobs/estimate", { method: "POST", json: { pages: p.analysis.pages.map((x) => ({ chars: x.chars, hasImages: x.hasImages })) } }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function reset() {
    setPicked(null);
    setQuote(null);
    setPhase(null);
    setError(undefined);
  }

  async function start() {
    if (!picked || !quote) return;
    setError(undefined);
    try {
      const form = new FormData();
      form.append("file", picked.file);
      form.append("title", title);
      form.append("targetLang", lang);
      form.append("analysis", JSON.stringify(picked.analysis));
      // Görsel içeren sayfaları tarayıcıda çiz; görseller bu görüntülerden kırpılır
      const imagePages = picked.analysis.pages.filter((p) => p.hasImages).map((p) => p.page);
      for (let i = 0; i < imagePages.length; i++) {
        setPhase({ label: `Sayfa görüntüleri hazırlanıyor (${i + 1}/${imagePages.length})`, pct: (i / imagePages.length) * 100 });
        form.append(`page-${imagePages[i]}`, await renderPageJpeg(picked.doc, imagePages[i]), `page-${imagePages[i]}.jpg`);
      }
      setPhase({ label: "Yükleniyor", pct: 0 });
      const r = await uploadWithProgress<{ id: string }>("/jobs", form, (pct) => setPhase({ label: "Yükleniyor", pct }));
      await refresh();
      onCreated();
      nav(`/panel/is/${r.id}`);
    } catch (e) {
      setPhase(null);
      setError((e as Error).message);
    }
  }

  if (!user) return null;
  const tooBig = quote && picked && picked.analysis.pageCount > quote.maxPages;
  const capExceeded = quote?.unlimited && quote.dailyPageCap != null && picked && quote.dailyPagesUsed + picked.analysis.pageCount > quote.dailyPageCap;
  const insufficient = quote && !quote.unlimited && quote.balance < quote.estimate.total;

  return (
    <Card>
      <CardHeader title="Yeni çeviri" desc="Kredi, sayfa sayısına ve içeriğe göre önceden hesaplanır; başarısız işlerde iade edilir." />
      <div className="p-5">
        {!picked ? (
          <PdfPicker onReady={onPicked} hint="İngilizce veya başka dildeki sunum/ders PDF'i" />
        ) : (
          <div className="space-y-5">
            <AnalysisSummary a={picked.analysis} fileSize={picked.file.size} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Başlık"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></Field>
              <Field label="Hedef dil">
                <Select value={lang} onChange={(e) => setLang(e.target.value)}>
                  {Object.entries(LANGUAGES).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </Select>
              </Field>
            </div>

            {quote && (
              <div className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm text-muted">Tahmini maliyet</span>
                  <span className="text-2xl font-semibold tabular-nums">
                    {quote.unlimited ? <><s className="mr-2 text-base text-muted">{quote.estimate.total}</s>0 kredi</> : `${quote.estimate.total} kredi`}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {quote.estimate.base} sabit + {quote.estimate.textPages} metin sayfası + {quote.estimate.imagePages} görselli sayfa + {quote.estimate.densePages} yoğun sayfa
                  {quote.unlimited
                    ? ` · Sınırsız plan: bugün ${quote.dailyPagesUsed}/${quote.dailyPageCap} sayfa kullanıldı`
                    : ` · Bakiye: ${quote.balance} → ${quote.balance - quote.estimate.total}`}
                </p>
              </div>
            )}

            {tooBig && <Alert>Bu PDF {picked.analysis.pageCount} sayfa; en fazla {quote!.maxPages} sayfa işlenebilir.</Alert>}
            {capExceeded && <Alert tone="warn">Günlük sayfa tavanınızı aşıyor. Yarın tekrar deneyin veya yöneticiyle iletişime geçin.</Alert>}
            {insufficient && <Alert tone="warn">Yetersiz kredi. Bu çeviri için {quote!.estimate.total - quote!.balance} kredi daha gerekiyor; yöneticiden kredi isteyin.</Alert>}
            {error && <Alert>{error}</Alert>}
            {phase && (
              <div className="space-y-2">
                <p className="text-sm">{phase.label}…</p>
                <Progress value={phase.pct} />
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={start} loading={!!phase} disabled={!quote || !!tooBig || !!capExceeded || !!insufficient}>
                Çeviriyi başlat
              </Button>
              <Button variant="secondary" onClick={reset} disabled={!!phase}>Vazgeç</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function JobList({ jobs }: { jobs: JobSummary[] | null }) {
  if (!jobs) return <p className="p-5 text-sm text-muted">Yükleniyor…</p>;
  if (!jobs.length) return <p className="p-5 text-sm text-muted">Henüz çeviri yok. Yukarıdan ilk PDF'inizi yükleyin.</p>;
  return (
    <ul className="divide-y divide-line">
      {jobs.map((j) => (
        <li key={j.id}>
          <Link to={`/panel/is/${j.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-surface-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{j.title}</div>
              <div className="text-xs text-muted">
                {formatDate(j.createdAt)} · {j.pageCount} sayfa · {j.unlimited ? "sınırsız plan" : `${j.charged ?? j.estimate} kredi`}
              </div>
            </div>
            {j.status !== "done" && j.status !== "failed" && <div className="w-28"><Progress value={j.progress} /></div>}
            <Badge tone={STATUS[j.status].tone}>{STATUS[j.status].label}</Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Ledger() {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  useEffect(() => {
    api<{ entries: LedgerEntry[] }>("/me/ledger").then((r) => setEntries(r.entries)).catch(() => setEntries([]));
  }, []);
  if (!entries) return <p className="p-5 text-sm text-muted">Yükleniyor…</p>;
  if (!entries.length) return <p className="p-5 text-sm text-muted">Henüz kredi hareketi yok.</p>;
  return <LedgerTable entries={entries} />;
}

export function LedgerTable({ entries, showActor }: { entries: (LedgerEntry & { actorEmail?: string | null })[]; showActor?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="px-5 py-2 font-medium">Tarih</th>
            <th className="px-2 py-2 font-medium">Tür</th>
            <th className="px-2 py-2 font-medium">Açıklama</th>
            {showActor && <th className="px-2 py-2 font-medium">İşlemi yapan</th>}
            <th className="px-5 py-2 text-right font-medium">Miktar</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap px-5 py-2 text-muted">{formatDate(e.createdAt)}</td>
              <td className="px-2 py-2"><Badge>{LEDGER_TYPES[e.type] ?? e.type}</Badge></td>
              <td className="px-2 py-2">{e.note}{e.jobTitle ? <span className="text-muted"> · {e.jobTitle}</span> : null}</td>
              {showActor && <td className="px-2 py-2 text-muted">{e.actorEmail ?? "–"}</td>}
              <td className={`px-5 py-2 text-right font-medium tabular-nums ${e.delta > 0 ? "text-ok" : e.delta < 0 ? "text-bad" : ""}`}>
                {e.delta > 0 ? `+${e.delta}` : e.delta}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
