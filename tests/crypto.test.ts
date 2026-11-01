import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../worker/lib/crypto";

describe("şifre özeti", () => {
  it("doğru şifreyi kabul eder, yanlışı reddeder", async () => {
    const h = await hashPassword("gizli-sifre-123");
    expect(h.startsWith("pbkdf2$100000$")).toBe(true);
    expect(await verifyPassword("gizli-sifre-123", h)).toBe(true);
    expect(await verifyPassword("yanlis", h)).toBe(false);
  });
});
