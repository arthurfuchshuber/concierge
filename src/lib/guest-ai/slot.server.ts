/**
 * PONTO DE EXTENSÃO DA IA DE ATENDIMENTO AO HÓSPEDE.
 *
 * Os canais de entrada (chat do guia, WhatsApp (em standby desde 10/11/2026), Airbnb/Channex) chamam este
 * ponto único quando a IA está LIGADA para a conversa (chave do anúncio, pausa
 * humana expirada etc.).
 *
 * F0 (fronteira de dados): o slot NÃO recebe mais nenhum cliente de banco. Ele
 * recebe só identificadores — superfície, conversa e mensagem (+ o dono esperado,
 * quando o canal já o provou) — e tudo o mais (imóvel, conta, reserva, hóspede) é
 * RE-DERIVADO e validado no backend por `guest-ai/data/scope.server.ts`. Nenhum
 * identificador vindo do cliente é aceito sem essa validação.
 *
 * 10/11/2026: o titular ligou a CONDUÇÃO AUTÔNOMA (ver `requestGuestAiReply` abaixo), atrás da chave
 * `GUEST_AI_AUTONOMOUS=on`. Desligada, devolve `null` e cada canal segue o FALLBACK de sempre (conversa vai
 * para `needs_human` + push à equipe).
 */
import {
  CREDENTIAL_UNAVAILABLE_REASON,
  hasAnyTag,
  needsCredentialLookup,
  resolveOutboundText,
  sanitizeResidualTags,
  type OutboundContext,
} from "@/lib/guest-ai/outbound-text";
import type { GuestSurface } from "@/lib/guest-ai/types";

export type GuestAiSurface = GuestSurface;

export type GuestAiRequest = {
  surface: GuestAiSurface;
  conversationId: string;
  /** Mensagem do HÓSPEDE que disparou o turno (já gravada pelo canal). */
  messageId: string;
  /** Dono (conta) que o canal já provou; se vier, o backend confere com o dono real do imóvel. */
  expectedOwnerId?: string | null;
};

export type GuestAiReply = {
  /** Texto a enviar ao hóspede (vazio = nada a dizer). */
  reply: string;
  /** Pedir que a equipe assuma a conversa. */
  handoff: boolean;
  handoffReason?: string | null;
  handoffUrgency?: string | null;
};

/** Motivo padrão registrado na conversa quando não há IA instalada. */
export const NO_AI_HANDOFF_REASON = "Atendimento automático indisponível — responder ao hóspede.";

/**
 * CONDUÇÃO AUTÔNOMA EM TEMPO REAL (10/11/2026, diretriz do titular).
 *
 * FAIL-CLOSED: só responde com `GUEST_AI_AUTONOMOUS=on` (exatamente). Desligado (ou imóvel fora de
 * `GUEST_AI_AUTONOMOUS_PROPERTIES`, quando a lista existir) ⇒ `null`, e cada canal segue o fallback de sempre
 * (fila humana + push). Ligado:
 *  1. valida o turno no backend (`validateTurnScope`); escopo recusado ⇒ encaminha à equipe;
 *  2. equipe atendendo a conversa (posse/pausa humana) ⇒ `{ reply: "", handoff: false }` — a IA não fala por
 *     cima do atendente;
 *  3. roda a MESMA cadeia do Copiloto (`generateCopilotSuggestion` em modo autônomo): Gemini Flash, Dossiê,
 *     Documento Vivo, ferramentas (Maps, clima, voos), validadores e D9 — uma resposta por mensagem, teto diário
 *     de custo e telemetria em /admin/ia;
 *  4. resposta aprovada ⇒ texto + encaminhamento pedido pela decisão; silêncio legítimo ⇒ nada; falha, recusa
 *     ou teto ⇒ encaminha à equipe. Nunca lança.
 */
export function autonomousEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env["GUEST_AI_AUTONOMOUS"] === "on";
}

/** Lista opcional de imóveis (UUIDs separados por vírgula). Sem lista ⇒ todos; lista inválida ⇒ nenhum. */
export function autonomousPropertyAllowed(propertyId: string, env: Record<string, string | undefined> = process.env): boolean {
  const raw = env["GUEST_AI_AUTONOMOUS_PROPERTIES"];
  if (raw === undefined || raw.trim() === "") return true;
  const ids = raw.split(",").map((x) => x.trim()).filter(Boolean);
  return ids.includes(propertyId);
}

export const AUTONOMOUS_HANDOFF_REASON = "Encaminhado para atendimento humano.";

const SILENT: GuestAiReply = Object.freeze({ reply: "", handoff: false });

