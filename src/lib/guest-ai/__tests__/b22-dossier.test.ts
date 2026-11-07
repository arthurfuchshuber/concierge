import { describe, expect, it } from "vitest";
import { buildPlaybook } from "@/lib/playbook-build";
import { ALTERNATIVE_PURPOSE, authorizeCandidateProperty, primaryDossierTarget } from "@/lib/guest-ai/data/property-access.server";
import { fetchPropertyDossier } from "@/lib/guest-ai/data/property-dossier.server";
import { GuestAiAbortedError } from "@/lib/guest-ai/data/client.server";
import { MANUAL_DOSSIER_COLUMNS, PROPERTY_ACCESS_COLUMNS, RECOMMENDATION_PUBLIC_COLUMNS, SENSITIVE_PROPERTY_COLUMNS } from "@/lib/guest-ai/data/projections";
import { normalizePropertyDossier, type DossierSources } from "@/lib/guest-ai/dossier/normalize";
import { DossierError, assertAvailabilityFor, assessGuestCapacity, type PropertyDossier } from "@/lib/guest-ai/dossier/contracts";
import { isIssuedDossierTarget, isIssuedPropertyDossier, issueDossierTarget, withAvailability } from "@/lib/guest-ai/dossier/registry";
import { GuestAiSecurityError, issue } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { REAL_COLUMNS } from "./helpers/real-columns";
import { P1, P2, P3, PA, PX, T1, T2, portfolioDb, portfolioTables } from "./helpers/b22-portfolio";

const turn = (over: Partial<ValidatedTurn> = {}) =>
  issue("turn", { surface: "guide_chat", conversationId: "c1", messageId: "m1", propertyId: P1, tenantId: T1, guestSessionId: "s", conversationStatus: "ai", reservationId: "r1", messageCreatedAt: null, ...over }) as ValidatedTurn;
const NOW = () => new Date("2026-11-03T12:00:00Z");
const realBuild = buildPlaybook as never;

async function load(propertyId: string, role: "primary" | "candidate", tables = portfolioTables()) {
  const { db, calls } = portfolioDb(tables);
  const target =
    role === "primary"
      ? primaryDossierTarget(turn(), ["P", "G"])
      : await authorizeCandidateProperty(turn(), propertyId, ALTERNATIVE_PURPOSE, { db }).then((d) => {
          if (!d.ok) throw new Error(d.reason);
          return d.target;
        });
  const dossier = await fetchPropertyDossier(target, { db, now: NOW, buildPlaybook: realBuild });
  return { dossier, calls };
}
const text = (d: PropertyDossier) => JSON.stringify(d);

