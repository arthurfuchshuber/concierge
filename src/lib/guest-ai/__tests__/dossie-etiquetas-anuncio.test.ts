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
