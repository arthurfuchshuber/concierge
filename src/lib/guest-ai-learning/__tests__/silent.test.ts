/**
 * Auto-aprendizado silencioso (10/11/2026): mensagem da equipe ⇒ fato aprovado na hora (em nome do atendente
 * com permissão), estadia não vira regra, escopo por réplica do mesmo dono, desfazer e mensagem apagada.
 */
import { describe, expect, it } from "vitest";
import {
  AUTO_APPROVED_NOTE,
  SOURCE_DELETED_NOTE,
  closeLearningForDeletedMessage,
  learnFromTeamMessage,
  setLearningScope,
  undoLearning,
} from "../silent.server";
import { buildTeamLearningPrompt, parseTeamLearningOutput } from "../team-learning";
import { proposeLearningCandidate } from "@/lib/guest-ai-learning.server";
import type { LlmProvider, ProviderOutcome, ProviderRequest } from "@/lib/guest-ai/llm/providers/types";

const ON = { GUEST_AI_LEARNING_EXTRACTOR: "on" };
type Row = Record<string, unknown>;

/** Banco em memória com o mínimo do PostgREST usado pelo módulo (+ RPCs de papel e de proposta). */
function fakeAdmin(seed: { owner: string; ai_train?: string[]; admins?: string[] }) {
  const t: Record<string, Row[]> = {
    property_chat_conversations: [{ id: "c1", property_id: "p1" }],
    properties: [
      { id: "p1", owner_id: seed.owner, city: "Foz do Iguaçu", archived_at: null },
      { id: "p2", owner_id: seed.owner, city: "Foz do Iguacu", archived_at: null },
      { id: "p3", owner_id: seed.owner, city: "Curitiba", archived_at: null },
      { id: "p9", owner_id: "outro", city: "Foz do Iguaçu", archived_at: null },
    ],
    property_chat_messages: [
      { id: "g1", conversation_id: "c1", role: "user", sender_type: "guest", sender_user_id: null, content: "Onde fica o ferro de passar?", is_internal_note: false, created_at: "2026-11-10T10:00:00Z" },
      { id: "h1", conversation_id: "c1", role: "assistant", sender_type: "human", sender_user_id: "staff", content: "O ferro de passar fica na prateleira de cima do armário do corredor.", is_internal_note: false, created_at: "2026-11-10T10:01:00Z" },
    ],
    guest_ai_learning_entries: [],
    guest_ai_learning_events: [],
  };
  let seq = 0;
  const query = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let order: { col: string; asc: boolean } | null = null;
    let lim = Infinity;
    let wantSelect = false;
    const run = () => {
      let rows = t[table]!.filter((r) => filters.every((f) => f(r)));
      if (patch) {
        for (const r of rows) Object.assign(r, patch);
        return wantSelect ? rows.map((r) => ({ id: r["id"] })) : null;
      }
      if (order) rows = [...rows].sort((a, b) => String(a[order!.col]).localeCompare(String(b[order!.col])) * (order!.asc ? 1 : -1));
      return rows.slice(0, lim);
    };
    const b: Record<string, unknown> = {
      select: () => ((wantSelect = true), b),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), b),
      contains: (c: string, v: unknown[]) => (filters.push((r) => v.every((x) => (r[c] as unknown[] | undefined)?.includes(x))), b),
      order: (c: string, o: { ascending: boolean }) => ((order = { col: c, asc: o.ascending }), b),
      limit: (n: number) => ((lim = n), b),
      update: (p: Row) => ((patch = p), b),
      insert: async (row: Row) => (t[table]!.push(row), { error: null }),
      maybeSingle: async () => ({ data: run()?.[0] ?? null }),
      then: (res: (v: unknown) => unknown) => res({ data: run(), error: null }),
    };
    return b;
  };
  const admin = {
    t,
    from: (table: string) => query(table),
    rpc: async (fn: string, a: Record<string, unknown>) => {
      if (fn === "has_role") return { data: (seed.admins ?? []).includes(String(a["_user_id"])) };
      if (fn === "has_member_permission") return { data: (seed.ai_train ?? []).includes(String(a["_user_id"])) };
      if (fn === "guest_ai_learning_propose") {
        const prop = t.properties!.find((p) => p["id"] === a["p_property_id"]);
        const dup = t.guest_ai_learning_entries!.some((e) => e["property_id"] === a["p_property_id"] && String(e["statement"]).toLowerCase() === String(a["p_statement"]).toLowerCase() && ["pending", "approved"].includes(String(e["status"])));
        if (dup) return { data: null, error: null };
        const id = `e${++seq}`;
        t.guest_ai_learning_entries!.push({ id, owner_id: prop?.["owner_id"], property_id: a["p_property_id"], category: a["p_category"], statement: a["p_statement"], source: a["p_source"], evidence_refs: a["p_evidence_refs"], status: "pending", decided_by: null, decided_at: null });
        return { data: id, error: null };
      }
      return { data: null, error: { message: "unknown" } };
    },
  };
  return admin;
}