describe("B2.2 · autorização por imóvel (isolamento por tenant)", () => {
  it("principal: imóvel e tenant do turno validado; audiências P/G", () => {
    const t = primaryDossierTarget(turn(), ["G", "P"]);
    expect(t).toEqual({ propertyId: P1, tenantId: T1, role: "primary", audiences: ["G", "P"], purpose: "reservation_context" });
    expect(isIssuedDossierTarget(t)).toBe(true);
    expect(Object.isFrozen(t)).toBe(true);
    expect(() => primaryDossierTarget(turn(), ["P", "I"])).toThrow();
    expect(() => primaryDossierTarget(turn(), ["G"])).toThrow();
    expect(() => primaryDossierTarget({ ...turn() }, ["P"])).toThrow(GuestAiSecurityError);
  });

  it("candidato do MESMO tenant, ativo ⇒ autorizado só com audiência pública", async () => {
    const { db, calls } = portfolioDb();
    const d = await authorizeCandidateProperty(turn(), P2, ALTERNATIVE_PURPOSE, { db });
    expect(d).toMatchObject({ ok: true, target: { propertyId: P2, tenantId: T1, role: "candidate", audiences: ["P"], purpose: ALTERNATIVE_PURPOSE } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: "properties", select: PROPERTY_ACCESS_COLUMNS.join(", "), filters: [["id", P2]] });
  });

  it.each([
    ["outro tenant", PX, "tenant_mismatch"],
    ["arquivado", PA, "archived"],
    ["inexistente", "55555555-0000-4000-8000-000000000005", "not_found"],
    ["o próprio principal", P1, "same_as_primary"],
    ["id inválido", "p2", "invalid_id"],
    ["id com injeção", `${P2}' or '1'='1`, "invalid_id"],
  ])("candidato %s ⇒ bloqueado (%s)", async (_n, id, reason) => {
    const { db } = portfolioDb();
    expect(await authorizeCandidateProperty(turn(), id, ALTERNATIVE_PURPOSE, { db })).toEqual({ ok: false, reason });
  });

  it("finalidade desconhecida, tenant ausente, dono nulo, identidade divergente ou falha ⇒ bloqueado", async () => {
    const { db } = portfolioDb();
    expect(await authorizeCandidateProperty(turn(), P2, "marketing", { db })).toEqual({ ok: false, reason: "purpose_invalid" });
    expect(await authorizeCandidateProperty(turn({ tenantId: "" }), P2, ALTERNATIVE_PURPOSE, { db })).toEqual({ ok: false, reason: "tenant_unknown" });
    const t = portfolioTables();
    (t.properties!.find((r) => r["id"] === P2) as Record<string, unknown>)["owner_id"] = null;
    expect(await authorizeCandidateProperty(turn(), P2, ALTERNATIVE_PURPOSE, { db: portfolioDb(t).db })).toEqual({ ok: false, reason: "tenant_unknown" });
    const t2 = portfolioTables();
    t2.properties!.push({ ...t2.properties!.find((r) => r["id"] === P3)!, id: P3.toUpperCase() });
    const liar = portfolioDb(t2);
    // banco que devolve outra linha para o id pedido
    const weird = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: P3, owner_id: T1, archived_at: null }, error: null }) }) }) }) };
    expect(await authorizeCandidateProperty(turn(), P2, ALTERNATIVE_PURPOSE, { db: weird as never })).toEqual({ ok: false, reason: "identity_mismatch" });
    expect(await authorizeCandidateProperty(turn(), P2, ALTERNATIVE_PURPOSE, { db: portfolioDb(portfolioTables(), { failTable: "properties" }).db })).toEqual({ ok: false, reason: "lookup_failed" });
    expect(liar).toBeTruthy();
  });

  it("autorizar um candidato NÃO autoriza outro: cada um é validado no banco", async () => {
    const { db, calls } = portfolioDb();
    await authorizeCandidateProperty(turn(), P2, ALTERNATIVE_PURPOSE, { db });
    await authorizeCandidateProperty(turn(), PX, ALTERNATIVE_PURPOSE, { db });
    expect(calls.map((c) => c.filters[0]![1])).toEqual([P2, PX]);
  });

  it("cancelamento: sinal abortado não abre consulta", async () => {
    const ac = new AbortController();
    ac.abort();
    const { db, calls } = portfolioDb();
    await expect(authorizeCandidateProperty(turn(), P2, ALTERNATIVE_PURPOSE, { db, signal: ac.signal })).rejects.toBeInstanceOf(GuestAiAbortedError);
    expect(calls).toHaveLength(0);
  });

  it("turno forjado é recusado", async () => {
    const { db } = portfolioDb();
    await expect(authorizeCandidateProperty({ ...turn() }, P2, ALTERNATIVE_PURPOSE, { db })).rejects.toBeInstanceOf(GuestAiSecurityError);
  });
});

