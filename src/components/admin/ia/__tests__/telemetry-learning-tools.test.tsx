import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TelemetryLearningTools } from "../TelemetryLearningTools";
import { TOOL_KPIS_UNAVAILABLE, computeLearningKpis, modelNote } from "@/lib/admin-ia-telemetry";

const NOW = Date.parse("2026-11-10T12:00:00Z");

describe("Telemetria IA · blocos de aprendizado e ferramentas (Etapa 4)", () => {
  it("com dados: 4 cartões e as etiquetas por origem", () => {
    const learning = computeLearningKpis(
      [
        { status: "pending", source: "checkout_done", createdAt: "2026-11-09T00:00:00Z" },
        { status: "approved", source: "guest_confirmation", createdAt: "2026-11-08T00:00:00Z" },
      ],
      { nowMs: NOW },
    );
    const html = renderToStaticMarkup(
      <TelemetryLearningTools learning={learning} tools={TOOL_KPIS_UNAVAILABLE} loading={false} />,
    );
    for (const t of ["Pendentes de revisão", "Aprovadas", "Rejeitadas / revogadas", "Taxa de aprovação", "Por origem", "Checkout", "Atendimento resolvido", "Confirmação do hóspede"])
      expect(html).toContain(t);
    expect(html).toContain("2 propostas nos últimos 14 dias");
  });

  it("sem registros de aprendizado nem de ferramentas: renderiza o estado vazio sem lançar", () => {
    const html = renderToStaticMarkup(<TelemetryLearningTools learning={null} tools={null} loading={false} />);
    expect(html).toContain("sem leitura do aprendizado no momento");
    expect(html).toContain("Ainda sem registro");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Por origem");
  });

  it("aprendizado vazio (zero entradas): zeros e taxa como traço", () => {
    const html = renderToStaticMarkup(
      <TelemetryLearningTools learning={computeLearningKpis([], { nowMs: NOW })} tools={TOOL_KPIS_UNAVAILABLE} loading={false} />,
    );
    expect(html).toContain("0 propostas nos últimos 14 dias · total 0");
    expect(html).not.toContain("NaN");
  });

  it("só tokens semânticos de cor (sem hex nem paleta fixa)", () => {
    const html = renderToStaticMarkup(<TelemetryLearningTools learning={null} tools={null} loading={false} />);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b|text-(red|green|blue|amber|rose)-\d/);
  });

  it("cartão Modelo: Flash como titular do Copiloto; outro titular conta a reserva", () => {
    expect(modelNote({ activeModel: "google/gemini-3.8-flash", reserveUsesToday: 40 })).toBe("titular do Copiloto");
    expect(modelNote({ activeModel: "openai/gpt-6-astra", reserveUsesToday: 2 })).toBe("reserva usada 2× hoje");
    expect(modelNote({ activeModel: "openai/gpt-6-astra", reserveUsesToday: 0 })).toBe("sem reserva hoje");
  });
});
