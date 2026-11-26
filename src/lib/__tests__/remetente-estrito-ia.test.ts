/**
 * Caso Carlos (26/11/2026, "Casa Completa Próx. a Avenida Turística"): a IA saiu assinada como "Regina ·
 * Coanfitrião" com o seletor em "Anfitrião Sigma". Causas: entrega autônoma sem remetente estrito (falha do envio
 * direto caía na Channex) e token mascarado ("***") da Channex usado como Bearer. Mais o "Obrigado pelo aviso" a um
 * horário de saída que só confirmava o padrão.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const direct = vi.fn();
const report = vi.fn(async () => {});
vi.mock("@/lib/airbnb-direct-sender.server", () => ({ sendAsPreferredSenderDetailed: (...a: unknown[]) => direct(...a) }));
vi.mock("@/lib/delivery-failure.server", () => ({ reportDeliveryFailure: (...a: unknown[]) => report(...(a as [])) }));

import { deliverToAirbnbThread } from "@/lib/channex-messages.server";
import { isMaskedOrUnusableToken, usableAirbnbToken } from "@/lib/airbnb-token";
import { shouldSilenceBareAck, isCheckoutTimeReply } from "@/lib/guest-ai/ack-silence";
import type { HistoryEntry } from "@/lib/guest-ai/history";

/** Admin falso: registra inserções; leituras devolvem vazio. */
function fakeAdmin() {
  const inserts: Array<Record<string, unknown>> = [];
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    order: () => chain,
    limit: () => chain,
    update: () => chain,
    maybeSingle: async () => ({ data: { name: "Casa Completa Próx. a Avenida Turística", owner_id: "tenant-1" } }),
    single: async () => ({ data: { id: "msg-1" } }),
    then: (r: (v: unknown) => unknown) => r({ data: null }),
  };
  return {
    inserts,
    from: () => ({
      ...chain,
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return chain;
      },
    }),
  };
}

const base = { conversationId: "c1", threadId: "t1", propertyId: "p1", text: "Até amanhã!", senderType: "ai" as const };

describe("Entrega no Airbnb: remetente estrito (quando pedido) e resposta garantida (IA)", () => {
  beforeEach(() => {
    direct.mockReset();
    report.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("a Channex não pode ser chamada quando o remetente estrito falha");
    }));
  });

  it("conta preferida falhou (token mascarado) ⇒ nada sai pela Channex, mensagem com falha e equipe avisada", async () => {
    direct.mockResolvedValue({ outcome: "failed", reason: "token_unavailable", channelId: "sigma" });
    const admin = fakeAdmin();
    const r = await deliverToAirbnbThread(admin, { ...base, strictSender: { expectedChannelId: "sigma" } });
    expect(r.ok).toBe(false);
    expect(r.failure).toBe("preferred_sender_failed");
    expect(fetch).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
    expect(admin.inserts[0]).toMatchObject({ delivery_status: "failed", sender_type: "ai" });
  });

  it("thread mapeada em OUTRA conta (Regina) e sem envio direto ⇒ sender_mismatch, nada enviado", async () => {
    direct.mockResolvedValue({ outcome: "no_preference", threadChannelId: "regina" });
    const admin = fakeAdmin();
    const r = await deliverToAirbnbThread(admin, { ...base, strictSender: { expectedChannelId: "sigma" } });
    expect(r.failure).toBe("sender_mismatch");
    expect(fetch).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("conta não resolvida pela política ⇒ nem tenta enviar, falha registrada e equipe avisada", async () => {
    const admin = fakeAdmin();
    const r = await deliverToAirbnbThread(admin, { ...base, strictSender: { unresolved: "preference_conflict" } });
    expect(r.failure).toBe("sender_unresolved");
    expect(direct).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("envio direto pela conta preferida deu certo ⇒ entregue, sem Channex", async () => {
    direct.mockResolvedValue({ outcome: "sent", messageId: "airbnb-9", channelId: "sigma" });
    const admin = fakeAdmin();
    const r = await deliverToAirbnbThread(admin, { ...base, strictSender: { expectedChannelId: "sigma" } });
    expect(r).toMatchObject({ ok: true, externalId: "airbnb-9" });
    expect(fetch).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("sem modo estrito (IA e equipe): conta selecionada falhou ⇒ responde pela conta do anúncio", async () => {
    direct.mockResolvedValue({ outcome: "failed", reason: "token_unavailable", channelId: "sigma" });
    vi.stubEnv("CHANNEX_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { id: "cx-1" } }), { status: 200 })));
    const admin = fakeAdmin();
    const r = await deliverToAirbnbThread(admin, base);
    vi.unstubAllEnvs();
    expect(r).toMatchObject({ ok: true, externalId: "cx-1" });
    expect(report).not.toHaveBeenCalled();
  });
});

describe("Token mascarado da Channex", () => {
  const attrs = (t: unknown) => ({ channel: "AirBNB", settings: { tokens: { access_token: t, expires_at: 0 } } });
  it("\"***\", vazio, nulo ou curto ⇒ indisponível, sem chamada ao Airbnb", () => {
    for (const t of ["***", "", null, undefined, "abc", "  ***  ", "****"]) {
      expect(isMaskedOrUnusableToken(t), String(t)).toBe(true);
      expect(usableAirbnbToken(attrs(t))).toBeNull();
    }
  });
  it("token real passa", () => {
    expect(usableAirbnbToken(attrs("a1b2c3d4e5f6g7h8"))).toBe("a1b2c3d4e5f6g7h8");
  });
});

describe("Silêncio na confirmação do horário de saída", () => {
  const e = (speaker: string, text: string): HistoryEntry =>
    ({ ref: "r", messageId: "m", speaker, channel: "airbnb", at: "", text, media: null, delivery: "recorded", current: false }) as unknown as HistoryEntry;
  const ask =
    "Olá, Carlos.\nSua estadia está chegando ao fim! ☀️\n\nSegue abaixo instruções de Checkout, que deve acontecer até 11:00 horas.\n\nCom base nisso, por favor, qual é o seu horário estimado de saída?";

  it("\"Vamos sair às 11h mesmo\" (caso Carlos) e variações ⇒ silêncio", () => {
    for (const t of ["Olá! Vamos sair às 11h mesmo. \nAbraços!", "Saio às 10h", "Às 11h", "10:30", "Vamos sair umas 9h, obrigado!"])
      expect(shouldSilenceBareAck([e("system", ask), e("guest", t)]), t).toBe(true);
  });

  it("horário depois do limite, pergunta, pedido ou problema ⇒ a IA responde", () => {
    for (const t of ["Vamos sair às 13h", "Gostaria de sair às 11h", "Vamos sair às 11h, podemos deixar as malas?", "Saímos às 10h, mas o chuveiro está quebrado"])
      expect(shouldSilenceBareAck([e("system", ask), e("guest", t)]), t).toBe(false);
  });

  it("sem limite conhecido não presume", () => {
    expect(isCheckoutTimeReply("Vamos sair às 11h", null)).toBe(false);
  });
});