describe("B2.2 · carregador sob demanda (projeções, revalidação, isolamento)", () => {
  it("alvo forjado ⇒ erro de segurança, nenhuma consulta", async () => {
    const { db, calls } = portfolioDb();
    await expect(fetchPropertyDossier({ propertyId: P2, tenantId: T1, role: "candidate", audiences: ["P"], purpose: ALTERNATIVE_PURPOSE }, { db })).rejects.toBeInstanceOf(GuestAiSecurityError);
    expect(calls).toHaveLength(0);
  });

  it("toda consulta é filtrada pelo imóvel do alvo e usa projeção explícita (sem senha, sem texto de distância)", async () => {
    const { calls } = await load(P1, "primary");
    for (const c of calls) {
      expect(c.select).not.toMatch(/\*/);
      expect(c.filters[0]![1]).toBe(P1);
      for (const col of SENSITIVE_PROPERTY_COLUMNS) expect(c.select ?? "").not.toMatch(new RegExp(`(^|, )${col}(,|$)`));
      // minutos só entram com trajeto confirmado (normalize); texto de distância e coordenadas nunca
      expect(c.select ?? "").not.toMatch(/distance_text|cohost_payout|amount/);
      if (c.table === "city_references") expect(c.select ?? "").not.toMatch(/\blat\b|\blng\b|address/);
    }
    expect(new Set(calls.map((c) => c.table))).toEqual(
      new Set(["properties", "property_faqs", "property_checkout_items", "property_emergency_contacts", "property_manual_items", "property_playbook_entries", "property_listing_raw_data", "property_recommendations", "city_reference_group_members", "city_references"]),
    );
  });

  it("revalida a posse na leitura: dono trocado depois de autorizar ⇒ erro de segurança", async () => {
    const tables = portfolioTables();
    const { db } = portfolioDb(tables);
    const d = await authorizeCandidateProperty(turn(), P2, ALTERNATIVE_PURPOSE, { db });
    if (!d.ok) throw new Error();
    (tables.properties!.find((r) => r["id"] === P2) as Record<string, unknown>)["owner_id"] = T2;
    await expect(fetchPropertyDossier(d.target, { db, now: NOW, buildPlaybook: realBuild })).rejects.toBeInstanceOf(GuestAiSecurityError);
  });

  it("candidato arquivado depois de autorizar ⇒ não carrega", async () => {
    const tables = portfolioTables();
    const { db } = portfolioDb(tables);
    const d = await authorizeCandidateProperty(turn(), P2, ALTERNATIVE_PURPOSE, { db });
    if (!d.ok) throw new Error();
    (tables.properties!.find((r) => r["id"] === P2) as Record<string, unknown>)["archived_at"] = "2026-11-03T00:00:00Z";
    await expect(fetchPropertyDossier(d.target, { db, now: NOW, buildPlaybook: realBuild })).rejects.toBeInstanceOf(DossierError);
  });

  it("falha de qualquer consulta ⇒ erro fixo (nada parcial)", async () => {
    const t = primaryDossierTarget(turn(), ["P", "G"]);
    for (const table of ["property_faqs", "property_recommendations", "property_listing_raw_data"]) {
      await expect(fetchPropertyDossier(t, { db: portfolioDb(portfolioTables(), { failTable: table }).db, now: NOW, buildPlaybook: realBuild })).rejects.toThrow("dossier_lookup_failed");
    }
  });

  it("dossiê emitido, congelado e sem colunas protegidas", async () => {
    const { dossier } = await load(P1, "primary");
    expect(isIssuedPropertyDossier(dossier)).toBe(true);
    expect(Object.isFrozen(dossier)).toBe(true);
    expect(Object.isFrozen(dossier.entries)).toBe(true);
    for (const v of ["LOCK-SECRET-1", "GATE-SECRET-1", "WIFIPASS-SECRET-1", "PIN-SECRET-1"]) expect(text(dossier)).not.toContain(v);
    expect(dossier.retrievedAt).toBe("2026-11-03T12:00:00.000Z");
  });
});

