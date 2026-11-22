import { describe, expect, it } from "vitest";
import { normalizeHistory } from "@/lib/guest-ai/history";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";
import { CONV, MSG, row } from "./helpers/b21-fixtures";

const at = (s: string) => `2026-11-22T22:31:${s}+00:00`;

describe("mensagens da conta enviadas depois da atual (22/11/2026, caso Juliano/Charmosa)", () => {
  const rows = [
    row({ id: MSG, role: "user", sender_type: "guest", created_at: at("21.0"), content: "Tranquilo para fazermos checkin agora?" }),
    row({ role: "assistant", sender_type: "system", created_at: at("47.0"), content: "Reserva confirmada! Guia: https://conciergeia.app/g/charmosa/" }),
    row({ role: "user", sender_type: "guest", created_at: at("50.0"), content: "outra" }),
    row({ role: "assistant", sender_type: "human", created_at: at("55.0"), content: "falha", delivery_status: "failed" }),
  ];
  const r = normalizeHistory(rows, { conversationId: CONV, currentMessageId: MSG });
  it("a atual continua sendo a última do histórico; a confirmação automática vem em sentAfter", () => {
    if (r.status !== "available") throw new Error(r.reason);
    expect(r.entries.at(-1)!.current).toBe(true);
    expect(r.sentAfter?.map((e) => e.speaker)).toEqual(["system"]);
    expect(r.sentAfter?.[0]!.ref).toBe("hist:system:d1");
    expect(r.sentAfter?.[0]!.text).toContain("Guia");
  });
  it("mensagem do hóspede posterior e envio que falhou não entram", () => {
    if (r.status !== "available") throw new Error(r.reason);
    expect(r.sentAfter).toHaveLength(1);
  });
  it("prompt explica o bloco e a resposta curta de check-in conforme o procedimento do imóvel", () => {
    const sys = buildSystemPrompt("airbnb");
    expect(sys).toMatch(/ja_enviadas_apos_a_atual/);
    expect(sys).toMatch(/não repita o que elas já dizem/);
    expect(sys).toMatch(/cada anfitrião trabalha de um jeito/);
    expect(sys).toMatch(/Nunca descreva um procedimento que não seja o do dossiê daquele imóvel/);
  });
});
