/**
 * COPILOTO · preparação dos testes dos TRÊS CANAIS (Guia, WhatsApp, Airbnb) — fluxo de ponta a ponta com as
 * ROTINAS OFICIAIS REAIS de envio (`handoff-send.server` / `whatsapp-send.server` / `deliverToAirbnbThread`).
 * Só a rede (Channex, Airbnb) e o banco são falsos: nenhuma mensagem real sai, nenhum hóspede real.
 *
 * Por canal: geração pela cadeia real + Gateway real (transporte falso) com o turno do canal → resposta
 * disponível. (O envio pela equipe da sugestão foi removido em 10/11/2026: a IA responde pelo slot.) Guia = `GuideAiChat` (/g/$slug) → POST /api/public/guide-chat,
 * superfície `guide_chat`, mensagens com `channel` padrão `web` e entrega por leitura (GET com `since`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ───────────── banco e rede falsos (registram tudo; nada sai) ─────────────
const db = vi.hoisted(() => ({
  inserts: [] as Array<{ client: string; table: string; row: Record<string, unknown> }>,
  updates: [] as Array<{ client: string; table: string; patch: Record<string, unknown> }>,
  conv: null as Record<string, unknown> | null,
  waConfig: null as Record<string, unknown> | null,
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

import { generateCopilotSuggestion } from "@/lib/guest-ai/copilot/generate.server";
import type { CopilotStore, CopilotResultInput } from "@/lib/guest-ai/copilot/store.server";
import type { GuestSurface } from "@/lib/guest-ai/types";
import { ctx, history, turn, v6 } from "../guest-ai/__tests__/helpers/b23-chain";
import { fakeProvider, okJson } from "../guest-ai/__tests__/helpers/copilot-provider";

const USER = "5e551000-0000-4000-8000-000000000001"; // atendente da SESSÃO (único autor aceito)
const CONV = "c0000000-0000-4000-8000-0000000000aa";
const SID = "50000000-0000-4000-8000-0000000000aa";
const ENV = {
  GUEST_AI_COPILOT_GENERATION: "on",
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
    label: "WhatsApp (standby; geração do motor segue igual)",
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
  db.permission.length = 0;
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
});

// Fases com envio pela equipe (UI/envio) removidas em 10/11/2026 junto com o cartão de sugestão.
