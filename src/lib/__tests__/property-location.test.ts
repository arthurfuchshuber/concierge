import { describe, it, expect } from "vitest";
import {
  addressWithComplement,
  complementItems,
  complementLine,
  complementMessageLines,
  floorLabel,
  normalizeParkingSpots,
  spotsLabel,
} from "@/lib/property-location";

const FULL = {
  in_condominium: true,
  apartment_number: "302",
  apartment_floor: "3",
  parking_spots: ["14", "15"],
  has_elevator: true,
};

describe("complemento do endereço (condomínio)", () => {
  it("monta a linha na ordem de leitura", () => {
    expect(complementLine(FULL)).toBe("Apto 302 · 3º andar · Vagas 14 e 15 · Com elevador");
  });

  it("com a chave desligada nada aparece, mesmo com valores guardados", () => {
    expect(complementLine({ ...FULL, in_condominium: false })).toBeNull();
    expect(complementItems({ ...FULL, in_condominium: null })).toEqual([]);
    expect(addressWithComplement("Rua A, 1", { ...FULL, in_condominium: false })).toBe("Rua A, 1");
  });

  it("só mostra o que foi preenchido", () => {
    expect(complementLine({ in_condominium: true, apartment_number: " 12 " })).toBe("Apto 12");
    expect(complementLine({ in_condominium: true })).toBeNull();
  });

  it("elevador: sim, não e não informado", () => {
    expect(complementLine({ in_condominium: true, has_elevator: false })).toBe("Sem elevador");
    expect(complementLine({ in_condominium: true, has_elevator: null })).toBeNull();
  });

  it("andar: número vira ordinal, texto fica como escrito", () => {
    expect(floorLabel("3")).toBe("3º andar");
    expect(floorLabel("03")).toBe("3º andar");
    expect(floorLabel("Térreo")).toBe("Térreo");
    expect(floorLabel("  ")).toBeNull();
  });

  it("vagas: singular, plural e lista", () => {
    expect(spotsLabel(["14"])).toBe("Vaga 14");
    expect(spotsLabel(["14", "15"])).toBe("Vagas 14 e 15");
    expect(spotsLabel(["14", "15", "16"])).toBe("Vagas 14, 15 e 16");
    expect(spotsLabel([])).toBeNull();
  });

  it("limpa a lista de vagas: vazios e repetidas saem", () => {
    expect(normalizeParkingSpots(["14", " ", "14", "15 ", "a  b"])).toEqual(["14", "15", "a b"]);
  });

  it("mensagem de WhatsApp: prédio numa linha, vaga na outra", () => {
    expect(complementMessageLines(FULL)).toEqual([
      "🏢 Apto 302 · 3º andar · Com elevador",
      "🚗 Vagas 14 e 15",
    ]);
    expect(complementMessageLines({ in_condominium: true, parking_spots: ["7"] })).toEqual(["🚗 Vaga 7"]);
  });

  it("copiar endereço leva o complemento na linha de baixo", () => {
    expect(addressWithComplement("R. Maracatu, 621", FULL)).toBe(
      "R. Maracatu, 621\nApto 302 · 3º andar · Vagas 14 e 15 · Com elevador",
    );
  });
});
