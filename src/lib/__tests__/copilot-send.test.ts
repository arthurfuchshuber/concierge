/**
 * COPILOTO · frente 3 (envio). Nenhuma mensagem real sai: as rotinas humanas de envio, a guarda, a Channex e o
 * Airbnb são falsos. Cobre: o envio usa a rotina humana EXISTENTE do canal (guia/Airbnb/WhatsApp) com o texto
 * aprovado; Airbnb impõe o remetente resolvido (modo estrito); guarda recusada ⇒ nada é enviado; cliques
 * repetidos/envio em andamento/resultado ambíguo ⇒ NENHUM segundo envio; erro na rotina ⇒ reconciliação antes
 * de marcar falha; remetente estrito sem fallback silencioso (e fluxo humano antigo inalterado); autoria só da
 * sessão (nenhum id de usuário aceito do frontend).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifySendError,
  sendCopilotSuggestionCore,
  type CopilotSendDeps,
} from "@/lib/copilot-send.server";

const SID = "5a000000-0000-4000-8000-000000000001";
const CONV = "5b000000-0000-4000-8000-000000000002";
const claimOk = (over: Record<string, unknown> = {}) => ({
  result: "claimed",
  send_token: "5c000000-0000-4000-8000-000000000003",
  text: "O check-in é às 15h.",
  conversation_id: CONV,
  property_id: "p1",
  tenant_id: "t1",
  surface: "guide_chat",
  trigger_message_id: "m1",
  ...over,
});

function fakeSupabase(
  responses: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>,
) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        const r = responses[fn];
        return {
          data:
            typeof r === "function"
              ? (r as (a: Record<string, unknown>) => unknown)(args)
              : (r ?? null),
          error: null,
        };
      },
      from: () => {
        throw new Error("não usado");
      },
    },
  };
}

const guardOk = (
  surface: "guide_chat" | "airbnb" | "whatsapp",
  senderChannelId: string | null = null,
) =>
  vi.fn(async () => ({
    ok: true as const,
    surface,
    turn: {} as never,
    senderChannelId,
    senderSource: senderChannelId ? ("host_preference" as const) : null,
  }));

function sendDeps(over: Partial<CopilotSendDeps> = {}) {
  const sendHuman = vi.fn(async () => ({
    ok: true as const,
    messageId: "msg-1",
    channel: "web" as const,
    externalId: null,
  }));
  const sendWhatsapp = vi.fn(async () => ({
    ok: true as const,
    messageId: "msg-wa",
    externalId: "wamid-1",
  }));
  return {
    sendHuman,
    sendWhatsapp,
    guard: guardOk("guide_chat"),
    ...over,
  } as Required<CopilotSendDeps> & {
    sendHuman: typeof sendHuman;
    sendWhatsapp: typeof sendWhatsapp;
  };
}

describe("Copiloto · envio pela rotina humana existente", () => {
  it("chat do guia: reivindica, confere, envia UMA vez pela rotina humana com o texto aprovado e encerra com o id", async () => {
    const sb = fakeSupabase({
      copilot_claim_send: claimOk(),
      copilot_finish_send: { result: "finished" },
    });
    const d = sendDeps();
    const r = await sendCopilotSuggestionCore(sb.client, "u-session", { suggestionId: SID }, d);
    expect(r).toEqual({ status: "sent", messageId: "msg-1" });
    expect(d.sendHuman).toHaveBeenCalledTimes(1);
    expect(d.sendHuman).toHaveBeenCalledWith(
      sb.client,
      "u-session",
      { conversationId: CONV, content: "O check-in é às 15h.", internalNote: false },
      {},
    );
    expect(d.sendWhatsapp).not.toHaveBeenCalled();
    expect(sb.calls.map((c) => c.fn)).toEqual(["copilot_claim_send", "copilot_finish_send"]);
    expect(sb.calls[1]!.args).toMatchObject({
      p_send_token: claimOk().send_token,
      p_outcome: "sent",
      p_message_id: "msg-1",
      p_channel: "web",
    });
  });

  it("Airbnb: impõe o remetente resolvido pela política (modo estrito) na rotina humana", async () => {
    const sb = fakeSupabase({
      copilot_claim_send: claimOk({ surface: "airbnb" }),
      copilot_finish_send: { result: "finished" },
    });
    const sendHuman = vi.fn(async () => ({
      ok: true as const,
      messageId: "msg-a",
      channel: "airbnb" as const,
      externalId: "airbnb-77",
    }));
    const d = sendDeps({ guard: guardOk("airbnb", "chan-preferido"), sendHuman });
    await sendCopilotSuggestionCore(sb.client, "u", { suggestionId: SID }, d);
    expect(sendHuman).toHaveBeenCalledWith(
      sb.client,
      "u",
      expect.objectContaining({ internalNote: false }),
      { strictSender: { expectedChannelId: "chan-preferido" } },
    );
    expect(sb.calls[1]!.args).toMatchObject({
      p_channel: "airbnb",
      p_provider_message_id: "airbnb-77",
    });
  });

  it("WhatsApp: só a rotina do canal oficial (Sinch) da conversa", async () => {
    const sb = fakeSupabase({
      copilot_claim_send: claimOk({ surface: "whatsapp" }),
      copilot_finish_send: { result: "finished" },
    });
    const d = sendDeps({ guard: guardOk("whatsapp") });
    expect(
      await sendCopilotSuggestionCore(sb.client, "u", { suggestionId: SID, text: "editado" }, d),
    ).toEqual({ status: "sent", messageId: "msg-wa" });
    expect(d.sendWhatsapp).toHaveBeenCalledWith(sb.client, "u", {
      conversationId: CONV,
      text: "O check-in é às 15h.",
    });
    expect(d.sendHuman).not.toHaveBeenCalled();
    expect(sb.calls[0]!.args).toMatchObject({ p_text: "editado" });
    expect(sb.calls[1]!.args).toMatchObject({
      p_channel: "whatsapp",
      p_provider_message_id: "wamid-1",
    });
  });

  it("guarda recusada (identidade de envio não resolvida / escopo mudou) ⇒ NADA é enviado; falha registrada", async () => {
    for (const code of ["sender_identity_preference_other_tenant", "scope_mismatch"]) {
      const sb = fakeSupabase({
        copilot_claim_send: claimOk({ surface: "airbnb" }),
        copilot_reconcile_send: { result: "reconciled_failed" },
      });
      const d = sendDeps({ guard: vi.fn(async () => ({ ok: false as const, code })) });
      const r = await sendCopilotSuggestionCore(sb.client, "u", { suggestionId: SID }, d);
      expect(r).toMatchObject({ status: "send_failed", code });
      expect(d.sendHuman).not.toHaveBeenCalled();
      expect(d.sendWhatsapp).not.toHaveBeenCalled();
      expect(sb.calls.at(-1)).toMatchObject({
        fn: "copilot_reconcile_send",
        args: { p_attempt_finished: true, p_error_code: code },
      });
    }
  });

  it("envio já em andamento (clique repetido, outra aba, nova tentativa) ⇒ nenhum envio", async () => {
    const sb = fakeSupabase({ copilot_claim_send: { result: "send_in_progress" } });
    const d = sendDeps();
    expect(await sendCopilotSuggestionCore(sb.client, "u", { suggestionId: SID }, d)).toEqual({
      status: "send_in_progress",
    });
    expect(d.sendHuman).not.toHaveBeenCalled();
    expect(d.guard).not.toHaveBeenCalled();
  });

  it("resultado ambíguo (envio sem desfecho > 2 min) ⇒ VERIFICA antes; nunca dispara segundo envio automático", async () => {
    for (const [rec, expected] of [
      ["reconciled_sent", "reconciled_sent"],
      ["reconciled_unknown", "unknown_result"],
      ["send_in_progress", "send_in_progress"],
    ] as const) {
      const sb = fakeSupabase({
        copilot_claim_send: { result: "send_unknown" },
        copilot_reconcile_send: { result: rec, sent_message_id: "m-x" },
      });
      const d = sendDeps();
      const r = await sendCopilotSuggestionCore(sb.client, "u", { suggestionId: SID }, d);
      expect(r.status).toBe(expected);
      expect(d.sendHuman).not.toHaveBeenCalled();
      expect(sb.calls.map((c) => c.fn)).toEqual(["copilot_claim_send", "copilot_reconcile_send"]);
    }
  });

  it("erro na rotina humana ⇒ reconciliação ANTES de marcar falha; se a mensagem foi gravada, conta como enviada", async () => {
    const boom = vi.fn(async () => {
      throw new Error("O Airbnb recusou a mensagem. A equipe foi avisada.");
    });
    const sb1 = fakeSupabase({
      copilot_claim_send: claimOk(),
      copilot_reconcile_send: { result: "reconciled_failed" },
    });
    const r1 = await sendCopilotSuggestionCore(
      sb1.client,
      "u",
      { suggestionId: SID },
      sendDeps({ sendHuman: boom }),
    );
    expect(r1).toMatchObject({
      status: "send_failed",
      code: "airbnb_rejected",
      message: "O Airbnb recusou a mensagem. A equipe foi avisada.",
    });
    expect(sb1.calls.at(-1)).toMatchObject({
      fn: "copilot_reconcile_send",
      args: { p_attempt_finished: true, p_error_code: "airbnb_rejected" },
    });
    // erro DEPOIS da gravação (ex.: na pausa da IA) ⇒ a reconciliação encontra a mensagem ⇒ enviada, sem reenvio
    const sb2 = fakeSupabase({
      copilot_claim_send: claimOk(),
      copilot_reconcile_send: { result: "reconciled_sent", sent_message_id: "msg-gravada" },
    });
    const late = vi.fn(async () => {
      throw new Error("falha ao pausar");
    });
    expect(
      await sendCopilotSuggestionCore(
        sb2.client,
        "u",
        { suggestionId: SID },
        sendDeps({ sendHuman: late }),
      ),
    ).toEqual({ status: "reconciled_sent", messageId: "msg-gravada" });
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("rotina enviou mas não devolveu o id ⇒ reconcilia pelo autor/instante; nunca reenvia", async () => {
    const sb = fakeSupabase({
      copilot_claim_send: claimOk(),
      copilot_reconcile_send: { result: "reconciled_sent", sent_message_id: "msg-r" },
    });
    const sendHuman = vi.fn(async () => ({
      ok: true as const,
      messageId: null,
      channel: "web" as const,
      externalId: null,
    }));
    expect(
      await sendCopilotSuggestionCore(
        sb.client,
        "u",
        { suggestionId: SID },
        sendDeps({ sendHuman }),
      ),
    ).toEqual({ status: "sent", messageId: "msg-r" });
    expect(sendHuman).toHaveBeenCalledTimes(1);
    expect(sb.calls.map((c) => c.fn)).not.toContain("copilot_finish_send");
  });

  it("estado inválido, não encontrada e reivindicação incompleta", async () => {
    const d = sendDeps();
    expect(
      await sendCopilotSuggestionCore(
        fakeSupabase({ copilot_claim_send: { result: "invalid_state", state: "sent" } }).client,
        "u",
        { suggestionId: SID },
        d,
      ),
    ).toEqual({ status: "invalid_state", state: "sent" });
    await expect(
      sendCopilotSuggestionCore(
        fakeSupabase({ copilot_claim_send: { result: "not_found" } }).client,
        "u",
        { suggestionId: SID },
        d,
      ),
    ).rejects.toThrow("Sugestão não encontrada.");
    const sb = fakeSupabase({
      copilot_claim_send: claimOk({ text: undefined }),
      copilot_reconcile_send: { result: "reconciled_failed" },
    });
    expect(await sendCopilotSuggestionCore(sb.client, "u", { suggestionId: SID }, d)).toMatchObject(
      { status: "send_failed", code: "claim_incomplete" },
    );
    expect(d.sendHuman).not.toHaveBeenCalled();
  });

  it("classificação fechada das falhas da rotina humana", () => {
    expect(
      classifySendError(
        new Error("Esta conversa está sendo atendida por outro membro. Solicite acesso"),
      ),
    ).toBe("assigned_to_other");
    expect(classifySendError(new Error("Sem permissão para esta ação."))).toBe("permission_denied");
    expect(
      classifySendError(new Error("Atendimento humano não está disponível no seu plano.")),
    ).toBe("permission_denied");
    expect(classifySendError(new Error("Este hóspede ainda não informou telefone"))).toBe(
      "guest_phone_missing",
    );
    expect(classifySendError(new Error("WhatsApp Business não está configurado nesta conta"))).toBe(
      "whatsapp_not_configured",
    );
    expect(classifySendError(new Error("Falha ao enviar WhatsApp: 500"))).toBe(
      "whatsapp_send_failed",
    );
    expect(
      classifySendError(
        new Error("A conta remetente configurada para este anúncio não pôde enviar."),
      ),
    ).toBe("preferred_sender_failed");
    expect(classifySendError("x")).toBe("send_failed");
  });

  it("autoria: nenhum schema de entrada aceita id de usuário; a autoria vem de context.userId/auth.uid()", () => {
    const fns = readFileSync(path.resolve(__dirname, "..", "copilot.functions.ts"), "utf8");
    const core = readFileSync(path.resolve(__dirname, "..", "copilot-send.server.ts"), "utf8");
    const schemas = [...fns.matchAll(/z\.object\(\{([^}]*)\}\)/g)].map((m) => m[1]!);
    expect(schemas.length).toBeGreaterThanOrEqual(5);
    for (const sc of schemas) expect(sc).not.toMatch(/user|actor|author|sender/i);
    expect(fns).toMatch(/sendCopilotSuggestionCore\(context\.supabase, context\.userId, data\)/);
    // nenhum envio direto a provedor: só as rotinas humanas existentes
    for (const src of [fns, core]) {
      expect(src).not.toMatch(
        /sinchSendText|deliverToAirbnbThread|sendChannexThreadMessage|property_chat_messages"\)\.insert/,
      );
    }
  });

  it("bundle: os núcleos de envio só entram por import dinâmico DENTRO dos handlers (nada de servidor no cliente)", () => {
    const read = (f: string) => readFileSync(path.resolve(__dirname, "..", f), "utf8");
    const pairs = [
      ["copilot.functions.ts", "copilot-send.server"],
      ["handoff.functions.ts", "handoff-send.server"],
      ["whatsapp.functions.ts", "whatsapp-send.server"],
    ] as const;
    for (const [file, mod] of pairs) {
      const src = read(file);
      const esc = mod.replace(".", "\\.");
      expect(src, file).not.toMatch(new RegExp(`^import[^;]*${esc}`, "m"));
      expect(src, file).toMatch(new RegExp(`await import\\("@/lib/${esc}"\\)`));
    }
    expect(read("handoff.functions.ts")).not.toMatch(
      /export async function sendHumanMessageToConversation/,
    );
    expect(read("whatsapp.functions.ts")).not.toMatch(
      /export async function sendWhatsappMessageToConversation/,
    );
  });
});

// ─────────────────────────── remetente estrito (Airbnb/Channex) ───────────────────────────

const direct = vi.hoisted(() => ({
  outcome: { outcome: "no_preference", threadChannelId: "chan-a" } as Record<string, unknown>,
  calls: [] as unknown[],
}));
vi.mock("@/lib/airbnb-direct-sender.server", () => ({
  sendAsPreferredSenderDetailed: async (...a: unknown[]) => {
    direct.calls.push(a);
    return direct.outcome;
  },
}));

describe("Copiloto · remetente estrito na entrega ao Airbnb (sem fallback silencioso)", () => {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ data: { id: "cx-1" } }), { status: 200 }),
  );
  beforeEach(() => {
    process.env.CHANNEX_API_KEY = "teste";
    fetchMock.mockClear();
    direct.calls.length = 0;
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("preferida falhou ⇒ estrito LANÇA e nada sai pela Channex; fluxo humano antigo continua caindo na Channex", async () => {
    const { sendChannexThreadMessage, StrictSenderError } =
      await import("@/lib/channex-messages.server");
    direct.outcome = { outcome: "failed", reason: "token_unavailable", channelId: "chan-pref" };
    await expect(
      sendChannexThreadMessage("th-1", "oi", { expectedChannelId: "chan-pref" }),
    ).rejects.toBeInstanceOf(StrictSenderError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await sendChannexThreadMessage("th-1", "oi")).toBe("cx-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a conta que enviaria (canal da thread) não é a esperada ⇒ LANÇA sem enviar; igual ⇒ envia pela Channex", async () => {
    const { sendChannexThreadMessage } = await import("@/lib/channex-messages.server");
    direct.outcome = { outcome: "no_preference", threadChannelId: "chan-outra" };
    await expect(
      sendChannexThreadMessage("th-1", "oi", { expectedChannelId: "chan-a" }),
    ).rejects.toMatchObject({ code: "sender_mismatch" });
    expect(fetchMock).not.toHaveBeenCalled();
    direct.outcome = { outcome: "preferred_is_mapped", channelId: "chan-a" };
    expect(await sendChannexThreadMessage("th-1", "oi", { expectedChannelId: "chan-a" })).toBe(
      "cx-1",
    );
    expect(direct.calls.at(-1)).toEqual(["th-1", "oi", "chan-a"]);
  });

  it("enviado pela preferida ⇒ id do Airbnb, sem passar pela Channex", async () => {
    const { sendChannexThreadMessage } = await import("@/lib/channex-messages.server");
    direct.outcome = { outcome: "sent", messageId: "air-9", channelId: "chan-a" };
    expect(await sendChannexThreadMessage("th-1", "oi", { expectedChannelId: "chan-a" })).toBe(
      "air-9",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deliverToAirbnbThread em modo estrito: falha do remetente vira `failure` fechado e é gravada como falha", async () => {
    const { deliverToAirbnbThread } = await import("@/lib/channex-messages.server");
    direct.outcome = { outcome: "failed", reason: "listing_mismatch", channelId: "chan-pref" };
    const inserts: unknown[] = [];
    const admin = {
      from: (t: string) => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Casa" } }) }) }),
        insert: (row: unknown) => {
          inserts.push({ t, row });
          return { select: () => ({ single: async () => ({ data: { id: "row-1" } }) }) };
        },
        update: () => ({ eq: async () => ({}) }),
      }),
    };
    vi.doMock("@/lib/delivery-failure.server", () => ({ reportDeliveryFailure: async () => {} }));
    const r = await deliverToAirbnbThread(admin, {
      conversationId: "c",
      threadId: "th",
      propertyId: "p",
      text: "Olá",
      senderType: "human",
      senderUserId: "u",
      strictSender: { expectedChannelId: "chan-pref" },
    });
    expect(r).toMatchObject({ ok: false, failure: "preferred_sender_failed", externalId: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(inserts).toEqual([
      expect.objectContaining({
        t: "property_chat_messages",
        row: expect.objectContaining({ delivery_status: "failed" }),
      }),
    ]);
  });
});

const prefs = vi.hoisted(() => ({ channel: "chan-pref" as string | null }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: async () => ({
            data: prefs.channel
              ? [{ channex_id: "L1", payload: { channel_id: prefs.channel } }]
              : [],
          }),
        }),
      }),
    }),
  },
}));

describe("Copiloto · envio direto pela conta preferida (módulo real, rede falsa)", () => {
  const urls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    urls.push(url);
    if (url.includes("/message_threads/"))
      return new Response(
        JSON.stringify({
          data: {
            attributes: { ota_message_thread_id: "999", meta: { listing_id: "L1" } },
            relationships: { channel: { data: { id: "chan-thread" } } },
          },
        }),
        { status: 200 },
      );
    return new Response("{}", { status: 500 });
  });
  beforeEach(() => {
    process.env.CHANNEX_API_KEY = "teste";
    urls.length = 0;
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("preferência gravada ≠ conta resolvida ⇒ `preference_mismatch` ANTES de qualquer chamada ao Airbnb", async () => {
    const real = await vi.importActual<typeof import("@/lib/airbnb-direct-sender.server")>(
      "@/lib/airbnb-direct-sender.server",
    );
    prefs.channel = "chan-pref";
    expect(await real.sendAsPreferredSenderDetailed("th-1", "oi", "chan-resolvida")).toEqual({
      outcome: "failed",
      reason: "preference_mismatch",
      channelId: "chan-pref",
    });
    expect(urls.some((u) => u.includes("airbnb.com"))).toBe(false);
    expect(urls.some((u) => u.includes("/channels/"))).toBe(false);
  });

  it("sem preferência ⇒ `no_preference` com o canal da thread; preferida = canal da thread ⇒ `preferred_is_mapped`", async () => {
    const real = await vi.importActual<typeof import("@/lib/airbnb-direct-sender.server")>(
      "@/lib/airbnb-direct-sender.server",
    );
    prefs.channel = null;
    expect(await real.sendAsPreferredSenderDetailed("th-1", "oi")).toEqual({
      outcome: "no_preference",
      threadChannelId: "chan-thread",
    });
    prefs.channel = "chan-thread";
    expect(await real.sendAsPreferredSenderDetailed("th-1", "oi", "chan-thread")).toEqual({
      outcome: "preferred_is_mapped",
      channelId: "chan-thread",
    });
  });

  it("token da preferida indisponível ⇒ `failed` (o legado `trySendAsPreferredSender` segue devolvendo null)", async () => {
    const real = await vi.importActual<typeof import("@/lib/airbnb-direct-sender.server")>(
      "@/lib/airbnb-direct-sender.server",
    );
    prefs.channel = "chan-pref";
    expect(await real.sendAsPreferredSenderDetailed("th-1", "oi", "chan-pref")).toMatchObject({
      outcome: "failed",
      channelId: "chan-pref",
    });
    expect(await real.trySendAsPreferredSender("th-1", "oi")).toBeNull();
    expect(urls.some((u) => u.includes("api.airbnb.com"))).toBe(false);
  });
});
