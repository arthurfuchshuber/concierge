import { describe, expect, it } from "vitest";
import { applyPhaseScope, buildSystemPrompt } from "@/lib/guest-ai/system-prompt";
import { renderPersona } from "@/lib/guest-ai/persona";
import type { StayPhase } from "@/lib/guest-ai/types";

const PHASES: StayPhase[] = ["inquiry", "pre_stay", "in_stay", "post_checkout", "cancelled", "no_show", "unknown"];
const sys = (phase?: StayPhase) => buildSystemPrompt("airbnb", undefined, phase ? { phase } : {});

describe("prompt por fase (16/11/2026)", () => {
  it("nenhuma marca de escopo chega ao modelo, em nenhuma fase nem canal", () => {
    for (const ch of ["airbnb", "whatsapp", "guide_chat"] as const)
      for (const phase of [...PHASES, undefined]) expect(buildSystemPrompt(ch, undefined, { phase })).not.toMatch(/\u0001/);
  });

  it("sem fase ou fase desconhecida ⇒ prompt inteiro (nunca falta regra por dúvida)", () => {
    expect(sys("unknown")).toBe(sys());
    for (const phase of PHASES) expect(sys().length).toBeGreaterThanOrEqual(sys(phase).length);
  });

  it("consulta: regras de venda e calendário entram; marcos, chegada, acesso e avarias ficam de fora", () => {
    const s = sys("inquiry");
    expect(s).toMatch(/Condução ao fechamento em consultas/);
    expect(s).toMatch(/Período consultado/);
    expect(s).toMatch(/Data que não dá para selecionar/);
    expect(s).not.toMatch(/Os marcos da estadia merecem atenção/);
    expect(s).not.toMatch(/Aviso de deslocamento ou de chegada/);
    expect(s).not.toMatch(/DIÁLOGO INVESTIGATIVO/);
    expect(s).not.toMatch(/Ciclo de uma checagem/);
  });

  it("reserva antes da chegada e estadia: chegada, acesso, marcos e avarias entram; regras de consulta ficam de fora", () => {
    for (const phase of ["pre_stay", "in_stay"] as const) {
      const s = sys(phase);
      expect(s).toMatch(/Aviso de deslocamento ou de chegada/);
      expect(s).toMatch(/Tipo de acesso \(verdade do cadastro/);
      expect(s).toMatch(/Os marcos da estadia merecem atenção/);
      expect(s).toMatch(/DIÁLOGO INVESTIGATIVO/);
      expect(s).not.toMatch(/Condução ao fechamento em consultas/);
      expect(s).not.toMatch(/Período consultado/);
    }
  });

  it("depois da saída: marcos de saída e avarias ficam; chegada e acesso saem", () => {
    const s = sys("post_checkout");
    expect(s).toMatch(/Despedida e saída concluída/);
    expect(s).toMatch(/Incidentes, avarias e problemas físicos/);
    expect(s).not.toMatch(/Aviso de deslocamento ou de chegada/);
    expect(s).not.toMatch(/Saudação pura no dia do check-in/);
  });

  it("regras que hóspede de consulta também aciona continuam em todas as fases", () => {
    for (const phase of PHASES) {
      const s = sys(phase);
      expect(s).toMatch(/Entrada antecipada e saída tardia/);
      expect(s).toMatch(/Chegada fora da janela de check-in/);
      expect(s).toMatch(/Quando o período pedido não cabe neste imóvel/);
      expect(s).toMatch(/Pedido de desconto, valor especial ou negociação/);
      expect(s).toMatch(/Comodidades do condomínio \(ex: portaria 24h\) não definem o método de entrada/);
      expect(s).toContain(renderPersona());
    }
  });

  it("filtro puro: só tira linhas marcadas de outro escopo e remove as marcas", () => {
    const t = ["comum", "\u0001consulta\u0001só consulta", "  \u0001reserva_ativa\u0001  * subitem ativo"].join("\n");
    expect(applyPhaseScope(t, "inquiry")).toBe(["comum", "só consulta"].join("\n"));
    expect(applyPhaseScope(t, "in_stay")).toBe(["comum", "    * subitem ativo"].join("\n"));
    expect(applyPhaseScope(t, null)).toBe(["comum", "só consulta", "    * subitem ativo"].join("\n"));
  });
});
