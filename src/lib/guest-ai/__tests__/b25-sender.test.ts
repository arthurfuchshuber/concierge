/**
 * B2.5 · Identidade de envio: resolução determinística a partir da preferência do anfitrião
 * (`airbnb_sender_pref`), do grupo do anúncio (gêmeos) e das contas do tenant. Só uma identidade
 * inequivocamente validada resulta em `resolved`; nunca há fallback para outra conta; resolver não
 * autoriza enviar. Voz institucional preservada.
 */
import { describe, expect, it } from "vitest";
import { resolveSenderIdentity, revalidateSenderIdentity, SENDER_PREF_ENTITY, type SenderIdentitySource } from "@/lib/guest-ai/policy/sender-identity";
import { runTurnChain } from "@/lib/guest-ai/turn-chain";
import { GUEST_PERSONA, renderPersona } from "@/lib/guest-ai/persona";
import { harness, turn, v4 } from "./helpers/b23-chain";
import { CH_MAPPED, CH_PREF, LISTING, PROPERTY, TENANT, TWIN, senderSource } from "./helpers/b25-fixtures";

const NOW = "2026-11-03T12:00:00.000Z";
const resolve = (over: Partial<SenderIdentitySource> = {}, surface: "airbnb" | "guide_chat" | "whatsapp" = "airbnb") =>
  resolveSenderIdentity({ tenantId: TENANT, propertyId: PROPERTY, surface, source: senderSource(over), now: NOW });

