/**
 * Tradução de chamadas de servidor para linguagem humana no Audit Trail.
 *
 * Objetivo: nenhuma linha do log pode ser críptica. Toda ação vira uma frase
 * ("Criou a regra ...", "Moveu o card do hóspede ... para Em limpeza").
 */

/** Rótulos específicos por função (sobrepõem a heurística de verbo). */
const FN_LABELS: Record<string, string> = {
  advanceArrival: "Avançou o card de chegada",
  revertArrival: "Retornou o card de chegada para a etapa anterior",
  upsertArrivalStatus: "Atualizou o status do card de chegada",
  updateGuestArrivalTime: "Alterou o horário previsto de chegada",
  updateGuestStayDates: "Alterou as datas da estadia",
  markPendingReservationStatus: "Marcou o status de uma reserva pendente",
  upsertProperty: "Salvou um imóvel/guia",
  duplicateProperty: "Duplicou um guia",
  deleteProperty: "Excluiu um imóvel",
  deleteGuides: "Excluiu guias",
  bulkUpdateProperties: "Editou imóveis em massa",
  inviteTeamMember: "Convidou um membro para a equipe",
  resendTeamInvite: "Reenviou um convite de equipe",
  revokeTeamInvite: "Cancelou um convite de equipe",
  removeTeamMember: "Removeu um membro da equipe",
  acceptMyInvite: "Aceitou um convite de equipe",
  declineMyInvite: "Recusou um convite de equipe",
  createPermissionCenterUser: "Criou/convidou um usuário no Centro de Permissões",
  removePermissionCenterUser: "Removeu um usuário do Centro de Permissões",
  setSubjectPermissionLevel: "Alterou o nível de permissão de um usuário",
  setSubjectProperty: "Alterou o acesso a um imóvel",
  setPermissionCenterPropertyScope: "Alterou o escopo de imóveis de um usuário",
  grantPermissionCenterPermission: "Concedeu uma permissão",
  revokePermissionCenterPermission: "Revogou uma permissão",
  assignPermissionCenterRole: "Atribuiu um papel",
  removePermissionCenterRole: "Removeu um papel",
  updateMemberPermission: "Atualizou permissões de um membro",
  saveOperationKnowledge: "Criou/editou uma regra de operação",
  archiveOperationKnowledge: "Arquivou uma regra de operação",
  saveHostBehavior: "Salvou o comportamento/prompt do anfitrião",
  saveGlobalInsight: "Publicou um insight global da IA",
  promoteLearningToGlobal: "Promoveu um aprendizado para conhecimento global",
  reviewLearningCandidate: "Revisou um aprendizado da IA",
  reviewAiPromptSuggestion: "Revisou uma sugestão de prompt",
  reviewPromptEvolution: "Revisou uma evolução de prompt",
  reviewProactiveAction: "Revisou uma ação proativa da IA",
  teachAiFromMessage: "Ensinou a IA a partir de uma mensagem",
  answerEscalation: "Respondeu a uma dúvida escalada pela IA",
  resolveAiKnowledgeGap: "Resolveu uma lacuna de conhecimento da IA",
  runAiEvaluation: "Rodou uma avaliação da IA",
  sendHandoffMessage: "Enviou uma mensagem no atendimento",
  editHandoffMessage: "Editou uma mensagem do atendimento",
  deleteHandoffMessage: "Apagou uma mensagem do atendimento",
  claimHandoffConversation: "Assumiu uma conversa",
  requestHandoffClaim: "Pediu para assumir uma conversa",
  transferHandoffConversation: "Transferiu uma conversa",
  releaseHandoffConversation: "Devolveu uma conversa para a IA",
  resolveHandoffConversation: "Resolveu uma conversa",
  reopenHandoffConversation: "Reabriu uma conversa",
  sendWhatsappFromConversation: "Enviou WhatsApp a partir da conversa",
  translateMessage: "Traduziu uma mensagem",
  recordGuideAccess: "Registrou acesso de hóspede ao guia",
  submitAccessPin: "Enviou o PIN de acesso ao guia",
  submitPin: "Enviou o PIN de acesso",
  changePlan: "Alterou o plano da assinatura",
  createPortalSession: "Abriu o portal de cobrança",
  setMissingCpf: "Informou CPF/CNPJ",
  updateMyProfile: "Atualizou o próprio perfil",
  uploadMyAvatar: "Trocou a foto de perfil",
  removeMyAvatar: "Removeu a foto de perfil",
  requestEmailChange: "Solicitou troca de e-mail",
  saveStakeholder: "Salvou um stakeholder",
  deleteStakeholder: "Excluiu um stakeholder",
  saveStakeholderActivity: "Salvou uma atividade de stakeholder",
  syncPropertyAirbnbIcal: "Sincronizou o calendário do Airbnb",
  importFromAirbnb: "Importou dados do Airbnb",
  enrichFromMapsLink: "Adicionou recomendação por link do Google Maps",
  moveRecommendations: "Moveu recomendações",
  addSigmaRec: "Adicionou uma recomendação Sigma",
  deleteSigmaRecs: "Excluiu recomendações Sigma",
  ingestTrail: "Rastro de uso",
};

