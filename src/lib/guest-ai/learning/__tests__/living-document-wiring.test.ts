import { describe, expect, it, vi } from "vitest";
import { composeTurnPrompt } from "@/lib/guest-ai/composer";
import { normalizeHistory } from "@/lib/guest-ai/history";
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
import { LIVING_DOCUMENT_TAG, buildSystemPrompt } from "@/lib/guest-ai/system-prompt";
import { normalizeLivingRows, type LivingDocumentLoad } from "@/lib/guest-ai/learning/learning";
import { proposeLearningCandidate } from "@/lib/guest-ai-learning.server";
import { CONV, MSG, conversationContext, row } from "../../__tests__/helpers/b21-fixtures";
import { P1, T1 } from "../../__tests__/helpers/b22-portfolio";

const ctx = () =>
  conversationContext({
    interlocutor: { guestId: "s", conversationId: CONV, messageId: MSG, surface: "guide_chat", guestName: null },
    property: { id: P1, tenantId: T1, name: "Flat", timezone: "America/Sao_Paulo", listingFacts: null, dossierKnowledge: null },
  });
const history = () => normalizeHistory([row({ id: MSG, content: "Como liga o aquecedor?" })], { conversationId: CONV, currentMessageId: MSG });
const block = (user: string, tag: string) => {
  const open = user.indexOf(`<${tag}`);
  if (open < 0) return null;
  return JSON.parse(user.slice(user.indexOf("\n", open) + 1, user.indexOf(`</${tag}>`)).trim());
};
const ITEM = { id: "e1", category: "equipamentos" as const, statement: "O aquecedor do banheiro liga pelo disjuntor marcado como boiler no quadro da cozinha.", source: "incident_resolved" as const, approvedAt: "2026-11-08" };

describe("Documento Vivo no prompt (Etapa 4)", () => {
  it("normalizeLivingRows: só do imóvel, categoria/origem válidas, sem pontual nem segredo", () => {
    const base = { id: "a", property_id: P1, category: "equipamentos", source: "checkout_done", statement: ITEM.statement, decided_at: "2026-11-08T10:00:00Z" };
    const out = normalizeLivingRows(P1, [
      base,
      { ...base, id: "outro", property_id: "outro-imovel" },
      { ...base, id: "cat", category: "inventada" },
      { ...base, id: "src", source: "suposicao" },
      { ...base, id: "seg", statement: "A senha da porta é 4471 e a do portão também é 4471, anote." },
    ]);
    expect(out.map((i) => i.id)).toEqual(["a"]);
    expect(out[0]!.approvedAt).toBe("2026-11-08");
  });

  it("aprovados do imóvel entram no bloco <documento_vivo>, com ids citáveis", () => {
    const ld: LivingDocumentLoad = { status: "available", propertyId: P1, items: [ITEM] };
    const r = composeTurnPrompt({ context: ctx(), history: history(), livingDocument: ld }, { guard: SECRET_SCRUBBER });
    if (r.kind !== "prompt") throw new Error(r.kind);
    const b = block(r.prompt.messages[0]!.content, LIVING_DOCUMENT_TAG);
    expect(b).toEqual([{ id: "vivo:1", categoria: "equipamentos", texto: ITEM.statement, origem: "incident_resolved", aprovado_em: "2026-11-08" }]);
    expect(r.prompt.sourceIds!.has("vivo:1")).toBe(true);
    expect(r.metrics).toBeTruthy();
  });

  it("outro imóvel, indisponível ou vazio: o bloco não entra", () => {
    for (const ld of [
      { status: "available", propertyId: "outro-imovel", items: [ITEM] },
      { status: "unavailable", reason: "lookup_failed" },
      { status: "available", propertyId: P1, items: [] },
    ] as LivingDocumentLoad[]) {
      const r = composeTurnPrompt({ context: ctx(), history: history(), livingDocument: ld }, { guard: SECRET_SCRUBBER });
      if (r.kind !== "prompt") throw new Error(r.kind);
      expect(r.prompt.messages[0]!.content).not.toContain(`<${LIVING_DOCUMENT_TAG}`);
    }
  });

  it("desempate (10/11/2026): o bloco vivo prevalece sobre o dossiê em fatos físicos, nunca em D9, valores ou horários oficiais", () => {
    const sys = buildSystemPrompt("guide_chat");
    expect(sys).toContain(`<${LIVING_DOCUMENT_TAG}>`);
    expect(sys).toMatch(/localização de itens, instruções de uso ou características físicas[\s\S]{0,120}prevalece sobre a informação cadastral estática/);
    expect(sys).toMatch(/NUNCA alcança senhas e códigos, a janela de liberação de credenciais, o veto por não comparecimento, valores financeiros/);
    expect(sys).toMatch(/nunca concede horário, desconto, credencial ou exceção/);
  });
});

describe("Proposta de candidato (fora do módulo, só service_role)", () => {
  const input = {
    propertyId: P1,
    category: "equipamentos",
    statement: ITEM.statement,
    evidence: { source: "incident_resolved" as const, propertyId: P1, refs: ["m1"], closed: true },
  };

  it("passa pelas travas e chama o RPC com os dados do candidato", async () => {
    const rpc = vi.fn(async () => ({ data: "new-id", error: null }));
    const r = await proposeLearningCandidate(input, { db: { rpc } });
    expect(r).toEqual({ ok: true, id: "new-id", duplicate: false });
    expect(rpc).toHaveBeenCalledWith("guest_ai_learning_propose", {
      p_property_id: P1,
      p_category: "equipamentos",
      p_statement: ITEM.statement,
      p_source: "incident_resolved",
      p_evidence_refs: ["m1"],
    });
  });

  it("candidato recusado pelas travas nunca chega ao banco", async () => {
    const rpc = vi.fn();
    const r = await proposeLearningCandidate({ ...input, evidence: { ...input.evidence, closed: false } }, { db: { rpc } });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("duplicata (RPC devolve null) e erro do banco", async () => {
    expect(await proposeLearningCandidate(input, { db: { rpc: async () => ({ data: null, error: null }) } })).toEqual({ ok: true, id: null, duplicate: true });
    expect(await proposeLearningCandidate(input, { db: { rpc: async () => ({ data: null, error: { message: "x" } }) } })).toEqual({ ok: false, code: "propose_failed" });
  });
});