describe("B2.5 · resolução da identidade de envio", () => {
  it("preferência do anfitrião corretamente configurada (anúncio + gêmeo) ⇒ resolved/validated, sem autorização de envio", () => {
    expect(SENDER_PREF_ENTITY).toBe("airbnb_sender_pref");
    expect(resolve()).toEqual({
      version: expect.any(String),
      status: "resolved",
      validation: "validated",
      senderChannelId: CH_PREF,
      source: "host_preference",
      listingId: LISTING,
      primaryListingId: LISTING,
      resolvedAt: NOW,
      reason: null,
      sendAuthorization: "not_granted",
      delivery: "not_sent",
    });
  });
  it("conversa vinda do anúncio GÊMEO resolve pelo grupo (mesma preferência)", () => {
    expect(resolve({ conversationListingId: TWIN })).toMatchObject({ status: "resolved", senderChannelId: CH_PREF, listingId: TWIN, primaryListingId: LISTING });
  });
  it("sem preferência configurada ⇒ conta mapeada do anúncio, com fonte explícita (validada como qualquer outra)", () => {
    expect(resolve({ prefs: [] })).toMatchObject({ status: "resolved", senderChannelId: CH_MAPPED, source: "listing_mapped_channel" });
  });
  it.each<[string, Partial<SenderIdentitySource>, string, string]>([
    ["preferência inválida (sem canal)", { prefs: [{ channex_id: LISTING, payload: { owner_id: TENANT } }] }, "invalid", "preference_invalid"],
    ["preferência gravada por outro tenant", { prefs: [{ channex_id: LISTING, payload: { owner_id: "t2", channel_id: CH_PREF } }] }, "invalid", "preference_other_tenant"],
    ["preferência inexistente na conta (canal não é do tenant)", { prefs: [{ channex_id: LISTING, payload: { owner_id: TENANT, channel_id: "ch-fantasma" } }] }, "invalid", "channel_not_owned"],
    ["canal preferido pertence a outro tenant", { prefs: [{ channex_id: LISTING, payload: { owner_id: TENANT, channel_id: "ch-x" } }], accounts: [{ owner_id: "t2", channex_channel_id: "ch-x", status: "active" }] }, "invalid", "channel_other_tenant"],
    ["conta preferida inativa — NÃO cai para a conta mapeada", { accounts: [{ owner_id: TENANT, channex_channel_id: CH_PREF, status: "disconnected" }, { owner_id: TENANT, channex_channel_id: CH_MAPPED, status: "active" }] }, "unavailable", "channel_inactive"],
    ["gêmeo inconsistente (preferências diferentes no grupo)", { prefs: [{ channex_id: LISTING, payload: { owner_id: TENANT, channel_id: CH_PREF } }, { channex_id: TWIN, payload: { owner_id: TENANT, channel_id: CH_MAPPED } }] }, "ambiguous", "preference_conflict"],
    ["conversa em anúncio gêmeo INATIVO (vínculo encerrado não conta)", { conversationListingId: TWIN, twins: [{ owner_id: TENANT, property_id: PROPERTY, primary_listing_id: LISTING, twin_listing_id: TWIN, status: "inactive" }] }, "unavailable", "listing_unidentified"],
    ["gêmeo de outro imóvel", { conversationListingId: TWIN, twins: [{ owner_id: TENANT, property_id: "p9", primary_listing_id: LISTING, twin_listing_id: TWIN, status: "active" }] }, "invalid", "twin_inconsistent"],
    ["gêmeo apontando para dois principais", { conversationListingId: TWIN, twins: [{ owner_id: TENANT, property_id: PROPERTY, primary_listing_id: LISTING, twin_listing_id: TWIN, status: "active" }, { owner_id: TENANT, property_id: PROPERTY, primary_listing_id: "1003", twin_listing_id: TWIN, status: "active" }] }, "invalid", "twin_inconsistent"],
    ["anúncio de outro tenant", { listings: [{ airbnb_listing_id: LISTING, property_id: PROPERTY, owner_id: "t2", channex_channel_id: CH_MAPPED }] }, "invalid", "listing_other_tenant"],
    ["anúncio de outro imóvel", { listings: [{ airbnb_listing_id: LISTING, property_id: "p9", owner_id: TENANT, channex_channel_id: CH_MAPPED }] }, "invalid", "listing_property_mismatch"],
    ["conversa sem anúncio identificável", { conversationListingId: null }, "unavailable", "listing_unidentified"],
    ["anúncio desconhecido", { conversationListingId: "9999" }, "unavailable", "listing_unidentified"],
    ["reserva e anúncio incompatíveis", { reservationListingId: "5555" }, "invalid", "reservation_listing_mismatch"],
    ["duas contas mapeadas sem critério determinístico (sem preferência)", { prefs: [], listings: [{ airbnb_listing_id: LISTING, property_id: PROPERTY, owner_id: TENANT, channex_channel_id: CH_MAPPED }, { airbnb_listing_id: LISTING, property_id: PROPERTY, owner_id: TENANT, channex_channel_id: "ch-2" }] }, "ambiguous", "multiple_mapped_channels"],
    ["sem conta nenhuma", { prefs: [], listings: [{ airbnb_listing_id: LISTING, property_id: PROPERTY, owner_id: TENANT, channex_channel_id: null }] }, "unavailable", "no_channel"],
    ["falha na consulta", { lookup: "failed" }, "unavailable", "lookup_failed"],
  ])("%s ⇒ %s/%s (sem fallback, sem canal)", (_n, over, status, reason) => {
    const r = resolve(over);
    expect(r).toMatchObject({ status, reason, senderChannelId: null, validation: "not_validated", sendAuthorization: "not_granted", delivery: "not_sent" });
  });
  it("reserva no anúncio gêmeo do mesmo grupo é coerente", () => {
    expect(resolve({ reservationListingId: TWIN }).status).toBe("resolved");
  });
  it("canal fora do Airbnb ⇒ não aplicável", () => {
    expect(resolve({}, "guide_chat")).toMatchObject({ status: "not_applicable", reason: "surface_not_airbnb" });
  });
  it("preferência alterada entre a decisão e o efeito ⇒ revalidação acusa mudança (nunca usar a antiga)", () => {
    const before = resolve();
    const after = resolve({ prefs: [{ channex_id: LISTING, payload: { owner_id: TENANT, channel_id: CH_MAPPED } }, { channex_id: TWIN, payload: { owner_id: TENANT, channel_id: CH_MAPPED } }] });
    expect(after).toMatchObject({ status: "resolved", senderChannelId: CH_MAPPED });
    expect(revalidateSenderIdentity(before, after)).toBe("changed");
    expect(revalidateSenderIdentity(before, resolve())).toBe("unchanged");
    expect(revalidateSenderIdentity(before, resolve({ lookup: "failed" }))).toBe("not_resolved");
  });
  it("a identidade nunca vem do modelo: conta/canal/anúncio na saída do modelo ⇒ scope_field_forbidden", async () => {
    for (const key of ["senderChannelId", "channel_id", "senderIdentity", "listingId"]) {
      const h = harness({ ...v4(), [key]: "ch-x" }, { loadSenderIdentitySource: async () => senderSource() });
      expect(await runTurnChain({ turn: turn(), traceId: "s" }, h.deps), key).toMatchObject({ kind: "refused", code: "parse_scope_field_forbidden" });
    }
  });
});

