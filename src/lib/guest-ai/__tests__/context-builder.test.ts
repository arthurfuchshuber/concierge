import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGuestContext, type BuilderDeps } from "@/lib/guest-ai/context/builder.server";
import { fetchDossierKnowledge, type BuildPlaybookFn } from "@/lib/guest-ai/data/dossier.server";
import { fetchReservationState } from "@/lib/guest-ai/data/reservation.server";
import { fetchSensitiveCredentials } from "@/lib/guest-ai/data/credentials.server";
import { issueCredentialGrant, GRANT_TTL_MS } from "@/lib/guest-ai/policy/grants";
import { validateTurnScope } from "@/lib/guest-ai/data/scope.server";
import { evaluateCaseGate } from "@/lib/guest-ai/policy/engine";
import { GuestAiSecurityError } from "@/lib/guest-ai/trust";
import { SENSITIVE_PROPERTY_COLUMNS } from "@/lib/guest-ai/data/projections";
import type { FakeDb } from "./helpers/fake-db";
import { IDS, SECRETS, SECRET_VALUES, makeDb } from "./helpers/fixtures";

// Imóvel em Foz do Iguaçu/Brasil ⇒ America/Sao_Paulo. Reserva: check-in 10/11 15:00 (18:00Z), checkout 12/11 11:00 (14:00Z).
const T = {
  beforeWindow: "2026-11-05T12:00:00Z",
  inStay: "2026-11-11T12:00:00Z",
  afterCheckout: "2026-11-12T15:00:00Z",
};

const guide = { surface: "guide_chat", conversationId: IDS.conv1, messageId: IDS.msg1 } as const;
const wa = { surface: "whatsapp", conversationId: IDS.convWa, messageId: IDS.msgWa } as const;
const ab = { surface: "airbnb", conversationId: IDS.convAb, messageId: IDS.msgAb } as const;

/** Construtor do Playbook falso: lê do objeto de imóvel RECEBIDO (prova o que foi carregado). */
const seenProperties: Array<Record<string, unknown>> = [];
const fakeBuild: BuildPlaybookFn = (src) => {
  seenProperties.push(src.property);
  const p = src.property;
  const r = (id: string, au: "P" | "G" | "I", raw: unknown, secret = false) => {
    const v = typeof raw === "string" ? raw : "";
    return { id, label: id, value: v, raw: v, empty: !v, secret, au, note: "" };
  };
  return [
    {
      rows: [
        r("f:titulo_publico", "P", p["name"]),
        r("f:endereco_rua_e_numero", "G", p["address"]),
        r("f:nome_da_rede_wi_fi", "G", p["wifi_ssid"]),
        r("f:senha_do_wi_fi", "G", p["wifi_password"], true),
        r("f:codigo_da_porta", "G", p["lock_code"], true),
        r("f:instrucoes_da_porta", "G", p["lock_instructions"]),
        r("f:nome_interno", "I", "Conta 4599 Patrícia"),
        ...src.faqs.map((f) => ({ id: `faq:${f.id}`, label: f.question, value: f.answer, raw: f.answer, empty: !f.answer, secret: false, au: "P" as const, note: "" })),
      ],
    },
  ];
};

function deps(db: FakeDb, now: string, extra: Partial<BuilderDeps> = {}): BuilderDeps {
  return {
    db,
    now: () => new Date(now),
    fetchDossierKnowledge: (turn, aud, d) => fetchDossierKnowledge(turn, aud, { ...d, buildPlaybook: fakeBuild }),
    ...extra,
  };
}
const STAFF = "99999999-9999-4999-8999-999999999999";
const statusRow = (o: Record<string, unknown>) => ({
  kind: "checkin",
  status: "pending",
  done_at: null,
  concluded_at: null,
  arrival_time_override: null,
  arrival_date_override: null,
  arrival_time_source: null,
  reservation_id: IDS.res1,
  log_id: null,
  property_id: IDS.prop1,
  credentials_released_at: null,
  credentials_released_by: null,
  late_checkout_time: null,
  late_checkout_approved_at: null,
  late_checkout_by: null,
  ...o,
});
const credentialQueries = (db: FakeDb) => SENSITIVE_PROPERTY_COLUMNS.reduce((n, c) => n + db.touched("properties", c), 0);
const noSecrets = (v: unknown) => {
  const json = JSON.stringify(v);
  for (const s of SECRET_VALUES) expect(json).not.toContain(s);
};

