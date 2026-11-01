import type { SessionUser } from "../env";
import { newId } from "./crypto";

export async function balanceOf(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(delta), 0) AS b FROM credit_ledger WHERE user_id = ?")
    .bind(userId)
    .first<{ b: number }>();
  return row?.b ?? 0;
}

export function unlimitedActive(u: Pick<SessionUser, "plan" | "plan_expires_at">, now = Date.now()): boolean {
  return u.plan === "unlimited" && (u.plan_expires_at == null || u.plan_expires_at > now);
}

/**
 * Bakiye yeterliyse tek bir atomik ifadeyle rezerv kaydı ekler.
 * D1 tek yazıcılı olduğu için koşul ve ekleme aynı ifadede güvenlidir.
 */
export async function tryReserve(db: D1Database, userId: string, amount: number, jobId: string): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO credit_ledger (id, user_id, delta, type, job_id, note, created_at)
       SELECT ?1, ?2, ?3, 'reserve', ?4, 'Çeviri için rezerv', ?5
       WHERE (SELECT COALESCE(SUM(delta), 0) FROM credit_ledger WHERE user_id = ?2) >= ?6`,
    )
    .bind(newId(), userId, -amount, jobId, Date.now(), amount)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export function ledgerInsert(
  db: D1Database,
  e: { userId: string; delta: number; type: string; jobId?: string | null; note?: string | null; actorId?: string | null },
) {
  return db
    .prepare(
      "INSERT INTO credit_ledger (id, user_id, delta, type, job_id, note, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(newId(), e.userId, e.delta, e.type, e.jobId ?? null, e.note ?? null, e.actorId ?? null, Date.now());
}

/** Günün (UTC) sınırsız plan kapsamında işlenen sayfa toplamı. */
export async function unlimitedPagesToday(db: D1Database, userId: string): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const row = await db
    .prepare(
      "SELECT COALESCE(SUM(page_count), 0) AS n FROM jobs WHERE user_id = ? AND unlimited = 1 AND status != 'failed' AND created_at >= ?",
    )
    .bind(userId, start.getTime())
    .first<{ n: number }>();
  return row?.n ?? 0;
}
