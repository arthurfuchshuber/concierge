import { describe, expect, it } from "vitest";
import { hostFacts, type HostListing } from "@/lib/airbnb-host-api";

const base = { checkoutTasks: [], rooms: [], photos: [], fetchedAt: "2026-11-19T00:00:00Z" } as unknown as HostListing;
const INSTR = "1. Abriremos o portão da garagem remotamente para vocês.\n2. O controle e as chaves estarão no cadeado-cofre.";

describe("instruções de check-in do anúncio no dossiê (casos Larissa e Whyll, 19/11/2026)", () => {
  it("vem do campo novo", () => {
    const f = hostFacts({ ...base, checkInInstruction: INSTR, houseManual: "Tudo no Guia Digital." });
    expect(f.find((x) => x.key === "instrucoes_checkin")?.content).toContain("portão da garagem remotamente");
    expect(f.find((x) => x.key === "manual_casa_anuncio")?.content).toBe("Tudo no Guia Digital.");
  });
  it("anúncio já sincronizado: lê do bruto guardado (listing.listing)", () => {
    const h = { ...base, raw: { listing: { listing: { check_in_option: { category: "other_checkin", instruction: INSTR }, house_manual: "Manual" } } } } as HostListing;
    const f = hostFacts(h);
    expect(f.find((x) => x.key === "instrucoes_checkin")?.content).toContain("remotamente");
    expect(f.find((x) => x.key === "manual_casa_anuncio")?.content).toBe("Manual");
  });
  it("nunca leva a senha do Wi-Fi do bruto para os fatos", () => {
    const h = { ...base, raw: { listing: { listing: { wifi_password: "segredo123", check_in_option: { instruction: INSTR } } } } } as HostListing;
    expect(JSON.stringify(hostFacts(h))).not.toContain("segredo123");
  });
});