describe("B2.5 · identidade na cadeia: resolvida/validada ≠ autorização ≠ envio", () => {
  const airbnbTurn = () => turn({ surface: "airbnb" });
  const airbnbCtx = async () => {
    const { ctx } = await import("./helpers/b23-chain");
    return ctx({ interlocutor: { ...ctx().guest.interlocutor, surface: "airbnb" } });
  };
  it("identidade resolvida ⇒ despacho aguardando autorização (nunca concedida, nada enviado)", async () => {
    const h = harness(v4(), { loadContext: airbnbCtx, loadSenderIdentitySource: async () => senderSource() });
    const r = await runTurnChain({ turn: airbnbTurn(), traceId: "s1" }, h.deps);
    if (r.kind !== "reply") throw new Error(r.kind);
    expect(r.dispatch).toMatchObject({ state: "awaiting_send_authorization", sendAuthorization: "not_granted", senderIdentity: { status: "resolved", senderChannelId: CH_PREF } });
    expect(r).toMatchObject({ delivery: "not_sent", effectsExecuted: false });
    expect(r.audit.checks.senderIdentity).toEqual({ status: "resolved", source: "host_preference", reason: null });
    expect(JSON.stringify(r.audit)).not.toContain(CH_PREF); // telemetria guarda estado/fonte/motivo, não o canal
  });
  it("identidade ambígua, inválida, indisponível ou ausente ⇒ preparação de envio BLOQUEADA", async () => {
    for (const src of [senderSource({ prefs: [{ channex_id: LISTING, payload: { owner_id: TENANT, channel_id: CH_PREF } }, { channex_id: TWIN, payload: { owner_id: TENANT, channel_id: CH_MAPPED } }] }), senderSource({ lookup: "failed" })]) {
      const h = harness(v4(), { loadContext: airbnbCtx, loadSenderIdentitySource: async () => src });
      const r = await runTurnChain({ turn: airbnbTurn(), traceId: "s2" }, h.deps);
      if (r.kind !== "reply") throw new Error(r.kind);
      expect(r.dispatch.state).toBe("blocked_sender_identity");
    }
    const none = harness(v4(), { loadContext: airbnbCtx });
    const r = await runTurnChain({ turn: airbnbTurn(), traceId: "s3" }, none.deps);
    expect(r.kind === "reply" && r.dispatch).toMatchObject({ state: "blocked_sender_identity", senderIdentity: null });
  });
  it("falha da fonte de identidade não derruba a decisão, mas bloqueia o despacho", async () => {
    const h = harness(v4(), { loadContext: airbnbCtx, loadSenderIdentitySource: async () => { throw new Error("db"); } });
    const r = await runTurnChain({ turn: airbnbTurn(), traceId: "s4" }, h.deps);
    expect(r.kind === "reply" && r.dispatch.state).toBe("blocked_sender_identity");
    expect(r.audit.checks.senderIdentity).toEqual({ status: "unavailable", source: null, reason: "lookup_failed" });
  });
});

describe("B2.5 · voz institucional", () => {
  it("persona fala pela equipe; nunca se apresenta como anfitrião/proprietário nem deduz identidade da conta de envio", () => {
    const voice = GUEST_PERSONA.character.find((p) => p.id === "institutional_voice");
    expect(voice?.guidance).toMatch(/equipe da acomodação/);
    expect(voice?.guidance).toMatch(/conta por onde a mensagem sai/);
    expect(renderPersona()).toContain(voice!.guidance);
    // sem frase obrigatória: é princípio, não template
    expect(voice!.guidance).not.toMatch(/"[^"]{10,}"/);
  });
  it("o prompt declara a voz institucional como fato do contexto", async () => {
    const h = harness(v4());
    await runTurnChain({ turn: turn(), traceId: "v" }, h.deps);
    expect(h.calls.prompts[0]!.messages[0]!.content).toContain('"id":"ctx:voz","valor":{"representa":"equipe_da_acomodacao","papel_individual":"nao_comprovado"}');
  });
});
