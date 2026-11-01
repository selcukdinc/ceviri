import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { JobSummary } from "../../shared/types";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Modal, Select, Stat, Tabs } from "../components/ui";
import { api, formatDate } from "../lib/api";
import { useAuth } from "../lib/auth";
import { LedgerTable, STATUS } from "./Dashboard";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  plan: "credits" | "unlimited";
  planExpiresAt: number | null;
  dailyPageCap: number | null;
  disabled: number;
  createdAt: number;
  balance: number;
  jobCount: number;
  pagesDone: number;
}

type Tab = "users" | "jobs" | "providers" | "settings" | "status";

export default function Admin() {
  const [tab, setTab] = useState<Tab>("users");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Yönetim</h1>
        <Tabs value={tab} onChange={setTab} items={[
          { value: "users", label: "Kullanıcılar" },
          { value: "jobs", label: "İşler" },
          { value: "providers", label: "Sağlayıcılar" },
          { value: "settings", label: "Kredi ve limitler" },
          { value: "status", label: "Durum" },
        ]} />
      </div>
      {tab === "users" && <Users />}
      {tab === "jobs" && <Jobs />}
      {tab === "providers" && <Providers />}
      {tab === "settings" && <Settings />}
      {tab === "status" && <Status />}
    </div>
  );
}

function planLabel(u: AdminUser) {
  if (u.plan !== "unlimited") return null;
  const active = u.planExpiresAt == null || u.planExpiresAt > Date.now();
  return <Badge tone={active ? "ok" : "warn"}>{active ? "Sınırsız" : "Sınırsız (süresi doldu)"}</Badge>;
}

function Users() {
  const { user: me, refresh } = useAuth();
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [modal, setModal] = useState<{ kind: "credits" | "plan" | "ledger"; user: AdminUser } | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const r = await api<{ users: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q)}`);
    setUsers(r.users);
  }, [q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  async function act(path: string, json: unknown) {
    setError(undefined);
    try {
      await api(path, { method: "POST", json });
      await load();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Kullanıcılar"
        desc="Yeni hesaplar 0 kredi ile açılır. Kredi yükleyin veya sınırsız plan tanımlayın."
        action={<Input placeholder="E-posta veya ad ara" value={q} onChange={(e) => setQ(e.target.value)} className="w-64 max-w-full" />}
      />
      {error && <div className="px-5 pt-4"><Alert>{error}</Alert></div>}
      {!users ? (
        <p className="p-5 text-sm text-muted">Yükleniyor…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="px-5 py-2 font-medium">Kullanıcı</th>
                <th className="px-2 py-2 font-medium">Durum</th>
                <th className="px-2 py-2 text-right font-medium">Bakiye</th>
                <th className="px-2 py-2 text-right font-medium">İş / sayfa</th>
                <th className="px-5 py-2 text-right font-medium">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => (
                <tr key={u.id} className={u.disabled ? "opacity-60" : ""}>
                  <td className="px-5 py-3">
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-muted">{u.email} · {formatDate(u.createdAt)}</div>
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.role === "admin" && <Badge tone="accent">Admin</Badge>}
                      {planLabel(u)}
                      {u.disabled ? <Badge tone="bad">Devre dışı</Badge> : null}
                    </div>
                  </td>
                  <td className="px-2 py-3 text-right font-medium tabular-nums">{u.balance}</td>
                  <td className="px-2 py-3 text-right tabular-nums text-muted">{u.jobCount} / {u.pagesDone}</td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button size="sm" onClick={() => setModal({ kind: "credits", user: u })}>Kredi</Button>
                      <Button size="sm" variant="secondary" onClick={() => setModal({ kind: "plan", user: u })}>Plan</Button>
                      <Button size="sm" variant="ghost" onClick={() => setModal({ kind: "ledger", user: u })}>Geçmiş</Button>
                      {u.id !== me?.id && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => act(`/admin/users/${u.id}/role`, { role: u.role === "admin" ? "user" : "admin" })}>
                            {u.role === "admin" ? "Admin'liği al" : "Admin yap"}
                          </Button>
                          <Button size="sm" variant="ghost" className={u.disabled ? "" : "text-bad"} onClick={() => act(`/admin/users/${u.id}/disable`, { disabled: !u.disabled })}>
                            {u.disabled ? "Etkinleştir" : "Devre dışı"}
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && <p className="p-5 text-sm text-muted">Kullanıcı bulunamadı.</p>}
        </div>
      )}

      {modal?.kind === "credits" && (
        <CreditModal user={modal.user} onClose={() => setModal(null)} onDone={async () => { setModal(null); await load(); await refresh(); }} />
      )}
      {modal?.kind === "plan" && (
        <PlanModal user={modal.user} onClose={() => setModal(null)} onDone={async () => { setModal(null); await load(); await refresh(); }} />
      )}
      {modal?.kind === "ledger" && <LedgerModal user={modal.user} onClose={() => setModal(null)} />}
    </Card>
  );
}

function CreditModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const presets = [25, 50, 100, 250, 500];
  const [amount, setAmount] = useState("100");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const sign = f.get("mode") === "remove" ? -1 : 1;
      await api(`/admin/users/${user.id}/credits`, { method: "POST", json: { amount: sign * Number(amount), note: f.get("note") } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Kredi: ${user.name}`}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">Mevcut bakiye: <b className="text-ink">{user.balance}</b> kredi</p>
        <Field label="İşlem">
          <Select name="mode" defaultValue="add">
            <option value="add">Kredi ekle</option>
            <option value="remove">Kredi düş</option>
          </Select>
        </Field>
        <Field label="Miktar" hint="Yaklaşık 1 kredi = 1 metin sayfası; 80 sayfalık görselli sunum ≈ 100 kredi">
          <Input type="number" min={1} max={1000000} value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <Button key={p} type="button" size="sm" variant="secondary" onClick={() => setAmount(String(p))}>{p}</Button>
          ))}
        </div>
        <Field label="Not"><Input name="note" placeholder="Örn. Dönem başı tanımlama" maxLength={200} /></Field>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Vazgeç</Button>
          <Button type="submit" loading={busy}>Kaydet</Button>
        </div>
      </form>
    </Modal>
  );
}