describe("B2.2 · dossiê normalizado — cobertura, procedência e exclusões", () => {
  it("principal (P+G): cadastro, FAQ, anúncio, página pública, reviews, manuais com descrição/imagens, recomendações do guia", async () => {
    const { dossier: d } = await load(P1, "primary");
    expect(d.propertyId).toBe(P1);
    expect(d.tenantId).toBe(T1);
    expect(d.role).toBe("primary");
    expect(d.publicName).toBe("Flat Marcador1");
    const ids = d.entries.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["faq:faq-1", "listing:fact:regras", "listing:public:amenities", "listing:public:unavailable", "listing:review:1", "listing:review:1:reply"]));
    expect(d.entries.find((e) => e.id === "listing:review:1")).toMatchObject({ kind: "guest_review", temporal: "historical", observedAt: "2026-09-01T00:00:00Z", source: "listing_channex" });
    expect(d.entries.find((e) => e.id === "listing:public:unavailable")).toMatchObject({ kind: "amenity_unavailable", value: "Secadora" });
    expect(d.manuals).toEqual([{ id: "manual:man-1", title: "TV", description: "Como usar a TV MARCADOR-1", body: "Ligue no botão vermelho. A senha da TV: Netflix55", imageRefs: ["https://cdn.example.com/tv.jpg"] }]);
    // Google Maps como fonte: trajeto confirmado ⇒ distância e minutos; linha reta ⇒ sem distância; link só do Google;
    // "Pela cidade" vem de city_references (o antigo scope=city de property_recommendations não entra); oculta não entra
    expect(d.places).toEqual([
      { id: "rec:rec-1", scope: "nearby", name: "Padaria P1", category: "padaria", type: "bakery", rating: 4.7, ratingsTotal: 120, openingHours: ["seg–sáb 6h–20h"], note: "Ótimo pão", mapsUrl: "https://maps.google.com/?cid=1", route: { meters: 350, walkMinutes: 4, driveMinutes: 1 } },
      { id: "rec:rec-4", scope: "nearby", name: "Farmácia P1", category: "farmácia", type: "pharmacy", rating: 4.1, ratingsTotal: 80, openingHours: null, note: null, mapsUrl: null, route: null },
      { id: "cref:cref-1", scope: "city", name: "Mirante P1", category: "Atrações", type: "attraction", rating: 4.8, ratingsTotal: 5000, openingHours: null, note: null, mapsUrl: "https://www.google.com/maps/place/?q=place_id:x", route: null },
    ]);
    expect(d.completeness.sourcesPresent).toEqual(expect.arrayContaining(["property_recommendations", "city_references"]));
    expect(d.mediaRefs).toEqual([{ id: "listing:public:cover", url: expect.stringContaining("p1.jpg"), source: "listing_public_page" }]);
    expect(d.availability).toEqual({ status: "not_consulted" });
  });

  it("exclusões: feedback privado, co-anfitrião, prefixo interno do título, telefone do anfitrião no título, minutos estimados", async () => {
    const { dossier: d } = await load(P1, "primary");
    const t = text(d);
    expect(t).not.toMatch(/PRIVADO-P1|Private feedback|repasse|cohost/i);
    expect(t).not.toMatch(/5511999990000|Conta Sigma/);
    expect(t).not.toMatch(/AP01 -/);
    // minutos presumidos (texto de distância) nunca; minutos só do trajeto confirmado no Google Maps
    expect(t).not.toMatch(/min a pé|min de carro/);
    expect(d.places.filter((p) => p.route === null).every((p) => p.route === null)).toBe(true);
    expect(d.places.find((p) => p.id === "rec:rec-4")!.route).toBeNull();
  });

  it("capacidade com procedência: confirmada, conflito (não escolhe) e desconhecida (não infere)", async () => {
    const p1 = (await load(P1, "primary")).dossier;
    expect(p1.capacity.guests).toEqual({ status: "confirmed", value: 2, sources: ["properties.airbnb_guest_count", "listing.public.guests"] });
    const p2 = (await load(P2, "candidate")).dossier;
    expect(p2.capacity.guests).toEqual({ status: "conflict", values: [{ value: 3, source: "properties.airbnb_guest_count" }, { value: 5, source: "listing.public.guests" }] });
    expect(p2.conflicts.some((c) => c.startsWith("capacity.guests"))).toBe(true);
    const p3 = (await load(P3, "candidate")).dossier;
    expect(p3.capacity.beds).toEqual({ status: "confirmed", value: 4, sources: ["listing.public.beds"] });
    const t = portfolioTables();
    const row = t.properties!.find((r) => r["id"] === P3) as Record<string, unknown>;
    row["airbnb_bathroom_count"] = null;
    (t.property_listing_raw_data!.find((r) => r["property_id"] === P3)!["normalized"] as Record<string, Record<string, unknown>>)["public_listing"]!["bathrooms"] = null;
    const p3b = (await load(P3, "candidate", t)).dossier;
    expect(p3b.capacity.bathrooms).toEqual({ status: "unknown" });
    expect(p3b.unknown).toContain("capacity.bathrooms");
  });

  it("conflito de horário entre anúncio e cadastro é preservado (sem troca silenciosa)", async () => {
    const { dossier } = await load(P1, "primary");
    expect(dossier.conflicts).toContain("checkout_time: anúncio 10:00 × cadastro 11:00");
  });

  it("candidato só com audiência pública: sem endereço, sem manuais (contados como retidos)", async () => {
    const { dossier: d } = await load(P2, "candidate");
    expect(d.role).toBe("candidate");
    expect(d.audiences).toEqual(["P"]);
    expect(text(d)).not.toContain("Rua Privada");
    expect(d.manuals).toEqual([]);
    expect(text(d)).not.toContain("MANUAL-P2");
    expect(d.completeness.withheldByPolicy).toBeGreaterThan(0);
  });

  it("nenhuma mistura: cada dossiê só tem os marcadores do próprio imóvel; outro tenant nunca aparece", async () => {
    const all = await Promise.all([load(P1, "primary"), load(P2, "candidate"), load(P3, "candidate")]);
    all.forEach(({ dossier }, i) => {
      const t = text(dossier);
      // controle positivo: os marcadores do PRÓPRIO imóvel estão lá
      expect(t).toMatch(new RegExp(`MARCADOR-${i + 1}`));
      expect(t).toMatch(new RegExp(`REGRA-LISTING-P${i + 1}`));
      for (let n = 1; n <= 3; n++) {
        if (n === i + 1) continue;
        expect(t, `P${i + 1} contém P${n}`).not.toMatch(new RegExp(`MARCADOR-?${n}\\b|REGRA-(LISTING-)?P${n}\\b|AMENIDADE-P${n}\\b|Padaria P${n === 1 ? 1 : "X"}|Mercado P${n === 3 ? 3 : "X"}`));
      }
      expect(t).not.toContain("DADO-DE-OUTRO-TENANT");
    });
  });
});

