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
import { parseBurstRequests, requestsFromBurst } from "@/lib/guest-ai-decision";
import { isAffirmativeStatement, isBareAcknowledgment } from "@/lib/guest-ai/ack-silence";

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
  /** Textos do hóspede da rajada atual (fallback sem modelo). */
  loadBurst?: (req: GuestAiRequest) => Promise<string[]>;
  /** Tempo máximo da cadeia do modelo antes do fallback determinístico. */
  generationTimeoutMs?: number;
}

/** Dados da resposta imediata ao abrir a decisão (horários oficiais + pedido). */

/**
 * Teto da cadeia do modelo no turno autônomo. O normal leva 5–10 s; acima disso o turno não pode ficar mudo: cai
 * no fallback determinístico (decisão com botões + resposta com os horários oficiais). A Gateway corta em 30 s.
 */
export const GENERATION_FALLBACK_MS = 25_000;

/**
 * Contingência de tempo (12/11/2026, caso Gilmar: "não consigo acesso a senha wifi" ficou sem resposta porque a
 * geração estourou e o fallback só tratava pedidos de horário). Mensagem com conteúdo nunca fica muda: este aviso
 * vai ao hóspede e a conversa sobe para a equipe com urgência alta. Sem prazo ("em instantes" é proibido pelo
 * roteiro) e sem justificativa inventada.
 */
export const CONTINGENCY_REPLY = "Recebi sua mensagem e já acionei nossa equipe para te orientar por aqui.";
export const CONTINGENCY_REASON = "Dúvida do hóspede sem resposta da IA (contingência de tempo): responder pela equipe.";
/** Falha técnica numa consulta/pergunta comercial: a equipe responde; o chat do hóspede não recebe frase padrão. */
export const COMMERCIAL_CONTINGENCY_REASON =
  "Consulta comercial ou de datas sem resposta da IA (contingência de tempo): responder pela equipe.";


/** Urgência do chamado de decisão (push prioritário). */
export const DECISION_HANDOFF_URGENCY = "high";

export async function requestGuestAiReply(req: GuestAiRequest, deps: SlotDeps = {}): Promise<GuestAiReply | null> {
  const env = deps.env ?? process.env;
  if (!autonomousEnabled(env)) return null;
  try {
    // 1) escopo validado no backend (fail-closed)
    let turn: { propertyId: string; reservationId?: string | null };
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
    const TIMED_OUT = Symbol("generation_timeout");
    const limitMs = deps.generationTimeoutMs ?? GENERATION_FALLBACK_MS;
    const run = deps.generate
      ? deps.generate(req)
      : (await import("@/lib/guest-ai/copilot/generate.server")).generateCopilotSuggestion(
          {
            surface: req.surface,
            conversationId: req.conversationId,
            messageId: req.messageId,
            expectedOwnerId: req.expectedOwnerId ?? null,
          },
          { autonomous: true },
        );
    let timer: ReturnType<typeof setTimeout> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raced: any = await Promise.race([
      Promise.resolve(run).catch(() => null),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), limitMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    // FALLBACK DETERMINÍSTICO (sem modelo): pedido de saída/entrada fora do horário NUNCA fica sem botões para a
    // equipe; ao hóspede não vai texto fixo (encaminhamento silencioso).
    if (raced === TIMED_OUT || raced === null) {
      return await deterministicFallback(req, deps, { inquiry: turn.reservationId === null });
    }
    const r = raced;

    // 4) projeção para o canal
    if (r?.status === "skipped" && r.code === "superseded_by_newer_message") return SILENT; // a mensagem mais nova responde
    if (r?.status === "stale") return toHandoff("", undefined, "normal"); // a mensagem mais nova assume o turno
    if (r?.status !== "stored" || !r.result) return await deterministicFallback(req, deps, { inquiry: turn.reservationId === null });
    // a geração foi gravada como falha (prazo, erro do modelo): mesma contingência, o hóspede não fica mudo
    if (r.state === "generation_failed") return await deterministicFallback(req, deps, { inquiry: turn.reservationId === null });
    const res = r.result as {
      text: string | null;
      handoffNeeded: boolean;
      handoffUrgency: string | null;
      internalQuestion: string | null;
      formalChangeRequests?: string[];
      bareAckWithoutQuestion?: boolean;
    };

    // 4a) PEDIDO DE EXCEÇÃO (late check-out, entrada antecipada, concessão): abre UMA decisão com botões para a
    //     equipe (push prioritário). MENSAGEM MISTA (11/11/2026, diretiva do titular): o texto validado do modelo
    //     (que já passou pelas travas de compromisso: não promete exceção sem autorização) é PRESERVADO, para não
    //     jogar fora a resposta das outras perguntas. Sem texto validado do modelo ⇒ encaminhamento silencioso:
    //     nenhum texto fixo vai ao hóspede (diretiva de 11/11/2026, caso Ary).
    let decisionReason: string | null = null;
    let decisionUrgency: string = DECISION_HANDOFF_URGENCY;
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
      if (open.opened) {
        decisionReason = open.reason ?? null;
        // sem texto validado do modelo ⇒ encaminhamento SILENCIOSO (nenhum texto fixo inventado; diretiva 11/11/2026)
        if (!(r.state === "available" && (res.text ?? "").trim())) return toHandoff("", decisionReason, DECISION_HANDOFF_URGENCY);
      } else if (open.code === "same_day_turnover") {
        // virada no mesmo dia: nada a decidir; a saída é pontual e a equipe só é avisada (urgência normal)
        decisionReason = open.reason ?? null;
        decisionUrgency = "normal";
        if (!(r.state === "available" && (res.text ?? "").trim())) return toHandoff("", decisionReason, decisionUrgency);
      } else if (open.code === "pending_exists" || open.code === "exists") return toHandoff("", open.reason, DECISION_HANDOFF_URGENCY);
    }
    // 4b) ALTERAÇÃO FORMAL (titular, 10/11/2026): cancelamento, datas, valor, nº de hóspedes ou condições
    //     NUNCA ficam só com a IA: a resposta ao hóspede segue, mas a equipe é SEMPRE avisada (push).
    const formal = res.formalChangeRequests ?? [];
    const mustHandoff = res.handoffNeeded || formal.length > 0 || decisionReason !== null;
    const reason = decisionReason ?? (res.internalQuestion?.trim() || (formal.length > 0 ? formalChangeReason(formal) : null));
    const urgency = decisionReason !== null ? decisionUrgency : res.handoffUrgency;
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
        ? toHandoff(text, reason, urgency)
        : { reply: sanitizeResidualTags(text), handoff: false };
    }
    if (decisionReason !== null) return toHandoff("", reason, decisionUrgency);
    if (r.state === "no_suggestion" && !mustHandoff) return SILENT; // silêncio legítimo
    return toHandoff(text, reason, urgency);
  } catch {
    return toHandoff("", undefined, "normal");
  }
}


