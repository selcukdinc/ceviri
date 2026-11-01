import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireRole } from "../lib/auth";

export const meRoutes = new Hono<AppEnv>().use(requireRole("user")).get("/ledger", async (c) => {
  const user = c.get("user")!;
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.delta, l.type, l.note, l.job_id AS jobId, l.created_at AS createdAt, j.title AS jobTitle
       FROM credit_ledger l LEFT JOIN jobs j ON j.id = l.job_id
      WHERE l.user_id = ? ORDER BY l.created_at DESC LIMIT 200`,
  )
    .bind(user.id)
    .all();
  return c.json({ entries: results });
});
