/**
 * DECISÃO HUMANA COM 1 CLIQUE — migration `20261110200000_guest_ai_human_decisions.sql` contra PostgreSQL REAL.
 * Prova: privilégios (cliente não escreve nem executa as RPCs), RLS de leitura por membro do imóvel, validação dos
 * botões, uma decisão por mensagem, UMA pendente por conversa, trava atômica contra duplo clique com conexões
 * simultâneas, resposta da IA registrada uma vez e só depois da decisão, e expiração.
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_AVAILABLE, startCluster, type PgCluster } from "./pg/pg-cluster";

const ROOT = path.resolve(__dirname, "../../../..");
const SETUP = path.join(__dirname, "pg/copilot-setup.sql");
const MIGRATION = path.join(ROOT, "supabase/migrations/20261110200000_guest_ai_human_decisions.sql");

const T1 = "11111111-1111-4111-8111-111111111111"; // dono
const MEMBER = "22222222-2222-4222-8222-222222222222";
const OUTSIDER = "33333333-3333-4333-8333-333333333333";
const P1 = "44444444-4444-4444-8444-444444444444";
const C1 = "55555555-5555-4555-8555-555555555555";
const C2 = "55555555-5555-4555-8555-555555555556";
const M1 = "66666666-6666-4666-8666-666666666661";
const M2 = "66666666-6666-4666-8666-666666666662";
const M3 = "66666666-6666-4666-8666-666666666663";

const OPTIONS = JSON.stringify([
  { id: "approve", label: "Aprovar 13h (cortesia)", variant: "primary", ai_intent: "approve", time: "13:00" },
  { id: "charge", label: "Cobrar meia diária", variant: "secondary", ai_intent: "charge" },
  { id: "decline", label: "Recusar com gentileza", variant: "neutral", ai_intent: "decline" },
  { id: "assume", label: "Eu assumo a conversa", variant: "assume", ai_intent: "assume" },
]);

const open = (msg: string, conv = C1, options = OPTIONS) =>
  `select public.guest_ai_decision_open('${T1}', '${P1}', '${conv}', '${msg}', 'late_checkout', 'Mariana pede saída às 13h. Aprovar como cortesia?', '${options}'::jsonb)::text`;
const as = (user: string, q: string) => `select set_config('request.jwt.claim.sub', '${user}', false);\n${q}`;
const json = (s: string) => JSON.parse(s.trim().split("\n").pop()!) as Record<string, unknown>;

describe.skipIf(!PG_AVAILABLE)("Decisão humana · migration contra PostgreSQL real", () => {
  let pg: PgCluster;
  let decisionId = "";
  beforeAll(() => {
    pg = startCluster([SETUP, MIGRATION], { bin: process.env.GUEST_AI_PG_BIN });
  }, 120_000);
  afterAll(() => pg?.stop());

  it("prepara imóvel, conversas e equipe", async () => {
    await pg.sql(`
      insert into public.properties (id, owner_id) values ('${P1}', '${T1}');
      insert into public.property_chat_conversations (id, property_id, guest_session_id) values ('${C1}', '${P1}', 's1'), ('${C2}', '${P1}', 's2');
      insert into public.property_chat_messages (id, conversation_id, sender_type, role, content) values
        ('${M1}', '${C1}', 'guest', 'user', 'posso sair 13h?'), ('${M2}', '${C1}', 'guest', 'user', 'e o café?'),
        ('${M3}', '${C2}', 'guest', 'user', 'chego 10h');
      insert into public.account_members (owner_id, member_user_id, role, status, all_properties) values ('${T1}', '${MEMBER}', 'agent', 'active', true);
    `);
  });

  it("cliente (authenticated/anon) não escreve na tabela nem executa as RPCs", async () => {
    const ins = await pg.trySql(
      `insert into public.guest_ai_human_decisions (tenant_id, property_id, conversation_id, trigger_message_id, kind, question_text, options) values ('${T1}','${P1}','${C1}','${M1}','late_checkout','x','[]')`,
      { role: "authenticated" },
    );
    expect(ins.ok).toBe(false);
    for (const role of ["authenticated", "anon"]) {
      const r = await pg.trySql(open(M1), { role });
      expect(r.ok, role).toBe(false);
      const c = await pg.trySql(`select public.guest_ai_decision_claim(gen_random_uuid(), '${MEMBER}', 'approve')`, { role });
      expect(c.ok, role).toBe(false);
    }
  });

  it("botões inválidos são recusados no próprio banco", async () => {
    const bad = JSON.stringify([{ id: "x", label: "", variant: "primary", ai_intent: "approve" }, { id: "y", label: "ok", variant: "primary", ai_intent: "pay" }]);
    expect(json(await pg.sql(open(M1, C1, bad), { role: "service_role" }))).toMatchObject({ result: "invalid", reason: "options" });
    const one = JSON.stringify([{ id: "approve", label: "Aprovar", variant: "primary", ai_intent: "approve" }]);
    expect(json(await pg.sql(open(M1, C1, one), { role: "service_role" }))).toMatchObject({ result: "invalid" });
  });

  it("abre UMA decisão por mensagem e no máximo UMA pendente por conversa", async () => {
    const r = json(await pg.sql(open(M1), { role: "service_role" }));
    expect(r.result).toBe("opened");
    decisionId = String(r.id);
    expect(json(await pg.sql(open(M1), { role: "service_role" }))).toMatchObject({ result: "exists" });
    expect(json(await pg.sql(open(M2), { role: "service_role" }))).toMatchObject({ result: "pending_exists" });
    // mensagem de outra conversa não serve de gatilho
    expect(json(await pg.sql(open(M3), { role: "service_role" }))).toMatchObject({ result: "invalid", reason: "message" });
  });

  it("RLS: membro do imóvel lê; quem não tem acesso não vê nada", async () => {
    expect(await pg.sql(as(MEMBER, `select count(*) from public.guest_ai_human_decisions`), { role: "authenticated" })).toMatch(/1$/);
    expect(await pg.sql(as(OUTSIDER, `select count(*) from public.guest_ai_human_decisions`), { role: "authenticated" })).toMatch(/0$/);
  });

  it("resposta da IA não pode ser marcada antes da decisão", async () => {
    const r = json(await pg.sql(`select public.guest_ai_decision_mark_reply('${decisionId}', 'sent', gen_random_uuid())::text`, { role: "service_role" }));
    expect(r.result).toBe("noop");
  });

  it("quem não tem acesso ao imóvel não decide; opção inexistente é recusada", async () => {
    expect(json(await pg.sql(`select public.guest_ai_decision_claim('${decisionId}', '${OUTSIDER}', 'approve')::text`, { role: "service_role" }))).toMatchObject({ result: "forbidden" });
    expect(json(await pg.sql(`select public.guest_ai_decision_claim('${decisionId}', '${MEMBER}', 'pay')::text`, { role: "service_role" }))).toMatchObject({ result: "invalid", reason: "option" });
  });

  it("duplo clique / cliques simultâneos: exatamente UM vence (conexões independentes)", async () => {
    const tries = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        pg.sql(`select public.guest_ai_decision_claim('${decisionId}', '${i % 2 ? MEMBER : T1}', '${i % 3 === 0 ? "approve" : "decline"}')::text`, { role: "service_role" }),
      ),
    );
    const results = tries.map((t) => json(t).result);
    expect(results.filter((r) => r === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r === "already_decided")).toHaveLength(5);
    const row = await pg.sql(`select status || '|' || (decided_by is not null) || '|' || (decided_at is not null) from public.guest_ai_human_decisions where id = '${decisionId}'`);
    expect(row).toBe("decided|true|true");
  });

  it("resposta registrada UMA vez; depois da decisão a conversa aceita nova pendente", async () => {
    const msg = "77777777-7777-4777-8777-777777777777";
    expect(json(await pg.sql(`select public.guest_ai_decision_mark_reply('${decisionId}', 'sent', '${msg}')::text`, { role: "service_role" })).result).toBe("marked");
    expect(json(await pg.sql(`select public.guest_ai_decision_mark_reply('${decisionId}', 'silent', null)::text`, { role: "service_role" })).result).toBe("noop");
    expect(json(await pg.sql(`select public.guest_ai_decision_mark_reply('${decisionId}', 'sent', null)::text`, { role: "service_role" }))).toMatchObject({ result: "invalid" });
    expect(json(await pg.sql(open(M2), { role: "service_role" })).result).toBe("opened");
  });

  it("expirar libera o silêncio; decisão já tomada não expira", async () => {
    const pending = await pg.sql(`select id from public.guest_ai_human_decisions where conversation_id = '${C1}' and status = 'pending'`);
    expect(json(await pg.sql(`select public.guest_ai_decision_expire('${pending}')::text`, { role: "service_role" })).result).toBe("expired");
    expect(json(await pg.sql(`select public.guest_ai_decision_expire('${decisionId}')::text`, { role: "service_role" })).result).toBe("noop");
    expect(await pg.sql(`select count(*) from public.guest_ai_human_decisions where conversation_id = '${C1}' and status = 'pending'`)).toBe("0");
  });
});
