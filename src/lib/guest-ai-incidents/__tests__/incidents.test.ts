import { describe, expect, it, vi } from "vitest";
import { buildDetectorMessages, incidentGate, parseDetectorOutput, type IncidentView } from "../contracts";
import { runIncidentDetector } from "../detector.server";

const inc = (over: Partial<IncidentView> = {}): IncidentView => ({ id: "i1", summary: "Ar-condicionado do quarto não gela", severity: "normal", category: "ar-condicionado", status: "open", ...over });
const known = { open: ["i1"], resolved: ["r1"] };

describe("incidentes · leitura da decisão do modelo", () => {
  it("abre com resumo, gravidade e categoria; gravidade inválida vira normal", () => {
    expect(parseDetectorOutput('{"action":"open","summary":"Chuveiro sem água quente","severity":"grave","category":"Chuveiro"}', known)).toEqual({ action: "open", summary: "Chuveiro sem água quente", severity: "grave", category: "chuveiro" });
    expect(parseDetectorOutput('{"action":"open","summary":"x","severity":"???"}', known)).toMatchObject({ severity: "normal" });
  });
  it("aceita JSON dentro de cerca de código", () => {
    expect(parseDetectorOutput('```json\n{"action":"resolve","incidentId":"i1","reason":"O técnico já consertou"}\n```', known)).toEqual({ action: "resolve", incidentId: "i1", reason: "O técnico já consertou" });
  });
  it("resolver ou reabrir um id desconhecido, lixo e abrir sem resumo ⇒ none", () => {
    expect(parseDetectorOutput('{"action":"resolve","incidentId":"zzz"}', known)).toEqual({ action: "none" });
    expect(parseDetectorOutput('{"action":"reopen","incidentId":"i1"}', known)).toEqual({ action: "none" }); // i1 está aberto, não resolvido
    expect(parseDetectorOutput("não sei", known)).toEqual({ action: "none" });
    expect(parseDetectorOutput('{"action":"open","summary":"  "}', known)).toEqual({ action: "none" });
  });
});

describe("incidentes · travas do código", () => {
  it("grave só fecha por fala da EQUIPE; normal fecha pela IA (hóspede) ou pela equipe", () => {
    const g = inc({ severity: "grave" });
    expect(incidentGate({ action: "resolve", incidentId: "i1", reason: "ok" }, { trigger: "guest", open: [g] }).allowed).toBe(false);
    expect(incidentGate({ action: "resolve", incidentId: "i1", reason: "ok" }, { trigger: "team", open: [g] })).toEqual({ allowed: true, resolvedBy: "human" });
    expect(incidentGate({ action: "resolve", incidentId: "i1", reason: "ok" }, { trigger: "guest", open: [inc()] })).toEqual({ allowed: true, resolvedBy: "ai" });
  });
  it("reabrir só por fala do hóspede; limite de 5 chamados abertos", () => {
    expect(incidentGate({ action: "reopen", incidentId: "r1", reason: "" }, { trigger: "team", open: [] }).allowed).toBe(false);
    expect(incidentGate({ action: "reopen", incidentId: "r1", reason: "" }, { trigger: "guest", open: [] }).allowed).toBe(true);
    const five = [1, 2, 3, 4, 5].map((n) => inc({ id: `i${n}` }));
    expect(incidentGate({ action: "open", summary: "x", severity: "normal", category: null }, { trigger: "guest", open: five }).allowed).toBe(false);
  });
  it("o prompt traz os canais, quem falou e os chamados", () => {
    const m = buildDetectorMessages({ trigger: "guest", open: [inc()], recentlyResolved: [], messages: [{ speaker: "guest", channel: "whatsapp", at: "2026-11-15T10:00:00Z", text: "o ar não gela" }, { speaker: "team", channel: "airbnb", at: "2026-11-15T10:05:00Z", text: "vamos verificar" }] });
    const u = String(m[1]!.content);
    expect(u).toContain("HÓSPEDE");
    expect(u).toContain("whatsapp");
    expect(u).toContain("EQUIPE");
    expect(u).toContain("id i1");
  });
});

