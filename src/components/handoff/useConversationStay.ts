import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getHandoffConversationStay } from "@/lib/handoff.functions";
import type { HandoffConversationStay } from "@/lib/handoff.schemas";

/**
 * Cabeçalho da conversa aberta: busca a reserva da PRÓPRIA conversa (não depende da lista), na hora em que ela
 * abre, e se atualiza com a conversa (tempo real invalida a chave) e a cada poucos segundos.
 */
export function useConversationStay(conversationId: string | null): HandoffConversationStay | null {
  const fn = useServerFn(getHandoffConversationStay);
  const q = useQuery({
    queryKey: ["handoff-stay", conversationId],
    queryFn: () => fn({ data: { conversationId: conversationId as string } }),
    enabled: !!conversationId,
    refetchInterval: 5000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: 1,
  });
  return q.data ?? null;
}