function provider(body: unknown): LlmProvider & { calls: number; seen: ProviderRequest[] } {
  const p = {
    id: "f",
    calls: 0,
    seen: [] as ProviderRequest[],
    async complete(req: ProviderRequest): Promise<ProviderOutcome> {
      p.calls += 1;
      p.seen.push(req);
      return { kind: "ok", text: JSON.stringify(body), finishReason: "stop", usage: { inputTokens: 300, outputTokens: 60, totalTokens: 360 }, requestId: "r" };
    },
  };
  return p;
}

const FERRO = { categoria: "equipamentos", fato: "O ferro de passar fica na prateleira de cima do armário do corredor.", temporalidade: "permanente", escopo: "imovel" };
const INPUT = { conversationId: "c1", userId: "staff", content: "O ferro de passar fica na prateleira de cima do armário do corredor." };
const run = (admin: ReturnType<typeof fakeAdmin>, body: unknown, env: Record<string, string> = ON) =>
  learnFromTeamMessage(INPUT, { env, admin, provider: provider(body), propose: (c) => proposeLearningCandidate(c, { db: admin as never }), log: () => {} });

describe("auto-aprendizado: mensagem da equipe", () => {
  it("atendente com permissão ⇒ fato APROVADO na hora, em nome dele, com a mensagem como evidência", async () => {
    const a = fakeAdmin({ owner: "dono", ai_train: ["staff"] });
    const r = await run(a, { fatos: [FERRO] });
    expect(r).toMatchObject({ status: "done", approved: 1, pending: 0 });
    expect(a.t.guest_ai_learning_entries![0]).toMatchObject({ property_id: "p1", status: "approved", decided_by: "staff", decision_note: AUTO_APPROVED_NOTE, evidence_refs: ["h1"] });
    expect(a.t.guest_ai_learning_events!.map((e) => e["status"])).toEqual(["approved"]);
  });
  it("governança por exceção: qualquer atendente ⇒ aprovado na hora em nome dele (sem fila manual)", async () => {
    const a = fakeAdmin({ owner: "dono" });
    const r = await run(a, { fatos: [FERRO] });
    expect(r).toMatchObject({ approved: 1, pending: 0 });
    expect(a.t.guest_ai_learning_entries![0]).toMatchObject({ status: "approved", decided_by: "staff" });
  });
  it("fato da estadia (temporalidade 'estadia') não vira regra do imóvel", async () => {
    const a = fakeAdmin({ owner: "dono", ai_train: ["staff"] });
    const r = await run(a, { fatos: [{ ...FERRO, fato: "A lâmpada do quarto queimou e será trocada pela manutenção.", temporalidade: "estadia" }] });
    expect(r).toMatchObject({ approved: 0, ephemeral: 1 });
    expect(a.t.guest_ai_learning_entries).toHaveLength(0);
  });
  it("segredo nunca é aprendido nem enviado ao modelo", async () => {
    const a = fakeAdmin({ owner: "dono", ai_train: ["staff"] });
    a.t.property_chat_messages![1]!["content"] = "A senha do Wi-Fi é Corredor#2024 e o roteador fica na sala.";
    const p = provider({ fatos: [{ ...FERRO, fato: "A senha do Wi-Fi da casa é Corredor#2024 para todos." }] });
    const r = await learnFromTeamMessage({ ...INPUT, content: "A senha do Wi-Fi é Corredor#2024 e o roteador fica na sala." }, { env: ON, admin: a, provider: p, propose: (c) => proposeLearningCandidate(c, { db: a as never }), log: () => {} });
    expect(JSON.stringify(p.seen[0]!.messages)).not.toContain("Corredor#2024");
    expect(r.approved).toBe(0);
    expect(a.t.guest_ai_learning_entries).toHaveLength(0);
  });
  it("escopo cidade ⇒ réplica aprovada só nos imóveis do MESMO dono na mesma cidade", async () => {
    const a = fakeAdmin({ owner: "dono", ai_train: ["staff"] });
    const r = await run(a, { fatos: [{ ...FERRO, fato: "A coleta de lixo reciclável na cidade passa às terças-feiras pela manhã.", categoria: "vizinhanca", escopo: "cidade" }] });
    expect(r).toMatchObject({ approved: 1, replicated: 1 });
    const props = a.t.guest_ai_learning_entries!.filter((e) => e["status"] === "approved").map((e) => e["property_id"]).sort();
    expect(props).toEqual(["p1", "p2"]);
  });
  it("desligado: nada é lido nem chamado", async () => {
    const a = fakeAdmin({ owner: "dono", ai_train: ["staff"] });
    const p = provider({ fatos: [FERRO] });
    const r = await learnFromTeamMessage(INPUT, { env: {}, admin: a, provider: p, log: () => {} });
    expect(r.status).toBe("off");
    expect(p.calls).toBe(0);
  });
});