// banco falso mínimo: encadeamento que devolve os dados por tabela
function fakeDb(state: { open: unknown[]; resolved: unknown[]; messages: unknown[]; siblings?: unknown[] }) {
  const writes: Array<{ table: string; op: string; row?: unknown }> = [];
  const db = {
    from(table: string) {
      const q: Record<string, unknown> & { _filters: Record<string, unknown> } = { _filters: {} };
      const chain = new Proxy(q, {
        get(_t, prop: string) {
          if (prop === "then") return undefined;
          if (prop === "insert") return (row: unknown) => { writes.push({ table, op: "insert", row }); return chain; };
          if (prop === "update") return (row: unknown) => { writes.push({ table, op: "update", row }); return chain; };
          if (prop === "eq") return (k: string, v: unknown) => { q._filters[k] = v; return chain; };
          if (prop === "maybeSingle") return async () => {
            if (table === "property_chat_conversations") return { data: { id: "c1", property_id: "p1", reservation_id: "res1", guest_name: "Ana", properties: { owner_id: "t1" } }, error: null };
            if (table === "guest_ai_incidents" && writes.some((w) => w.op === "insert")) return { data: { id: "new1" }, error: null };
            return { data: null, error: null };
          };
          if (prop === "select" || prop === "or" || prop === "in" || prop === "gte" || prop === "neq" || prop === "order") return () => chain;
          if (prop === "limit") return async () => {
            if (table === "guest_ai_incidents") return { data: q._filters["status"] === "resolved" ? state.resolved : state.open, error: null };
            if (table === "property_chat_messages") return { data: state.messages, error: null };
            if (table === "property_chat_conversations") return { data: state.siblings ?? [{ id: "c1" }, { id: "c2" }], error: null };
            return { data: [], error: null };
          };
          return undefined;
        },
      });
      return chain;
    },
  };
  return { db: db as never, writes };
}
const msg = (role: string, sender: string, content: string, at: string, channel = "whatsapp") => ({ role, sender_type: sender, channel, content, created_at: at, attachment_transcript: null });
const llmJson = (o: unknown) => vi.fn(async () => ({ ok: true, text: JSON.stringify(o), finishReason: "stop" }) as never);

describe("incidentes · detector", () => {
  it("hóspede relata defeito ⇒ abre o chamado e avisa a equipe", async () => {
    const { db, writes } = fakeDb({ open: [], resolved: [], messages: [msg("user", "guest", "O ar-condicionado não gela", "2026-11-15T10:00:00Z")] });
    const notify = vi.fn(async () => {});
    const llm = llmJson({ action: "open", summary: "Ar-condicionado não gela", severity: "normal", category: "ar-condicionado" });
    const r = await runIncidentDetector({ conversationId: "c1", trigger: "guest", messageId: "m1" }, { db, llm, notifyOpened: notify, enabled: true });
    expect(r).toEqual({ status: "applied", action: "open", incidentId: "new1" });
    expect(writes.find((w) => w.op === "insert")?.row).toMatchObject({ property_id: "p1", conversation_id: "c1", reservation_id: "res1", severity: "normal" });
    expect(notify).toHaveBeenCalledOnce();
  });
  it("a equipe fala e não há chamado aberto ⇒ nem chama o modelo", async () => {
    const { db } = fakeDb({ open: [], resolved: [], messages: [msg("assistant", "human", "ok", "2026-11-15T10:00:00Z")] });
    const llm = llmJson({ action: "none" });
    expect(await runIncidentDetector({ conversationId: "c1", trigger: "team" }, { db, llm, enabled: true })).toEqual({ status: "skipped", reason: "no_open_incident" });
    expect(llm).not.toHaveBeenCalled();
  });
  it("equipe confirma que consertou ⇒ chamado fecha (resolved_by human em grave)", async () => {
    const open = [{ id: "i1", summary: "Vazamento no banheiro", severity: "grave", category: "vazamento", status: "open" }];
    const { db, writes } = fakeDb({ open, resolved: [], messages: [msg("assistant", "human", "O encanador consertou o vazamento hoje", "2026-11-15T12:00:00Z", "airbnb")] });
    const llm = llmJson({ action: "resolve", incidentId: "i1", reason: "O encanador consertou o vazamento" });
    // update sem linhas devolvidas pelo banco falso ⇒ error; o que importa aqui é a decisão aplicada ao banco
    await runIncidentDetector({ conversationId: "c1", trigger: "team" }, { db, llm, enabled: true });
    expect(writes.find((w) => w.op === "update")?.row).toMatchObject({ status: "resolved", resolved_by: "human" });
  });
  it("hóspede diz que está tudo certo, mas o chamado é grave ⇒ continua aberto", async () => {
    const open = [{ id: "i1", summary: "Cheiro de gás", severity: "grave", category: "gás", status: "open" }];
    const { db, writes } = fakeDb({ open, resolved: [], messages: [msg("user", "guest", "agora está tudo certo", "2026-11-15T12:00:00Z")] });
    const llm = llmJson({ action: "resolve", incidentId: "i1", reason: "hóspede disse que está tudo certo" });
    expect(await runIncidentDetector({ conversationId: "c1", trigger: "guest" }, { db, llm, enabled: true })).toEqual({ status: "blocked", reason: "grave_needs_human" });
    expect(writes.length).toBe(0);
  });
  it("modelo fora do ar, resposta inválida ou desligado ⇒ nunca lança e nada muda", async () => {
    const { db, writes } = fakeDb({ open: [], resolved: [], messages: [msg("user", "guest", "oi", "2026-11-15T10:00:00Z")] });
    const bad = vi.fn(async () => ({ ok: false }) as never);
    expect(await runIncidentDetector({ conversationId: "c1", trigger: "guest" }, { db, llm: bad, enabled: true })).toEqual({ status: "error" });
    expect(await runIncidentDetector({ conversationId: "c1", trigger: "guest" }, { db, llm: llmJson({ action: "none" }), enabled: true })).toEqual({ status: "none" });
    expect(await runIncidentDetector({ conversationId: "c1", trigger: "guest" }, { db, enabled: false })).toEqual({ status: "skipped", reason: "off" });
    expect(writes.length).toBe(0);
  });
});
