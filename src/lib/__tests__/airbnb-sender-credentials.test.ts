/**
 * Cofre do token da conta remetente do Airbnb (26/11/2026): a Channex passou a mascarar o token ("***");
 * o ConciergeIA guarda o último token real, cifrado, e o envio direto usa o cofre antes da Channex.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { decryptToken, encryptToken, senderTokenKey } from "@/lib/security/sender-crypto.server";
import { getUsableSenderToken, saveSenderCredentials } from "@/lib/airbnb-sender-credentials.server";
import { channelToken } from "@/lib/airbnb-direct-sender.server";

const REAL = "tok_real_1234567890abcdef";

/** Banco falso mínimo para a tabela do cofre. */
function fakeDb(rows: Array<Record<string, unknown>> = []) {
  const updates: Array<Record<string, unknown>> = [];
  const upserts: Array<Record<string, unknown>> = [];
  const q = (table: string) => {
    let filtered = table === "airbnb_sender_credentials" ? [...rows] : [{ owner_id: "tenant-1" }];
    const chain: any = {
      select: () => chain,
      eq: (k: string, v: unknown) => {
        filtered = filtered.filter((r) => !(k in r) || r[k] === v);
        return chain;
      },
      order: () => chain,
      limit: async () => ({ data: filtered, error: null }),
      upsert: async (row: Record<string, unknown>) => {
        upserts.push(row);
        return { error: null };
      },
      update: (row: Record<string, unknown>) => {
        updates.push(row);
        return chain;
      },
      then: (r: (v: unknown) => unknown) => r({ data: filtered, error: null }),
    };
    return chain;
  };
  return { from: q, updates, upserts };
}

describe("Cifra AES-256-GCM", () => {
  it("cifra e decifra de volta; formato iv:tag:payload; cada cifra é diferente", async () => {
    const a = await encryptToken(REAL);
    const b = await encryptToken(REAL);
    expect(a.split(":")).toHaveLength(3);
    expect(a).not.toContain(REAL);
    expect(a).not.toBe(b);
    expect(await decryptToken(a)).toBe(REAL);
  });

  it("dado adulterado ou chave errada ⇒ falha (nunca devolve lixo)", async () => {
    const c = await encryptToken(REAL);
    const [iv, tag, ct] = c.split(":");
    const tampered = `${iv}:${tag}:${Buffer.from("x" + Buffer.from(ct!, "base64").toString("latin1"), "latin1").toString("base64")}`;
    await expect(decryptToken(tampered)).rejects.toThrow();
    await expect(decryptToken(c, { AIRBNB_TOKEN_SECRET: "outra-chave" })).rejects.toThrow();
  });

  it("produção sem chave nenhuma ⇒ não cifra (nunca grava em claro)", () => {
    expect(() => senderTokenKey({ NODE_ENV: "production" })).toThrow();
    expect(senderTokenKey({ APP_USER_CONNECTION_KEY_SECRET: "abc" })).toHaveLength(32);
  });
});

describe("Cofre: leitura e gravação", () => {
  it("não guarda token mascarado", async () => {
    const db = fakeDb();
    expect(await saveSenderCredentials(db, { ownerId: "t", channelId: "sigma", accessToken: "***" })).toBe(false);
    expect(db.upserts).toHaveLength(0);
  });

  it("devolve o token decifrado da conta ativa", async () => {
    const db = fakeDb([{ owner_id: "t", channex_channel_id: "sigma", encrypted_access_token: await encryptToken(REAL), encrypted_refresh_token: null, expires_at: null, status: "active" }]);
    expect(await getUsableSenderToken(db, "sigma")).toBe(REAL);
  });

  it("para vencer: renova com o refresh token e grava o novo", async () => {
    const now = Date.parse("2026-11-26T12:00:00Z");
    const db = fakeDb([
      {
        owner_id: "t",
        channex_channel_id: "sigma",
        encrypted_access_token: await encryptToken(REAL),
        encrypted_refresh_token: await encryptToken("refresh_abcdefghijkl"),
        expires_at: new Date(now + 60_000).toISOString(),
        status: "active",
      },
    ]);
    const refresh = vi.fn(async () => ({ accessToken: "tok_novo_0987654321", refreshToken: null, expiresInSeconds: 3600 }));
    expect(await getUsableSenderToken(db, "sigma", { now: () => now, refresh })).toBe("tok_novo_0987654321");
    expect(refresh).toHaveBeenCalledWith("refresh_abcdefghijkl");
    expect(db.upserts).toHaveLength(1);
    expect(JSON.stringify(db.upserts[0])).not.toContain("tok_novo");
  });

  it("vencido e sem renovação ⇒ null e marca como expirado", async () => {
    const now = Date.parse("2026-11-26T12:00:00Z");
    const db = fakeDb([{ owner_id: "t", channex_channel_id: "sigma", encrypted_access_token: await encryptToken(REAL), encrypted_refresh_token: null, expires_at: new Date(now - 1000).toISOString(), status: "active" }]);
    expect(await getUsableSenderToken(db, "sigma", { now: () => now })).toBeNull();
    expect(db.updates[0]).toMatchObject({ status: "expired" });
  });
});

describe("channelToken: cofre antes da Channex", () => {
  it("usa o cofre e nem consulta a Channex", async () => {
    const channex = vi.fn();
    expect(await channelToken("sigma", { db: fakeDb(), vault: async () => REAL, channex })).toBe(REAL);
    expect(channex).not.toHaveBeenCalled();
  });

  it("sem cofre: Channex mascarada ⇒ null", async () => {
    const channex = vi.fn(async () => ({ data: { attributes: { channel: "AirBNB", settings: { tokens: { access_token: "***" } } } } }));
    expect(await channelToken("sigma", { db: fakeDb(), vault: async () => null, channex })).toBeNull();
  });

  it("sem cofre: Channex com token real ⇒ usa e guarda no cofre (cifrado)", async () => {
    const db = fakeDb();
    const channex = vi.fn(async () => ({ data: { attributes: { channel: "AirBNB", settings: { tokens: { access_token: REAL } } } } }));
    expect(await channelToken("sigma", { db, vault: async () => null, channex })).toBe(REAL);
    expect(db.upserts).toHaveLength(1);
    expect(JSON.stringify(db.upserts[0])).not.toContain(REAL);
  });
});

describe("Isolamento da tabela (RLS)", () => {
  const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261127000000_airbnb_sender_credentials.sql"), "utf8");
  it("RLS ligada, sem policy, acesso só do service_role", () => {
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/revoke all on public\.airbnb_sender_credentials from public, anon, authenticated/i);
    expect(sql).toMatch(/grant all on public\.airbnb_sender_credentials to service_role/i);
  });
});
