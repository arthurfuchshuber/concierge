/**
 * Playbook de cancelamento do Airbnb (artigo 475, 10/11/2026): o SISTEMA calcula o prazo sem custo da reserva;
 * a modalidade nunca é presumida; o roteiro decide pelo fato calculado.
 */
import { describe, expect, it } from "vitest";
import { freeCancellationStatus, resolveCancellationPolicy } from "@/lib/guest-ai/playbooks/airbnb-cancellation";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";

const d = (s: string) => new Date(s);
const CHECKIN = d("2026-11-22T18:00:00Z"); // 15:00 em São Paulo
const base = { checkInAt: CHECKIN, nights: 2, bookedAt: d("2026-10-01T12:00:00Z"), isNonRefundable: false as boolean | null };

describe("Playbook de cancelamento · cálculo do prazo sem custo", () => {
  it("não reembolsável (caso Fabiano): encerrado, salvo as primeiras 24 h de reserva feita ≥ 7 dias antes", () => {
    const f = { ...base, category: "tiered_pricing_non_refundable", isNonRefundable: true };
    expect(freeCancellationStatus({ ...f, now: d("2026-11-10T23:00:00Z") })).toMatchObject({ status: "closed", policyLabel: "Não reembolsável" });
    expect(freeCancellationStatus({ ...f, now: d("2026-10-02T11:00:00Z") })).toMatchObject({ status: "open" });
    expect(freeCancellationStatus({ ...f, now: d("2026-10-02T12:00:01Z") }).status).toBe("closed");
    // reservada a menos de 7 dias do check-in ⇒ sem janela de 24 h
    expect(freeCancellationStatus({ ...f, bookedAt: d("2026-11-18T12:00:00Z"), now: d("2026-11-18T13:00:00Z") }).status).toBe("closed");
  });

  it("moderada: aberto até 5 dias antes do check-in (no horário do check-in), depois encerrado", () => {
    const m = { ...base, category: "moderate" };
    const open = freeCancellationStatus({ ...m, now: d("2026-11-17T17:59:00Z") });
    expect(open.status).toBe("open");
    expect(open.until?.toISOString()).toBe("2026-11-17T18:00:00.000Z");
    expect(freeCancellationStatus({ ...m, now: d("2026-11-17T18:00:00Z") }).status).toBe("closed");
  });

  it("flexível 24 h, limitada 14 dias, restrita 30 dias; rigorosas só a janela de 24 h", () => {
    expect(freeCancellationStatus({ ...base, category: "flexible", now: d("2026-11-21T17:00:00Z") }).status).toBe("open");
    expect(freeCancellationStatus({ ...base, category: "flexible", now: d("2026-11-21T19:00:00Z") }).status).toBe("closed");
    expect(freeCancellationStatus({ ...base, category: "limited", now: d("2026-11-08T17:00:00Z") }).status).toBe("open");
    expect(freeCancellationStatus({ ...base, category: "limited", now: d("2026-11-09T17:00:00Z") }).status).toBe("closed");
    expect(freeCancellationStatus({ ...base, category: "firm", now: d("2026-10-23T17:00:00Z") }).status).toBe("open");
    expect(freeCancellationStatus({ ...base, category: "firm", now: d("2026-10-24T17:00:00Z") }).status).toBe("closed");
    for (const c of ["strict", "strict_14_with_grace_period", "super_strict_30", "super_strict_60"])
      expect(freeCancellationStatus({ ...base, category: c, now: d("2026-10-05T12:00:00Z") }).status, c).toBe("closed");
  });

  it("depois do check-in nunca há prazo aberto", () => {
    expect(freeCancellationStatus({ ...base, category: "flexible", now: d("2026-11-23T00:00:00Z") }).status).toBe("closed");
  });

  it("estadia longa (≥ 28 noites): restrita 30 dias; rigorosa só 48 h com 28 dias de antecedência", () => {
    const l = { ...base, nights: 30 };
    expect(freeCancellationStatus({ ...l, category: "firm", now: d("2026-10-20T00:00:00Z") })).toMatchObject({ status: "open", policyLabel: "Restrita (estadia longa)" });
    expect(freeCancellationStatus({ ...l, category: "strict", now: d("2026-10-03T11:00:00Z") }).status).toBe("open");
    expect(freeCancellationStatus({ ...l, category: "strict", now: d("2026-10-03T13:00:00Z") }).status).toBe("closed");
    expect(freeCancellationStatus({ ...l, category: "moderate", now: d("2026-10-03T13:00:00Z") }).status).toBe("unknown");
  });

  it("NUNCA presume: categoria vazia/desconhecida ou sem horário de check-in ⇒ desconhecido", () => {
    expect(resolveCancellationPolicy(null, false, 2)).toBeNull();
    expect(resolveCancellationPolicy("", null, 2)).toBeNull();
    expect(resolveCancellationPolicy("alguma_politica_nova", false, 2)).toBeNull();
    expect(freeCancellationStatus({ ...base, category: null, now: d("2026-11-01T00:00:00Z") })).toMatchObject({ status: "unknown", policyLabel: null });
    expect(freeCancellationStatus({ ...base, category: "moderate", checkInAt: null, now: d("2026-11-01T00:00:00Z") }).status).toBe("unknown");
  });
});

describe("Playbook de cancelamento · roteiro", () => {
  const p = JSON.stringify(buildSystemPrompt("airbnb" as never));
it("postura fixa: nunca estimula nem é permissiva; a responsabilidade é das regras da plataforma (titular, 10/11/2026)", () => {
    expect(p).toMatch(/ctx:cancelamento_sem_custo/);
    expect(p).toMatch(/NUNCA estimula, facilita, sugere nem é permissivo com cancelamento ou alteração/);
    expect(p).toMatch(/definido exclusivamente pelas regras da plataforma/);
    expect(p).toMatch(/não temos autonomia para alterar, cancelar, abrir exceção ou reembolsar/);
    expect(p).toMatch(/não ensine o passo a passo por iniciativa própria/);
  });
  it("encerrado ⇒ não é possível; aberto ⇒ só o fato, sem incentivar; desconhecido ⇒ nunca presume", () => {
    expect(p).toMatch(/prazo encerrado: diga com clareza que, pelas regras da plataforma/);
    expect(p).toMatch(/só se a pessoa insistir, diga que ela pode procurar o suporte da plataforma/);
    expect(p).toMatch(/prazo aberto: informe apenas o fato/);
    expect(p).toMatch(/nunca presuma a modalidade nem o prazo/);
  });
  it("traz o resumo das modalidades do Airbnb", () => {
    expect(p).toMatch(/Moderada = até 5 dias antes/);
    expect(p).toMatch(/Não reembolsável = tarifa com desconto/);
  });
});
