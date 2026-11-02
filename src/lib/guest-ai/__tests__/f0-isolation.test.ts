import { describe, expect, it } from "vitest";
import { validateTurnScope, GuestAiScopeError } from "@/lib/guest-ai/data/scope.server";
import { fetchReservationState } from "@/lib/guest-ai/data/reservation.server";
import { fetchListingFacts } from "@/lib/guest-ai/data/listing.server";
import { fetchSensitiveCredentials } from "@/lib/guest-ai/data/credentials.server";
import { GuestAiSecurityError } from "@/lib/guest-ai/trust";
import { SENSITIVE_PROPERTY_COLUMNS } from "@/lib/guest-ai/data/projections";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { IDS, SECRET_VALUES, makeDb } from "./helpers/fixtures";

const ok = { surface: "guide_chat", conversationId: IDS.conv1, messageId: IDS.msg1 } as const;
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "no-error";
  } catch (e) {
    return e instanceof GuestAiScopeError ? e.code : `other:${(e as Error).name}`;
  }
};

describe("F0 · validação do turno (backend não confia em identificadores do canal/cliente)", () => {
  it("aceita guia, WhatsApp e Airbnb coerentes e deriva imóvel e conta do BANCO", async () => {
    const db = makeDb();
    const g = await validateTurnScope({ ...ok }, { db });
    expect(g).toMatchObject({ propertyId: IDS.prop1, tenantId: IDS.owner1, reservationId: IDS.res1, surface: "guide_chat" });
    const w = await validateTurnScope({ surface: "whatsapp", conversationId: IDS.convWa, messageId: IDS.msgWa }, { db });
    expect(w).toMatchObject({ propertyId: IDS.prop1, reservationId: null });
    const a = await validateTurnScope({ surface: "airbnb", conversationId: IDS.convAb, messageId: IDS.msgAb }, { db });
    expect(a.conversationStatus).toBe("needs_human");
  });

  it("o turno emitido é congelado", async () => {
    const t = await validateTurnScope({ ...ok }, { db: makeDb() });
    expect(Object.isFrozen(t)).toBe(true);
  });

  it("entrada inválida: uuid malformado, canal desconhecido, dono esperado malformado, vazio", async () => {
    const db = makeDb();
    expect(await code(validateTurnScope({ ...ok, conversationId: "1' or '1'='1" }, { db }))).toBe("invalid_input");
    expect(await code(validateTurnScope({ ...ok, messageId: "" }, { db }))).toBe("invalid_input");
    expect(await code(validateTurnScope({ ...ok, surface: "sms" as never }, { db }))).toBe("invalid_input");
    expect(await code(validateTurnScope({ ...ok, expectedOwnerId: "nao-e-uuid" }, { db }))).toBe("invalid_input");
    expect(await code(validateTurnScope(null as never, { db }))).toBe("invalid_input");
    expect(db.calls.length).toBe(0); // nada foi consultado com entrada inválida
  });

  it("conversa ou mensagem inexistente", async () => {
    const db = makeDb();
    expect(await code(validateTurnScope({ ...ok, conversationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, { db }))).toBe("conversation_not_found");
    expect(await code(validateTurnScope({ ...ok, messageId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }, { db }))).toBe("message_not_found");
  });

  it("associação incorreta entre mensagem e conversa (ID manipulado): mensagem de OUTRA conta com conversa própria", async () => {
    const db = makeDb();
    expect(await code(validateTurnScope({ ...ok, messageId: IDS.msg2 }, { db }))).toBe("message_conversation_mismatch");
    expect(await code(validateTurnScope({ surface: "guide_chat", conversationId: IDS.conv2, messageId: IDS.msg1 }, { db }))).toBe("message_conversation_mismatch");
  });

  it("só mensagem do HÓSPEDE dispara turno (resposta da equipe e nota interna, nunca) — participante com mais de um papel", async () => {
    const db = makeDb();
    expect(await code(validateTurnScope({ ...ok, messageId: IDS.msgHuman }, { db }))).toBe("message_not_from_guest");
    expect(await code(validateTurnScope({ ...ok, messageId: IDS.msgNote }, { db }))).toBe("message_not_from_guest");
  });

  it("canal validado contra a conversa E a mensagem", async () => {
    const db = makeDb();
    expect(await code(validateTurnScope({ surface: "airbnb", conversationId: IDS.conv1, messageId: IDS.msg1 }, { db }))).toBe("surface_mismatch");
    expect(await code(validateTurnScope({ surface: "guide_chat", conversationId: IDS.convWa, messageId: IDS.msgWa }, { db }))).toBe("surface_mismatch");
    expect(await code(validateTurnScope({ surface: "whatsapp", conversationId: IDS.convAb, messageId: IDS.msgAb }, { db }))).toBe("surface_mismatch");
    // sessão do guia, mas a mensagem foi gravada como airbnb
    const db2 = makeDb();
    (db2.tables["property_chat_messages"] ?? []).find((m) => m["id"] === IDS.msg1)!["channel"] = "airbnb";
    expect(await code(validateTurnScope({ ...ok }, { db: db2 }))).toBe("surface_mismatch");
  });

  it("acesso cruzado entre proprietários: o dono esperado tem de ser o dono REAL do imóvel", async () => {
    const db = makeDb();
    expect(await code(validateTurnScope({ ...ok, expectedOwnerId: IDS.owner2 }, { db }))).toBe("tenant_mismatch");
    expect(await code(validateTurnScope({ surface: "guide_chat", conversationId: IDS.conv2, messageId: IDS.msg2, expectedOwnerId: IDS.owner1 }, { db }))).toBe("tenant_mismatch");
    expect(await code(validateTurnScope({ ...ok, expectedOwnerId: IDS.owner1 }, { db }))).toBe("no-error");
  });

  it("imóvel inexistente ou sem dono", async () => {
    const db = makeDb();
    (db.tables["property_chat_conversations"] ?? []).find((c) => c["id"] === IDS.conv1)!["property_id"] = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaff";
    expect(await code(validateTurnScope({ ...ok }, { db }))).toBe("property_unresolved");
    const db2 = makeDb();
    (db2.tables["properties"] ?? []).find((p) => p["id"] === IDS.prop1)!["owner_id"] = null;
    expect(await code(validateTurnScope({ ...ok }, { db: db2 }))).toBe("property_unresolved");
  });

  it("falha de consulta ⇒ lookup_failed (nunca presume)", async () => {
    const db = makeDb();
    db.failTables.add("property_chat_messages");
    expect(await code(validateTurnScope({ ...ok }, { db }))).toBe("lookup_failed");
  });

  it("nenhuma consulta do escopo lê coluna sensível", async () => {
    const db = makeDb();
    await validateTurnScope({ ...ok }, { db });
    for (const c of SENSITIVE_PROPERTY_COLUMNS) expect(db.touched("properties", c)).toBe(0);
    for (const call of db.calls) expect(call.columns).not.toContain("*");
  });
});

describe("F0 · camada de dados só aceita turno emitido pelo módulo (identificadores forjados)", () => {
  const forged: ValidatedTurn = {
    surface: "guide_chat",
    conversationId: IDS.conv1,
    messageId: IDS.msg1,
    propertyId: IDS.prop2, // imóvel alheio
    tenantId: IDS.owner2,
    guestSessionId: "x",
    conversationStatus: "ai",
    reservationId: IDS.res2,
    messageCreatedAt: null,
  };
  it("fetchReservationState / fetchListingFacts recusam turno forjado sem consultar nada", async () => {
    const db = makeDb();
    await expect(fetchReservationState(forged, { db })).rejects.toBeInstanceOf(GuestAiSecurityError);
    await expect(fetchListingFacts(forged, { includeAddress: true }, { db })).rejects.toBeInstanceOf(GuestAiSecurityError);
    expect(db.calls.length).toBe(0);
  });
  it("fetchSensitiveCredentials recusa grant forjado: não há caminho alternativo para a D9", async () => {
    const db = makeDb();
    const fakeGrant = {
      propertyId: IDS.prop2,
      reservationId: IDS.res2,
      conversationId: IDS.conv1,
      messageId: IDS.msg1,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      policy: { decision: "allow", allowed: true, reason: "within_release_window", evaluatedAt: new Date().toISOString() },
    };
    await expect(fetchSensitiveCredentials(fakeGrant as never, { db })).rejects.toBeInstanceOf(GuestAiSecurityError);
    expect(db.touched("properties")).toBe(0);
  });
});

describe("F0 · isolamento entre imóveis e reservas", () => {
  it("reserva vinculada que pertence a OUTRO imóvel vira conflito, nunca a reserva alheia", async () => {
    const db = makeDb();
    (db.tables["property_chat_conversations"] ?? []).find((c) => c["id"] === IDS.conv1)!["reservation_id"] = IDS.res2;
    const turn = await validateTurnScope({ ...ok }, { db });
    expect(await fetchReservationState(turn, { db })).toEqual({ kind: "conflict", code: "reservation_property_mismatch" });
  });
  it("reservation_id sem reserva correspondente (a coluna não tem chave estrangeira) vira conflito", async () => {
    const db = makeDb();
    (db.tables["property_chat_conversations"] ?? []).find((c) => c["id"] === IDS.conv1)!["reservation_id"] = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbff";
    const turn = await validateTurnScope({ ...ok }, { db });
    expect(await fetchReservationState(turn, { db })).toEqual({ kind: "conflict", code: "reservation_not_found" });
  });
  it("fatos do anúncio e endereço vêm só do imóvel do turno; endereço só com audiência G", async () => {
    const db = makeDb();
    const turn = await validateTurnScope({ ...ok }, { db });
    const pub = await fetchListingFacts(turn, { includeAddress: false }, { db });
    expect(pub.facts.name).toBe("Casa Teste");
    expect(pub.facts.address).toBeNull();
    const act = await fetchListingFacts(turn, { includeAddress: true }, { db });
    expect(act.facts.address).toContain("Rua das Flores");
    expect(JSON.stringify([pub, act])).not.toContain("Casa Alheia");
  });
  it("campos sensíveis não são selecionados nas consultas comuns", async () => {
    const db = makeDb();
    const turn = await validateTurnScope({ ...ok }, { db });
    await fetchReservationState(turn, { db });
    await fetchListingFacts(turn, { includeAddress: true }, { db });
    for (const c of SENSITIVE_PROPERTY_COLUMNS) expect(db.touched("properties", c)).toBe(0);
    expect(JSON.stringify(db.calls)).not.toMatch(/\*/);
    for (const s of SECRET_VALUES) expect(JSON.stringify(db.calls)).not.toContain(s);
  });
});