describe("B2.2 · normalização — determinismo, imutabilidade, fidelidade", () => {
  const sources = (): DossierSources => {
    const t = portfolioTables();
    const pick = (table: string) => t[table]!.filter((r) => r["property_id"] === P1);
    return {
      property: t.properties!.find((r) => r["id"] === P1)!,
      faqs: pick("property_faqs") as never,
      checkout: pick("property_checkout_items") as never,
      emergency: pick("property_emergency_contacts") as never,
      manuals: pick("property_manual_items") as never,
      entries: [],
      listingNormalized: pick("property_listing_raw_data")[0]!["normalized"],
      recommendations: pick("property_recommendations"),
    };
  };
  const target = { propertyId: P1, tenantId: T1, role: "primary" as const, audiences: ["P", "G"] as const };
  const deepFreeze = <T,>(o: T): T => {
    if (o && typeof o === "object") {
      Object.freeze(o);
      Object.values(o as object).forEach(deepFreeze);
    }
    return o;
  };

  it("determinística (mesma entrada ⇒ mesma saída) e não altera as fontes (entrada congelada)", () => {
    const src = deepFreeze(sources());
    const before = JSON.stringify(src);
    const a = normalizePropertyDossier({ target, sources: src, retrievedAt: "x", buildPlaybook: realBuild });
    const b = normalizePropertyDossier({ target, sources: src, retrievedAt: "x", buildPlaybook: realBuild });
    expect(a).toEqual(b);
    expect(JSON.stringify(src)).toBe(before);
  });

  it("nada é truncado: valor longo chega inteiro; unidades e quantidades preservadas", () => {
    const src = sources();
    const long = "Descrição muito longa. ".repeat(3000);
    (src.listingNormalized as Record<string, Record<string, unknown>>)["public_listing"]!["descriptions"] = [long];
    const d = normalizePropertyDossier({ target, sources: src, retrievedAt: "x", buildPlaybook: realBuild });
    expect(d.entries.find((e) => e.id === "listing:public:description:1")!.value).toBe(long);
    expect(d.places[0]!.route!.meters).toBe(350);
  });

  it("duplicata exata entre fontes vira uma entrada com a procedência adicional (alsoIn)", () => {
    const src = sources();
    (src.listingNormalized as Record<string, Record<string, unknown>>)["public_listing"]!["houseRules"] = "Proibido fumar REGRA-LISTING-P1";
    const d = normalizePropertyDossier({ target, sources: src, retrievedAt: "x", buildPlaybook: realBuild });
    const same = d.entries.filter((e) => e.value === "Proibido fumar REGRA-LISTING-P1");
    expect(same).toHaveLength(1);
    expect(same[0]!.alsoIn).toEqual(["listing_public_page"]);
  });

  it("linha de outro imóvel ⇒ erro (fail-closed); alvo inválido ⇒ erro", () => {
    const src = sources();
    expect(() => normalizePropertyDossier({ target, sources: { ...src, recommendations: [{ ...src.recommendations[0]!, property_id: P2 }] }, retrievedAt: "x", buildPlaybook: realBuild })).toThrow("cross_property_row");
    expect(() => normalizePropertyDossier({ target: { ...target, propertyId: P2 }, sources: src, retrievedAt: "x", buildPlaybook: realBuild })).toThrow("cross_property_row");
    expect(() => normalizePropertyDossier({ target: { ...target, role: "candidate" }, sources: src, retrievedAt: "x", buildPlaybook: realBuild })).toThrow("candidate_cannot_have_reservation_audience");
    expect(() => normalizePropertyDossier({ target: { ...target, audiences: ["G"] as never }, sources: src, retrievedAt: "x", buildPlaybook: realBuild })).toThrow("audiences_invalid");
    expect(() => normalizePropertyDossier({ target: { ...target, audiences: ["P", "I"] as never }, sources: src, retrievedAt: "x", buildPlaybook: realBuild })).toThrow("audiences_invalid");
  });

  it("fontes ausentes: dossiê mínimo com desconhecidos explícitos, sem inventar", () => {
    const t = portfolioTables();
    const d = normalizePropertyDossier({
      target,
      sources: { property: { id: P1, name: null }, faqs: [], checkout: [], emergency: [], manuals: [], entries: [], listingNormalized: null, recommendations: [] },
      retrievedAt: "x",
      buildPlaybook: realBuild,
    });
    expect(d.capacity).toEqual({ guests: { status: "unknown" }, bedrooms: { status: "unknown" }, beds: { status: "unknown" }, bathrooms: { status: "unknown" } });
    expect(d.unknown).toEqual(expect.arrayContaining(["capacity.guests", "capacity.beds", "public_name"]));
    expect(d.completeness.sourcesMissing).toEqual(expect.arrayContaining(["listing_channex", "listing_public_page", "property_recommendations"]));
    expect(d.places).toEqual([]);
    expect(t).toBeTruthy();
  });
});

