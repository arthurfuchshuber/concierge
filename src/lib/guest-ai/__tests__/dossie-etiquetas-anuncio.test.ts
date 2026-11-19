/**
 * Caso Larissa (19/11/2026) e auditoria integral do dossiê: todo dado do anúncio chega à IA, cada um com a
 * etiqueta de audiência do Dossiê. O que o Airbnb só libera a quem reservou (trajeto, instruções de check-in e
 * de check-out, manual da casa) é G; o resto é P. Marcações do Guia Digital viram texto puro.
 */
import { describe, expect, it } from "vitest";
import { buildPlaybook } from "@/lib/playbook-build";
import { normalizePropertyDossier, type DossierSources } from "@/lib/guest-ai/dossier/normalize";
import { listingFactAudience, pickNormalized } from "@/lib/guest-ai/data/listing-normalized";
import { propertyStructureText } from "@/lib/airbnb-host-api";
import { plainGuideTags } from "@/lib/guide-tags";

const P = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";

const rawListing = {
  check_in_option: {
    category: "other_checkin",
    instruction: "1. Abriremos o portão da garagem remotamente para vocês.\n2. Utilize a senha que estará em [[tag:senhas-acesso]] no dia da chegada.",
  },
  house_manual: "Toalhas e edredom estão nos armários.",
  property_details: { listing_size: { size: 115, size_unit: "SQUARE_METERS" }, listing_floor: 1, number_of_floors: 1, year_built: 2021 },
  listing_views: ["COURTYARD_VIEW", "GARDEN_VIEW"],
};

function sources(): DossierSources {
  return {
    property: { id: P, name: "Casa Completa", owner_id: T },
    faqs: [{ id: "f1", question: "Como faço o check-in?", answer: "A senha fica em [[tag:senhas-acesso|Senhas]]." }],
    checkout: [],
    emergency: [],
    manuals: [],
    entries: [],
    recommendations: [],
    listingNormalized: {
      facts: [
        { key: "descricao_0", title: "Descrição", content: "Casa completa." },
        { key: "como_chegar", title: "Orientações de Trajeto (Airbnb)", content: "Entrada pelo portão lateral, ligue (45) 90000-0000." },
        { key: "tarefas_checkout", title: "Instruções de Check-out do Anúncio", content: "• Deixe as chaves no cofre." },
      ],
      host_listing: { photos: [], rooms: [], checkoutTasks: [], raw: { listing: { listing: rawListing } } },
    },
  } as unknown as DossierSources;
}

const run = (audiences: Array<"P" | "G">) =>
  normalizePropertyDossier({
    target: { propertyId: P, tenantId: T, role: "primary", audiences },
    sources: sources(),
    retrievedAt: "2026-11-19T12:00:00Z",
    buildPlaybook: buildPlaybook as never,
  });

const ids = (d: ReturnType<typeof run>) => d.entries.map((e) => e.id);