const FORMAL_CHANGE_LABEL: Record<string, string> = {
  dates: "datas",
  guest_count: "número de hóspedes",
  price: "valor",
  cancellation: "cancelamento",
  early_checkin: "entrada antecipada",
  late_checkout: "late check-out",
  other_conditions: "condições da reserva",
};
/** Motivo do chamado para pedidos de alteração formal ("Pedido de alteração formal: cancelamento"). */
export function formalChangeReason(kinds: readonly string[]): string {
  const labels = [...new Set(kinds.map((k) => FORMAL_CHANGE_LABEL[k] ?? "condições da reserva"))];
  return `Pedido de alteração formal: ${labels.join(", ")}`;
}

function toHandoff(text: string | null | undefined, reason?: string | null, urgency?: string | null): GuestAiReply {
  return {
    // trava final: nenhuma tag crua ([[...]] / {{...}}) sai para o canal, em nenhum caminho
    reply: sanitizeResidualTags((text ?? "").trim()),
    handoff: true,
    handoffReason: reason?.trim() || AUTONOMOUS_HANDOFF_REASON,
    handoffUrgency: urgency || "normal",
  };
}

export interface SlotDeps {
  env?: Record<string, string | undefined>;
  now?: () => number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validate?: (req: GuestAiRequest) => Promise<any>;
  /** `true` = equipe atendendo agora (a IA se cala); `null` = leitura incerta. */
  humanActive?: (turn: unknown, nowIso: string) => Promise<boolean | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generate?: (req: GuestAiRequest) => Promise<any>;
  /**
   * Contexto para resolver as tags da resposta (14/11/2026): credenciais (só com a D9 autorizando agora, por
   * `CredentialGrant`), campos públicos do imóvel e slug do guia. `needsCredentials` = o texto pede algo sensível.
   */
  outboundContext?: (req: GuestAiRequest, needsCredentials: boolean) => Promise<OutboundContext | null>;
  /** Decisão humana pendente na conversa ⇒ silêncio absoluto (10/11/2026). */
  pendingDecision?: (conversationId: string) => Promise<boolean>;
  /** Abre a decisão humana para um pedido de exceção (late check-out, entrada antecipada, concessão). */
  openDecision?: (p: {
    conversationId: string;
    triggerMessageId: string;
    formalChangeRequests: readonly string[];
    internalQuestion: string | null;
  }) => Promise<{ opened: boolean; code?: string; reason?: string }>;
}

/** Urgência do chamado de decisão (push prioritário). */
export const DECISION_HANDOFF_URGENCY = "high";

