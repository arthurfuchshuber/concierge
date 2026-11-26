/**
 * Atendimento refatorado (mockups ATD-D/M, REG, CANC e APR aprovados em 23–26/11/2026): regras puras novas.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatDayBR, relativeDayWord, todaySaoPauloIso } from "@/lib/relative-day";
import {
  buildDecisionOptions,
  decisionBusyLabel,
  decisionRecordText,
  decisionTextParts,
  formatHourFull,
  visibleDecisionOptions,
} from "@/lib/guest-ai-decision";
import {
  conversationsLabel,
  joinNames,
  regionalExpiresAt,
  regionalLivingStatement,
  regionalTitle,
  regionalValidityOf,
} from "@/lib/regional-situation";
import { LEARNING_AUDIENCE, LEARNING_CATEGORIES } from "@/lib/guest-ai/learning/learning";
import { composeTurnPrompt } from "@/lib/guest-ai/composer";
import { normalizeHistory } from "@/lib/guest-ai/history";
import { CONV, MSG, TEST_GUARD, conversationContext, row } from "@/lib/guest-ai/__tests__/helpers/b21-fixtures";

describe("data relativa (regra global de 23/11/2026)", () => {
  const today = "2026-11-26";
  it("Hoje, Amanhã, Ontem, Anteontem e Depois de Amanhã; fora de ±2 dias, nada", () => {
    expect(relativeDayWord("2026-11-26", today)).toBe("Hoje");
    expect(relativeDayWord("2026-11-27", today)).toBe("Amanhã");
    expect(relativeDayWord("2026-11-28", today)).toBe("Depois de Amanhã");
    expect(relativeDayWord("2026-11-25", today)).toBe("Ontem");
    expect(relativeDayWord("2026-11-24", today)).toBe("Anteontem");
    expect(relativeDayWord("2026-11-29", today)).toBeNull();
    expect(relativeDayWord("2026-11-23T10:00:00Z", today)).toBeNull();
    expect(relativeDayWord(null, today)).toBeNull();
    expect(relativeDayWord("lixo", today)).toBeNull();
  });
  it("virada de mês/ano e formato dd/mm/aaaa", () => {
    expect(relativeDayWord("2027-01-01", "2026-12-31")).toBe("Amanhã");
    expect(formatDayBR("2026-03-05")).toBe("05/03/2026");
    expect(formatDayBR(null)).toBeNull();
  });
  it("'hoje' no fuso de São Paulo (01h UTC ainda é o dia anterior)", () => {
    expect(todaySaoPauloIso(new Date("2026-11-27T01:30:00Z"))).toBe("2026-11-26");
  });
});

describe("faixa e registro da decisão (ATD-D04/M05, D18/M21)", () => {
  it("hora sempre com minutos e negrito marcado por ** ", () => {
    expect(formatHourFull("13:00")).toBe("13h00");
    expect(formatHourFull("9:30")).toBe("9h30");
    expect(decisionTextParts("a **b** c")).toEqual([
      { text: "a ", bold: false },
      { text: "b", bold: true },
      { text: " c", bold: false },
    ]);
  });
  it("só um botão em destaque; 'Eu Assumo' nunca aparece na tela", () => {
    for (const conflict of [false, true]) {
      const shown = visibleDecisionOptions(buildDecisionOptions("early_checkin", "10:00", { conflict }));
      expect(shown[0]!.variant).toBe("primary");
      expect(shown.filter((o) => o.variant === "primary")).toHaveLength(1);
      expect(shown.map((o) => o.label)).not.toContain("Eu Assumo a Conversa");
    }
  });
  it("rótulo no gerúndio enquanto a IA leva a resposta", () => {
    expect(decisionBusyLabel({ ai_intent: "charge", label: "Cobrar Meia Diária" })).toBe("Cobrando Meia Diária…");
    expect(decisionBusyLabel({ ai_intent: "decline", label: "Recusar com Gentileza" })).toBe("Recusando com Gentileza…");
    expect(decisionBusyLabel({ ai_intent: "approve", label: "Aprovar como Cortesia" })).toBe("Aprovando como Cortesia…");
    expect(decisionBusyLabel({ ai_intent: "approve", label: "Aprovar" })).toBe("Aprovando…");
  });
  it("linha de registro depois da decisão", () => {
    const options = buildDecisionOptions("late_checkout", "13:00");
    const rec = (decided_option_id: string | null, status = "decided") =>
      decisionRecordText({ kind: "late_checkout", options, decided_option_id, status } as never);
    expect(rec("charge")).toBe("Meia diária cobrada: saída às **13h00**");
    expect(rec("approve")).toBe("Cortesia aprovada: saída às **13h00**");
    expect(rec("decline")).toMatch(/^Recusado com gentileza/);
    expect(rec("assume")).toBe("Respondido direto pela equipe");
    expect(rec(null, "expired")).toBe("Decisão encerrada sem clique");
  });
});

describe("situação regional (REG-D/M 01–03)", () => {
  it("frase para a IA com cidade/bairros e as travas (sem texto pronto ao hóspede)", () => {
    const s = regionalLivingStatement({ kind: "Falta de energia", city: "Foz do Iguaçu", neighborhoods: "Toda a cidade", aiText: "A Copel prevê volta às 18h." });
    expect(s).toMatch(/^Situação regional confirmada pela equipe em Foz do Iguaçu: Falta de energia\./);
    expect(s).toMatch(/nunca cite outros hóspedes ou imóveis/);
    expect(s).toMatch(/problema do imóvel e encaminhe à equipe/);
    expect(s.length).toBeLessThanOrEqual(600);
    expect(regionalLivingStatement({ kind: "Falta de água", city: "Foz", neighborhoods: "Centro", aiText: "x" })).toMatch(/em Foz \(Centro\)/);
  });
  it("título, validade, contagem e nomes", () => {
    expect(regionalTitle({ kind: "Falta de energia ", city: " Foz do Iguaçu" })).toBe("Falta de energia · Foz do Iguaçu");
    expect(regionalExpiresAt(new Date("2026-11-26T10:00:00Z"), 6)).toBe("2026-11-26T16:00:00.000Z");
    expect(regionalValidityOf("2026-11-26T10:00:00Z", "2026-11-26T22:00:00Z")).toBe(12);
    expect(regionalValidityOf("2026-11-26T10:00:00Z", null)).toBe(6);
    expect(conversationsLabel(1)).toBe("1 conversa");
    expect(conversationsLabel(3)).toBe("3 conversas");
    expect(joinNames(["Roberto Lima", "Paulo", "Larissa Souza"])).toBe("Roberto, Paulo e Larissa");
    expect(joinNames(["Ana"])).toBe("Ana");
  });
});

describe("Quem Vê (Aprendizados, 26/11/2026)", () => {
  it("toda categoria tem público; acesso, equipamentos e manutenção só com reserva ativa", () => {
    for (const c of LEARNING_CATEGORIES) expect(["P", "G"]).toContain(LEARNING_AUDIENCE[c]);
    expect(LEARNING_AUDIENCE.acesso_e_chegada).toBe("G");
    expect(LEARNING_AUDIENCE.equipamentos).toBe("G");
    expect(LEARNING_AUDIENCE.manutencao).toBe("G");
    expect(LEARNING_AUDIENCE.vizinhanca).toBe("P");
  });
  it("no prompt: item G some para quem não tem reserva ativa; item P continua", () => {
    const history = normalizeHistory([row({ id: MSG, created_at: "2026-11-03T10:00:50Z", content: "Oi" })], { conversationId: CONV, currentMessageId: MSG });
    const run = (audiences: Array<"P" | "G">) => {
      const context = conversationContext({ audiences } as never);
      const livingDocument = {
        status: "available" as const,
        propertyId: context.guest.property.id,
        items: [
          { id: "a", category: "equipamentos" as const, statement: "O quadro de energia geral fica atrás da porta da cozinha.", source: "team_instruction" as const, approvedAt: null },
          { id: "b", category: "vizinhanca" as const, statement: "A padaria da esquina abre às seis da manhã todos os dias.", source: "team_instruction" as const, approvedAt: null },
        ],
      };
      const r = composeTurnPrompt({ context, history, livingDocument } as never, { guard: TEST_GUARD });
      if (r.kind !== "prompt") throw new Error(`esperado prompt, veio ${r.kind}`);
      const user = r.prompt.messages.map((m: { content: string }) => m.content).join("\n");
      const open = user.indexOf("<documento_vivo");
      return open < 0 ? "" : user.slice(open, user.indexOf("</documento_vivo>"));
    };
    const pub = run(["P"]);
    expect(pub).not.toMatch(/quadro de energia/);
    expect(pub).toMatch(/padaria da esquina/);
    const guest = run(["P", "G"]);
    expect(guest).toMatch(/quadro de energia/);
    expect(guest).toMatch(/padaria da esquina/);
  });
});

describe("auditoria de 26/11/2026", () => {
  const SRC = path.resolve(__dirname, "../..");
  const read = (f: string) => readFileSync(path.join(SRC, f), "utf8");
  it("o prompt devolve de qual item do Documento Vivo veio cada `vivo:n` (base do 'usada em N conversas')", () => {
    const history = normalizeHistory([row({ id: MSG, created_at: "2026-11-03T10:00:50Z", content: "Oi" })], { conversationId: CONV, currentMessageId: MSG });
    const context = conversationContext({ audiences: ["P", "G"] } as never);
    const r = composeTurnPrompt(
      {
        context,
        history,
        livingDocument: {
          status: "available",
          propertyId: context.guest.property.id,
          items: [{ id: "regional:abc", category: "vizinhanca", statement: "A cidade está sem energia por causa do temporal desta tarde.", source: "team_instruction", approvedAt: null }],
        },
      } as never,
      { guard: TEST_GUARD },
    );
    if (r.kind !== "prompt") throw new Error(r.kind);
    expect(r.livingRefs).toEqual([{ ref: "vivo:1", itemId: "regional:abc" }]);
  });
  it("a contagem vem do registro real de uso (não de toda resposta da cidade)", () => {
    const fns = read("lib/atendimento.functions.ts");
    expect(fns).toMatch(/used_conversation_ids/);
    expect(fns).not.toMatch(/outcome_kind", "reply"/);
    expect(read("lib/guest-ai/turn/generate.server.ts")).toMatch(/recordRegionalUse/);
  });
  it("janelas sem o recuo de 24px da base e com rolagem só no conteúdo", () => {
    const w = read("components/handoff/atd-window.tsx");
    expect(w).toMatch(/p-0 sm:p-0/);
    expect(w).toMatch(/min-h-0 flex-1 flex-col overflow-y-auto/);
  });
  it("cards da lista não aninham botões (copiar e WhatsApp ficam dentro do card)", () => {
    const v = read("components/handoff/ConversationView.tsx");
    const list = v.slice(v.indexOf("export function ConversationList"));
    expect(list).not.toMatch(/<button\s+key=\{c\.id\}/);
    expect(list).toMatch(/role="button"/);
  });
  it("as abas de Aprendizados contam sem o filtro que zerava tudo", () => {
    expect(read("lib/atendimento.functions.ts")).not.toMatch(/\.not\("evidence_refs", "cs", "\{\}"\)/);
  });
});