const VERBS: Array<[RegExp, string]> = [
  [/^(get|list|count|search|preview|lookup|explain|compare|resolvePaddlePrice|check)/, "Consultou"],
  [/^(create|add|invite|start)/, "Criou"],
  [/^(update|save|set|upsert|edit|rename|reorder|toggle|mark|unmark|assign|apply)/, "Atualizou"],
  [/^(delete|remove|revoke|archive|cancel|disconnect|unlink|unsubscribe)/, "Removeu"],
  [/^(send|submit|run|sync|import|refresh|scan|generate|track|record|answer|teach|translate)/, "Executou"],
];

function humanize(name: string): string {
  const words = name.replace(/([A-Z])/g, " $1").trim().toLowerCase();
  for (const [re, verb] of VERBS) {
    if (re.test(name)) return `${verb}: ${words}`;
  }
  return `Ação: ${words}`;
}

const SENSITIVE = /(password|senha|token|secret|apikey|api_key|authorization|pin|cpf|cnpj|card|cvv)/i;

/** Campos que identificam bem "o quê / de quem" nos logs. */
const KEY_FIELDS = [
  "id", "name", "title", "email", "slug", "stage", "status", "level", "role",
  "guestName", "guest_name", "propertyId", "property_id", "conversationId",
  "reservationCode", "reservation_code", "phone", "date", "checkin", "checkout",
  "time", "message", "reason", "category", "action", "tenantId", "ownerId",
];

function short(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.slice(0, 80);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/** Snapshot seguro dos argumentos (sem segredos, sem payloads gigantes). */
export function sanitizeArgs(data: unknown, depth = 0): unknown {
  if (data === null || data === undefined) return null;
  if (typeof data === "string") return data.length > 300 ? `${data.slice(0, 300)}…` : data;
  if (typeof data === "number" || typeof data === "boolean") return data;
  if (Array.isArray(data)) {
    if (depth > 2) return `[${data.length} itens]`;
    return data.slice(0, 10).map((d) => sanitizeArgs(d, depth + 1));
  }
  if (typeof data === "object") {
    if (depth > 3) return "{…}";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE.test(k)) {
        out[k] = "***";
        continue;
      }
      if (typeof v === "function") continue;
      out[k] = sanitizeArgs(v, depth + 1);
    }
    return out;
  }
  return null;
}

/** Frase curta com os dados-chave da chamada ("hóspede X · imóvel Y"). */
export function describeArgs(data: unknown): string {
  const src = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of KEY_FIELDS) {
    if (!(key in src)) continue;
    if (SENSITIVE.test(key)) continue;
    const val = short(src[key]);
    if (!val) continue;
    parts.push(`${key}: ${val}`);
    if (parts.length >= 4) break;
  }
  return parts.join(" · ");
}

/** Descrição final exibida na coluna "Descrição" do Audit Trail. */
export function describeServerCall(name: string, data: unknown, failed: boolean): string {
  const label = FN_LABELS[name] ?? humanize(name);
  const detail = describeArgs(data);
  return `${label}${detail ? ` — ${detail}` : ""}${failed ? " (falhou)" : ""}`;
}
