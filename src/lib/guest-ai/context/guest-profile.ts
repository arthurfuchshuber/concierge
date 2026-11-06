/**
 * MEMÓRIA DO HÓSPEDE — bloco LEVE e seguro para o prompt (puro: sem banco, rede nem relógio).
 *
 * Só o necessário para a hospitalidade: se o hóspede é recorrente, quantas estadias concluídas, a data da
 * última saída e as preferências consolidadas (cada uma com id citável `perfil:pN`). Nenhum nome,
 * telefone, conta, e-mail, documento ou dado financeiro. Conflito, ausência de âncora ou falha de leitura
 * ⇒ status explícito, sem preferências: o modelo trata como primeira estadia. Acompanhante (WhatsApp de
 * outro número numa reserva vinculada) ⇒ sem preferências do titular e sem saudação de recorrente.
 * Notas são CONTEXTO, não autorização: nunca concedem horário, desconto, credencial ou exceção.
 */
import type { GuestNoteCategory, GuestProfileLoad } from "@/lib/guest-ai/data/guest-profile.server";

export type GuestProfileStatus =
  "recorrente" | "novo" | "acompanhante" | "nao_identificado" | "conflito" | "indisponivel";

export interface GuestProfileContext {
  status: GuestProfileStatus;
  estadias_anteriores: number | null;
  ultima_saida: string | null;
  preferencias: ReadonlyArray<{ id: string; categoria: GuestNoteCategory; texto: string }>;
}

export function buildGuestProfileContext(
  load: GuestProfileLoad | null | undefined,
): GuestProfileContext {
  const empty = (status: GuestProfileStatus): GuestProfileContext => ({
    status,
    estadias_anteriores: null,
    ultima_saida: null,
    preferencias: [],
  });
  if (!load) return empty("indisponivel");
  switch (load.status) {
    case "found":
      return {
        status: load.stayCount >= 1 ? "recorrente" : "novo",
        estadias_anteriores: load.stayCount,
        ultima_saida: load.lastStayCheckout,
        preferencias: load.notes.map((n, i) => ({
          id: `perfil:p${i + 1}`,
          categoria: n.categoria,
          texto: n.texto,
        })),
      };
    case "not_found":
      return load.reason === "no_anchor" ? empty("nao_identificado") : empty("novo");
    case "companion":
      return empty("acompanhante");
    case "conflict":
      return empty("conflito");
    default:
      return empty("indisponivel");
  }
}
