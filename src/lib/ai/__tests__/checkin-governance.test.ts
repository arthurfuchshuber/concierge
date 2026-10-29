import { describe, expect, it } from "vitest";
import {
  decideContingency,
  detectArrivalTime,
  holdBridgeText,
  isGuestPressing,
  isLateArrival,
  isPreparatoryCredentialQuestion,
  mentionsThirdPartyArrival,
} from "@/lib/ai/checkin-governance";

describe("chegada depois do limite de check-in", () => {
  it("caso Fernanda: 2 da manhã com limite 23:00 é fora do padrão", () => {
    const a = detectArrivalTime("Os hóspedes vão chegar às 2 da manhã");
    expect(a).toBe(120);
    expect(isLateArrival({ arrival: a, checkinMax: "23:00" })).toBe(true);
  });
  it("22h com limite 23:00 está dentro", () => {
    expect(isLateArrival({ arrival: detectArrivalTime("vamos chegar às 22h"), checkinMax: "23:00" })).toBe(false);
  });
  it("horário autorizado pela equipe às 02h00 libera", () => {
    expect(isLateArrival({ arrival: 120, checkinMax: "23:00", staffTime: "02h00" })).toBe(false);
  });
  it("'chego às 2' sem manhã/madrugada não vira madrugada", () => {
    expect(detectArrivalTime("chego às 2")).toBeNull();
  });
});

describe("terceiros", () => {
  it("'os hóspedes vão chegar' é terceiro", () => expect(mentionsThirdPartyArrival("Os hóspedes vão chegar às 2")).toBe(true));
  it("'vamos chegar' não é terceiro", () => expect(mentionsThirdPartyArrival("vamos chegar às 20h")).toBe(false));
});

describe("contingência", () => {
  it("autônomo + verificado + credenciais conduz", () =>
    expect(decideContingency({ autonomous: true, verified: true, hasCredentials: true })).toBe("conduct"));
  it("sem acesso autônomo segura", () =>
    expect(decideContingency({ autonomous: false, verified: true, hasCredentials: true })).toBe("hold"));
  it("reserva não verificada segura", () =>
    expect(decideContingency({ autonomous: true, verified: false, hasCredentials: true })).toBe("hold"));
  it("ponte de espera pede para aguardar e promete retorno", () => {
    const t = holdBridgeText("fernanda", false, 0);
    expect(t).toMatch(/aguarde/);
    expect(t).toMatch(/retornamos por aqui/);
  });
  it("cobrança e chegada contam; 'ok' não", () => {
    expect(isGuestPressing("estou chegando")).toBe(true);
    expect(isGuestPressing("já estou aqui na frente")).toBe(true);
    expect(isGuestPressing("e aí, posso?")).toBe(true);
    expect(isGuestPressing("ok")).toBe(false);
  });
});

describe("presença física antes do acesso", () => {
  it("perguntar como achar a senha é preparatório", () =>
    expect(isPreparatoryCredentialQuestion("Como eu acho a senha pra entrar na casa? Não tô conseguindo acessar o guia digital")).toBe(true));
  it("'cheguei e não abre' não é preparatório", () =>
    expect(isPreparatoryCredentialQuestion("cheguei e o cofre não abre, qual a senha?")).toBe(false));
});
