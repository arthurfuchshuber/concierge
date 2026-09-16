/**
 * O CONTRATO ENTRE O CATÁLOGO DE FERRAMENTAS E OS AGENTES.
 *
 * Origem (11/09/2026): `check_availability`, `find_available_stays` e
 * `search_web` estavam implementadas, documentadas e COBRADAS pelo prompt — e
 * não constavam da `allowedTools` de nenhum agente. Como o filtro do registry
 * é uma whitelist estrita por nome, as três eram descartadas em silêncio antes
 * da conversa começar. A IA recebia a ordem de consultar o calendário e não
 * recebia o calendário; daí saíam as promessas vazias.
 *
 * Nenhum teste pegava isso porque não havia nada olhando a JUNÇÃO das duas
 * listas — cada lado estava certo sozinho. Estes três testes olham a junção, e
 * é por isso que eles existem:
 *
 *  1. toda ferramenta liberada a um agente precisa existir de verdade
 *     (pega erro de digitação, que falha do mesmo jeito silencioso);
 *  2. toda ferramenta construída precisa ser alcançável por ALGUÉM
 *     (pega exatamente o bug acima — é o teste que faltava);
 *  3. todo schema precisa ser válido no modo estrito da API, onde uma chave
 *     opcional fora de `required` faz a requisição INTEIRA ser rejeitada —
 *     ou seja, derruba todas as mensagens daquele agente, não só as que usam
 *     a ferramenta.
 */
import { describe, it, expect } from "vitest";
import { buildGuestTools, type ToolContext } from "@/lib/ai/tools.server";
import { buildAgentTools } from "@/lib/ai/agents/tools.server";
import { AGENT_REGISTRY, AGENT_KEYS } from "@/lib/ai/agents/registry.server";

/** O catálogo é montado sem tocar no contexto: `ctx` só é usado dentro de
 *  `execute`, que estes testes nunca chamam. */
const ctx = {
  supabase: null,
  ownerId: "owner",
  propertyId: "prop",
  property: {},
  conversationId: null,
  guestName: null,
  guestKey: "session:test",
  collectSource: () => {},
  requestHandoff: () => {},
} as unknown as ToolContext;

const catalogo = [
  ...buildGuestTools(ctx),
  ...buildAgentTools({ ...ctx, agent: "generalist", onEscalation: () => {} } as never),
];
const nomesDoCatalogo = new Set(catalogo.map((t) => t.name));

describe("contrato ferramentas × agentes", () => {
  it("toda ferramenta liberada a um agente existe no catálogo", () => {
    const fantasmas: string[] = [];
    for (const key of AGENT_KEYS) {
      for (const nome of AGENT_REGISTRY[key].allowedTools) {
        if (!nomesDoCatalogo.has(nome)) fantasmas.push(`${key} → ${nome}`);
      }
    }
    expect(fantasmas).toEqual([]);
  });

  it("toda ferramenta do catálogo é alcançável por pelo menos um agente", () => {
    const liberadas = new Set(AGENT_KEYS.flatMap((k) => AGENT_REGISTRY[k].allowedTools));
    const orfas = [...nomesDoCatalogo].filter((n) => !liberadas.has(n));
    expect(orfas).toEqual([]);
  });

  it("todo schema é válido no modo estrito (toda chave em `required`)", () => {
    const invalidas: string[] = [];
    for (const t of catalogo) {
      const p = t.parameters as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      const chaves = Object.keys(p.properties ?? {});
      const obrigatorias = new Set(p.required ?? []);
      const faltando = chaves.filter((c) => !obrigatorias.has(c));
      if (faltando.length) invalidas.push(`${t.name}: ${faltando.join(", ")}`);
    }
    expect(invalidas).toEqual([]);
  });
});

describe("o agente de reservas enxerga o calendário", () => {
  it("tem as duas ferramentas de disponibilidade", () => {
    const r = AGENT_REGISTRY.reservation.allowedTools;
    expect(r).toContain("check_availability");
    expect(r).toContain("find_available_stays");
  });

  it("não carrega mais a ordem de escalar toda pergunta de data", () => {
    // A regra antiga ("qualquer alteração de datas, prorrogação, antecipação
    // ou cancelamento") era injetada no prompt como ESCALONAMENTO OBRIGATÓRIO
    // e anulava a ferramenta na prática.
    const regras = AGENT_REGISTRY.reservation.escalationRules.join(" ").toLowerCase();
    expect(regras).not.toContain("qualquer alteração de datas");
    expect(regras).toContain("já fechada");
  });
});
