/**
 * MEMÓRIA DO HÓSPEDE — leitura do perfil (duas portas), bloco do prompt, cadeia e extração da conta OTA.
 * Banco falso em memória; a migration é provada contra PostgreSQL real em `guest-profile-pg.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  GUEST_NOTE_MAX,
  fetchGuestProfile,
  normalizeGuestPhone,
  type GuestProfileLoad,
} from "@/lib/guest-ai/data/guest-profile.server";
import { GuestAiAbortedError, type GuestAiDb } from "@/lib/guest-ai/data/client.server";
import {
  GUEST_IDENTITY_COLUMNS,
  GUEST_PROFILE_ANCHOR_COLUMNS,
  GUEST_PROFILE_COLUMNS,
} from "@/lib/guest-ai/data/projections";
import { buildGuestProfileContext } from "@/lib/guest-ai/context/guest-profile";
import { composeTurnPrompt } from "@/lib/guest-ai/composer";
import { GUEST_PROFILE_TAG, buildSystemPrompt } from "@/lib/guest-ai/system-prompt";
import { issue, GuestAiSecurityError } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { otaGuestAccountId } from "@/lib/channex-guest-identity";
import { ctx, history } from "./helpers/b23-chain";
import { TEST_GUARD } from "./helpers/b21-fixtures";

const T = "a1000000-0000-4000-8000-000000000001";
const PROP = "b1000000-0000-4000-8000-000000000001";
const RES = "r1000000-0000-4000-8000-000000000001";
const P1 = "f1000000-0000-4000-8000-000000000001";
const P2 = "f2000000-0000-4000-8000-000000000002";

const base: ValidatedTurn = {
  surface: "airbnb",
  conversationId: "c1",
  messageId: "m1",
  propertyId: PROP,
  tenantId: T,
  guestSessionId: "airbnb:thread-1",
  conversationStatus: "ai",
  reservationId: RES,
  messageCreatedAt: null,
};
const turn = (over: Partial<ValidatedTurn> = {}) =>
  issue("turn", { ...base, ...over }) as ValidatedTurn;

type Call = {
  table: string;
  select?: string;
  eq: Array<[string, unknown]>;
  in: Array<[string, unknown[]]>;
};
type Resp = { data?: unknown; error?: unknown };
function fakeDb(tables: {
  reservation?: Resp;
  identities?: Resp;
  profile?: Resp;
  throwOn?: string;
}) {
  const calls: Call[] = [];
  const db: GuestAiDb = {
    from(table: string) {
      if (tables.throwOn === table) throw new Error("rede");
      const c: Call = { table, eq: [], in: [] };
      calls.push(c);
      const resp = (): Resp =>
        (table === "property_reservations"
          ? tables.reservation
          : table === "guest_ai_guest_identities"
            ? tables.identities
            : tables.profile) ?? { data: null, error: null };
      const q: Record<string, unknown> = {
        select(s: string) {
          c.select = s;
          return q;
        },
        eq(k: string, v: unknown) {
          c.eq.push([k, v]);
          return q;
        },
        in(k: string, v: unknown[]) {
          c.in.push([k, v]);
          return Promise.resolve({ data: resp().data ?? null, error: resp().error ?? null });
        },
        maybeSingle() {
          return Promise.resolve({ data: resp().data ?? null, error: resp().error ?? null });
        },
      };
      return q;
    },
  };
  return { db, calls };
}
const profileRow = (over: Record<string, unknown> = {}) => ({
  canonical_id: P1,
  tenant_id: T,
  stay_count: 3,
  last_stay_checkout: "2026-05-10",
  behavioral_notes: [
    { categoria: "preferencia", texto: "Pede travesseiros extras" },
    { categoria: "rotina", texto: "Trabalha remoto; precisa de Wi-Fi estável" },
  ],
  ...over,
});
const ident = (canonical: string, kind: string, value: string, status = "active") => ({
  canonical_id: canonical,
  kind,
  value,
  status,
});

describe("Memória do hóspede · fetchGuestProfile (duas portas)", () => {
  it("projeções sem nome, e-mail, código ou valores; âncoras só da reserva DO IMÓVEL do turno", async () => {
    for (const forbidden of ["guest_name", "phones", "ota_account_ids"])
      expect(GUEST_PROFILE_COLUMNS as readonly string[]).not.toContain(forbidden);
    expect(GUEST_PROFILE_ANCHOR_COLUMNS.join(",")).not.toMatch(/names|emails|code|amount|payment/);
    const { db, calls } = fakeDb({
      reservation: {
        data: { id: RES, property_id: PROP, ota_guest_id: "airbnb:123", phones: ["5547999990001"] },
      },
      identities: { data: [ident(P1, "ota", "airbnb:123")] },
      profile: { data: profileRow() },
    });
    const r = await fetchGuestProfile(turn(), { db });
    expect(r).toEqual({
      status: "found",
      via: "ota",
      stayCount: 3,
      lastStayCheckout: "2026-05-10",
      notes: [
        { categoria: "preferencia", texto: "Pede travesseiros extras" },
        { categoria: "rotina", texto: "Trabalha remoto; precisa de Wi-Fi estável" },
      ],
    });
    expect(calls[0]).toMatchObject({
      table: "property_reservations",
      select: GUEST_PROFILE_ANCHOR_COLUMNS.join(", "),
    });
    expect(calls[0]!.eq).toEqual([
      ["id", RES],
      ["property_id", PROP],
    ]);
    expect(calls[1]).toMatchObject({
      table: "guest_ai_guest_identities",
      select: GUEST_IDENTITY_COLUMNS.join(", "),
    });
    expect(calls[1]!.eq).toEqual([["tenant_id", T]]);
    expect(calls[1]!.in).toEqual([["value", ["airbnb:123", "+5547999990001"]]]);
    expect(calls[2]!.eq).toEqual([
      ["canonical_id", P1],
      ["tenant_id", T],
    ]);
  });

  it("Porta 1 tem prioridade: conta OTA identifica mesmo com telefone de outro perfil", async () => {
    const { db } = fakeDb({
      reservation: { data: { ota_guest_id: "AIRBNB:123", phones: ["5547999990009"] } },
      identities: { data: [ident(P1, "ota", "airbnb:123"), ident(P2, "phone", "+5547999990009")] },
      profile: { data: profileRow() },
    });
    expect(await fetchGuestProfile(turn(), { db })).toMatchObject({ status: "found", via: "ota" });
  });

  it("WhatsApp: é o titular só se o número da sessão for EXATAMENTE o telefone oficial do titular da reserva", async () => {
    const titular = fakeDb({
      reservation: { data: { ota_guest_id: "airbnb:777", phones: ["+55 47 99999-0002"] } },
      identities: { data: [ident(P1, "ota", "airbnb:777")] },
      profile: { data: profileRow() },
    });
    const wa = turn({ surface: "whatsapp", guestSessionId: "wa:5547999990002" });
    expect(await fetchGuestProfile(wa, { db: titular.db })).toMatchObject({
      status: "found",
      via: "ota",
    });
    // o telefone da sessão nunca é usado para procurar perfil: só as identidades do titular
    expect(titular.calls[1]!.in).toEqual([["value", ["airbnb:777", "+5547999990002"]]]);
  });

  it("WhatsApp de outro número numa reserva vinculada pelo código ⇒ acompanhante: nenhum perfil é consultado", async () => {
    const { db, calls } = fakeDb({
      reservation: { data: { ota_guest_id: "airbnb:777", phones: ["5547999990002"] } },
      identities: { data: [ident(P1, "ota", "airbnb:777"), ident(P2, "phone", "+5547900000000")] },
      profile: { data: profileRow() },
    });
    const acompanhante = turn({ surface: "whatsapp", guestSessionId: "wa:5547900000000" });
    expect(await fetchGuestProfile(acompanhante, { db })).toEqual({ status: "companion" });
    expect(calls.map((c) => c.table)).toEqual(["property_reservations"]);
    // reserva sem telefone do titular: ninguém pode provar ser o titular pelo WhatsApp
    const semTelefone = fakeDb({
      reservation: { data: { ota_guest_id: "airbnb:777", phones: [] } },
    });
    expect(await fetchGuestProfile(acompanhante, { db: semTelefone.db })).toEqual({
      status: "companion",
    });
  });

  it("WhatsApp sem reserva vinculada ⇒ sem âncora (o número da conversa nunca identifica o perfil sozinho)", async () => {
    const { db, calls } = fakeDb({
      identities: { data: [ident(P1, "phone", "+5547999990002")] },
      profile: { data: profileRow() },
    });
    expect(
      await fetchGuestProfile(
        turn({ surface: "whatsapp", guestSessionId: "wa:5547999990002", reservationId: null }),
        { db },
      ),
    ).toEqual({
      status: "not_found",
      reason: "no_anchor",
    });
    expect(calls).toEqual([]);
  });

  it("Airbnb: telefone oficial do titular resolve quando a conta OTA ainda não tem identidade", async () => {
    const { db } = fakeDb({
      reservation: { data: { ota_guest_id: "airbnb:888", phones: ["5547999990002"] } },
      identities: { data: [ident(P1, "phone", "+5547999990002")] },
      profile: { data: profileRow() },
    });
    expect(await fetchGuestProfile(turn(), { db })).toMatchObject({
      status: "found",
      via: "phone",
    });
  });

  it("número reciclado (identidade em conflito) ou telefones de perfis diferentes ⇒ conflict, sem perfil", async () => {
    const recycled = fakeDb({
      reservation: { data: { ota_guest_id: null, phones: ["5547999990003"] } },
      identities: { data: [ident(P1, "phone", "+5547999990003", "conflict")] },
    });
    expect(await fetchGuestProfile(turn(), { db: recycled.db })).toEqual({ status: "conflict" });
    expect(recycled.calls.map((c) => c.table)).not.toContain("guest_ai_guest_profiles");
    const split = fakeDb({
      reservation: { data: { ota_guest_id: null, phones: ["5547999990004", "5547999990005"] } },
      identities: {
        data: [ident(P1, "phone", "+5547999990004"), ident(P2, "phone", "+5547999990005")],
      },
    });
    expect(await fetchGuestProfile(turn(), { db: split.db })).toEqual({ status: "conflict" });
  });

  it("sem âncora (Airbnb sem reserva vinculada) ⇒ not_found sem consultar identidades", async () => {
    const { db, calls } = fakeDb({});
    expect(await fetchGuestProfile(turn({ reservationId: null }), { db })).toEqual({
      status: "not_found",
      reason: "no_anchor",
    });
    expect(calls).toEqual([]);
  });

  it("perfil de outra conta nunca entra (defesa além do filtro); falha de leitura ou tabela inexistente ⇒ unavailable", async () => {
    const other = fakeDb({
      reservation: { data: { ota_guest_id: "airbnb:1", phones: [] } },
      identities: { data: [ident(P1, "ota", "airbnb:1")] },
      profile: { data: profileRow({ tenant_id: "outra-conta" }) },
    });
    expect(await fetchGuestProfile(turn(), { db: other.db })).toEqual({
      status: "not_found",
      reason: "no_profile",
    });
    const missing = fakeDb({
      reservation: { data: { ota_guest_id: "airbnb:1", phones: [] } },
      identities: { error: { code: "42P01", message: "relation does not exist" } },
    });
    expect(await fetchGuestProfile(turn(), { db: missing.db })).toEqual({ status: "unavailable" });
    expect(
      await fetchGuestProfile(turn(), { db: fakeDb({ throwOn: "property_reservations" }).db }),
    ).toEqual({ status: "unavailable" });
  });

  it("notas saneadas: categoria fora da lista vira outro, texto vazio sai, limite de quantidade e tamanho", async () => {
    const notes = [
      { categoria: "inventada", texto: "  Chega tarde  " },
      { categoria: "preferencia", texto: "" },
      { texto: "x".repeat(500) },
      ...Array.from({ length: 30 }, (_, i) => ({ categoria: "cuidado", texto: `n${i}` })),
    ];
    const { db } = fakeDb({
      reservation: { data: { ota_guest_id: "airbnb:1", phones: [] } },
      identities: { data: [ident(P1, "ota", "airbnb:1")] },
      profile: {
        data: profileRow({ behavioral_notes: notes, last_stay_checkout: "lixo", stay_count: -2 }),
      },
    });
    const r = (await fetchGuestProfile(turn(), { db })) as Extract<
      GuestProfileLoad,
      { status: "found" }
    >;
    expect(r.notes[0]).toEqual({ categoria: "outro", texto: "Chega tarde" });
    expect(r.notes[1]!.texto).toHaveLength(280);
    expect(r.notes).toHaveLength(GUEST_NOTE_MAX);
    expect(r.stayCount).toBe(0);
    expect(r.lastStayCheckout).toBeNull();
  });

  it("ISOLAMENTO: mesmo que o banco devolva avaliação interna ou resumos, nada disso sai do loader nem vai ao prompt", async () => {
    const { db } = fakeDb({
      reservation: { data: { ota_guest_id: "airbnb:1", phones: [] } },
      identities: { data: [ident(P1, "ota", "airbnb:1")] },
      profile: {
        data: profileRow({
          internal_assessment: {
            cuidado_com_o_imovel: { nivel: "atencao", resumo: "Toalha manchada" },
          },
          stay_summaries: [{ avaliacao: { incidentes: { resumo: "Barulho" } } }],
          guest_name: "Nome Real",
        }),
      },
    });
    const r = await fetchGuestProfile(turn(), { db });
    const serialized = JSON.stringify(r);
    expect(serialized).not.toMatch(/Toalha|Barulho|Nome Real|internal_assessment|stay_summaries/);
    const ctxBlock = JSON.stringify(buildGuestProfileContext(r));
    expect(ctxBlock).not.toMatch(/Toalha|Barulho|Nome Real/);
  });

  it("exige turno emitido; cancelamento interrompe", async () => {
    await expect(
      fetchGuestProfile({ ...base } as ValidatedTurn, { db: fakeDb({}).db }),
    ).rejects.toBeInstanceOf(GuestAiSecurityError);
    const ac = new AbortController();
    ac.abort();
    await expect(
      fetchGuestProfile(turn(), { db: fakeDb({}).db, signal: ac.signal }),
    ).rejects.toBeInstanceOf(GuestAiAbortedError);
  });

  it("telefone em E.164 sem palpite de DDI", () => {
    expect(normalizeGuestPhone("+55 (47) 99999-0001")).toBe("+5547999990001");
    expect(normalizeGuestPhone("005547999990001")).toBe("+5547999990001");
    expect(normalizeGuestPhone("12345")).toBeNull();
    expect(normalizeGuestPhone("0123456789")).toBeNull();
    expect(normalizeGuestPhone(null)).toBeNull();
  });
});

describe("Memória do hóspede · bloco do prompt", () => {
  it("contexto: recorrente com ids citáveis; novo, não identificado, conflito e indisponível sem preferências", () => {
    expect(
      buildGuestProfileContext({
        status: "found",
        via: "ota",
        stayCount: 2,
        lastStayCheckout: "2026-05-10",
        notes: [{ categoria: "preferencia", texto: "Travesseiros extras" }],
      }),
    ).toEqual({
      status: "recorrente",
      estadias_anteriores: 2,
      ultima_saida: "2026-05-10",
      preferencias: [{ id: "perfil:p1", categoria: "preferencia", texto: "Travesseiros extras" }],
    });
    expect(
      buildGuestProfileContext({
        status: "found",
        via: "phone",
        stayCount: 0,
        lastStayCheckout: null,
        notes: [],
      }).status,
    ).toBe("novo");
    expect(buildGuestProfileContext({ status: "not_found", reason: "no_anchor" }).status).toBe(
      "nao_identificado",
    );
    expect(buildGuestProfileContext({ status: "not_found", reason: "no_profile" }).status).toBe(
      "novo",
    );
    expect(buildGuestProfileContext({ status: "conflict" })).toMatchObject({
      status: "conflito",
      preferencias: [],
    });
    expect(buildGuestProfileContext({ status: "unavailable" })).toMatchObject({
      status: "indisponivel",
      preferencias: [],
    });
    expect(buildGuestProfileContext(null).status).toBe("indisponivel");
  });

  it("composer: bloco <perfil_do_hospede> com preferências citáveis (guard aplicado); sem perfil, sem bloco", () => {
    const gp = buildGuestProfileContext({
      status: "found",
      via: "ota",
      stayCount: 3,
      lastStayCheckout: "2026-05-10",
      notes: [{ categoria: "preferencia", texto: "Travesseiros extras" }],
    });
    const r = composeTurnPrompt(
      { context: ctx(), history: history(), guestProfile: gp },
      { guard: TEST_GUARD },
    );
    if (r.kind !== "prompt") throw new Error(r.kind);
    const user = r.prompt.messages[0]!.content;
    expect(user).toContain(`<${GUEST_PROFILE_TAG}>`);
    expect(user).toContain('"status":"recorrente"');
    expect(user).toContain("Travesseiros extras");
    expect(r.prompt.sourceIds!.has("perfil:p1")).toBe(true);
    const none = composeTurnPrompt({ context: ctx(), history: history() }, { guard: TEST_GUARD });
    if (none.kind !== "prompt") throw new Error(none.kind);
    expect(none.prompt.messages[0]!.content).not.toContain(GUEST_PROFILE_TAG);
  });

  it("system prompt: acolhimento do recorrente, discrição e notas sem valor de autorização", () => {
    const sys = buildSystemPrompt("airbnb");
    expect(sys).toContain(`<${GUEST_PROFILE_TAG}>`);
    expect(sys).toMatch(/recorrente/);
    expect(sys).toMatch(/nunca concedem horário, desconto, credencial ou exceção/);
    expect(sys).toMatch(/status acompanhante, quem escreve não é o titular/);
  });
});

describe("Memória do hóspede · conta do hóspede na OTA (ingestão Channex)", () => {
  const raw = (guestId: unknown) =>
    JSON.stringify({
      reservation: { guest_id: guestId, confirmation_code: "HMX", suggested_door_code: "9999" },
    });
  it("Airbnb: `reservation.guest_id` do payload bruto vira `airbnb:<id>`; nada mais é extraído", () => {
    expect(otaGuestAccountId({ ota_name: "Airbnb", raw_message: raw("1234567890") })).toBe(
      "airbnb:1234567890",
    );
    expect(
      otaGuestAccountId({ ota_name: "AirBNB", raw_message: { reservation: { guest_id: 42 } } }),
    ).toBe("airbnb:42");
  });
  it("sem prova ⇒ null: outra OTA, payload ausente/ilegível, id inválido", () => {
    expect(otaGuestAccountId({ ota_name: "BookingCom", raw_message: raw("1") })).toBeNull();
    expect(otaGuestAccountId({ ota_name: "Airbnb", raw_message: "não é json" })).toBeNull();
    expect(otaGuestAccountId({ ota_name: "Airbnb", raw_message: "{quebrado" })).toBeNull();
    expect(otaGuestAccountId({ ota_name: "Airbnb", raw_message: raw("a b c") })).toBeNull();
    expect(otaGuestAccountId({ ota_name: "Airbnb" })).toBeNull();
    expect(otaGuestAccountId(null)).toBeNull();
  });
});
