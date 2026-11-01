import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { applyTheme, getTheme, type Theme } from "../lib/theme";
import { Badge, cx } from "./ui";

function NavItem({ to, children }: { to: string; children: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cx("rounded-md px-3 py-1.5 text-sm font-medium transition", isActive ? "bg-surface-2 text-ink" : "text-muted hover:text-ink")
      }
    >
      {children}
    </NavLink>
  );
}

export function CreditBadge() {
  const { user } = useAuth();
  if (!user) return null;
  return user.unlimitedActive ? <Badge tone="ok">Sınırsız plan</Badge> : <Badge tone={user.balance > 0 ? "accent" : "warn"}>{user.balance} kredi</Badge>;
}

export function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [theme, setTheme] = useState<Theme>(getTheme());
  useEffect(() => applyTheme(theme), [theme]);
  const nextTheme: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const themeLabel: Record<Theme, string> = { system: "Sistem", light: "Açık", dark: "Koyu" };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <Link to="/" className="mr-2 flex items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="size-7" />
            <span>Çeviri</span>
          </Link>
          <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
            <NavItem to="/arac">Prompt aracı</NavItem>
            {user && <NavItem to="/panel">Panel</NavItem>}
            {user?.role === "admin" && <NavItem to="/admin">Admin</NavItem>}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setTheme(nextTheme[theme])}
              className="hidden rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 sm:block cursor-pointer"
              title="Tema"
            >
              Tema: {themeLabel[theme]}
            </button>
            {user ? (
              <>
                <span className="hidden sm:inline"><CreditBadge /></span>
                <button
                  onClick={async () => {
                    await logout();
                    nav("/");
                  }}
                  className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink cursor-pointer"
                >
                  Çıkış
                </button>
              </>
            ) : (
              <>
                <Link to="/giris" className="rounded-md px-3 py-1.5 text-sm font-medium text-muted hover:text-ink">Giriş</Link>
                <Link to="/kayit" className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90">Kayıt ol</Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-line py-6 text-center text-xs text-muted">
        ceviri.selcukdinc.dev · PDF'ler misafir modunda tarayıcınızdan çıkmaz
      </footer>
    </div>
  );
}
