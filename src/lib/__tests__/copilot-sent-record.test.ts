import { describe, expect, it } from "vitest";
import { recordCopilotSuggestionSent, textSimilarity, type SentRecordDeps } from "../copilot-sent-record.server";

const mk = (live: Array<{ id: string; suggested_text: string | null; edited_text: string | null }>, finish = "finished") => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const deps: SentRecordDeps = {
    listLive: async () => live,
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return fn === "copilot_actor_claim_send"
        ? { data: { result: "claimed", send_token: "tok" }, error: null }
        : { data: { result: finish }, error: null };
    },
  };
  return { deps, calls };
};
const base = { userId: "u1", conversationId: "c1", messageId: "m1", channel: "airbnb" };

describe("registro de envio da sugestão do Copiloto", () => {
  it("texto igual ou quase igual grava claim + finish com mensagem, canal e ator", async () => {
    const { deps, calls } = mk([{ id: "s1", suggested_text: "Oi Ana! O check-in é a partir das 15h, combinado?", edited_text: null }]);
    const r = await recordCopilotSuggestionSent(deps, { ...base, content: "Oi Ana! O check-in é a partir das 15h, tudo bem?" });
    expect(r).toEqual({ recorded: true, suggestionId: "s1" });
    expect(calls.map((c) => c.fn)).toEqual(["copilot_actor_claim_send", "copilot_actor_finish_send"]);
    expect(calls[1]!.args).toMatchObject({ p_actor: "u1", p_message_id: "m1", p_channel: "airbnb", p_outcome: "sent", p_send_token: "tok" });
  });
  it("mensagem sem relação com a sugestão não grava nada", async () => {
    const { deps, calls } = mk([{ id: "s1", suggested_text: "O check-in é a partir das 15h.", edited_text: null }]);
    expect(await recordCopilotSuggestionSent(deps, { ...base, content: "Pode deixar a bagagem na portaria." })).toEqual({ recorded: false });
    expect(calls).toHaveLength(0);
  });
  it("escolhe a sugestão mais parecida e usa o texto editado quando existe", async () => {
    const { deps, calls } = mk([
      { id: "a", suggested_text: "Bom dia, tudo certo por aí?", edited_text: null },
      { id: "b", suggested_text: "x", edited_text: "A senha do wifi está no guia e a rede é Casa5." },
    ]);
    const r = await recordCopilotSuggestionSent(deps, { ...base, content: "A senha do wifi está no guia e a rede é Casa5." });
    expect(r.suggestionId).toBe("b");
    expect(calls[0]!.args["p_suggestion_id"]).toBe("b");
  });
  it("falha de RPC, canal inválido ou erro inesperado nunca propaga", async () => {
    const { deps } = mk([{ id: "s1", suggested_text: "olá tudo bem", edited_text: null }], "invalid");
    expect(await recordCopilotSuggestionSent(deps, { ...base, content: "olá tudo bem" })).toEqual({ recorded: false });
    expect(await recordCopilotSuggestionSent(deps, { ...base, channel: "sms", content: "olá tudo bem" })).toEqual({ recorded: false });
    const boom: SentRecordDeps = { listLive: async () => { throw new Error("x"); }, rpc: async () => ({ data: null, error: null }) };
    expect(await recordCopilotSuggestionSent(boom, { ...base, content: "olá" })).toEqual({ recorded: false });
  });
  it("similaridade ignora acento, caixa e pontuação", () => {
    expect(textSimilarity("Olá, Ação!", "ola acao")).toBe(1);
    expect(textSimilarity("", "a")).toBe(0);
  });
});