/**
 * Fallback sem modelo (timeout, erro ou resultado inválido): lê a rajada do hóspede por regex e, se houver pedido
 * de saída tardia/entrada antecipada, abre a decisão com botões e responde com os horários oficiais. Sem pedido
 * reconhecido, mantém o encaminhamento de sempre (fila humana + push), sem texto.
 */
/**
 * Pergunta comercial ou de disponibilidade (datas, vaga, valor, reserva, mínimo de noites): numa falha técnica NÃO
 * recebe o aviso de contingência (soa como SAC e não responde nada a quem quer reservar). Vai só para a equipe,
 * com urgência alta (diretiva de 12/11/2026, caso Tais).
 */
export const COMMERCIAL_QUESTION =
  /\b(disponib\w*|disponive\w*|vagas?|livres?|lotad\w*|ocupad\w*|reserv\w*|valor(es)?|preco|precos|quanto (custa|fica|sai|e)|diarias?|(\d{1,2}|uma|duas|tres|quatro|cinco) noites?|noites? (livres?|disponive\w*|a mais|extras?)|desconto|promoc\w*|minimo|datas?|dias? \d{1,2}|\d{1,2}\/\d{1,2}|\d{1,2} (a|ao|ate) \d{1,2}|de \d{1,2} a \d{1,2})\b/;

export function isCommercialQuestion(texts: readonly string[]): boolean {
  const n = texts
    .join(" ")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  return COMMERCIAL_QUESTION.test(n);
}

async function deterministicFallback(req: GuestAiRequest, deps: SlotDeps, opts: { inquiry?: boolean } = {}): Promise<GuestAiReply> {
  try {
    const texts = deps.loadBurst
      ? await deps.loadBurst(req)
      : await (async () => {
          const { loadGuestBurstFor } = await import("@/lib/guest-ai-decision.server");
          return loadGuestBurstFor(req.conversationId, req.messageId);
        })();
    const burst = parseBurstRequests(texts, { strict: true });
    const requests = requestsFromBurst(burst);
    if (requests.length === 0) {
      // dúvida operacional (Wi-Fi, portaria, chuveiro…) sem resposta do modelo: nunca emudece o chat. Só cortesia
      // ("ok", "obrigado") segue em silêncio, como no fluxo normal.
      const content = texts.filter((t) => (t ?? "").trim());
      if (!content.length || content.every((t) => isBareAcknowledgment(t) || isAffirmativeStatement(t))) return toHandoff("", undefined, "normal");
      // consulta (sem reserva) ou pergunta comercial/de datas: nada de frase de SAC no chat; a equipe responde
      if (opts.inquiry || isCommercialQuestion(content)) return toHandoff("", COMMERCIAL_CONTINGENCY_REASON, "high");
      return toHandoff(CONTINGENCY_REPLY, CONTINGENCY_REASON, "high");
    }
    const input = {
      conversationId: req.conversationId,
      triggerMessageId: req.messageId,
      formalChangeRequests: requests,
      internalQuestion: null,
    };
    const open = deps.openDecision
      ? await deps.openDecision(input)
      : await (await import("@/lib/guest-ai-decision.server")).openHumanDecision(input);
    // fallback sem modelo: decisão aberta para a equipe, hóspede sem texto fixo (encaminhamento silencioso)
    if (open.opened) return toHandoff("", open.reason, DECISION_HANDOFF_URGENCY);
    if (open.code === "same_day_turnover") return toHandoff("", open.reason, "normal");
    if (open.code === "pending_exists" || open.code === "exists") return toHandoff("", open.reason, DECISION_HANDOFF_URGENCY);
    return toHandoff("", undefined, "normal");
  } catch {
    // nem a leitura da rajada deu certo: ainda assim o hóspede não fica sem resposta (consulta ⇒ só a equipe)
    if (opts.inquiry) return toHandoff("", COMMERCIAL_CONTINGENCY_REASON, "high");
    return toHandoff(CONTINGENCY_REPLY, CONTINGENCY_REASON, "high");
  }
}
