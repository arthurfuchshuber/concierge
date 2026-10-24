import { describe, expect, it } from "vitest";
import {
  VALIDADE_SERVICO_MS,
  chaveRascunhoServico,
  rascunhoServicoValido,
  rascunhoServicoVazio,
  type RascunhoServico,
} from "@/lib/offline/service-draft";

const base: RascunhoServico = {
  criadoEm: 1_000_000,
  situationId: "damage",
  step: 3,
  link: "reserva",
  propertyId: "p1",
  reservationId: "r1",
  providerId: null,
  date: null,
  cents: 0,
  centsEdited: false,
  title: "",
  note: "",
  midias: [],
};

describe("rascunho do novo serviço", () => {
  it("uma chave por situação", () => {
    expect(chaveRascunhoServico("damage")).not.toBe(chaveRascunhoServico("maintenance"));
  });
  it("sem nenhuma resposta é vazio; com vínculo ou texto não é", () => {
    expect(rascunhoServicoVazio({ ...base, link: null, propertyId: null })).toBe(true);
    expect(rascunhoServicoVazio(base)).toBe(false);
    expect(rascunhoServicoVazio({ ...base, link: null, propertyId: null, title: "Pia" })).toBe(false);
  });
  it("vale por 48h", () => {
    expect(rascunhoServicoValido(base, base.criadoEm + VALIDADE_SERVICO_MS)).toBe(true);
    expect(rascunhoServicoValido(base, base.criadoEm + VALIDADE_SERVICO_MS + 1)).toBe(false);
    expect(rascunhoServicoValido(null)).toBe(false);
  });
});