afterEach(() => {
  vi.restoreAllMocks();
  seenProperties.length = 0;
});

describe("F1 · GuestContextBuilder — cenários", () => {
  it("conversa vinculada a reserva, estadia em andamento: contexto tipado completo e credenciais autorizadas", async () => {
    const db = makeDb({ property_faqs: [{ id: "f1", property_id: IDS.prop1, question: "Tem piscina?", answer: "Não.", position: 1 }] });
    const ctx = await buildGuestContext(guide, deps(db, T.inStay));
    expect(ctx.version).toBe(1);
    expect(ctx.interlocutor).toEqual({ guestId: "sess-guide-aaaaaaaaaaaa", conversationId: IDS.conv1, messageId: IDS.msg1, surface: "guide_chat" });
    expect(ctx.property).toMatchObject({ id: IDS.prop1, tenantId: IDS.owner1, timezone: "America/Sao_Paulo" });
    expect(ctx.phase).toBe("in_stay");
    expect(ctx.stay).toMatchObject({ reservationId: IDS.res1, phase: "in_stay", checkInAt: "2026-11-10T18:00:00.000Z", checkOutAt: "2026-11-12T14:00:00.000Z" });
    expect(ctx.audiences).toEqual(["P", "G"]);
    expect(ctx.access).toMatchObject({ credentialsAllowed: true, policyResult: { allowed: true, reason: "within_release_window" } });
    expect(ctx.credentials).toEqual({
      lockCode: SECRETS.lock,
      gateCode: SECRETS.gate,
      pinCode: SECRETS.pin,
      wifiPassword: SECRETS.wifi,
      accessInstructions: `${SECRETS.gateInstr}\n\n${SECRETS.lockInstr}`,
    });
    // Endereço (G) presente; nome interno (I) e linhas de senha fora do Dossiê.
    expect(ctx.property.listingFacts?.address).toContain("Rua das Flores");
    const ids = ctx.property.dossierKnowledge?.items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["f:titulo_publico", "f:endereco_rua_e_numero", "f:nome_da_rede_wi_fi", "faq:f1"]));
    expect(ids).not.toContain("f:nome_interno");
    expect(ids).not.toContain("f:senha_do_wi_fi");
    // Os segredos só existem dentro de `credentials`.
    noSecrets({ ...ctx, credentials: null });
  });

  it("conversa sem reserva (WhatsApp): stay=null, fase inquiry, só Público, sem credenciais", async () => {
    const db = makeDb();
    const ctx = await buildGuestContext(wa, deps(db, T.inStay));
    expect(ctx.stay).toBeNull();
    expect(ctx.phase).toBe("inquiry");
    expect(ctx.audiences).toEqual(["P"]);
    expect(ctx.credentials).toBeNull();
    expect(ctx.access.policyResult.reason).toBe("reservation_invalid");
    expect(ctx.uncertainties).toContain("no_reservation_link");
    expect(ctx.property.listingFacts?.address).toBeNull();
    expect(credentialQueries(db)).toBe(0);
  });

  it("consulta pré-reserva no Airbnb (vinculada só ao imóvel): informações gerais do imóvel continuam disponíveis", async () => {
    const db = makeDb();
    const ctx = await buildGuestContext(ab, deps(db, T.beforeWindow));
    expect(ctx.stay).toBeNull();
    expect(ctx.property.name).toBe("Casa Teste");
    expect(ctx.property.dossierKnowledge?.items.map((i) => i.id)).toEqual(["f:titulo_publico"]);
    expect(ctx.credentials).toBeNull();
  });

  it("Dossiê: título público sem o código interno em todo o contexto; properties.name intacto", async () => {
    const db = makeDb();
    const prop = db.tables["properties"]!.find((r) => r["id"] === IDS.prop1)!;
    prop["name"] = "AP014 - Flat ao lado da Santa Casa";
    const ctx = await buildGuestContext(ab, deps(db, T.beforeWindow));
    expect(ctx.property.name).toBe("Flat ao lado da Santa Casa");
    expect(ctx.property.listingFacts?.name).toBe("Flat ao lado da Santa Casa");
    const json = JSON.stringify(ctx);
    expect(json).not.toContain("AP014");
    expect(json).toContain("Flat ao lado da Santa Casa");
    expect(prop["name"]).toBe("AP014 - Flat ao lado da Santa Casa");
  });

  it("Dossiê: com nome codificado, o prefixo privado do título do anúncio continua isolado (listing e dossiê)", async () => {
    const db = makeDb({
      property_listing_raw_data: [
        {
          property_id: IDS.prop1,
          synced_at: "2026-11-01T00:00:00Z",
          normalized: { facts: [{ key: "identificacao", title: "Identificação", content: "Título do anúncio: 45999730002 Patrícia Regina · Flat ao lado da Santa Casa\nCidade: Londrina" }] },
        },
      ],
    });
    db.tables["properties"]!.find((r) => r["id"] === IDS.prop1)!["name"] = "AP014 - Flat ao lado da Santa Casa";
    const seen: Array<{ name: unknown; facts: unknown }> = [];
    const spyBuild: BuildPlaybookFn = (src) => {
      seen.push({ name: (src.property as Record<string, unknown>)["name"], facts: src.listingFacts });
      return fakeBuild(src);
    };
    const ctx = await buildGuestContext(guide, deps(db, T.inStay, { fetchDossierKnowledge: (turn, aud, d) => fetchDossierKnowledge(turn, aud, { ...d, buildPlaybook: spyBuild }) }));
    const ident = ctx.property.listingFacts?.normalized?.facts.find((f) => f.key === "identificacao");
    expect(ident?.content).toBe("Título do anúncio: Flat ao lado da Santa Casa\nCidade: Londrina");
    // o construtor do Dossiê recebe o nome público e a identificação já sem o prefixo privado
    expect(seen).toHaveLength(1);
    expect(seen[0]!.name).toBe("Flat ao lado da Santa Casa");
    expect(JSON.stringify(seen[0]!.facts)).toContain("Título do anúncio: Flat ao lado da Santa Casa");
    for (const leak of ["45999730002", "Patrícia Regina", "AP014"]) expect(JSON.stringify(seen)).not.toContain(leak);
    const json = JSON.stringify(ctx);
    for (const leak of ["45999730002", "Patrícia Regina", "AP014"]) expect(json).not.toContain(leak);
  });

  it("NÃO vincula por proximidade: outra reserva do mesmo imóvel não entra numa conversa sem vínculo", async () => {
    const db = makeDb();
    db.tables["property_reservations"]!.push({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9", property_id: IDS.prop1, status: "confirmed", source: "channex", checkin_date: "2026-11-11", checkout_date: "2026-11-13" });
    const ctx = await buildGuestContext(wa, deps(db, T.inStay));
    expect(ctx.stay).toBeNull();
    expect(db.touched("property_reservations")).toBe(0);
  });

  it("múltiplas reservas possíveis: usa somente a reserva vinculada na conversa", async () => {
    const db = makeDb();
    db.tables["property_reservations"]!.push({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9", property_id: IDS.prop1, status: "cancelled", source: "channex", checkin_date: "2026-11-01", checkout_date: "2026-11-03" });
    const ctx = await buildGuestContext(guide, deps(db, T.inStay));
    expect(ctx.stay?.reservationId).toBe(IDS.res1);
  });

  it("reserva cancelada: fase cancelled, só Público, sem credenciais", async () => {
    const db = makeDb();
    db.tables["property_reservations"]!.find((r) => r["id"] === IDS.res1)!["status"] = "cancelled";
    const ctx = await buildGuestContext(guide, deps(db, T.inStay));
    expect(ctx.phase).toBe("cancelled");
    expect(ctx.audiences).toEqual(["P"]);
    expect(ctx.access.policyResult.reason).toBe("reservation_cancelled");
    expect(ctx.credentials).toBeNull();
    expect(credentialQueries(db)).toBe(0);
  });

  it("reserva sem imóvel correspondente (aponta para outro imóvel): conflito preservado, nada da reserva alheia", async () => {
    const db = makeDb();
    db.tables["property_chat_conversations"]!.find((c) => c["id"] === IDS.conv1)!["reservation_id"] = IDS.res2;
    const ctx = await buildGuestContext(guide, deps(db, T.inStay));
    expect(ctx.stay).toBeNull();
    expect(ctx.conflicts).toContain("reservation_property_mismatch");
    expect(ctx.credentials).toBeNull();
    expect(JSON.stringify(ctx)).not.toContain("Casa Alheia");
  });

  it("dados incompletos: fuso do imóvel não comprovado ⇒ missing_timezone, sem credenciais", async () => {
    const db = makeDb();
    Object.assign(db.tables["properties"]!.find((p) => p["id"] === IDS.prop1)!, { country: null, city: "Foz do Iguaçu" });
    const ctx = await buildGuestContext(guide, deps(db, T.inStay));
    expect(ctx.property.timezone).toBeNull();
    expect(ctx.uncertainties).toContain("property_timezone_unproven");
    expect(ctx.access.policyResult.reason).toBe("missing_timezone");
    expect(ctx.phase).toBe("unknown");
    expect(ctx.credentials).toBeNull();
  });

  it("fontes conflitantes: anúncio × cadastro preservados como conflito, sem escolher um vencedor", async () => {
    const db = makeDb({
      property_listing_raw_data: [{ property_id: IDS.prop1, synced_at: "2026-11-01T00:00:00Z", normalized: { checkout_time: "10:00", checkin_window: { start: "15:00", end: "23:00" }, facts: [] } }],
    });
    const ctx = await buildGuestContext(guide, deps(db, T.inStay));
    expect(ctx.conflicts).toContain("checkout_time: anúncio 10:00 × cadastro 11:00");
    expect(ctx.stay?.checkOutAt).toBe("2026-11-12T14:00:00.000Z"); // a D9 segue o cadastro operacional, sem trocar silenciosamente
  });

  it("cobertura integral do anúncio: identificacao (sem prefixo interno), reviews públicos e página pública entram; feedback privado e cohosts não", async () => {
    const db = makeDb({
      property_listing_raw_data: [
        {
          property_id: IDS.prop1,
          synced_at: "2026-11-01T00:00:00Z",
          normalized: {
            facts: [
              { key: "identificacao", title: "Identificação", content: "Título do anúncio: 45999730002 Patrícia Regina · Casa Teste\nCidade: Foz do Iguaçu\nCapacidade máxima: 7 hóspedes" },
              { key: "horarios", title: "Horários", content: "Check-in a partir das 15h" },
              { key: "chave_nova_qualquer", title: "Nova", content: "Fato novo do anúncio" },
            ],
            reviews: [
              { id: "r1", score: 10, received_at: "2026-10-01T00:00:00Z", reply: "Obrigado!", content: "Public review:\r\nCasa ótima e limpa.\r\n\r\nPrivate feedback:\r\nO chuveiro do banheiro 2 pinga, segredo entre nós." },
              { id: "r2", score: 9, received_at: "2026-09-01T00:00:00Z", reply: null, content: "Public review:\nLocal tranquilo." },
            ],
            public_listing: { guests: 7, beds: 4, houseRules: "Sem festas", descriptions: ["Casa ampla"] },
            cohosts: [{ name: null, role: "co-anfitrião (repasse automático nas reservas)" }],
          },
        },
      ],
    });
    const ctx = await buildGuestContext(guide, deps(db, T.inStay));
    const n = ctx.property.listingFacts?.normalized;
    const ident = n?.facts.find((f) => f.key === "identificacao");
    expect(ident?.content).toBe("Título do anúncio: Casa Teste\nCidade: Foz do Iguaçu\nCapacidade máxima: 7 hóspedes");
    expect(n?.facts.map((f) => f.key)).toEqual(["identificacao", "horarios", "chave_nova_qualquer"]); // nenhum fato descartado
    expect(n?.reviews).toEqual([
      { score: 10, receivedAt: "2026-10-01T00:00:00Z", text: "Casa ótima e limpa.", hostReply: "Obrigado!" },
      { score: 9, receivedAt: "2026-09-01T00:00:00Z", text: "Local tranquilo.", hostReply: null },
    ]);
    expect(n?.publicListing).toMatchObject({ guests: 7, houseRules: "Sem festas" });
    const json = JSON.stringify(ctx);
    expect(json).not.toContain("45999730002");
    expect(json).not.toContain("Patrícia");
    expect(json).not.toContain("segredo entre nós");
    expect(json).not.toContain("repasse automático");
  });

  it("contexto com informação insuficiente: falha ao ler a reserva ⇒ incerteza registrada e nenhuma credencial", async () => {
    const db = makeDb();
    db.failTables.add("guest_arrival_status");
    const ctx = await buildGuestContext(guide, deps(db, T.inStay));
    expect(ctx.uncertainties).toContain("reservation_state_unavailable");
    expect(ctx.credentials).toBeNull();
    expect(ctx.access.policyResult.allowed).toBe(false);
  });

  it("antes da janela de 24 h: Reserva Ativa (endereço) sim, credenciais não", async () => {
    const db = makeDb();
    const ctx = await buildGuestContext(guide, deps(db, T.beforeWindow));
    expect(ctx.phase).toBe("pre_stay");
    expect(ctx.audiences).toEqual(["P", "G"]);
    expect(ctx.access.policyResult.reason).toBe("outside_release_window");
    expect(ctx.credentials).toBeNull();
  });

  it("D13: cartão liberado manualmente pela equipe antes da janela ⇒ manual_release e credenciais", async () => {
    const db = makeDb({ guest_arrival_status: [statusRow({ credentials_released_at: "2026-11-05T10:00:00Z", credentials_released_by: STAFF })] });
    const ctx = await buildGuestContext(guide, deps(db, T.beforeWindow));
    expect(ctx.access.policyResult).toMatchObject({ allowed: true, reason: "manual_release" });
    expect(ctx.credentials?.lockCode).toBe(SECRETS.lock);
  });

  it("D13: liberação manual NÃO supera no-show nem checkout confirmado", async () => {
    const a = makeDb({ guest_arrival_status: [statusRow({ status: "no_show", credentials_released_at: "2026-11-05T10:00:00Z", credentials_released_by: STAFF })] });
    expect((await buildGuestContext(guide, deps(a, T.beforeWindow))).access.policyResult.reason).toBe("no_show");
    const b = makeDb({
      guest_arrival_status: [
        statusRow({ credentials_released_at: "2026-11-05T10:00:00Z", credentials_released_by: STAFF }),
        statusRow({ kind: "checkout", status: "done", done_at: "2026-11-05T11:00:00Z" }),
      ],
    });
    const ctx = await buildGuestContext(guide, deps(b, T.beforeWindow));
    expect(ctx.access.policyResult.reason).toBe("checkout_confirmed");
    expect(ctx.credentials).toBeNull();
    expect(credentialQueries(a) + credentialQueries(b)).toBe(0);
  });

  it("D13: revogação da liberação entre a avaliação e a entrega ⇒ deny", async () => {
    const db = makeDb({ guest_arrival_status: [statusRow({ credentials_released_at: "2026-11-05T10:00:00Z", credentials_released_by: STAFF })] });
    let calls = 0;
    const ctx = await buildGuestContext(
      guide,
      deps(db, T.beforeWindow, {
        fetchReservationState: async (turn, d) => {
          calls += 1;
          if (calls === 2) db.tables["guest_arrival_status"]![0]!["credentials_released_at"] = null;
          return fetchReservationState(turn, d);
        },
      }),
    );
    expect(ctx.access.policyResult.reason).toBe("outside_release_window");
    expect(ctx.credentials).toBeNull();
    expect(credentialQueries(db)).toBe(0);
  });

  it("após o checkout: fase post_checkout, sem Reserva Ativa e sem credenciais", async () => {
    const db = makeDb();
    const ctx = await buildGuestContext(guide, deps(db, T.afterCheckout));
    expect(ctx.phase).toBe("post_checkout");
    expect(ctx.audiences).toEqual(["P"]);
    expect(ctx.credentials).toBeNull();
  });

  it("R6: late checkout FORMAL estende o prazo das credenciais; previsão 'staff' com horário não estende", async () => {
    const formal = makeDb({
      guest_arrival_status: [statusRow({ kind: "checkout", late_checkout_time: "14:00", late_checkout_approved_at: "2026-11-11T10:00:00Z", late_checkout_by: STAFF })],
    });
    const ok = await buildGuestContext(guide, deps(formal, T.afterCheckout));
    expect(ok.access.policyResult.allowed).toBe(true);
    expect(ok.credentials?.lockCode).toBe(SECRETS.lock);
    const staff = makeDb({ guest_arrival_status: [statusRow({ kind: "checkout", arrival_time_source: "staff", arrival_time_override: "18:00" })] });
    const no = await buildGuestContext(guide, deps(staff, T.afterCheckout));
    expect(no.access.policyResult.allowed).toBe(false);
    expect(no.credentials).toBeNull();
    expect(credentialQueries(staff)).toBe(0);
  });

  it("R6: revogação do late checkout entre a avaliação e a entrega ⇒ deny", async () => {
    const db = makeDb({
      guest_arrival_status: [statusRow({ kind: "checkout", late_checkout_time: "14:00", late_checkout_approved_at: "2026-11-11T10:00:00Z", late_checkout_by: STAFF })],
    });
    let calls = 0;
    const ctx = await buildGuestContext(
      guide,
      deps(db, T.afterCheckout, {
        fetchReservationState: async (turn, d) => {
          calls += 1;
          if (calls === 2) Object.assign(db.tables["guest_arrival_status"]![0]!, { late_checkout_time: null, late_checkout_approved_at: null, late_checkout_by: null });
          return fetchReservationState(turn, d);
        },
      }),
    );
    expect(ctx.access.policyResult.allowed).toBe(false);
    expect(ctx.credentials).toBeNull();
    expect(credentialQueries(db)).toBe(0);
  });

  it("D13: liberação sem autor registrado não vale como liberação manual", async () => {
    const db = makeDb({ guest_arrival_status: [statusRow({ credentials_released_at: "2026-11-05T10:00:00Z", credentials_released_by: null })] });
    const ctx = await buildGuestContext(guide, deps(db, T.beforeWindow));
    expect(ctx.access.policyResult.reason).toBe("outside_release_window");
    expect(ctx.credentials).toBeNull();
  });

  it("no-show gravado só no formulário do hóspede (mesma estadia): veto absoluto", async () => {
    const db = makeDb({
      guide_access_logs: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1", property_id: IDS.prop1, checkin_date: "2026-11-10" }],
      guest_arrival_status: [statusRow({ status: "no_show", reservation_id: null, log_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1" })],
    });
    const ctx = await buildGuestContext(guide, deps(db, T.inStay));
    expect(ctx.phase).toBe("no_show");
    expect(ctx.access.policyResult.reason).toBe("no_show");
    expect(ctx.credentials).toBeNull();
    expect(credentialQueries(db)).toBe(0);
  });

  it("chamado aberto com assunto INDEPENDENTE: a IA pode atender; com assunto RELACIONADO: a equipe é dona daquele assunto", async () => {
    const db = makeDb();
    const ctx = await buildGuestContext(ab, deps(db, T.beforeWindow));
    expect(ctx.openCases).toEqual([{ id: IDS.convAb, source: "conversation_status", topic: null, status: "needs_human" }]);
    expect(evaluateCaseGate(ctx.openCases, "independent")).toMatchObject({ aiMayAnswer: true, humanOwnsTopic: false });
    expect(evaluateCaseGate(ctx.openCases, "related")).toMatchObject({ aiMayAnswer: true, humanOwnsTopic: true, caseId: IDS.convAb });
  });

  it("identidade inválida (mensagem da equipe, canal errado) ⇒ nada é montado", async () => {
    const db = makeDb();
    await expect(buildGuestContext({ ...guide, messageId: IDS.msgHuman }, deps(db, T.inStay))).rejects.toMatchObject({ code: "message_not_from_guest" });
    await expect(buildGuestContext({ ...guide, surface: "airbnb" }, deps(db, T.inStay))).rejects.toMatchObject({ code: "surface_mismatch" });
    expect(credentialQueries(db)).toBe(0);
  });
});

describe("D9 · expurgo de credenciais (ordem de execução e vazamento)", () => {
  it("negado ⇒ a consulta de credenciais NÃO é executada (antes da janela, sem reserva, cancelada, no-show)", async () => {
    const scenarios: Array<[typeof guide | typeof wa, string, (db: FakeDb) => void]> = [
      [guide, T.beforeWindow, () => {}],
      [wa, T.inStay, () => {}],
      [guide, T.inStay, (db) => { db.tables["property_reservations"]!.find((r) => r["id"] === IDS.res1)!["status"] = "cancelled"; }],
      [guide, T.inStay, (db) => { db.tables["guest_arrival_status"]!.push(statusRow({ status: "no_show" })); }],
      [guide, T.inStay, (db) => { db.tables["guest_arrival_status"]!.push(statusRow({ kind: "checkout", status: "done", done_at: "2026-11-11T09:00:00Z" })); }],
    ];
    for (const [input, now, mutate] of scenarios) {
      const db = makeDb();
      mutate(db);
      const ctx = await buildGuestContext(input, deps(db, now));
      expect(ctx.credentials).toBeNull();
      expect(ctx.access.credentialsAllowed).toBe(false);
      expect(credentialQueries(db)).toBe(0);
      noSecrets(ctx);
      expect(JSON.stringify(ctx)).not.toMatch(/lockCode|gateCode|wifiPassword|pinCode/);
    }
  });

  it("o construtor do Dossiê nunca recebe colunas sensíveis (nada é carregado para depois ser apagado)", async () => {
    const db = makeDb();
    await buildGuestContext(guide, deps(db, T.inStay));
    expect(seenProperties.length).toBeGreaterThan(0);
    for (const p of seenProperties) {
      for (const c of SENSITIVE_PROPERTY_COLUMNS) expect(Object.keys(p)).not.toContain(c);
    }
  });

  it("autorizado ⇒ reavalia com estado ATUALIZADO imediatamente antes da entrega; revogação no meio do caminho vence", async () => {
    const db = makeDb();
    let calls = 0;
    const ctx = await buildGuestContext(
      guide,
      deps(db, T.inStay, {
        fetchReservationState: async (turn, d) => {
          calls += 1;
          // Entre a 1ª avaliação e a revalidação, a equipe marca "Não compareceu".
          if (calls === 2) db.tables["guest_arrival_status"]!.push(statusRow({ status: "no_show" }));
          return fetchReservationState(turn, d);
        },
      }),
    );
    expect(calls).toBe(2);
    expect(ctx.access.policyResult.reason).toBe("no_show");
    expect(ctx.credentials).toBeNull();
    expect(credentialQueries(db)).toBe(0);
  });

  it("checkout confirmado entre a avaliação e a entrega também revoga na hora", async () => {
    const db = makeDb();
    let calls = 0;
    const ctx = await buildGuestContext(
      guide,
      deps(db, T.inStay, {
        fetchReservationState: async (turn, d) => {
          calls += 1;
          if (calls === 2) db.tables["guest_arrival_status"]!.push(statusRow({ kind: "checkout", status: "done", done_at: "2026-11-11T11:59:00Z" }));
          return fetchReservationState(turn, d);
        },
      }),
    );
    expect(ctx.access.policyResult.reason).toBe("checkout_confirmed");
    expect(ctx.credentials).toBeNull();
  });

  it("falha na revalidação ⇒ deny (nunca entrega com dado velho)", async () => {
    const db = makeDb();
    let calls = 0;
    const ctx = await buildGuestContext(
      guide,
      deps(db, T.inStay, {
        fetchReservationState: async (turn, d) => {
          calls += 1;
          if (calls === 2) throw new Error("rede caiu");
          return fetchReservationState(turn, d);
        },
      }),
    );
    expect(ctx.credentials).toBeNull();
    expect(ctx.access.policyResult).toMatchObject({ allowed: false, reason: "invalid_operational_state" });
    expect(ctx.uncertainties).toContain("credentials_revalidation_failed");
  });

  it("logs e erros nunca contêm credenciais (sucesso, negação e falhas)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const errors: string[] = [];
    const db1 = makeDb();
    await buildGuestContext(guide, deps(db1, T.inStay));
    await buildGuestContext(guide, deps(makeDb(), T.beforeWindow));
    const db3 = makeDb();
    let n = 0;
    await buildGuestContext(guide, deps(db3, T.inStay, { fetchSensitiveCredentials: async () => { n += 1; throw new Error("falha genérica"); } })).catch((e: Error) => errors.push(e.message));
    expect(n).toBe(1);
    await buildGuestContext({ ...guide, messageId: IDS.msgHuman }, deps(makeDb(), T.inStay)).catch((e: Error) => errors.push(`${e.name}:${e.message}`));
    const logged = spies.flatMap((s) => s.mock.calls.flat()).map((a) => (typeof a === "string" ? a : JSON.stringify(a ?? null)));
    for (const s of SECRET_VALUES) {
      expect(logged.join("\n")).not.toContain(s);
      expect(errors.join("\n")).not.toContain(s);
    }
  });

  it("concessão: só com allow, só com turno emitido, só para a reserva do turno, e expira (autorização antiga não sobrevive)", async () => {
    const db = makeDb();
    const turn = await validateTurnScope(guide, { db });
    const allow = { decision: "allow", allowed: true, reason: "within_release_window", evaluatedAt: T.inStay } as const;
    const deny = { decision: "deny", allowed: false, reason: "no_show", evaluatedAt: T.inStay } as const;
    expect(() => issueCredentialGrant(turn, IDS.res1, deny, Date.parse(T.inStay))).toThrow(GuestAiSecurityError);
    expect(() => issueCredentialGrant({ ...turn }, IDS.res1, allow, Date.parse(T.inStay))).toThrow(GuestAiSecurityError);
    expect(() => issueCredentialGrant(turn, IDS.res2, allow, Date.parse(T.inStay))).toThrow(GuestAiSecurityError);

    const t0 = Date.parse(T.inStay);
    const grant = issueCredentialGrant(turn, IDS.res1, allow, t0);
    expect(Object.isFrozen(grant)).toBe(true);
    await expect(fetchSensitiveCredentials(grant, { db, nowMs: t0 + GRANT_TTL_MS + 1 })).rejects.toMatchObject({ code: "grant_expired" });
    expect(credentialQueries(db)).toBe(0);
    // Cópia do grant (objeto não emitido) também é recusada.
    await expect(fetchSensitiveCredentials({ ...grant }, { db, nowMs: t0 })).rejects.toMatchObject({ code: "credentials_require_grant" });
    // Grant válido: lê só o imóvel do grant.
    const creds = await fetchSensitiveCredentials(grant, { db, nowMs: t0 + 1 });
    expect(creds?.lockCode).toBe(SECRETS.lock);
    const call = db.calls.find((c) => c.table === "properties" && c.columns.includes("lock_code"));
    expect(call?.filters).toEqual([["eq", "id", IDS.prop1]]);
  });

  it("falha ao ler credenciais ⇒ null (sem valor parcial)", async () => {
    const db = makeDb();
    const turn = await validateTurnScope(guide, { db });
    const t0 = Date.parse(T.inStay);
    const grant = issueCredentialGrant(turn, IDS.res1, { decision: "allow", allowed: true, reason: "within_release_window", evaluatedAt: T.inStay }, t0);
    db.failTables.add("properties");
    expect(await fetchSensitiveCredentials(grant, { db, nowMs: t0 })).toBeNull();
  });
});
