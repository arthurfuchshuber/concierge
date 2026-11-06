/**
 * COPILOTO · migration `20261105150000_guest_ai_copilot_suggestions.sql` contra POSTGRES REAL (cluster local
 * temporário; cada consulta = conexão independente ⇒ concorrência real). Nada toca a produção.
 * Cobre: privilégios e RLS (isolamento entre tenants), autoria por `auth.uid()`, reivindicação idempotente e
 * concorrente da geração, escopo, substituição por mensagem nova, teto diário, gravação só da tentativa
 * vigente, edição/descarte, envio com token (cliques repetidos/abas simultâneas ⇒ UM envio), reconciliação
 * de resultado ambíguo (nunca reenvia sozinho), retenção de 14 dias e paridade de vocabulário TS × SQL.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PG_AVAILABLE, startCluster, type PgCluster } from "./pg/pg-cluster";
import {
  COPILOT_STATES,
  COPILOT_WARNINGS,
  COPILOT_ROW_COLUMNS,
  COPILOT_DAILY_COST_CEILING_USD,
  COPILOT_MAX_TURN_COST_USD,
} from "@/lib/guest-ai/copilot/contracts";
import {
  INTENT_CATEGORIES,
  STRATEGIES,
  HANDOFF_URGENCIES,
} from "@/lib/guest-ai/orchestrator/contracts";

const REPO = path.resolve(__dirname, "..", "..", "..", "..");
const SETUP = path.join(__dirname, "pg", "copilot-setup.sql");
const MIGRATION = path.join(
  REPO,
  "supabase/migrations/20261105150000_guest_ai_copilot_suggestions.sql",
);

const T1 = "a1000000-0000-4000-8000-000000000001"; // dono (tenant) 1
const T2 = "a2000000-0000-4000-8000-000000000002"; // dono (tenant) 2
const MEMBER = "a3000000-0000-4000-8000-000000000003"; // membro do imóvel 1
const STRANGER = "a4000000-0000-4000-8000-000000000004"; // autenticado sem acesso
const ALLPROPS = "a5000000-0000-4000-8000-000000000005"; // membro de T1 com acesso a todos os imóveis
const READONLY = "a6000000-0000-4000-8000-000000000006"; // membro de T1 com acesso a P1 mas SEM chat_respond
const P1B = "b1000000-0000-4000-8000-0000000000b1"; // segundo imóvel de T1 (MEMBER não é atribuído)
const C1B = "c1000000-0000-4000-8000-0000000000b1";
const P1 = "b1000000-0000-4000-8000-000000000001";
const P2 = "b2000000-0000-4000-8000-000000000002";
const C1 = "c1000000-0000-4000-8000-000000000001";
const C2 = "c2000000-0000-4000-8000-000000000002";
let seq = 0;
const uid = (p = "d0000000") => `${p}-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;

let pg: PgCluster;
type J = Record<string, unknown> & { result?: string };
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `array[${v.map(lit).join(",")}]::text[]`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
const as = (user: string | null) =>
  user ? `select set_config('request.jwt.claim.sub', '${user}', false);\n` : "";
const call = (fn: string, args: Record<string, unknown>) =>
  `select public.${fn}(${Object.entries(args)
    .map(([k, v]) => `${k} => ${lit(v)}`)
    .join(", ")})`;
/** RPC como service_role (geração). */
const sr = async (fn: string, args: Record<string, unknown>): Promise<J> =>
  JSON.parse(await pg.sql(call(fn, args), { role: "service_role" })) as J;
/** RPC como usuário autenticado (ações do atendente). */
const user = async (who: string | null, fn: string, args: Record<string, unknown>): Promise<J> => {
  const out = await pg.sql(`${as(who)}${call(fn, args)}`, { role: "authenticated" });
  return JSON.parse(out.split("\n").pop()!) as J;
};
const claimArgs = (over: Record<string, unknown> = {}) => ({
  p_tenant_id: T1,
  p_property_id: P1,
  p_conversation_id: C1,
  p_trigger_message_id: MSG_A,
  p_surface: "guide_chat",
  p_daily_cost_limit_usd: 1,
  p_turn_cost_ceiling_usd: 0.15,
  ...over,
});
let MSG_A = "";

async function guestMessage(conv = C1, at = "now()"): Promise<string> {
  const id = uid("e0000000");
  await pg.sql(
    `insert into public.property_chat_messages (id, conversation_id, sender_type, role, created_at) values ('${id}', '${conv}', 'guest', 'user', ${at})`,
  );
  return id;
}

