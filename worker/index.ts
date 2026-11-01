import { Hono } from "hono";
import type { AppEnv } from "./env";
import { loadUser, sameOrigin } from "./lib/auth";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { jobRoutes } from "./routes/jobs";
import { meRoutes } from "./routes/me";

const app = new Hono<AppEnv>().basePath("/api");

app.use(sameOrigin, loadUser);
app.route("/auth", authRoutes);
app.route("/me", meRoutes);
app.route("/jobs", jobRoutes);
app.route("/admin", adminRoutes);
app.get("/health", (c) => c.json({ ok: true }));
app.get("/config", (c) => c.json({ turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? null }));

app.notFound((c) => c.json({ error: "Bulunamadı." }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Sunucu hatası." }, 500);
});

export default app;
export { TranslateWorkflow } from "./workflow/translate";
