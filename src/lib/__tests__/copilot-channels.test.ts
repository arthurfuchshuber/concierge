/**
 * COPILOTO · preparação dos testes dos TRÊS CANAIS (Guia, WhatsApp, Airbnb) — fluxo de ponta a ponta com as
 * ROTINAS OFICIAIS REAIS de envio (`handoff-send.server` / `whatsapp-send.server` / `deliverToAirbnbThread`).
 * Só a rede (Sinch, Channex, Airbnb) e o banco são falsos: nenhuma mensagem real sai, nenhum hóspede real.
 *
 * Por canal: geração pela cadeia real + Gateway real (transporte falso) com o turno do canal → sugestão
 * disponível → aprovação humana → reivindicação → guarda → rotina oficial do canal → gravação com AUTORIA da
 * sessão → encerramento com o id; clique repetido não gera segundo envio; falha do provedor é registrada e
 * reconciliada antes de marcar falha. Guia = `GuideAiChat` (/g/$slug) → POST /api/public/guide-chat,
 * superfície `guide_chat`, mensagens com `channel` padrão `web` e entrega por leitura (GET com `since`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ───────────── banco e rede falsos (registram tudo; nada sai) ─────────────
const db = vi.hoisted(() => ({
  inserts: [] as Array<{ client: string; table: string; row: Record<string, unknown> }>,
  updates: [] as Array<{ client: string; table: string; patch: Record<string, unknown> }>,
  conv: null as Record<string, unknown> | null,
  waConfig: null as Record<string, unknown> | null,
  sinch: [] as Array<{ to: string; text: string }>,
  sinchFail: false,
  permission: [] as string[],
}));

function fakeClient(name: string) {
  const builder = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "not", "order", "limit", "ilike"]) q[m] = () => q;
    q.maybeSingle = async () => ({
      data:
        table === "property_chat_conversations"
          ? db.conv
          : table === "host_whatsapp_config"
            ? db.waConfig
            : table === "properties"
              ? { name: "Casa Teste" }
              : null,
      error: null,
    });
    q.single = q.maybeSingle;
    q.insert = (row: Record<string, unknown>) => {
      db.inserts.push({ client: name, table, row });
      const r = { data: { id: `row-${db.inserts.length}` }, error: null };
      return {
        select: () => ({ single: async () => r, maybeSingle: async () => r }),
        then: (f: (v: unknown) => void) => f({ error: null }),
      };
    };
    q.update = (patch: Record<string, unknown>) => {
      db.updates.push({ client: name, table, patch });
      const u: Record<string, unknown> = {};
      for (const m of ["eq", "in"]) u[m] = () => u;
      u.then = (f: (v: unknown) => void) => f({ error: null });
      return u;
    };
    return q;
  };
  return { from: builder };
}

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeClient("admin") }));
vi.mock("@/lib/handoff.functions", () => ({
  requireChatRespondForConversation: async (_s: unknown, userId: string) => {
    db.permission.push(`chat_respond:${userId}`);
  },
}));
vi.mock("@/lib/member-permissions.server", () => ({
  requireMemberPermission: async (_s: unknown, userId: string, _o: string, perm: string) => {
    db.permission.push(`${perm}:${userId}`);
  },
}));
vi.mock("@/lib/whatsapp.server", () => ({
  decryptToken: () => "token-falso",
  normalizePhone: (p: string) => `+${p.replace(/\D/g, "")}`,
  sinchSendText: async (_cfg: unknown, m: { toE164: string; text: string }) => {
    if (db.sinchFail) throw new Error("Sinch 500");
    db.sinch.push({ to: m.toE164, text: m.text });
    return { messageId: `sinch-${db.sinch.length}` };
  },
}));
vi.mock("@/lib/guest-push.server", () => ({ sendPushToGuest: async () => {} }));
vi.mock("@/lib/delivery-failure.server", () => ({ reportDeliveryFailure: async () => {} }));
const airbnb = vi.hoisted(() => ({
  outcome: { outcome: "preferred_is_mapped", channelId: "chan-ok" } as Record<string, unknown>,
  calls: [] as unknown[],
}));
vi.mock("@/lib/airbnb-direct-sender.server", () => ({
  sendAsPreferredSenderDetailed: async (...a: unknown[]) => {
    airbnb.calls.push(a);
    return airbnb.outcome;
  },
}));

import { sendCopilotSuggestionCore } from "@/lib/copilot-send.server";
import { generateCopilotSuggestion } from "@/lib/guest-ai/copilot/generate.server";
import type { CopilotStore, CopilotResultInput } from "@/lib/guest-ai/copilot/store.server";
import type { GuestSurface } from "@/lib/guest-ai/types";
import { ctx, history, turn, v6 } from "../guest-ai/__tests__/helpers/b23-chain";
import { fakeProvider, okJson } from "../guest-ai/__tests__/helpers/copilot-provider";

const USER = "5e551000-0000-4000-8000-000000000001"; // atendente da SESSÃO (único autor aceito)
const CONV = "c0000000-0000-4000-8000-0000000000aa";
const SID = "50000000-0000-4000-8000-0000000000aa";
const ENV = {
  GUEST_AI_COPILOT_UI: "on",
  GUEST_AI_COPILOT_GENERATION: "on",
  GUEST_AI_COPILOT_SEND: "on",
  GUEST_AI_COPILOT_GENERATION_PROPERTY_IDS: "p1",
};
const fetchMock = vi.fn(async (url: string) =>
  url.includes("/message_threads/")
    ? new Response(JSON.stringify({ data: { id: "cx-msg-1" } }), { status: 200 })
    : new Response("{}", { status: 404 }),
);

const CHANNELS: ReadonlyArray<{
  surface: GuestSurface;
  session: string;
  label: string;
  channel: "web" | "whatsapp" | "airbnb";
}> = [
  {
    surface: "guide_chat",
    session: "1f0c2b9e-guia-sessao-teste",
    label: "Guia (chat do guia público)",
    channel: "web",
  },
  {
    surface: "whatsapp",
    session: "wa:5500000000001",
    label: "WhatsApp (Sinch, número de teste)",
    channel: "whatsapp",
  },
  {
    surface: "airbnb",
    session: "airbnb:thread-teste-1",
    label: "Airbnb (Channex, thread de teste)",
    channel: "airbnb",
  },
];

class MemStore implements CopilotStore {
  result: CopilotResultInput | null = null;
  async claim() {
    return { kind: "claimed" as const, suggestionId: SID, attempt: 1, reclaimed: false };
  }
  async state() {
    return { state: "generating" as const, attempt: 1 };
  }
  async store(i: CopilotResultInput) {
    this.result = i;
    return { kind: "stored" as const };
  }
}

/** RPCs do envio (Gate G1: `copilot_actor_*` como service_role) com a semântica do banco: um claimed; depois send_in_progress. */
function sessionRpc(text: string, surface: GuestSurface) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let claimed = false;
  const client = {
    ...fakeClient("session"),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "copilot_actor_claim_send") {
        if (claimed) return { data: { result: "send_in_progress" }, error: null };
        claimed = true;
        return {
          data: {
            result: "claimed",
            send_token: "70000000-0000-4000-8000-000000000001",
            text,
            conversation_id: CONV,
            property_id: "p1",
            tenant_id: "t1",
            surface,
            trigger_message_id: "m1",
          },
          error: null,
        };
      }
      if (fn === "copilot_actor_finish_send") return { data: { result: "finished" }, error: null };
      if (fn === "copilot_actor_reconcile_send")
        return {
          data: { result: args.p_attempt_finished ? "reconciled_failed" : "send_in_progress" },
          error: null,
        };
      return { data: null, error: null };
    },
  };
  return { client, calls };
}

