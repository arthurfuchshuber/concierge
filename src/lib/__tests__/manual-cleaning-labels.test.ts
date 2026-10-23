import { describe, expect, it } from "vitest";
import { providerActivityLabel, reservationGuestLine } from "@/lib/manual-cleaning-labels";

describe("providerActivityLabel", () => {
  it("usa o rótulo do cadastro de prestadores", () => {
    expect(providerActivityLabel("limpeza", null)).toBe("Limpeza");
    expect(providerActivityLabel("manutencao", null)).toBe("Manutenção");
  });
  it("cai na primeira categoria quando a principal está vazia", () => {
    expect(providerActivityLabel("", ["jardinagem", "piscina"])).toBe("Jardinagem");
  });
  it("categoria desconhecida vira Title simples; vazio vira null", () => {
    expect(providerActivityLabel("pintura", null)).toBe("Pintura");
    expect(providerActivityLabel(null, null)).toBeNull();
  });
});

describe("reservationGuestLine", () => {
  it("prefere o nome do formulário do guia", () => {
    expect(reservationGuestLine("Diego Do CARMO", "HM3WPKRQWM", null, null)).toBe(
      "Hóspede: Diego Do CARMO",
    );
  });
  it("sem nome, mostra o código quando o hint é um código", () => {
    expect(reservationGuestLine(null, "HM3WPKRQWM", null, null)).toBe("Cód. Reserva: HM3WPKRQWM");
  });
  it("hint que é nome vira Hóspede", () => {
    expect(reservationGuestLine(null, "Lucas Machado", null, null)).toBe("Hóspede: Lucas Machado");
  });
  it("acha o código no link/uid quando não há hint", () => {
    expect(
      reservationGuestLine(null, null, "x", "https://airbnb.com/hosting/reservations/details/HM3WPKRQWM"),
    ).toBe("Cód. Reserva: HM3WPKRQWM");
    expect(reservationGuestLine(null, null, null, null)).toBe("Reserva");
  });
});
