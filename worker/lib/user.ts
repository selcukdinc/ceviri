import type { PublicUser } from "../../shared/types";
import type { SessionUser } from "../env";
import { balanceOf, unlimitedActive } from "./credits";

export async function toPublicUser(db: D1Database, u: SessionUser): Promise<PublicUser> {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    plan: u.plan,
    planExpiresAt: u.plan_expires_at,
    balance: await balanceOf(db, u.id),
    unlimitedActive: unlimitedActive(u),
  };
}
