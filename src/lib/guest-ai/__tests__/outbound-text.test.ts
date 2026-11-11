/**
 * SAÍDA DA IA · resolução e blindagem universal de tags (caso Renan, 10/11/2026: "[[CREDENCIAIS]]" chegou cru ao
 * hóspede no Airbnb). Puro e pelo slot autônomo, sem rede nem banco.
 */
import { describe, expect, it, vi } from "vitest";
import {
  CREDENTIAL_FALLBACK_SENTENCE,
  applyCredentials,
  stripCredentialMarker,
} from "@/lib/guest-ai/credential-delivery";
import {
  CREDENTIAL_UNAVAILABLE_REASON,
  expandGuideTags,
  hasAnyTag,
  needsCredentialLookup,
  resolveOutboundText,
  sanitizeResidualTags,
  type OutboundContext,
} from "@/lib/guest-ai/outbound-text";
import { requestGuestAiReply } from "@/lib/guest-ai/slot.server";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";

const CREDS = { lockCode: "2610", gateCode: "4455", pinCode: null, wifiPassword: "praia2026", accessInstructions: "O cofre fica à direita da porta." };
const PROP = { checkin_time: "15:00", checkout_time: "11:00", host_name: "Arthur", wifi_ssid: "Casa_Praia", marketplace_links: [{ label: "Mercado", url: "https://loja.exemplo/m" }] };
const ctx = (over: Partial<OutboundContext> = {}): OutboundContext => ({
  surface: "airbnb",
  credentials: CREDS,
  property: PROP,
  guideSlug: "studio-103",
  ...over,
});
const RAW = /\[\[|\]\]|\{\{|\}\}/;

describe("[[CREDENCIAIS]] · troca pela credencial real autorizada", () => {
  it("CASO RENAN: o marcador vira o código real do cofre (Airbnb: texto limpo) e nunca aparece cru", () => {
    const r = resolveOutboundText("Seguem os dados de acesso: [[CREDENCIAIS]] Qualquer coisa, me chama aqui!", ctx());
    expect(r.text).toContain("Código da fechadura/cofre: 2610");
    expect(r.text).toContain("Código do portão: 4455");
    expect(r.text).toContain("O cofre fica à direita da porta.");
    expect(r.text).not.toContain("**");
    expect(r.text).not.toMatch(RAW);
    expect(r.credentialsDelivered).toBe(true);
    expect(r.needsHandoff).toBe(false);
    expect(r.text.indexOf("Seguem")).toBe(0);
    expect(r.text.trim().endsWith("me chama aqui!")).toBe(true);
  });
  it("negrito no WhatsApp (*x*) e no guia (**x**)", () => {
    expect(resolveOutboundText("Acesso: [[CREDENCIAIS]]", ctx({ surface: "whatsapp" })).text).toContain("*2610*");
    expect(resolveOutboundText("Acesso: [[CREDENCIAIS]]", ctx({ surface: "guide_chat" })).text).toContain("**2610**");
  });
  it("Wi-Fi só quando o assunto é Wi-Fi; códigos de porta não vazam numa resposta sobre Wi-Fi", () => {
    const r = applyCredentials("A senha do Wi-Fi é [[CREDENCIAIS]]", CREDS);
    expect(r.text).toContain("praia2026");
    expect(r.text).not.toContain("2610");
    expect(applyCredentials("Para entrar: [[CREDENCIAIS]]", CREDS).text).not.toContain("praia2026");
  });
  it("D9 negou ou credencial falhou ⇒ frase do marcador vira aviso seguro e a conversa vai para a equipe", () => {
    const r = resolveOutboundText("Tudo certo! O código do cofre é [[CREDENCIAIS]]. Boa estadia!", ctx({ credentials: null }));
    expect(r.text).not.toMatch(RAW);
    expect(r.text).not.toMatch(/2610|código do cofre é/i);
    expect(r.text).toContain(CREDENTIAL_FALLBACK_SENTENCE);
    expect(r.text).toContain("Boa estadia!");
    expect(r.needsHandoff).toBe(true);
  });
  it("credencial existe mas está vazia (imóvel sem código cadastrado) ⇒ mesmo aviso seguro", () => {
    const r = applyCredentials("Acesso: [[CREDENCIAIS]]", { lockCode: null, gateCode: null, pinCode: null, wifiPassword: null, accessInstructions: null });
    expect(r.fallback).toBe(true);
    expect(r.text).not.toContain("[[");
  });
  it("variações do marcador (caixa, espaços, colchete simples) também são resolvidas ou removidas", () => {
    expect(resolveOutboundText("Acesso: [[ credenciais ]]", ctx()).text).toContain("2610");
    expect(stripCredentialMarker("Acesso: [CREDENCIAIS] ok")).not.toMatch(/credenciais/i);
  });
  it("marcador repetido: só o primeiro vira credencial, o resto some", () => {
    const r = resolveOutboundText("A: [[CREDENCIAIS]] B: [[CREDENCIAIS]]", ctx());
    expect(r.text.match(/2610/g)).toHaveLength(1);
    expect(r.text).not.toMatch(RAW);
  });
});

