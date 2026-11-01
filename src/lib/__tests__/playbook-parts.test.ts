import { describe, expect, it } from "vitest";
import { partsFromProperty, partsToColumns } from "@/lib/playbook-parts";

describe("playbook-parts", () => {
  it("lê as partes do imóvel como texto", () => {
    const v = partsFromProperty("limpeza_operacional", { cleaning_price_normal_cents: 15000, cleaning_duration_normal_minutes: 180 });
    expect(v).toMatchObject({ price_normal: "15000", dur_normal: "180", price_full: "", dur_full: "" });
  });
  it("converte para colunas e valida", () => {
    const c = partsToColumns("limpeza_operacional", { price_normal: "15000", dur_normal: "180", price_full: "", dur_full: "" });
    expect(c).toEqual({ cleaning_price_normal_cents: 15000, cleaning_duration_normal_minutes: 180, cleaning_price_full_cents: null, cleaning_duration_full_minutes: null });
    expect(() => partsToColumns("limpeza_operacional", { dur_normal: "45" })).toThrow();
    expect(() => partsToColumns("horario_de_check_in", { checkin_time: "25:00" })).toThrow();
  });
  it("apartamento e andar só valem com condomínio ligado", () => {
    const off = partsToColumns("imovel_em_condominio", { in_condominium: "false", apartment_number: "302", apartment_floor: "3" });
    expect(off).toEqual({ in_condominium: false, apartment_number: null, apartment_floor: null });
    const on = partsToColumns("imovel_em_condominio", { in_condominium: "true", apartment_number: "302", apartment_floor: "3" });
    expect(on).toMatchObject({ in_condominium: true, apartment_number: "302", apartment_floor: "3" });
  });
});