describe("governança por exceção: desfazer, escopo e mensagem apagada", () => {
  it("mensagem da equipe apagada ⇒ aprendizado e réplicas saem do Documento Vivo na hora", async () => {
    const a = fakeAdmin({ owner: "dono", ai_train: ["staff"] });
    await run(a, { fatos: [{ ...FERRO, fato: "A coleta de lixo reciclável na cidade passa às terças-feiras pela manhã.", categoria: "vizinhanca", escopo: "cidade" }] });
    const n = await closeLearningForDeletedMessage({ messageId: "h1", userId: "staff" }, { admin: a });
    expect(n).toBe(2);
    expect(a.t.guest_ai_learning_entries!.every((e) => e["status"] === "revoked" && e["decision_note"] === SOURCE_DELETED_NOTE)).toBe(true);
  });
  it("desfazer (1 clique) exige permissão e revoga entrada e réplicas", async () => {
    const a = fakeAdmin({ owner: "dono", ai_train: ["staff"] });
    await run(a, { fatos: [{ ...FERRO, fato: "A coleta de lixo reciclável na cidade passa às terças-feiras pela manhã.", categoria: "vizinhanca", escopo: "cidade" }] });
    await expect(undoLearning({ entryId: "e1", userId: "intruso" }, { admin: a })).rejects.toThrow("not_authorized");
    expect(await undoLearning({ entryId: "e1", userId: "staff" }, { admin: a })).toBe(2);
  });
  it("ajustar escopo: cidade ⇒ imóvel remove a réplica; imóvel ⇒ conta replica em todos os imóveis do dono", async () => {
    const a = fakeAdmin({ owner: "dono", ai_train: ["staff"] });
    await run(a, { fatos: [{ ...FERRO, fato: "A coleta de lixo reciclável na cidade passa às terças-feiras pela manhã.", categoria: "vizinhanca", escopo: "cidade" }] });
    expect(await setLearningScope({ entryId: "e1", userId: "staff", scope: "property" }, { admin: a })).toEqual({ removed: 1, replicated: 0 });
    const r = await setLearningScope({ entryId: "e1", userId: "staff", scope: "account" }, { admin: a });
    expect(r.replicated).toBe(2);
    const active = a.t.guest_ai_learning_entries!.filter((e) => e["status"] === "approved").map((e) => e["property_id"]).sort();
    expect(active).toEqual(["p1", "p2", "p3"]);
    expect(active).not.toContain("p9");
  });
});

describe("prompt e parser do aprendizado da equipe", () => {
  it("mensagem curta (saudação) não chama o modelo; só fatos permanentes passam; escopo desconhecido ⇒ imóvel", () => {
    expect(buildTeamLearningPrompt("Oi! Tudo bem?", [])).toBeNull();
    const r = parseTeamLearningOutput({ fatos: [{ ...FERRO, escopo: "planeta" }, { ...FERRO, temporalidade: "estadia" }, { categoria: "x", fato: "y" }] });
    expect(r.facts.map((f) => f.scope)).toEqual(["property"]);
    expect(r).toMatchObject({ ephemeral: 1, dropped: 1 });
  });
});

describe("extrator de situações encerradas: aprovação automática em nome do dono", () => {
  it("autoApproveForOwner aprova o pendente com o dono do imóvel como autor", async () => {
    const { autoApproveForOwner, AUTO_LEARN_NOTE } = await import("../silent.server");
    const a = fakeAdmin({ owner: "dono" });
    a.t.guest_ai_learning_entries!.push({ id: "x1", property_id: "p1", status: "pending", decided_by: null, decided_at: null, evidence_refs: ["m"] });
    expect(await autoApproveForOwner("x1", "p1", { admin: a })).toBe(true);
    expect(a.t.guest_ai_learning_entries![0]).toMatchObject({ status: "approved", decided_by: "dono", decision_note: AUTO_LEARN_NOTE });
    // já decidido: não aprova de novo
    expect(await autoApproveForOwner("x1", "p1", { admin: a })).toBe(false);
  });
});
