import type { TranslateParams } from "./workflow/translate";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  TRANSLATE: Workflow<TranslateParams>;
  AI: Ai;
  BROWSER: Fetcher;
  ASSETS: Fetcher;

  ADMIN_EMAILS: string;
  APP_URL: string;
  GEMINI_MODEL: string;
  GROQ_MODEL: string;
  WORKERS_AI_MODEL: string;
  MOCK_AI: string;

  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  plan: "credits" | "unlimited";
  plan_expires_at: number | null;
  daily_page_cap: number | null;
  disabled: number;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser | null } };