function toDateInput(ms: number | null) {
  return ms ? new Date(ms).toISOString().slice(0, 10) : "";
}

function PlanModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const [plan, setPlan] = useState(user.plan);
  const [expires, setExpires] = useState(toDateInput(user.planExpiresAt));
  const [cap, setCap] = useState(user.dailyPageCap ? String(user.dailyPageCap) : "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/admin/users/${user.id}/plan`, {
        method: "POST",
        json: {
          plan,
          expiresAt: expires ? new Date(`${expires}T23:59:59`).getTime() : null,
          dailyPageCap: cap ? Number(cap) : null,
        },
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Plan: ${user.name}`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Plan">
          <Select value={plan} onChange={(e) => setPlan(e.target.value as AdminUser["plan"])}>
            <option value="credits">Kredili (bakiyeden düşer)</option>
            <option value="unlimited">Sınırsız (kredi düşmez)</option>
          </Select>
        </Field>
        {plan === "unlimited" && (
          <>
            <Field label="Bitiş tarihi" hint="Boş bırakılırsa süresiz">
              <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </Field>
            <Field label="Günlük sayfa tavanı" hint="Boş bırakılırsa genel ayar kullanılır; ücretsiz API kotalarını korur">
              <Input type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} />
            </Field>
          </>
        )}
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Vazgeç</Button>
          <Button type="submit" loading={busy}>Kaydet</Button>
        </div>
      </form>
    </Modal>
  );
}

function LedgerModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [entries, setEntries] = useState<Parameters<typeof LedgerTable>[0]["entries"] | null>(null);
  useEffect(() => {
    api<{ entries: Parameters<typeof LedgerTable>[0]["entries"] }>(`/admin/users/${user.id}/ledger`).then((r) => setEntries(r.entries));
  }, [user.id]);
  return (
    <Modal open onClose={onClose} title={`Kredi geçmişi: ${user.name}`}>
      <div className="-mx-5 -mb-5 max-h-[60vh] overflow-y-auto">
        {!entries ? <p className="p-5 text-sm text-muted">Yükleniyor…</p> : entries.length ? <LedgerTable entries={entries} showActor /> : <p className="p-5 text-sm text-muted">Hareket yok.</p>}
      </div>
    </Modal>
  );
}

function Jobs() {
  const [jobs, setJobs] = useState<(JobSummary & { userEmail: string })[] | null>(null);
  useEffect(() => {
    const load = () => api<{ jobs: (JobSummary & { userEmail: string })[] }>("/admin/jobs").then((r) => setJobs(r.jobs));
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);
  return (
    <Card>
      <CardHeader title="Son işler" desc="Tüm kullanıcıların son 100 çevirisi" />
      {!jobs ? (
        <p className="p-5 text-sm text-muted">Yükleniyor…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="px-5 py-2 font-medium">İş</th>
                <th className="px-2 py-2 font-medium">Kullanıcı</th>
                <th className="px-2 py-2 font-medium">Durum</th>
                <th className="px-2 py-2 font-medium">Sağlayıcı</th>
                <th className="px-5 py-2 text-right font-medium">Kredi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="px-5 py-2">
                    <a href={`/panel/is/${j.id}`} className="font-medium hover:underline">{j.title}</a>
                    <div className="text-xs text-muted">{formatDate(j.createdAt)} · {j.pageCount} sayfa</div>
                    {j.error && <div className="mt-1 max-w-md truncate text-xs text-bad" title={j.error}>{j.error}</div>}
                  </td>
                  <td className="px-2 py-2 text-muted">{j.userEmail}</td>
                  <td className="px-2 py-2">
                    <Badge tone={STATUS[j.status].tone}>{STATUS[j.status].label}{j.status !== "done" && j.status !== "failed" ? ` %${j.progress}` : ""}</Badge>
                  </td>
                  <td className="px-2 py-2 text-muted">{j.provider ?? "–"}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{j.unlimited ? "∞" : j.charged ?? j.estimate}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {jobs.length === 0 && <p className="p-5 text-sm text-muted">Henüz iş yok.</p>}
        </div>
      )}
    </Card>
  );
}

interface SettingRow { key: string; label: string; min: number; max: number; value: number }
const PROVIDER_NAMES: Record<string, string> = { gemini: "Google Gemini (PDF'i doğrudan okur)", groq: "Groq (metin)", workersai: "Workers AI (metin)" };

function Settings() {
  const [rows, setRows] = useState<SettingRow[] | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string }>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ settings: SettingRow[]; providerOrder: string[] }>("/admin/settings").then((r) => {
      setRows(r.settings);
      setOrder(r.providerOrder);
    });
  }, []);

  async function save() {
    if (!rows) return;
    setBusy(true);
    setMsg(undefined);
    try {
      await api("/admin/settings", { method: "PUT", json: { values: Object.fromEntries(rows.map((r) => [r.key, r.value])), providerOrder: order } });
      setMsg({ tone: "ok", text: "Kaydedildi." });
    } catch (e) {
      setMsg({ tone: "bad", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return <p className="text-muted">Yükleniyor…</p>;
  const all = ["gemini", "groq", "workersai"];
  const w = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const example = Math.ceil(w["credit.job_base"] + 40 * w["credit.text_page"] + 40 * w["credit.image_page"]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Kredi ağırlıkları ve limitler" desc={`Örnek: 80 sayfalık, yarısı görselli sunu ≈ ${example} kredi`} />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {rows.map((r, i) => (
            <Field key={r.key} label={r.label} hint={`${r.min}–${r.max}`}>
              <Input
                type="number"
                step="0.5"
                min={r.min}
                max={r.max}
                value={r.value}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)))}
              />
            </Field>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="Çeviri sağlayıcı sırası" desc="Kota dolduğunda veya hata olduğunda sıradaki sağlayıcıya geçilir." />
        <ul className="space-y-2 p-5">
          {all.map((p) => {
            const idx = order.indexOf(p);
            const on = idx >= 0;
            return (
              <li key={p} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setOrder(on ? order.filter((x) => x !== p) : [...order, p])}
                  className="size-4 accent-[var(--color-accent)]"
                  aria-label={PROVIDER_NAMES[p]}
                />
                <span className="flex-1 text-sm">{on ? <b className="mr-2 tabular-nums">{idx + 1}.</b> : null}{PROVIDER_NAMES[p]}</span>
                {on && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={idx === 0} onClick={() => { const o = [...order]; [o[idx - 1], o[idx]] = [o[idx], o[idx - 1]]; setOrder(o); }} aria-label="Yukarı">↑</Button>
                    <Button size="sm" variant="ghost" disabled={idx === order.length - 1} onClick={() => { const o = [...order]; [o[idx + 1], o[idx]] = [o[idx], o[idx + 1]]; setOrder(o); }} aria-label="Aşağı">↓</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      <div className="flex items-center gap-3 lg:col-span-2">
        <Button onClick={save} loading={busy}>Ayarları kaydet</Button>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      </div>
    </div>
  );
}

interface StatsResp {
  usage: { day: string; provider: string; requests: number; failures: number }[];
  totals: { users: number; jobs: number; running: number; pages: number; creditsSpent: number; creditsGranted: number };
  configured: Record<string, boolean>;
}

function Status() {
  const [s, setS] = useState<StatsResp | null>(null);
  useEffect(() => {
    api<StatsResp>("/admin/stats").then(setS);
  }, []);
  if (!s) return <p className="text-muted">Yükleniyor…</p>;
  const days = [...new Set(s.usage.map((u) => u.day))].sort().reverse();
  const providers = ["gemini", "groq", "workersai", "mock"].filter((p) => s.usage.some((u) => u.provider === p));
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Kullanıcı" value={s.totals.users} />
        <Stat label="İş" value={s.totals.jobs} />
        <Stat label="Devam eden" value={s.totals.running} />
        <Stat label="Çevrilen sayfa" value={s.totals.pages} />
        <Stat label="Yüklenen kredi" value={s.totals.creditsGranted} />
        <Stat label="Harcanan kredi" value={s.totals.creditsSpent} />
      </div>
      <Card>
        <CardHeader title="Yapılandırma" />
        <div className="flex flex-wrap gap-2 p-5">
          {Object.entries({ gemini: "Gemini anahtarı", groq: "Groq anahtarı", workersai: "Workers AI", turnstile: "Turnstile", mock: "Sahte sağlayıcı (MOCK_AI)" }).map(([k, label]) => (
            <Badge key={k} tone={k === "mock" ? (s.configured[k] ? "warn" : "neutral") : s.configured[k] ? "ok" : "bad"}>
              {label}: {s.configured[k] ? "açık" : "yok"}
            </Badge>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="Sağlayıcı kullanımı (son 14 gün)" desc="İstek / başarısız. Ücretsiz kotaları izlemek için." />
        {days.length === 0 ? (
          <p className="p-5 text-sm text-muted">Henüz kayıt yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-2 font-medium">Gün</th>
                  {providers.map((p) => <th key={p} className="px-5 py-2 text-right font-medium">{p}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {days.map((d) => (
                  <tr key={d}>
                    <td className="px-5 py-2 tabular-nums">{d}</td>
                    {providers.map((p) => {
                      const u = s.usage.find((x) => x.day === d && x.provider === p);
                      return (
                        <td key={p} className="px-5 py-2 text-right tabular-nums">
                          {u ? <>{u.requests}{u.failures ? <span className="text-bad"> / {u.failures}</span> : null}</> : "–"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

interface ProviderInfo {
  id: string;
  name: string;
  secret: string;
  model: string;
  keyPresent: boolean;
  quotaUrl: string;
  quotaHint: string;
  position: number | null;
  todayRequests: number;
  todayFailures: number;
  lastOkAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  quotaInfo: string | null;
  quotaInfoAt: number | null;
  rateLimitedUntil: number | null;
}

function ModelPicker({ provider, onSaved }: { provider: ProviderInfo; onSaved: () => void }) {
  const [value, setValue] = useState(provider.model);
  const [models, setModels] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string }>();
  const [busy, setBusy] = useState<"list" | "save" | null>(null);
  const listId = `models-${provider.id}`;
  const canList = provider.id !== "workersai" && provider.keyPresent;

  async function fetchModels() {
    setBusy("list");
    setMsg(undefined);
    try {
      setModels((await api<{ models: string[] }>(`/admin/providers/${provider.id}/models`)).models);
    } catch (e) {
      setMsg({ tone: "bad", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setMsg(undefined);
    try {
      await api(`/admin/providers/${provider.id}/model`, { method: "POST", json: { model: value.trim() } });
      setMsg({ tone: "ok", text: "Kaydedildi. Test et ile doğrulayın." });
      onSaved();
    } catch (e) {
      setMsg({ tone: "bad", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <Field label="Model">
        <Input list={listId} value={value} onChange={(e) => setValue(e.target.value)} className="font-mono text-xs" spellCheck={false} />
        <datalist id={listId}>{models?.map((m) => <option key={m} value={m} />)}</datalist>
      </Field>
      <div className="flex flex-wrap gap-2">
        {canList && <Button size="sm" variant="ghost" onClick={fetchModels} loading={busy === "list"}>Modelleri getir{models ? ` (${models.length})` : ""}</Button>}
        <Button size="sm" variant="secondary" onClick={save} loading={busy === "save"} disabled={!value.trim() || value.trim() === provider.model}>Modeli kaydet</Button>
      </div>
      {models && <p className="text-xs text-muted">Alana tıklayınca anahtarınızın erişebildiği modeller listelenir.</p>}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </div>
  );
}

function Providers() {
  const [data, setData] = useState<{ providers: ProviderInfo[]; mock: boolean } | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; ms: number; message: string } | "running">>({});

  const load = useCallback(async () => setData(await api("/admin/providers")), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function test(id: string) {
    setTests((t) => ({ ...t, [id]: "running" }));
    try {
      const r = await api<{ ok: boolean; ms: number; message: string }>(`/admin/providers/${id}/test`, { method: "POST" });
      setTests((t) => ({ ...t, [id]: r }));
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { ok: false, ms: 0, message: (e as Error).message } }));
    }
    await load();
  }

  if (!data) return <p className="text-muted">Yükleniyor…</p>;
  return (
    <div className="space-y-4">
      {data.mock && <Alert tone="warn">MOCK_AI=1: gerçek sağlayıcılar yerine sahte sağlayıcı kullanılıyor.</Alert>}
      <p className="text-sm text-muted">
        Çeviri sırayla ilk çalışan sağlayıcıyla yapılır. Bir sağlayıcı hata verirse (kota, anahtar, model) sıradakine geçilir; nedeni burada ve her işin detayında görünür.
        "Test et" küçük bir gerçek istek gönderir.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        {data.providers.map((p) => {
          const t = tests[p.id];
          return (
            <Card key={p.id}>
              <CardHeader
                title={p.name}
                desc={p.secret}
                action={p.position ? <Badge tone="accent">{p.position}. sırada</Badge> : <Badge>Sırada değil</Badge>}
              />
              <div className="space-y-3 p-5 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge tone={p.keyPresent ? "ok" : "bad"}>{p.keyPresent ? "Anahtar tanımlı" : `${p.secret} yok`}</Badge>
                  {p.rateLimitedUntil && <Badge tone="warn">Kota beklemesinde · {new Date(p.rateLimitedUntil).toLocaleTimeString("tr-TR")}'e kadar</Badge>}
                </div>
                <ModelPicker key={p.model} provider={p} onSaved={load} />
                <dl className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-surface-2 px-3 py-2"><dt className="text-xs text-muted">Bugün istek</dt><dd className="text-lg font-semibold tabular-nums">{p.todayRequests}</dd></div>
                  <div className="rounded-lg bg-surface-2 px-3 py-2"><dt className="text-xs text-muted">Bugün hata</dt><dd className={`text-lg font-semibold tabular-nums ${p.todayFailures ? "text-bad" : ""}`}>{p.todayFailures}</dd></div>
                </dl>
                {p.quotaInfo && (
                  <p className="text-xs"><b>Kota:</b> {p.quotaInfo} <span className="text-muted">({p.quotaInfoAt ? formatDate(p.quotaInfoAt) : ""})</span></p>
                )}
                <p className="text-xs text-muted">
                  {p.quotaHint}{" "}
                  <a href={p.quotaUrl} target="_blank" rel="noreferrer" className="text-accent underline">Kota panelini aç</a>
                </p>
                {p.lastError && (
                  <div className="rounded-lg bg-bad-soft p-3 text-xs text-bad">
                    <div className="font-medium">Son hata{p.lastErrorAt ? ` · ${formatDate(p.lastErrorAt)}` : ""}</div>
                    <div className="mt-1 break-words">{p.lastError}</div>
                  </div>
                )}
                {p.lastOkAt && <p className="text-xs text-muted">Son başarılı çağrı: {formatDate(p.lastOkAt)}</p>}
                {t && t !== "running" && (
                  <Alert tone={t.ok ? "ok" : "bad"}>
                    {t.ok ? "✓ " : "✗ "}{t.message}{t.ms ? ` (${t.ms} ms)` : ""}
                  </Alert>
                )}
                <Button variant="secondary" size="sm" onClick={() => test(p.id)} loading={t === "running"}>Test et</Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
