/**
 * Auditoria do dossiê (08/11/2026): as configurações do anúncio (horários de check-in/out, regras, avisos,
 * cancelamento, preços/taxas, estadia) vêm do `rate_plans[].settings` do canal da Channex. Antes elas só
 * eram gravadas na importação e reaproveitadas para sempre — o Studio 3 ficou sem horário-limite de
 * check-in e taxas de limpeza antigas seguiam no dossiê. Agora toda leitura do canal regrava o que mudou.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { freshSettingsByListing } from "@/lib/channex-entity-sync.server";

describe("freshSettingsByListing", () => {
  it("mapeia listing_id → configurações; vazio nunca entra (não apaga o gravado)", () => {
    const m = freshSettingsByListing([
      {
        attributes: {
          rate_plans: [
            { settings: { listing_id: "1784434111056512008", booking_setting: { check_in_time_start: "15", check_in_time_end: "23" } } },
            { settings: { listing_id: "999" } }, // só o id: sem conteúdo
            { settings: null },
            { settings: {} },
          ],
        },
      },
      { attributes: { rate_plans: [{ settings: { listing_id: "1668247859065922881", pricing_setting: { guests_included: 4 } } }] } },
      {},
    ]);
    expect([...m.keys()].sort()).toEqual(["1668247859065922881", "1784434111056512008"]);
    expect((m.get("1784434111056512008")!["booking_setting"] as Record<string, string>)["check_in_time_end"]).toBe("23");
  });
});

describe("sincronização de entidades usa as configurações frescas do canal", () => {
  const src = readFileSync(path.join(process.cwd(), "src/lib/channex-entity-sync.server.ts"), "utf8");
  it("compara com o gravado e marca para reaplicar quando mudou", () => {
    expect(src).toContain("const settingsByListing = freshSettingsByListing(channels);");
    expect(src).toMatch(/stableStringify\(fresh\) === stableStringify\(r\.raw_settings \?\? \{\}\)/);
  });
  it("reaplica no imóvel e nos fatos com as frescas e regrava raw_settings", () => {
    expect(src).toContain("const settings = fresh ?? rr?.raw_settings ?? {};");
    expect(src).toContain("applyListingToProperty({ propertyId, listingId: lid, meta, settings, pub: null })");
    expect(src).toContain("...(fresh ? { raw_settings: fresh } : {}),");
  });
});