describe("[[info:...]] e [[tag:...]] · expansão pelo canal", () => {
  it("info pública: horários e anfitrião expandem em qualquer canal", () => {
    const r = resolveOutboundText("Check-in a partir de [[info:checkin-time]] e saída até [[info:checkout-time]]. Abraço, [[info:host-name]].", ctx({ credentials: null }));
    expect(r.text).toBe("Check-in a partir de 15:00 e saída até 11:00. Abraço, Arthur.");
    expect(r.needsHandoff).toBe(false);
  });
  it("info SENSÍVEL só sai com a D9: com credencial expande; sem ela vira aviso seguro + equipe", () => {
    expect(resolveOutboundText("Código: [[info:lock-code]]", ctx()).text).toBe("Código: 2610");
    const denied = resolveOutboundText("O código da fechadura é [[info:lock-code]].", ctx({ credentials: null }));
    expect(denied.text).not.toMatch(/2610|\[\[/);
    expect(denied.needsHandoff).toBe(true);
    expect(needsCredentialLookup("x [[info:wifi-password]]")).toBe(true);
    expect(needsCredentialLookup("x [[info:checkin-time]]")).toBe(false);
  });
  it("marketplace: link no guia (Markdown) e no WhatsApp; no Airbnb só o rótulo, sem URL", () => {
    expect(resolveOutboundText("Veja o [[info:marketplace:mercado|Mercado]]", ctx({ surface: "guide_chat" })).text).toContain("[Mercado](https://loja.exemplo/m)");
    const air = resolveOutboundText("Veja o [[info:marketplace:mercado|Mercado]]", ctx()).text;
    expect(air).toBe("Veja o Mercado");
  });
  it("tag do guia: Airbnb só o nome legível; guia em Markdown; WhatsApp com URL pública", () => {
    expect(expandGuideTags("Veja [[tag:manual-casa]].", { surface: "airbnb", guideSlug: "studio-103" })).toBe("Veja Manual da casa.");
    expect(expandGuideTags("Veja [[tag:faq:piscina|a FAQ]].", { surface: "airbnb", guideSlug: "studio-103" })).toBe("Veja a FAQ.");
    expect(expandGuideTags("Veja [[tag:manual-casa]].", { surface: "guide_chat", guideSlug: "studio-103" })).toBe("Veja [Manual da casa](/g/studio-103#residencia).");
    expect(expandGuideTags("Veja [[tag:manual-casa]].", { surface: "whatsapp", guideSlug: "studio-103", origin: "https://x.app" })).toBe("Veja Manual da casa (https://x.app/g/studio-103#residencia).");
    expect(expandGuideTags("Veja [[tag:manual-casa]].", { surface: "whatsapp", guideSlug: null })).toBe("Veja Manual da casa.");
    expect(resolveOutboundText("Tudo no [[tag:regras-casa]]", ctx()).text).not.toMatch(/https?:|\/g\//);
  });
});

describe("trava final · nenhuma tag crua sai para o canal", () => {
  it("tags desconhecidas ([[...]] e {{...}}) somem sem quebrar a frase", () => {
    expect(sanitizeResidualTags("Olá {{guest_name}}, tudo certo [[xyz:abc]] por aí?")).toBe("Olá, tudo certo por aí?");
    expect(resolveOutboundText("Combinado [[info:nao-existe]]! Até já.", ctx()).text).toBe("Combinado! Até já.");
    expect(resolveOutboundText("Veja [[tag:secao-inventada]].", ctx({ surface: "guide_chat" })).text).toBe("Veja.");
    expect(hasAnyTag("sem tag")).toBe(false);
    expect(hasAnyTag("{{x}}")).toBe(true);
  });
});

describe("slot autônomo · nenhuma tag crua e credencial real antes do envio", () => {
  const ON = { GUEST_AI_AUTONOMOUS: "on" };
  const REQ = { surface: "airbnb" as const, conversationId: "c1", messageId: "m1", expectedOwnerId: "o1" };
  const stored = (text: string, extra: Record<string, unknown> = {}) => ({
    status: "stored", suggestionId: "s1", state: "available", code: null,
    result: { text, handoffNeeded: false, handoffUrgency: null, internalQuestion: null, outcomeKind: "reply", ...extra },
  });
  const deps = (text: string, outboundContext: unknown, extra: Record<string, unknown> = {}) => ({
    env: ON,
    validate: vi.fn(async () => ({ propertyId: "p1" })),
    humanActive: vi.fn(async () => false),
    pendingDecision: vi.fn(async () => false),
    generate: vi.fn(async () => stored(text, extra)),
    outboundContext: outboundContext as never,
  });

  it("CASO RENAN: a resposta autônoma sai com o código real no lugar de [[CREDENCIAIS]]", async () => {
    const oc = vi.fn(async () => ctx());
    const r = await requestGuestAiReply(REQ, deps("Seguem os dados de acesso: [[CREDENCIAIS]] Qualquer coisa, me chama!", oc));
    expect(r?.reply).toContain("2610");
    expect(r?.reply).not.toMatch(RAW);
    expect(r?.handoff).toBe(false);
    expect(oc).toHaveBeenCalledWith(REQ, true);
  });
  it("sem credencial autorizada: aviso seguro e encaminhamento com urgência alta; marcador nunca sai", async () => {
    const r = await requestGuestAiReply(REQ, deps("O código é [[CREDENCIAIS]].", async () => ctx({ credentials: null })));
    expect(r?.reply).not.toMatch(RAW);
    expect(r).toMatchObject({ handoff: true, handoffReason: CREDENTIAL_UNAVAILABLE_REASON, handoffUrgency: "high" });
  });
  it("leitura do contexto falhou: mesmo assim nada cru sai (aviso seguro + equipe)", async () => {
    const r = await requestGuestAiReply(REQ, deps("Acesso: [[CREDENCIAIS]] {{x}}", async () => { throw new Error("db"); }));
    expect(r?.reply).not.toMatch(RAW);
    expect(r?.handoff).toBe(true);
  });
  it("texto sem tag não consulta nada; com só tag pública não pede credenciais", async () => {
    const oc = vi.fn(async () => ctx());
    expect((await requestGuestAiReply(REQ, deps("O check-in é às 15h.", oc)))?.reply).toBe("O check-in é às 15h.");
    expect(oc).not.toHaveBeenCalled();
    await requestGuestAiReply(REQ, deps("Check-in às [[info:checkin-time]].", oc));
    expect(oc).toHaveBeenCalledWith(REQ, false);
  });
  it("encaminhamento pedido pela decisão também sai sem tag crua", async () => {
    const r = await requestGuestAiReply(REQ, deps("Já avisei a equipe {{handoff}}.", async () => ctx(), { handoffNeeded: true, internalQuestion: "Verificar cofre" }));
    expect(r).toMatchObject({ handoff: true, reply: "Já avisei a equipe." });
  });
});

describe("roteiro · sem jargão de SAC e com exemplos de ouro", () => {
  const p = buildSystemPrompt("airbnb");
  it("a frase de exemplo copiada pelo modelo saiu do prompt e as frases passivas estão proibidas", () => {
    expect(p).not.toContain("o problema vai ser verificado o quanto antes");
    expect(p).toMatch(/Nada de voz passiva/);
    for (const f of ["essa situação será verificada", "seu relato foi registrado", "estamos à disposição para maiores esclarecimentos"]) expect(p).toContain(f);
    expect(p).toMatch(/nossa equipe já foi avisada aqui e vai te dar suporte de imediato/);
  });
  it("quatro exemplos de tom: acesso, consulta, aparelho e indicação local, avisando para não copiar fatos", () => {
    for (const t of ["Exemplo 1 (acesso e fechadura", "Exemplo 2 (consulta antes de reservar", "Exemplo 3 (aparelho durante a estadia", "Exemplo 4 (indicação local"]) expect(p).toContain(t);
    expect(p).toMatch(/nunca copie as frases nem reaproveite nomes, números, distâncias ou fatos/);
  });
});
