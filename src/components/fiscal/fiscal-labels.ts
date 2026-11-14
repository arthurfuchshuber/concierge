export type Tone = "sage" | "amber" | "rose" | "gray";
export const TONE_CLASS: Record<Tone, string> = {
  sage: "bg-[#E6F1EA] text-[#2F5A40]",
  amber: "bg-[#FFF3D6] text-[#7A4F00]",
  rose: "bg-[#FBEBEE] text-[#9B2F45]",
  gray: "bg-muted text-muted-foreground",
};
export const DOC_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Rascunho", tone: "gray" },
  discovered: { label: "Recebida", tone: "gray" },
  pending_issue: { label: "Aguardando envio", tone: "amber" },
  processing: { label: "Processando", tone: "amber" },
  authorized: { label: "Autorizada", tone: "sage" },
  rejected: { label: "Rejeitada", tone: "rose" },
  cancel_requested: { label: "Cancelamento em andamento", tone: "amber" },
  cancelled: { label: "Cancelada", tone: "gray" },
  denied: { label: "Denegada", tone: "rose" },
  unknown_result: { label: "Resultado desconhecido", tone: "amber" },
};
export const OP_STATE: Record<string, { label: string; tone: Tone }> = {
  awaiting_authorization: { label: "Aguardando autorização", tone: "amber" },
  authorized_by_human: { label: "Autorizada", tone: "amber" },
  queued: { label: "Na fila", tone: "amber" },
  in_flight: { label: "Enviando", tone: "amber" },
  completed: { label: "Concluída", tone: "sage" },
  failed_definitive: { label: "Falhou", tone: "rose" },
  expired: { label: "Expirada", tone: "gray" },
  unknown_result: { label: "Resultado desconhecido", tone: "amber" },
};
export const OP_KIND: Record<string, string> = { issue: "Emitir", cancel: "Cancelar", inutilize: "Inutilizar", event: "Evento", manifest: "Manifestar" };
export const DOC_KIND: Record<string, string> = { nfe: "NF-e", nfse: "NFS-e", nfsen: "NFS-e Nacional", cte: "CT-e" };

export function formatTaxId(d: string): string {
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}

export function SEND_OUTCOME(o: { kind: string; reason?: string; responseClass?: string; httpStatus?: number }): { ok: boolean; text: string } {
  if (o.kind === "denied") return { ok: false, text: `Envio negado (${o.reason}). Nada foi enviado.` };
  if (o.kind === "unknown") return { ok: false, text: "O envio pode ter chegado ao provedor. Vamos consultar sozinhos; nada será reenviado sem nova autorização." };
  if (o.responseClass === "accepted") return { ok: true, text: "Enviado ao provedor. A situação do documento será confirmada por consulta." };
  if (o.responseClass === "inconclusive") return { ok: false, text: "Resposta inconclusiva do provedor. Vamos consultar a situação." };
  return { ok: false, text: "O provedor não aceitou o envio." };
}