describe("B2.2 · disponibilidade separada das características", () => {
  it("dossiê nasce com disponibilidade NÃO consultada (nunca inferida das características)", async () => {
    const { dossier } = await load(P2, "candidate");
    expect(dossier.availability).toEqual({ status: "not_consulted" });
  });
  it("disponibilidade de um imóvel nunca serve a outro", async () => {
    const { dossier } = await load(P2, "candidate");
    const forP3 = { status: "confirmed_available" as const, propertyId: P3, checkIn: "2026-12-01", checkOut: "2026-12-05", source: "fonte-futura", consultedAt: "2026-11-03T12:00:00Z" };
    expect(() => withAvailability(dossier, forP3)).toThrow("availability_property_mismatch");
    const ok = withAvailability(dossier, { ...forP3, propertyId: P2 });
    expect(ok.availability).toMatchObject({ status: "confirmed_available", propertyId: P2 });
    expect(isIssuedPropertyDossier(ok)).toBe(true);
    expect(dossier.availability).toEqual({ status: "not_consulted" }); // original intacto
  });
  it("estado de disponibilidade inválido é recusado; dossiê não emitido é recusado", async () => {
    const { dossier } = await load(P2, "candidate");
    const base = { status: "confirmed_unavailable" as const, propertyId: P2, source: "x", consultedAt: "y" };
    expect(() => assertAvailabilityFor(dossier, { ...base, checkIn: "2026-12-05", checkOut: "2026-12-01" })).toThrow("availability_invalid");
    expect(() => assertAvailabilityFor(dossier, { ...base, checkIn: "05/12", checkOut: "2026-12-06" })).toThrow("availability_invalid");
    expect(() => assertAvailabilityFor(dossier, { status: "maybe" } as never)).toThrow("availability_invalid");
    expect(() => withAvailability({ ...dossier }, { status: "not_consulted" })).toThrow("dossier_not_issued");
  });
  it("compatibilidade: confirmada/incompatível só com valor confirmado; conflito e ausência = desconhecida", async () => {
    const p1 = (await load(P1, "primary")).dossier;
    expect(assessGuestCapacity(p1.capacity, 2)).toEqual({ status: "confirmed", evidence: ["properties.airbnb_guest_count", "listing.public.guests"] });
    expect(assessGuestCapacity(p1.capacity, 3).status).toBe("incompatible");
    const p2 = (await load(P2, "candidate")).dossier;
    expect(assessGuestCapacity(p2.capacity, 4)).toEqual({ status: "unknown", reason: "conflicting_sources" });
    expect(assessGuestCapacity({ ...p2.capacity, guests: { status: "unknown" } }, 1)).toEqual({ status: "unknown", reason: "not_informed" });
    expect(() => assessGuestCapacity(p1.capacity, 0)).toThrow("need_invalid");
  });
});