describe("dossiê · etiquetas dos fatos do anúncio", () => {
  it("trajeto, instruções de check-in/check-out e manual da casa são G", () => {
    for (const k of ["como_chegar", "instrucoes_checkin", "tarefas_checkout", "manual_casa_anuncio"]) expect(listingFactAudience(k)).toBe("G");
    for (const k of ["descricao_0", "regras_publicas", "estrutura_imovel", "comodidades"]) expect(listingFactAudience(k)).toBe("P");
  });

  it("pré-reserva (só P): nada que é G chega, e conta como retido por política", () => {
    const d = run(["P"]);
    expect(ids(d)).toContain("listing:fact:descricao_0");
    expect(ids(d)).toContain("listing:fact:estrutura_imovel");
    for (const k of ["como_chegar", "instrucoes_checkin", "tarefas_checkout", "manual_casa_anuncio"]) expect(ids(d)).not.toContain(`listing:fact:${k}`);
    expect(d.completeness.withheldByPolicy).toBeGreaterThanOrEqual(4);
  });

  it("reserva ativa (P+G): tudo chega, com a etiqueta G", () => {
    const d = run(["P", "G"]);
    const ci = d.entries.find((e) => e.id === "listing:fact:instrucoes_checkin")!;
    expect(ci.audience).toBe("G");
    expect(ci.value).toContain("Abriremos o portão da garagem remotamente");
    expect(d.entries.find((e) => e.id === "listing:fact:manual_casa_anuncio")!.audience).toBe("G");
    expect(d.entries.find((e) => e.id === "listing:fact:como_chegar")!.audience).toBe("G");
  });

  it("marcações do Guia Digital viram texto puro (anúncio e FAQ), sem colchetes", () => {
    const d = run(["P", "G"]);
    const ci = d.entries.find((e) => e.id === "listing:fact:instrucoes_checkin")!.value;
    expect(ci).toContain("Guia Digital (Senhas de acesso)");
    expect(d.entries.some((e) => e.value.includes("[["))).toBe(false);
    expect(plainGuideTags("Veja [[tag:senhas-acesso|Senhas]] e [[info:wifi-password]].")).toBe("Veja Guia Digital (Senhas) e Wi-Fi — senha.");
  });

  it("fatos do anfitrião são recalculados na leitura a partir do bruto já guardado", () => {
    const n = pickNormalized(sources().listingNormalized, "Casa Completa")!;
    const keys = n.facts.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["instrucoes_checkin", "manual_casa_anuncio", "estrutura_imovel"]));
  });

  it("estrutura do imóvel: área, andar, pavimentos, ano, vista e método de check-in", () => {
    expect(propertyStructureText(rawListing)).toBe(
      "Área: 115 m²\nAndar do imóvel: térreo\nPavimentos do edifício/casa: 1\nAno de construção: 2021\nVista: pátio, jardim\nMétodo de check-in: Outro método de check-in",
    );
    expect(propertyStructureText({ property_details: { listing_size: {} } })).toBeNull();
  });
});