export async function requestGuestAiReply(req: GuestAiRequest, deps: SlotDeps = {}): Promise<GuestAiReply | null> {
  const env = deps.env ?? process.env;
  if (!autonomousEnabled(env)) return null;
  try {
    // 1) escopo validado no backend (fail-closed)
    let turn: { propertyId: string };
    try {
      turn = deps.validate
        ? await deps.validate(req)
        : await (async () => {
            const { validateTurnScope } = await import("@/lib/guest-ai/data/scope.server");
            const { getGuestAiDb } = await import("@/lib/guest-ai/data/client.server");
            return validateTurnScope(
              {
                surface: req.surface,
                conversationId: req.conversationId,
                messageId: req.messageId,
                expectedOwnerId: req.expectedOwnerId ?? null,
              },
              { db: await getGuestAiDb() },
            );
          })();
    } catch {
      return toHandoff("", "Não foi possível validar a conversa — responder ao hóspede.", "normal");
    }
    if (!autonomousPropertyAllowed(turn.propertyId, env)) return null;

    // 1b) DECISÃO HUMANA PENDENTE (10/11/2026): enquanto a equipe não decide, a IA não fala nada ao hóspede
    const pending = deps.pendingDecision
      ? await deps.pendingDecision(req.conversationId)
      : await (await import("@/lib/guest-ai-decision.server")).hasPendingDecision(req.conversationId);
    if (pending) return SILENT;

    // 2) equipe atendendo ⇒ a IA não fala por cima do atendente
    const nowIso = new Date((deps.now ?? Date.now)()).toISOString();
    const human = deps.humanActive
      ? await deps.humanActive(turn, nowIso)
      : await (async () => {
          const { loadConversationOwnership } = await import("@/lib/guest-ai/data/conversation-ownership.server");
          const { deriveHumanOwnership } = await import("@/lib/guest-ai/orchestrator/case-ownership");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const own = await loadConversationOwnership(turn as any, { nowIso });
          if (own.status === "identified" || own.status === "none") return deriveHumanOwnership(own.row, nowIso).aiPausedByTeam;
          return null;
        })();
    if (human === true) return SILENT;
    // leitura incerta da posse: não arrisca falar por cima de alguém
    if (human === null) return toHandoff("", "Não foi possível confirmar quem está atendendo — responder ao hóspede.", "normal");

    // 3) a cadeia completa (modo autônomo)
    const r = deps.generate
      ? await deps.generate(req)
      : await (await import("@/lib/guest-ai/copilot/generate.server")).generateCopilotSuggestion(
          {
            surface: req.surface,
            conversationId: req.conversationId,
            messageId: req.messageId,
            expectedOwnerId: req.expectedOwnerId ?? null,
          },
          { autonomous: true },
        );

    // 4) projeção para o canal
    if (r?.status === "skipped" && r.code === "superseded_by_newer_message") return SILENT; // a mensagem mais nova responde
    if (r?.status !== "stored" || !r.result) return toHandoff("", undefined, "normal");
    const res = r.result as {
      text: string | null;
      handoffNeeded: boolean;
      handoffUrgency: string | null;
      internalQuestion: string | null;
      formalChangeRequests?: string[];
      bareAckWithoutQuestion?: boolean;
    };

    // 4a) PEDIDO DE EXCEÇÃO (late check-out, entrada antecipada, concessão): a IA não responde nem "vai verificar";
    //     abre UMA decisão com botões para a equipe (push prioritário) e espera o clique.
    if ((res.formalChangeRequests ?? []).length > 0) {
      const open = deps.openDecision
        ? await deps.openDecision({
            conversationId: req.conversationId,
            triggerMessageId: req.messageId,
            formalChangeRequests: res.formalChangeRequests ?? [],
            internalQuestion: res.internalQuestion,
          })
        : await (await import("@/lib/guest-ai-decision.server")).openHumanDecision({
            conversationId: req.conversationId,
            triggerMessageId: req.messageId,
            formalChangeRequests: res.formalChangeRequests ?? [],
            internalQuestion: res.internalQuestion,
          });
      if (open.opened || open.code === "pending_exists" || open.code === "exists")
        return toHandoff("", open.reason, DECISION_HANDOFF_URGENCY);
    }
    // 4b) ALTERAÇÃO FORMAL (titular, 10/11/2026): cancelamento, datas, valor, nº de hóspedes ou condições
    //     NUNCA ficam só com a IA: a resposta ao hóspede segue, mas a equipe é SEMPRE avisada (push).
    const formal = res.formalChangeRequests ?? [];
    const mustHandoff = res.handoffNeeded || formal.length > 0;
    const reason = res.internalQuestion?.trim() || (formal.length > 0 ? formalChangeReason(formal) : null);
    // 4c) SILÊNCIO GARANTIDO (titular, 10/11/2026): "Sim"/"Ok"/"Obrigado" sem pergunta nossa pendente não recebe
    //     resposta, mesmo que o modelo tenha escrito uma. Encaminhamento/alteração formal nunca são calados.
    if (res.bareAckWithoutQuestion && !mustHandoff) return SILENT;
    let text = (res.text ?? "").trim();
    let tagHandoff = false;
    // 4d) TAGS NA SAÍDA (14/11/2026): o modelo só escreve marcadores; a troca pelos valores reais acontece AQUI.
    //     `[[CREDENCIAIS]]` e `[[info:...]]` sensível só com credenciais de um CredentialGrant novo (D9 agora);
    //     sem elas, aviso seguro + equipe. `[[info:...]]` público e `[[tag:...]]` pelo formato do canal. O que
    //     sobrar é removido: nenhuma tag crua chega ao hóspede.
    if (r.state === "available" && text && hasAnyTag(text)) {
      const need = needsCredentialLookup(text);
      const ctx = await (deps.outboundContext
        ? deps.outboundContext(req, need)
        : (await import("@/lib/guest-ai/credential-delivery.server")).loadOutboundContext(req, turn.propertyId, need)
      ).catch(() => null);
      const o = resolveOutboundText(
        text,
        ctx ?? { surface: req.surface, credentials: null, property: null, guideSlug: null },
      );
      text = o.text;
      tagHandoff = o.needsHandoff;
    }
    if (r.state === "available" && text) {
      if (tagHandoff)
        return toHandoff(text, reason ?? CREDENTIAL_UNAVAILABLE_REASON, res.handoffUrgency ?? "high");
      return mustHandoff
        ? toHandoff(text, reason, res.handoffUrgency)
        : { reply: sanitizeResidualTags(text), handoff: false };
    }
    if (r.state === "no_suggestion" && !mustHandoff) return SILENT; // silêncio legítimo
    return toHandoff(text, reason, res.handoffUrgency);
  } catch {
    return toHandoff("", undefined, "normal");
  }
}