/** Sugestão disponível com texto (caminho autorizado: reivindica + grava como service_role). */
async function available(text = "O check-in é às 15h.", msg?: string): Promise<string> {
  const m = msg ?? (await guestMessage());
  const c = await sr("copilot_claim_generation", claimArgs({ p_trigger_message_id: m }));
  expect(c.result).toBe("claimed");
  const s = await sr(
    "copilot_store_result",
    storeArgs(String(c.suggestion_id), Number(c.generation_attempts), { p_text: text }),
  );
  expect(s.result).toBe("stored");
  return String(c.suggestion_id);
}
const storeArgs = (id: string, attempt: number, over: Record<string, unknown> = {}) => ({
  p_suggestion_id: id,
  p_attempt: attempt,
  p_state: "available",
  p_text: "texto",
  p_internal_question: null,
  p_intents: ["informational_query"],
  p_strategy: "answer",
  p_handoff_needed: false,
  p_handoff_urgency: null,
  p_outcome_kind: "reply",
  p_outcome_code: null,
  p_warnings: ["unknown_facts"],
  p_context_stay_phase: "pre_stay",
  p_context_reservation_linked: true,
  p_context_history_messages: 3,
  p_context_dossier_entries: 12,
  p_context_credential_policy: "deny",
  p_context_sender_identity: "not_applicable",
  p_context_human_in_command: false,
  p_model_id: "google/gemini-3.8-flash",
  p_input_tokens: 900,
  p_output_tokens: 120,
  p_cost_usd: 0.00057,
  p_latency_ms: 800,
  p_gateway_error: null,
  ...over,
});