describe("B2.2 · projeções novas existem no banco real e excluem o proibido", () => {
  // + distance_kind (migration 20261107030000)
  const REC_REAL = ["id", "property_id", "scope", "type", "name", "category", "rating", "distance_text", "distance_meters", "drive_minutes", "note", "image_url", "maps_url", "place_id", "position", "created_at", "user_ratings_total", "walk_minutes", "opening_hours", "last_synced_at", "distance_kind"];
  it("colunas reais (snapshot de produção)", () => {
    expect(PROPERTY_ACCESS_COLUMNS.filter((c) => !REAL_COLUMNS["properties"]!.includes(c))).toEqual([]);
    expect(MANUAL_DOSSIER_COLUMNS.filter((c) => !REAL_COLUMNS["property_manual_items"]!.includes(c))).toEqual([]);
    expect(RECOMMENDATION_PUBLIC_COLUMNS.filter((c) => !REC_REAL.includes(c))).toEqual([]);
  });
  it("recomendações sem texto de distância derivado (minutos só com trajeto confirmado); acesso sem segredo", () => {
    for (const c of ["distance_text", "image_url", "place_id", "last_synced_at"]) expect(RECOMMENDATION_PUBLIC_COLUMNS as readonly string[]).not.toContain(c);
    expect(RECOMMENDATION_PUBLIC_COLUMNS as readonly string[]).toContain("distance_kind");
    for (const c of SENSITIVE_PROPERTY_COLUMNS) {
      expect(PROPERTY_ACCESS_COLUMNS as readonly string[]).not.toContain(c);
      expect(MANUAL_DOSSIER_COLUMNS as readonly string[]).not.toContain(c);
    }
  });
  it("registro: alvo emitido não pode ser recriado por cópia; emissão manual é a única via", () => {
    const t = issueDossierTarget({ propertyId: P2, tenantId: T1, role: "candidate", audiences: ["P"], purpose: ALTERNATIVE_PURPOSE });
    expect(isIssuedDossierTarget(t)).toBe(true);
    expect(isIssuedDossierTarget({ ...t })).toBe(false);
  });
});

describe("B2.2 · loader — defesa em profundidade contra linha de outro imóvel", () => {
  it("se o banco ignorar o filtro do anúncio, linhas de outros imóveis/tenants são descartadas", async () => {
    const tables = portfolioTables();
    // linhas estrangeiras PRIMEIRO: sem o filtro local, o loader pegaria a de outro tenant
    tables.property_listing_raw_data = [...tables.property_listing_raw_data!].reverse();
    const { db } = portfolioDb(tables, { ignoreFiltersOn: "property_listing_raw_data" });
    const target = primaryDossierTarget(turn(), ["P", "G"]);
    const d = await fetchPropertyDossier(target, { db, now: NOW, buildPlaybook: realBuild });
    const t = text(d);
    expect(t).toContain("REGRA-LISTING-P1");
    for (const n of [2, 3, 9]) {
      expect(t).not.toContain(`REGRA-LISTING-P${n}`);
      expect(t).not.toContain(`AMENIDADE-P${n}`);
    }
  });
});