beforeEach(() => {
  db.inserts.length = 0;
  db.updates.length = 0;
  db.sinch.length = 0;
  db.permission.length = 0;
  db.sinchFail = false;
  airbnb.calls.length = 0;
  airbnb.outcome = { outcome: "preferred_is_mapped", channelId: "chan-ok" };
  process.env.CHANNEX_API_KEY = "teste";
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe.each(CHANNELS)("Copiloto · canal $label", ({ surface, session, channel }) => {
  const setConv = () => {
    db.conv = {
      id: CONV,
      assigned_to: null,
      property_id: "p1",
      guest_session_id: session,
      guest_name: "Hóspede Teste",
      properties: { id: "p1", owner_id: "t1", name: "Casa Teste", slug: "casa-teste" },
    };
    db.waConfig = {
      provider: "sinch",
      sender_number: "+5500000000999",
      service_plan_id: "proj",
      app_id: "app",
      api_token_encrypted: "enc",
      status: "active",
    };
  };
  const guard = (async () => ({
    ok: true as const,
    surface,
    turn: {} as never,
    senderChannelId: surface === "airbnb" ? "chan-ok" : null,
    senderSource: surface === "airbnb" ? ("host_preference" as const) : null,
  })) as never;

  it("recebimento → contexto D9 → geração pelo Gateway (transporte falso) → sugestão disponível do canal", async () => {
    const store = new MemStore();
    const p = fakeProvider(okJson(v6()));
    const r = await generateCopilotSuggestion(
      { surface, conversationId: CONV, messageId: "m1", expectedOwnerId: "t1" },
      {
        env: ENV,
        store,
        db: {
          from: () => {
            throw new Error("sem banco real");
          },
        },
        validateTurnScope: async () => turn({ surface, guestSessionId: session }),
        loadOwnership: async () => ({
          status: "none",
          row: {
            id: CONV,
            status: "ai",
            assigned_to: null,
            handoff_reason: null,
            handoff_urgency: null,
            handoff_at: null,
            resolved_at: null,
            ai_paused: false,
            paused_until: null,
          } as never,
        }),
        ports: () => ({
          loadContext: async () =>
            ctx({ interlocutor: { ...ctx().guest.interlocutor, surface } } as never),
          loadHistory: async () => history(),
          loadDossiers: async () => null,
          loadStayAuthorizationSource: async () => {
            throw new Error("sem fonte");
          },
          loadSenderIdentitySource: async () => ({
            lookup: "ok",
            conversationListingId: null,
            reservationListingId: null,
            listings: [],
            twins: [],
            prefs: [],
            accounts: [],
          }),
        }),
        provider: p,
        log: () => {},
        // bastidores (08/11/2026) fora deste teste: aqui só a sugestão do canal (uma chamada ao Gateway)
        extractOps: async () => null,
        ops: async () => undefined,
      },
    );
    expect(r).toMatchObject({ status: "stored", state: "available" });
    expect(p.calls).toBe(1);
    expect(store.result?.text).toBeTruthy();
    expect(store.result?.context.credentialPolicy).toBe("deny");
  });

  it("aprovação humana → rotina OFICIAL do canal → gravação com autoria da sessão → encerramento; clique repetido não reenvia", async () => {
    setConv();
    const s = sessionRpc("O check-in é às 15h.", surface);
    const r1 = await sendCopilotSuggestionCore(
      s.client,
      USER,
      { suggestionId: SID },
      { env: ENV, guard, actorDb: s.client },
    );
    const r2 = await sendCopilotSuggestionCore(
      s.client,
      USER,
      { suggestionId: SID },
      { env: ENV, guard, actorDb: s.client },
    );
    expect(r2).toEqual({ status: "send_in_progress" });
    const outbound = db.inserts.filter((i) => i.table === "property_chat_messages");
    expect(outbound).toHaveLength(1); // UM envio, mesmo com dois cliques
    const row = outbound[0]!.row;
    expect(row).toMatchObject({ sender_type: "human", sender_user_id: USER, role: "assistant" });
    expect(row.content).toContain("15h");
    if (channel === "web") {
      expect(outbound[0]!.client).toBe("session"); // gravação do chat do guia pela sessão (RLS)
      expect(row.channel ?? "web").toBe("web"); // coluna com padrão 'web' — o guest lê por GET /api/public/guide-chat
      expect(db.sinch).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(db.permission).toContain(`chat_respond:${USER}`);
    }
    if (channel === "whatsapp") {
      expect(db.sinch).toEqual([{ to: "+5500000000001", text: expect.stringContaining("15h") }]);
      expect(row).toMatchObject({
        channel: "whatsapp",
        delivery_status: "sent",
        external_id: "sinch-1",
        sent_via_number: "+5500000000999",
      });
      expect(db.permission).toContain(`chat_respond:${USER}`);
    }
    if (channel === "airbnb") {
      expect(airbnb.calls[0]).toEqual([
        "thread-teste-1",
        expect.stringContaining("15h"),
        "chan-ok",
      ]); // remetente estrito
      expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
        expect.stringContaining("/message_threads/thread-teste-1/messages"),
      ]);
      expect(row).toMatchObject({
        channel: "airbnb",
        delivery_status: "sent",
        external_id: "cx-msg-1",
      });
      expect(outbound[0]!.client).toBe("admin");
    }
    // pausa da IA / atribuição aplicadas pela rotina oficial (como no envio humano normal)
    expect(
      db.updates.some(
        (u) => u.table === "property_chat_conversations" && u.patch.assigned_to === USER,
      ),
    ).toBe(true);
    // encerramento com o token da reivindicação
    const fin = s.calls.find((c) => c.fn === "copilot_actor_finish_send");
    if (channel === "airbnb")
      expect(fin?.args).toMatchObject({
        p_outcome: "sent",
        p_channel: "airbnb",
        p_provider_message_id: "cx-msg-1",
      });
    else expect(s.calls.map((c) => c.fn)).toContain("copilot_actor_reconcile_send"); // guia/WhatsApp: id reconciliado pelo autor/instante
    expect(r1.status === "sent" || r1.status === "send_in_progress").toBe(true);
  });

  it("falha do provedor ⇒ registrada e reconciliada antes de marcar falha; nada sai por caminho paralelo", async () => {
    setConv();
    if (channel === "web") {
      // guia não tem provedor externo: a falha é da gravação (simulada pela guarda recusando o escopo)
      const s = sessionRpc("x", surface);
      const out = await sendCopilotSuggestionCore(
        s.client,
        USER,
        { suggestionId: SID },
        {
          env: ENV,
          guard: (async () => ({ ok: false, code: "scope_mismatch" })) as never,
          actorDb: s.client,
        },
      );
      expect(out).toMatchObject({ status: "send_failed", code: "scope_mismatch" });
      expect(db.inserts).toHaveLength(0);
      return;
    }
    if (channel === "whatsapp") db.sinchFail = true;
    if (channel === "airbnb")
      airbnb.outcome = { outcome: "failed", reason: "token_unavailable", channelId: "chan-ok" };
    const s = sessionRpc("O check-in é às 15h.", surface);
    const out = await sendCopilotSuggestionCore(
      s.client,
      USER,
      { suggestionId: SID },
      { env: ENV, guard, actorDb: s.client },
    );
    expect(out).toMatchObject({
      status: "send_failed",
      code: channel === "whatsapp" ? "whatsapp_send_failed" : "preferred_sender_failed",
    });
    expect(s.calls.at(-1)).toMatchObject({
      fn: "copilot_actor_reconcile_send",
      args: { p_attempt_finished: true },
    });
    const failed = db.inserts.filter((i) => i.table === "property_chat_messages");
    expect(failed.every((f) => f.row.delivery_status === "failed")).toBe(true);
    if (channel === "airbnb") expect(fetchMock).not.toHaveBeenCalled(); // sem fallback silencioso pela Channex
  });
});