describe.skipIf(!PG_AVAILABLE)("Copiloto · migration contra PostgreSQL real", () => {
  beforeAll(() => {
    pg = startCluster([SETUP, MIGRATION], { bin: process.env.GUEST_AI_PG_BIN });
  }, 120_000);
  afterAll(() => pg?.stop());
  beforeEach(async () => {
    await pg.sql(`truncate public.guest_ai_copilot_suggestions, public.property_chat_messages, public.property_chat_conversations cascade;
      delete from public.property_assignments; delete from public.account_members; delete from public.properties;
      insert into public.properties (id, owner_id) values ('${P1}', '${T1}'), ('${P2}', '${T2}'), ('${P1B}', '${T1}');
      insert into public.property_chat_conversations (id, property_id, guest_session_id) values ('${C1}', '${P1}', 'sess-1'), ('${C2}', '${P2}', 'sess-2'), ('${C1B}', '${P1B}', 'sess-1b');
      -- modelo REAL: dono como membro 'owner'; MEMBER restrito a P1 por atribuição; ALLPROPS com todos os imóveis de T1
      insert into public.account_members (owner_id, member_user_id, role, status, all_properties) values
        ('${T1}', '${T1}', 'owner', 'active', true), ('${T2}', '${T2}', 'owner', 'active', true),
        ('${T1}', '${MEMBER}', 'agent', 'active', false), ('${T1}', '${ALLPROPS}', 'agent', 'active', true);
      insert into public.property_assignments (tenant_id, property_id, user_id, status) values ('${T1}', '${P1}', '${MEMBER}', 'active'), ('${T1}', '${P1}', '${READONLY}', 'active');
      insert into public.account_members (owner_id, member_user_id, role, status, all_properties) values ('${T1}', '${READONLY}', 'agent', 'active', false);
      -- permissões explícitas (deny por padrão, como na produção): MEMBER e ALLPROPS podem responder; READONLY não
      delete from public.account_member_permissions;
      insert into public.account_member_permissions (owner_id, member_user_id, permission, granted) values
        ('${T1}', '${MEMBER}', 'chat_respond', true), ('${T1}', '${ALLPROPS}', 'chat_respond', true), ('${T1}', '${READONLY}', 'chat_view', true);`);
    MSG_A = await guestMessage();
  });

  it("versão do servidor (evidência)", () => expect(pg.version).toMatch(/^1[5-9]\./));

  describe("privilégios e RLS", () => {
    it("ninguém escreve direto na tabela (anon, authenticated, service_role)", async () => {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const r = await pg.trySql(
          `insert into public.guest_ai_copilot_suggestions (tenant_id, property_id, conversation_id, trigger_message_id, surface) values ('${T1}', '${P1}', '${C1}', '${MSG_A}', 'guide_chat')`,
          { role },
        );
        expect(r.ok, role).toBe(false);
      }
      const id = await available();
      for (const role of ["authenticated", "service_role"]) {
        expect(
          (
            await pg.trySql(
              `update public.guest_ai_copilot_suggestions set state = 'sent' where id = '${id}'`,
              { role },
            )
          ).ok,
          role,
        ).toBe(false);
        expect(
          (
            await pg.trySql(`delete from public.guest_ai_copilot_suggestions where id = '${id}'`, {
              role,
            })
          ).ok,
          role,
        ).toBe(false);
      }
      expect(
        (await pg.trySql(`select 1 from public.guest_ai_copilot_suggestions`, { role: "anon" })).ok,
      ).toBe(false);
    });

    it("RLS: só quem tem acesso ao imóvel lê; outro tenant e estranho não veem nada", async () => {
      await available();
      const count = async (who: string) =>
        Number(
          (
            await pg.sql(`${as(who)}select count(*) from public.guest_ai_copilot_suggestions`, {
              role: "authenticated",
            })
          )
            .split("\n")
            .pop(),
        );
      expect(await count(T1)).toBe(1);
      expect(await count(MEMBER)).toBe(1);
      expect(await count(T2)).toBe(0);
      expect(await count(STRANGER)).toBe(0);
    });

    it("modelo de acesso REAL do SaaS: atribuição por imóvel, todos os imóveis, membro inativo e atribuição inativa", async () => {
      const idP1 = await available("P1");
      const mB = await guestMessage(C1B);
      const cB = await sr(
        "copilot_claim_generation",
        claimArgs({ p_conversation_id: C1B, p_property_id: P1B, p_trigger_message_id: mB }),
      );
      await sr("copilot_store_result", storeArgs(String(cB.suggestion_id), 1, { p_text: "P1B" }));
      const visible = async (who: string) =>
        (
          await pg.sql(
            `${as(who)}select coalesce(string_agg(suggested_text, ',' order by suggested_text), '(nenhuma)') from public.guest_ai_copilot_suggestions`,
            { role: "authenticated" },
          )
        )
          .split("\n")
          .pop();
      expect(await visible(T1)).toBe("P1,P1B"); // dono: todos os imóveis da conta
      expect(await visible(ALLPROPS)).toBe("P1,P1B"); // membro com todos os imóveis
      expect(await visible(MEMBER)).toBe("P1"); // membro restrito: só o imóvel atribuído
      expect(await visible(T2)).toBe("(nenhuma)"); // outro tenant
      // membro restrito não age na sugestão de imóvel não atribuído da MESMA conta
      expect(
        (
          await user(MEMBER, "copilot_claim_send", {
            p_suggestion_id: cB.suggestion_id,
            p_text: null,
          })
        ).result,
      ).toBe("not_found");
      expect(
        (await user(ALLPROPS, "copilot_edit", { p_suggestion_id: cB.suggestion_id, p_text: "ok" }))
          .result,
      ).toBe("edited");
      // atribuição inativa ⇒ perde acesso; membro inativo ⇒ perde acesso mesmo com todos os imóveis
      await pg.sql(
        `update public.property_assignments set status = 'inactive' where user_id = '${MEMBER}'`,
      );
      expect(await visible(MEMBER)).toBe("(nenhuma)");
      expect((await user(MEMBER, "copilot_discard", { p_suggestion_id: idP1 })).result).toBe(
        "not_found",
      );
      await pg.sql(
        `update public.account_members set status = 'inactive' where member_user_id = '${ALLPROPS}'`,
      );
      expect(await visible(ALLPROPS)).toBe("(nenhuma)");
      expect(
        (await user(ALLPROPS, "copilot_claim_send", { p_suggestion_id: idP1, p_text: null }))
          .result,
      ).toBe("not_found");
    });

    it("membro com permissão insuficiente (sem chat_respond): LÊ como as mensagens, mas não edita, descarta nem envia", async () => {
      const id = await available();
      const seen = await pg.sql(
        `${as(READONLY)}select count(*) from public.guest_ai_copilot_suggestions`,
        { role: "authenticated" },
      );
      expect(seen.split("\n").pop()).toBe("1");
      expect(
        (await user(READONLY, "copilot_edit", { p_suggestion_id: id, p_text: "x" })).result,
      ).toBe("forbidden");
      expect((await user(READONLY, "copilot_discard", { p_suggestion_id: id })).result).toBe(
        "forbidden",
      );
      expect(
        (await user(READONLY, "copilot_claim_send", { p_suggestion_id: id, p_text: null })).result,
      ).toBe("forbidden");
      expect(
        (
          await user(READONLY, "copilot_reconcile_send", {
            p_suggestion_id: id,
            p_attempt_finished: true,
            p_error_code: null,
          })
        ).result,
      ).toBe("forbidden");
      expect(
        await pg.sql(
          `select state || ':' || send_attempts from public.guest_ai_copilot_suggestions where id = '${id}'`,
        ),
      ).toBe("available:0");
      // concessão explícita revogada também tira o envio de quem tinha
      await pg.sql(
        `update public.account_member_permissions set granted = false where member_user_id = '${MEMBER}'`,
      );
      expect(
        (await user(MEMBER, "copilot_claim_send", { p_suggestion_id: id, p_text: null })).result,
      ).toBe("forbidden");
      // o dono nunca precisa de concessão
      expect(
        (await user(T1, "copilot_claim_send", { p_suggestion_id: id, p_text: null })).result,
      ).toBe("claimed");
    });

    it("DML direto por tenant: nem o dono, nem membro, nem outro tenant, nem service_role escrevem ou leem fora das RPCs", async () => {
      const id = await available();
      for (const who of [T1, MEMBER, T2]) {
        for (const stmt of [
          `insert into public.guest_ai_copilot_suggestions (tenant_id, property_id, conversation_id, trigger_message_id, surface) values ('${T1}', '${P1}', '${C1}', '${MSG_A}', 'guide_chat')`,
          `update public.guest_ai_copilot_suggestions set state = 'sent' where id = '${id}'`,
          `delete from public.guest_ai_copilot_suggestions where id = '${id}'`,
        ]) {
          expect(
            (await pg.trySql(`${as(who)}${stmt}`, { role: "authenticated" })).ok,
            `${who}: ${stmt.slice(0, 20)}`,
          ).toBe(false);
        }
      }
      expect(
        (
          await pg.trySql(`select count(*) from public.guest_ai_copilot_suggestions`, {
            role: "service_role",
          })
        ).ok,
      ).toBe(false);
      expect(
        await pg.sql(`select state from public.guest_ai_copilot_suggestions where id = '${id}'`),
      ).toBe("available");
    });

    it("caminho administrativo: a ÚNICA política é de leitura por acesso ao imóvel (sem leitura global de admin do SaaS)", async () => {
      const pols = await pg.sql(
        `select string_agg(polcmd::text || ' ' || pg_get_expr(polqual, polrelid), ' | ') from pg_policy where polrelid = 'public.guest_ai_copilot_suggestions'::regclass`,
      );
      expect(pols).toBe(
        "r ((expires_at > now()) AND user_can_access_property(auth.uid(), property_id))",
      );
    });

    it("funções de geração só para service_role; ações do atendente só para authenticated", async () => {
      expect(
        (await pg.trySql(call("copilot_claim_generation", claimArgs()), { role: "authenticated" }))
          .ok,
      ).toBe(false);
      expect(
        (await pg.trySql(call("copilot_claim_generation", claimArgs()), { role: "anon" })).ok,
      ).toBe(false);
      expect(
        (await pg.trySql(call("copilot_purge_expired", {}), { role: "authenticated" })).ok,
      ).toBe(false);
      for (const f of [
        "copilot_edit(null::uuid, 'x')",
        "copilot_discard(null::uuid)",
        "copilot_claim_send(null::uuid, null)",
        "copilot_reconcile_send(null::uuid, false, null)",
      ]) {
        expect((await pg.trySql(`select public.${f}`, { role: "service_role" })).ok, f).toBe(false);
        expect((await pg.trySql(`select public.${f}`, { role: "anon" })).ok, f).toBe(false);
      }
      expect(
        (
          await pg.trySql(`select public.guest_ai_copilot_lock_for_actor(null::uuid, null::uuid)`, {
            role: "authenticated",
          })
        ).ok,
      ).toBe(false);
    });

    it("sem sessão (auth.uid() nulo) ⇒ unauthenticated; identidade é a da sessão, nunca um argumento", async () => {
      const id = await available();
      expect((await user(null, "copilot_discard", { p_suggestion_id: id })).result).toBe(
        "unauthenticated",
      );
      // a assinatura das ações não aceita id de usuário: não há como forjar autoria
      const args = await pg.sql(
        `select string_agg(pg_get_function_identity_arguments(p.oid), ' | ') from pg_proc p where p.proname in ('copilot_edit','copilot_discard','copilot_claim_send','copilot_finish_send','copilot_reconcile_send')`,
      );
      expect(args).not.toMatch(/actor|user/);
    });
  });

  describe("geração", () => {
    it("reivindicação idempotente e concorrente: 12 pedidos simultâneos ⇒ 1 claimed, 11 exists", async () => {
      const rs = await Promise.all(
        Array.from({ length: 12 }, () => sr("copilot_claim_generation", claimArgs())),
      );
      expect(rs.filter((r) => r.result === "claimed")).toHaveLength(1);
      expect(rs.filter((r) => r.result === "exists")).toHaveLength(11);
      expect(Number(await pg.sql(`select count(*) from public.guest_ai_copilot_suggestions`))).toBe(
        1,
      );
    });

    it("escopo: imóvel de outro tenant, mensagem de outra conversa e argumentos fora dos tetos ⇒ invalid", async () => {
      expect(await sr("copilot_claim_generation", claimArgs({ p_tenant_id: T2 }))).toMatchObject({
        result: "invalid",
        reason: "scope",
      });
      expect(await sr("copilot_claim_generation", claimArgs({ p_property_id: P2 }))).toMatchObject({
        result: "invalid",
        reason: "scope",
      });
      const other = await guestMessage(C2);
      expect(
        await sr("copilot_claim_generation", claimArgs({ p_trigger_message_id: other })),
      ).toMatchObject({ result: "invalid", reason: "message" });
      expect(
        await sr("copilot_claim_generation", claimArgs({ p_daily_cost_limit_usd: 5 })),
      ).toMatchObject({ result: "invalid", reason: "arguments" });
      expect(
        await sr("copilot_claim_generation", claimArgs({ p_turn_cost_ceiling_usd: 0.5 })),
      ).toMatchObject({ result: "invalid", reason: "arguments" });
      expect(await sr("copilot_claim_generation", claimArgs({ p_surface: "email" }))).toMatchObject(
        { result: "invalid", reason: "arguments" },
      );
    });

    it("mensagem nova do hóspede ⇒ sugestões vivas anteriores ficam superseded; gravação da antiga vira stale", async () => {
      const c = await sr("copilot_claim_generation", claimArgs());
      const old = await available("antiga", await guestMessage());
      const m2 = await guestMessage();
      const c2 = await sr("copilot_claim_generation", claimArgs({ p_trigger_message_id: m2 }));
      expect(c2.result).toBe("claimed");
      const states = await pg.sql(
        `select string_agg(state, ',' order by created_at) from public.guest_ai_copilot_suggestions`,
      );
      expect(states).toBe("superseded,superseded,generating");
      expect((await sr("copilot_store_result", storeArgs(String(c.suggestion_id), 1))).result).toBe(
        "stale",
      );
      expect((await sr("copilot_generation_state", { p_suggestion_id: old })).state).toBe(
        "superseded",
      );
    });

    it("teto diário (UTC): gerações em curso contam pelo pior caso; acima do teto ⇒ nasce generation_failed sem chamada", async () => {
      // 6 gerações em curso × 0,15 = 0,90 ⇒ a 7ª passaria de 1,00
      for (let i = 0; i < 6; i++) {
        await pg.sql(
          `insert into public.property_chat_conversations (id, property_id, guest_session_id) values ('${uid("c9000000")}', '${P1}', 's')`,
        );
      }
      const convs = (
        await pg.sql(
          `select id from public.property_chat_conversations where guest_session_id = 's' order by id`,
        )
      ).split("\n");
      for (const c of convs)
        expect(
          (
            await sr(
              "copilot_claim_generation",
              claimArgs({ p_conversation_id: c, p_trigger_message_id: await guestMessage(c) }),
            )
          ).result,
        ).toBe("claimed");
      const over = await sr("copilot_claim_generation", claimArgs());
      expect(over.result).toBe("daily_budget_exceeded");
      expect(
        await pg.sql(
          `select state || ':' || outcome_code from public.guest_ai_copilot_suggestions where id = '${over.suggestion_id}'`,
        ),
      ).toBe("generation_failed:budget_daily_exceeded");
    });

    it("geração travada (> 90 s) é reivindicada de novo com nova tentativa; a tentativa antiga não grava", async () => {
      const c = await sr("copilot_claim_generation", claimArgs());
      await pg.sql(
        `update public.guest_ai_copilot_suggestions set generation_started_at = now() - interval '2 minutes'`,
      );
      const again = await sr("copilot_claim_generation", claimArgs());
      expect(again).toMatchObject({ result: "claimed", reclaimed: true, generation_attempts: 2 });
      expect((await sr("copilot_store_result", storeArgs(String(c.suggestion_id), 1))).result).toBe(
        "stale",
      );
      expect((await sr("copilot_store_result", storeArgs(String(c.suggestion_id), 2))).result).toBe(
        "stored",
      );
    });

    it("vocabulário fechado: estado, aviso, intenção e texto acima do teto são recusados pelo banco", async () => {
      const c = await sr("copilot_claim_generation", claimArgs());
      const id = String(c.suggestion_id);
      expect((await sr("copilot_store_result", storeArgs(id, 1, { p_state: "sent" }))).result).toBe(
        "invalid",
      );
      expect(
        (await sr("copilot_store_result", storeArgs(id, 1, { p_text: "x".repeat(4001) }))).result,
      ).toBe("invalid");
      expect(
        (
          await pg.trySql(
            call("copilot_store_result", storeArgs(id, 1, { p_warnings: ["texto livre"] })),
            { role: "service_role" },
          )
        ).ok,
      ).toBe(false);
      expect(
        (
          await pg.trySql(
            call("copilot_store_result", storeArgs(id, 1, { p_intents: ["qualquer"] })),
            { role: "service_role" },
          )
        ).ok,
      ).toBe(false);
      expect(
        (
          await pg.trySql(
            call(
              "copilot_store_result",
              storeArgs(id, 1, { p_gateway_error: "Erro do provedor: chave X" }),
            ),
            { role: "service_role" },
          )
        ).ok,
      ).toBe(false);
    });
  });

  describe("ações do atendente", () => {
    it("editar e descartar: autoria = auth.uid(); outro tenant ⇒ not_found (sem revelar existência)", async () => {
      const id = await available();
      expect(
        (await user(T2, "copilot_edit", { p_suggestion_id: id, p_text: "invasão" })).result,
      ).toBe("not_found");
      expect((await user(STRANGER, "copilot_discard", { p_suggestion_id: id })).result).toBe(
        "not_found",
      );
      const e = await user(MEMBER, "copilot_edit", {
        p_suggestion_id: id,
        p_text: "O check-in é às 15h. Bem-vindo!",
      });
      expect(e).toMatchObject({
        result: "edited",
        state: "edited",
        text: "O check-in é às 15h. Bem-vindo!",
      });
      expect(
        await pg.sql(
          `select edited_by from public.guest_ai_copilot_suggestions where id = '${id}'`,
        ),
      ).toBe(MEMBER);
      expect((await user(T1, "copilot_discard", { p_suggestion_id: id })).result).toBe("discarded");
      expect(
        await pg.sql(
          `select state || ':' || discarded_by from public.guest_ai_copilot_suggestions where id = '${id}'`,
        ),
      ).toBe(`discarded:${T1}`);
      expect((await user(T1, "copilot_edit", { p_suggestion_id: id, p_text: "x" })).result).toBe(
        "invalid_state",
      );
      expect(
        (await user(T1, "copilot_claim_send", { p_suggestion_id: id, p_text: null })).result,
      ).toBe("invalid_state");
    });

    it("sugestão em geração ou sem texto não pode ser enviada", async () => {
      const c = await sr("copilot_claim_generation", claimArgs());
      expect(
        (await user(T1, "copilot_claim_send", { p_suggestion_id: c.suggestion_id, p_text: null }))
          .result,
      ).toBe("invalid_state");
      await sr(
        "copilot_store_result",
        storeArgs(String(c.suggestion_id), 1, { p_state: "no_suggestion", p_text: null }),
      );
      expect(
        (await user(T1, "copilot_claim_send", { p_suggestion_id: c.suggestion_id, p_text: null }))
          .result,
      ).toBe("invalid_state");
    });

    it("envio: 10 cliques/abas simultâneos ⇒ UM claimed (com token), 9 send_in_progress", async () => {
      const id = await available();
      const rs = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          user(i % 2 ? T1 : MEMBER, "copilot_claim_send", { p_suggestion_id: id, p_text: null }),
        ),
      );
      const claimed = rs.filter((r) => r.result === "claimed");
      expect(claimed).toHaveLength(1);
      expect(rs.filter((r) => r.result === "send_in_progress")).toHaveLength(9);
      expect(String(claimed[0]!.send_token)).toMatch(/^[0-9a-f-]{36}$/);
      expect(claimed[0]!.text).toBe("O check-in é às 15h.");
      expect(
        Number(
          await pg.sql(
            `select send_attempts from public.guest_ai_copilot_suggestions where id = '${id}'`,
          ),
        ),
      ).toBe(1);
    });

    it("encerrar envio exige o token e o MESMO usuário; `sent` exige a mensagem gravada", async () => {
      const id = await available();
      const c = await user(MEMBER, "copilot_claim_send", {
        p_suggestion_id: id,
        p_text: "Texto final aprovado",
      });
      expect(c.text).toBe("Texto final aprovado");
      const base = {
        p_suggestion_id: id,
        p_outcome: "sent",
        p_message_id: uid("f0000000"),
        p_provider_message_id: "ext-1",
        p_channel: "web",
        p_error_code: null,
      };
      expect(
        (await user(MEMBER, "copilot_finish_send", { ...base, p_send_token: uid("aa000000") }))
          .result,
      ).toBe("token_mismatch");
      expect(
        (await user(T1, "copilot_finish_send", { ...base, p_send_token: c.send_token })).result,
      ).toBe("token_mismatch");
      expect(
        (
          await user(MEMBER, "copilot_finish_send", {
            ...base,
            p_send_token: c.send_token,
            p_message_id: null,
          })
        ).result,
      ).toBe("invalid");
      const ok = await user(MEMBER, "copilot_finish_send", { ...base, p_send_token: c.send_token });
      expect(ok).toMatchObject({ result: "finished", state: "sent" });
      expect(
        await pg.sql(
          `select sent_by || ':' || sent_channel || ':' || sent_provider_message_id || ':' || (edited_text is not null) from public.guest_ai_copilot_suggestions where id = '${id}'`,
        ),
      ).toBe(`${MEMBER}:web:ext-1:true`);
      // repetição depois de enviada (reprocessamento, refresh) ⇒ nada de novo
      expect(
        (await user(MEMBER, "copilot_claim_send", { p_suggestion_id: id, p_text: null })).result,
      ).toBe("invalid_state");
      expect(
        (await user(MEMBER, "copilot_finish_send", { ...base, p_send_token: c.send_token })).result,
      ).toBe("invalid_state");
    });

    it("falha registrada ⇒ send_failed; novo envio só por nova reivindicação explícita (tentativa 2)", async () => {
      const id = await available();
      const c = await user(T1, "copilot_claim_send", { p_suggestion_id: id, p_text: null });
      const f = await user(T1, "copilot_finish_send", {
        p_suggestion_id: id,
        p_send_token: c.send_token,
        p_outcome: "failed",
        p_message_id: null,
        p_provider_message_id: null,
        p_channel: "airbnb",
        p_error_code: "airbnb_rejected",
      });
      expect(f).toMatchObject({ result: "finished", state: "send_failed" });
      const c2 = await user(T1, "copilot_claim_send", { p_suggestion_id: id, p_text: null });
      expect(c2).toMatchObject({ result: "claimed", send_attempts: 2 });
    });

    it("reconciliação: mensagem gravada pelo mesmo usuário depois da reivindicação ⇒ sent (nunca reenvia)", async () => {
      const id = await available();
      await user(T1, "copilot_claim_send", { p_suggestion_id: id, p_text: null });
      // a rotina humana gravou a mensagem mas o processo caiu antes de `finish`
      const msg = uid("f1000000");
      await pg.sql(
        `insert into public.property_chat_messages (id, conversation_id, sender_type, role, sender_user_id, delivery_status, channel, external_id) values ('${msg}', '${C1}', 'human', 'assistant', '${T1}', 'sent', 'whatsapp', 'wamid-9')`,
      );
      const r = await user(T1, "copilot_reconcile_send", {
        p_suggestion_id: id,
        p_attempt_finished: true,
        p_error_code: "send_failed",
      });
      expect(r).toMatchObject({ result: "reconciled_sent", state: "sent", sent_message_id: msg });
      expect(
        await pg.sql(
          `select sent_channel || ':' || sent_provider_message_id from public.guest_ai_copilot_suggestions where id = '${id}'`,
        ),
      ).toBe("whatsapp:wamid-9");
    });

    it("reconciliação sem mensagem: dentro do prazo ⇒ em andamento; tentativa encerrada ⇒ falha; prazo vencido ⇒ resultado desconhecido", async () => {
      const id = await available();
      await user(T1, "copilot_claim_send", { p_suggestion_id: id, p_text: null });
      expect(
        (
          await user(T1, "copilot_reconcile_send", {
            p_suggestion_id: id,
            p_attempt_finished: false,
            p_error_code: null,
          })
        ).result,
      ).toBe("send_in_progress");
      // mensagem de OUTRO usuário, nota interna ou falha não contam como o envio
      await pg.sql(
        `insert into public.property_chat_messages (id, conversation_id, sender_type, role, sender_user_id, delivery_status) values ('${uid("f2000000")}', '${C1}', 'human', 'assistant', '${MEMBER}', 'sent'), ('${uid("f3000000")}', '${C1}', 'human', 'assistant', '${T1}', 'failed')`,
      );
      await pg.sql(
        `insert into public.property_chat_messages (id, conversation_id, sender_type, role, sender_user_id, is_internal_note) values ('${uid("f4000000")}', '${C1}', 'human', 'assistant', '${T1}', true)`,
      );
      await pg.sql(
        `update public.guest_ai_copilot_suggestions set send_claimed_at = now() - interval '3 minutes' where id = '${id}'`,
      );
      // clique depois do prazo ⇒ `send_unknown` (o servidor reconcilia antes de qualquer nova tentativa)
      expect(
        (await user(T1, "copilot_claim_send", { p_suggestion_id: id, p_text: null })).result,
      ).toBe("send_unknown");
      const r = await user(T1, "copilot_reconcile_send", {
        p_suggestion_id: id,
        p_attempt_finished: false,
        p_error_code: null,
      });
      expect(r).toMatchObject({ result: "reconciled_unknown", state: "send_failed" });
      expect(
        await pg.sql(
          `select send_error from public.guest_ai_copilot_suggestions where id = '${id}'`,
        ),
      ).toBe("unknown_result");
      const id2 = await available("outra", await guestMessage());
      await user(T1, "copilot_claim_send", { p_suggestion_id: id2, p_text: null });
      expect(
        await user(T1, "copilot_reconcile_send", {
          p_suggestion_id: id2,
          p_attempt_finished: true,
          p_error_code: "whatsapp_send_failed",
        }),
      ).toMatchObject({ result: "reconciled_failed", state: "send_failed" });
      expect(
        (
          await user(T1, "copilot_reconcile_send", {
            p_suggestion_id: id2,
            p_attempt_finished: true,
            p_error_code: "Texto Livre",
          })
        ).result,
      ).toBe("invalid");
    });

    it("reconciliação e encerramento por outro tenant ⇒ not_found", async () => {
      const id = await available();
      const c = await user(T1, "copilot_claim_send", { p_suggestion_id: id, p_text: null });
      expect(
        (
          await user(T2, "copilot_reconcile_send", {
            p_suggestion_id: id,
            p_attempt_finished: true,
            p_error_code: null,
          })
        ).result,
      ).toBe("not_found");
      expect(
        (
          await user(T2, "copilot_finish_send", {
            p_suggestion_id: id,
            p_send_token: c.send_token,
            p_outcome: "sent",
            p_message_id: uid(),
            p_provider_message_id: null,
            p_channel: "web",
            p_error_code: null,
          })
        ).result,
      ).toBe("not_found");
    });
  });

  describe("retenção de 14 dias", () => {
    it("expirada some da leitura e das ações; expurgo remove; reivindicação expurga oportunisticamente", async () => {
      const id = await available();
      await pg.sql(
        `update public.guest_ai_copilot_suggestions set expires_at = now() - interval '1 second' where id = '${id}'`,
      );
      expect(
        await pg.sql(`${as(T1)}select count(*) from public.guest_ai_copilot_suggestions`, {
          role: "authenticated",
        }),
      ).toMatch(/0$/);
      expect(
        (await user(T1, "copilot_claim_send", { p_suggestion_id: id, p_text: null })).result,
      ).toBe("not_found");
      await sr(
        "copilot_claim_generation",
        claimArgs({ p_trigger_message_id: await guestMessage() }),
      );
      expect(
        Number(
          await pg.sql(
            `select count(*) from public.guest_ai_copilot_suggestions where id = '${id}'`,
          ),
        ),
      ).toBe(0);
      const id2 = await available("x", await guestMessage());
      await pg.sql(
        `update public.guest_ai_copilot_suggestions set expires_at = now() - interval '1 second' where id = '${id2}'`,
      );
      expect((await sr("copilot_purge_expired", {})).deleted).toBeGreaterThanOrEqual(1);
      expect(
        await pg.sql(
          `select (expires_at - created_at) = interval '14 days' from public.guest_ai_copilot_suggestions limit 1`,
        ),
      ).toBe("t");
    });

    it("sem FK para tabelas operacionais: conversa apagada não é tocada pela tabela nova; a órfã some na retenção", async () => {
      const id = await available();
      const fks = await pg.sql(
        `select count(*) from pg_constraint where conrelid = 'public.guest_ai_copilot_suggestions'::regclass and contype = 'f'`,
      );
      expect(fks).toBe("0");
      // nenhuma trigger (nem interna de FK) em lugar algum aponta para a tabela nova
      const trg = await pg.sql(
        `select count(*) from pg_trigger where tgconstrrelid = 'public.guest_ai_copilot_suggestions'::regclass or tgrelid = 'public.guest_ai_copilot_suggestions'::regclass`,
      );
      expect(trg).toBe("0");
      await pg.sql(`delete from public.property_chat_conversations where id = '${C1}'`);
      // a sugestão órfã continua só até expirar e é expurgada pela retenção
      await pg.sql(
        `update public.guest_ai_copilot_suggestions set expires_at = now() - interval '1 second' where id = '${id}'`,
      );
      await sr("copilot_purge_expired", {});
      expect(
        Number(
          await pg.sql(
            `select count(*) from public.guest_ai_copilot_suggestions where id = '${id}'`,
          ),
        ),
      ).toBe(0);
    });
  });

  describe("paridade TypeScript × SQL", () => {
    const checkOf = async (col: string) =>
      pg.sql(
        `select string_agg(pg_get_constraintdef(c.oid), ' ') from pg_constraint c where c.conrelid = 'public.guest_ai_copilot_suggestions'::regclass and pg_get_constraintdef(c.oid) like '%${col}%'`,
      );
    const quoted = (def: string) => new Set([...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    it("estados, avisos, intenções, estratégias e urgências iguais aos do TypeScript", async () => {
      const states = quoted(await checkOf("state = ANY")); // inclui também outros CHECKs com state
      for (const s of COPILOT_STATES) expect(states.has(s), s).toBe(true);
      const warn = quoted(await checkOf("warnings <@"));
      expect([...warn].sort()).toEqual([...COPILOT_WARNINGS].sort());
      const intents = quoted(await checkOf("intents <@"));
      expect([...intents].sort()).toEqual([...INTENT_CATEGORIES].sort());
      for (const s of STRATEGIES) expect(quoted(await checkOf("strategy")).has(s), s).toBe(true);
      for (const u of HANDOFF_URGENCIES)
        expect(quoted(await checkOf("handoff_urgency")).has(u), u).toBe(true);
    });
    it("todas as colunas lidas pela UI existem; tetos de custo da migration = os do TypeScript", async () => {
      const cols = (
        await pg.sql(
          `select string_agg(column_name, ',') from information_schema.columns where table_schema = 'public' and table_name = 'guest_ai_copilot_suggestions'`,
        )
      ).split(",");
      for (const c of COPILOT_ROW_COLUMNS) expect(cols, c).toContain(c);
      const src = await pg.sql(
        `select prosrc from pg_proc where proname = 'copilot_claim_generation'`,
      );
      expect(src).toContain(
        `p_daily_cost_limit_usd > ${COPILOT_DAILY_COST_CEILING_USD.toFixed(2)}`,
      );
      expect(src).toContain(`p_turn_cost_ceiling_usd > ${COPILOT_MAX_TURN_COST_USD}`);
    });
  });

  describe("bundle: idempotente, transacional e fail-closed", () => {
    it("reaplicar o bundle sobre a estrutura idêntica não altera nada (no-op)", async () => {
      const id = await available();
      const fp = async () =>
        pg.sql(
          `select md5(string_agg(oid::text || proname || md5(prosrc), ',' order by proname)) from pg_proc where proname like 'copilot\\_%'`,
        );
      const before = await fp();
      await pg.sql(readFileSync(MIGRATION, "utf8"));
      expect(await fp()).toBe(before);
      expect(
        await pg.sql(`select state from public.guest_ai_copilot_suggestions where id = '${id}'`),
      ).toBe("available");
    });

    it("estrutura divergente ou aplicação parcial ⇒ COPILOT_CONFLITO e nada é alterado", async () => {
      await pg.sql(
        `create index guest_ai_copilot_tmp_divergencia on public.guest_ai_copilot_suggestions (surface)`,
      );
      const r1 = await pg.trySql(readFileSync(MIGRATION, "utf8"));
      expect(r1.ok).toBe(false);
      expect(!r1.ok && r1.error).toMatch(/COPILOT_(CONFLITO|PREFLIGHT)/);
      await pg.sql(`drop index public.guest_ai_copilot_tmp_divergencia`);
      // aplicação parcial (função faltando)
      await pg.sql(`alter function public.copilot_purge_expired() rename to zz_copilot_tmp_fora`);
      const r2 = await pg.trySql(readFileSync(MIGRATION, "utf8"));
      expect(!r2.ok && r2.error).toMatch(/COPILOT_CONFLITO: aplicação parcial/);
      await pg.sql(`alter function public.zz_copilot_tmp_fora() rename to copilot_purge_expired`);
      // de volta ao idêntico ⇒ no-op de novo
      expect((await pg.trySql(readFileSync(MIGRATION, "utf8"))).ok).toBe(true);
    });

    it("o bundle é um ÚNICO comando (bloco DO) e não altera nada fora da tabela nova", () => {
      const sql = readFileSync(MIGRATION, "utf8")
        .replace(/^--.*$/gm, "")
        .trim();
      expect(sql.startsWith("DO $bundle$")).toBe(true);
      expect(sql.endsWith("$bundle$;")).toBe(true);
      expect(sql).not.toMatch(
        /alter publication|references public\.|create trigger|alter table public\.(?!guest_ai_copilot_suggestions)|drop (table|function|policy)/i,
      );
      expect(sql).toMatch(/COPILOT_POS: o catálogo operacional mudou/);
    });
  });
});
