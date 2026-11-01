import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { PublicUser } from "../../shared/types";
import { Alert, Button, Card, Field, Input } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, o: { sitekey: string; callback: (t: string) => void }) => void };
  }
}

function useTurnstile() {
  const [token, setToken] = useState<string>();
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    api<{ turnstileSiteKey: string | null }>("/config").then((c) => setSiteKey(c.turnstileSiteKey)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!siteKey || !el.current) return;
    const render = () => window.turnstile?.render(el.current!, { sitekey: siteKey, callback: setToken });
    if (window.turnstile) return render();
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }, [siteKey]);
  return { token, widget: siteKey ? <div ref={el} /> : null, required: !!siteKey };
}

function AuthShell({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md">
      <Card className="p-6 sm:p-8">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted">{desc}</p>
        <div className="mt-6">{children}</div>
      </Card>
    </div>
  );
}

export function Login() {
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ user: PublicUser }>("/auth/login", { method: "POST", json: { email: f.get("email"), password: f.get("password") } });
      setUser(r.user);
      nav(params.get("next") || "/panel");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Giriş yap" desc="Otomatik çeviri ve geçmişinize erişmek için giriş yapın.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="E-posta"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Şifre"><Input name="password" type="password" autoComplete="current-password" required /></Field>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" loading={busy} className="w-full">Giriş yap</Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted">
        Hesabınız yok mu? <Link to="/kayit" className="font-medium text-accent">Kayıt olun</Link>
      </p>
    </AuthShell>
  );
}

export function Register() {
  const { setUser } = useAuth();
  const nav = useNavigate();
  const ts = useTurnstile();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("password2")) return setError("Şifreler eşleşmiyor.");
    if (ts.required && !ts.token) return setError("Lütfen robot doğrulamasını tamamlayın.");
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ user: PublicUser }>("/auth/register", {
        method: "POST",
        json: { name: f.get("name"), email: f.get("email"), password: f.get("password"), turnstile: ts.token },
      });
      setUser(r.user);
      nav("/panel");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Hesap oluştur" desc="Yeni hesaplar 0 kredi ile açılır; kredi tanımlaması admin tarafından yapılır.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Ad soyad"><Input name="name" autoComplete="name" required minLength={2} /></Field>
        <Field label="E-posta"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Şifre" hint="En az 8 karakter"><Input name="password" type="password" autoComplete="new-password" required minLength={8} /></Field>
        <Field label="Şifre (tekrar)"><Input name="password2" type="password" autoComplete="new-password" required minLength={8} /></Field>
        {ts.widget}
        {error && <Alert>{error}</Alert>}
        <Button type="submit" loading={busy} className="w-full">Kayıt ol</Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted">
        Zaten hesabınız var mı? <Link to="/giris" className="font-medium text-accent">Giriş yapın</Link>
      </p>
    </AuthShell>
  );
}