describe("dossiê · andar (P), apartamento e vaga (G), silêncio e comodidades da API", () => {
  const apiListing = {
    property_details: { listing_floor: 3, listing_size: { size: 35, size_unit: "SQUARE_METERS" } },
    quiet_hours: [{ start_time: "23", end_time: "7" }],
    amenities: {
      AC: { is_present: true, metadata: { ac: { ac_options: ["SPLIT_TYPE_DUCTLESS"] } } },
      TV: { is_present: true, metadata: { tv: { size_in_inch: 55 } } },
      FREE_PARKING: { is_present: true, metadata: { parking: { number_of_spaces: 1, parking_type: "RESIDENTIAL_GARAGE" } } },
      CARBON_MONOXIDE_DETECTOR: { is_present: false },
    },
  };
  const withApi = (): DossierSources => {
    const base = sources() as unknown as Record<string, any>;
    return {
      ...base,
      property: {
        ...base.property,
        in_condominium: true,
        apartment_number: "302",
        apartment_floor: "2º andar",
        parking_spots: ["14"],
        airbnb_house_rules: "Proibido festas",
        airbnb_amenities: [
          { name: "Ar-condicionado", available: true },
          { name: "TV", available: true },
          { name: "Estacionamento gratuito no local", available: true },
        ],
      },
      listingNormalized: { facts: [], host_listing: { photos: [], rooms: [], checkoutTasks: [], raw: { listing: { listing: apiListing }, rooms: { listing_rooms: [] } } } },
    } as unknown as DossierSources;
  };
  const runApi = (audiences: Array<"P" | "G">) =>
    normalizePropertyDossier({
      target: { propertyId: P, tenantId: T, role: "primary", audiences },
      sources: withApi(),
      retrievedAt: "2026-11-19T12:00:00Z",
      buildPlaybook: buildPlaybook as never,
    });
  const byLabel = (d: ReturnType<typeof runApi>, label: string) => d.entries.find((e) => e.label === label);

  it("andar do imóvel é P: aparece na pré-reserva, em Elevador e escadas, sem o número do apartamento", () => {
    const d = runApi(["P"]);
    const elev = byLabel(d, "Elevador e escadas")!;
    expect(elev.audience).toBe("P");
    expect(elev.value).toContain("Andar do imóvel: 2º andar");
    const condo = byLabel(d, "Imóvel em condomínio")!;
    expect(condo.audience).toBe("P");
    expect(condo.value).toBe("Sim");
    expect(d.entries.some((e) => e.value.includes("302") || e.value.includes("Vaga 14"))).toBe(false);
    expect(byLabel(d, "Apartamento e vaga")).toBeUndefined();
  });

  it("número do apartamento e vaga privativa são G: só com reserva ativa", () => {
    const d = runApi(["P", "G"]);
    const row = byLabel(d, "Apartamento e vaga")!;
    expect(row.audience).toBe("G");
    expect(row.value).toBe("Apto 302 · Vaga 14");
  });

  it("horário de silêncio vem do dado estruturado da API, mesmo sem a frase nas regras", () => {
    expect(byLabel(runApi(["P"]), "Horário de silêncio")!.value).toBe("23:00 às 07:00");
  });

  it("vagas de garagem (P) trazem tipo e quantidade da API; sem identificador de vaga", () => {
    const v = byLabel(runApi(["P"]), "Vagas de garagem")!;
    expect(v.audience).toBe("P");
    expect(v.value).toContain("1 vaga");
    expect(v.value).toContain("garagem residencial");
    expect(v.value).not.toContain("14");
  });

  it("comodidades do Playbook ganham o detalhe da API; ausentes declaradas entram", () => {
    const d = runApi(["P"]);
    expect(byLabel(d, "Climatização")!.value).toContain("Ar-condicionado: split");
    expect(byLabel(d, "Entretenimento")!.value).toContain("TV: 55 polegadas");
    expect(byLabel(d, "Ausentes no anúncio")!.value).toContain("Detector de monóxido de carbono");
  });

  it("estrutura (área em m²) e silêncio são fatos P para a IA; nada disso é retido na pré-reserva", () => {
    const d = runApi(["P"]);
    expect(d.entries.find((e) => e.id === "listing:fact:estrutura_imovel")!.value).toContain("Área: 35 m²");
    // o fato tem o mesmo texto da linha do Playbook: o Dossiê funde os dois e registra a origem extra
    const silencio = byLabel(d, "Horário de silêncio")!;
    expect(silencio.audience).toBe("P");
    expect(silencio.alsoIn).toContain("listing_channex");
  });
});

describe("dossiê · fatos descobertos sozinhos (extra_*) respeitam a etiqueta", () => {
  const raw = { ev_charger_speed: "FAST_CHARGER", key_pickup_location: "Cofre ao lado do portão", lockbox_code: "4821" };
  const src = (): DossierSources => {
    const base = sources() as unknown as Record<string, any>;
    return { ...base, listingNormalized: { facts: [], host_listing: { photos: [], rooms: [], checkoutTasks: [], raw: { listing: { listing: raw } } } } } as unknown as DossierSources;
  };
  const go = (audiences: Array<"P" | "G">) =>
    normalizePropertyDossier({ target: { propertyId: P, tenantId: T, role: "primary", audiences }, sources: src(), retrievedAt: "2026-11-19T12:00:00Z", buildPlaybook: buildPlaybook as never });

  it("pré-reserva vê o fato público; o de acesso fica retido e contado", () => {
    const d = go(["P"]);
    expect(d.entries.find((e) => e.id === "listing:fact:extra_ev_charger_speed")!.audience).toBe("P");
    expect(d.entries.some((e) => e.id === "listing:fact:extra_key_pickup_location")).toBe(false);
    expect(d.completeness.withheldByPolicy).toBeGreaterThanOrEqual(1);
  });

  it("reserva ativa vê os dois, e a credencial nunca aparece", () => {
    const d = go(["P", "G"]);
    expect(d.entries.find((e) => e.id === "listing:fact:extra_key_pickup_location")!.audience).toBe("G");
    expect(d.entries.some((e) => e.value.includes("4821"))).toBe(false);
  });
});