// ─────────────────────────── configurações de liberação ───────────────────────────
const CONFIG_INICIAL = {
  GUEST_AI_COPILOT_UI: "on",
  GUEST_AI_COPILOT_GENERATION: "off",
  GUEST_AI_COPILOT_SEND: "off",
};
const CONFIG_FASE_A = {
  GUEST_AI_COPILOT_UI: "on",
  GUEST_AI_COPILOT_GENERATION: "on",
  GUEST_AI_COPILOT_SEND: "off",
  GUEST_AI_COPILOT_GENERATION_PROPERTY_IDS: "p1",
};

describe.each(CHANNELS)(
  "Copiloto · configurações de liberação no canal $label",
  ({ surface, session }) => {
    const genDeps = (
      env: Record<string, string>,
      store: MemStore,
      p: ReturnType<typeof fakeProvider>,
      validate = vi.fn(async () => turn({ surface, guestSessionId: session })),
    ) => ({
      env,
      store,
      db: {
        from: () => {
          throw new Error("sem banco real");
        },
      },
      validateTurnScope: validate,
      loadOwnership: async () => ({
        status: "none" as const,
        row: {
          id: CONV,
          status: "ai",
          assigned_to: null,
          handoff_reason: null,
          handoff_urgency: null,
          handoff_at: null,
          resolved_at: null,
          ai_paused: false,
          paused_until: null,
        } as never,
      }),
      ports: () => ({
        loadContext: async () =>
          ctx({ interlocutor: { ...ctx().guest.interlocutor, surface } } as never),
        loadHistory: async () => history(),
        loadDossiers: async () => null,
        loadStayAuthorizationSource: async () => {
          throw new Error("sem fonte");
        },
        loadSenderIdentitySource: async () => ({
          lookup: "ok" as const,
          conversationListingId: null,
          reservationListingId: null,
          listings: [],
          twins: [],
          prefs: [],
          accounts: [],
        }),
      }),
      provider: p,
      log: () => {},
      extractOps: async () => null,
      ops: async () => undefined,
    });
    const guard = vi.fn(async () => ({
      ok: true as const,
      surface,
      turn: {} as never,
      senderChannelId: surface === "airbnb" ? "chan-ok" : null,
      senderSource: null,
    }));
    const sendHuman = vi.fn();

    it("INICIAL (UI on, geração off, envio off): nenhuma geração nem envio por nenhum caminho", async () => {
      const store = new MemStore();
      const p = fakeProvider(okJson(v6()));
      const validate = vi.fn(async () => turn({ surface, guestSessionId: session }));
      const r = await generateCopilotSuggestion(
        { surface, conversationId: CONV, messageId: "m1" },
        genDeps(CONFIG_INICIAL, store, p, validate) as never,
      );
      expect(r).toEqual({ status: "skipped", code: "generation_off", detail: null });
      expect(validate).not.toHaveBeenCalled();
      expect(p.calls).toBe(0);
      const s = sessionRpc("x", surface);
      expect(
        await sendCopilotSuggestionCore(s.client, USER, { suggestionId: SID }, {
          env: CONFIG_INICIAL,
          guard,
          actorDb: s.client,
          sendHuman,
          sendWhatsapp: sendHuman,
        } as never),
      ).toEqual({ status: "send_disabled" });
      expect(s.calls).toEqual([]);
      expect(guard).not.toHaveBeenCalled();
      expect(sendHuman).not.toHaveBeenCalled();
      expect(db.inserts).toHaveLength(0);
      expect(db.sinch).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("FASE A (UI on, geração on, envio off): gera pelo Gateway com contexto D9, grava associada ao turno; envio bloqueado no backend", async () => {
      const store = new MemStore();
      const p = fakeProvider(okJson(v6()));
      const r = await generateCopilotSuggestion(
        { surface, conversationId: CONV, messageId: "m1" },
        genDeps(CONFIG_FASE_A, store, p) as never,
      );
      expect(r).toMatchObject({ status: "stored", suggestionId: SID, state: "available" });
      expect(p.calls).toBe(1);
      expect(store.result).toMatchObject({
        suggestionId: SID,
        attempt: 1,
        state: "available",
        context: { credentialPolicy: "deny" },
      });
      // envio: nem reivindicação, nem guarda, nem rotina, nem rede
      setConvFor(surface, session);
      const s = sessionRpc(store.result!.text!, surface);
      for (let i = 0; i < 3; i++) {
        expect(
          await sendCopilotSuggestionCore(s.client, USER, { suggestionId: SID, text: "editado" }, {
            env: CONFIG_FASE_A,
            guard,
            actorDb: s.client,
          } as never),
        ).toEqual({ status: "send_disabled" });
      }
      expect(s.calls).toEqual([]);
      expect(guard).not.toHaveBeenCalled();
      expect(db.inserts).toHaveLength(0);
      expect(db.sinch).toHaveLength(0);
      expect(airbnb.calls).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  },
);

function setConvFor(surface: GuestSurface, session: string) {
  db.conv = {
    id: CONV,
    assigned_to: null,
    property_id: "p1",
    guest_session_id: session,
    guest_name: "Hóspede Teste",
    properties: { id: "p1", owner_id: "t1", name: "Casa Teste", slug: "casa-teste" },
  };
  db.waConfig = {
    provider: "sinch",
    sender_number: "+5500000000999",
    service_plan_id: "proj",
    app_id: "app",
    api_token_encrypted: "enc",
    status: "active",
  };
  void surface;
}
