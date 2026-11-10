import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import {
  getConversationLearnings,
  undoLearningEntry,
  type ConversationLearning,
} from "@/lib/guest-ai-learning.functions";
import { SCOPE_LABEL } from "@/lib/guest-ai-learning/qualify";
import { friendlyErrorMessage } from "@/lib/friendly-error";

/** Aprendizados ativos desta conversa, por mensagem da equipe que os gerou. Falha de leitura ⇒ nenhum selo. */
export function useConversationLearnings(conversationId: string): Map<string, ConversationLearning> {
  const fn = useServerFn(getConversationLearnings);
  const q = useQuery({
    queryKey: ["conv-learnings", conversationId],
    queryFn: () => fn({ data: { conversationId } }),
    retry: false,
  });
  return useMemo(() => new Map((q.data ?? []).map((l) => [l.messageId, l])), [q.data]);
}

/**
 * Selo "IA aprendeu · <escopo>" com "Desfazer" (mockup aprovado em 10/11/2026), abaixo da mensagem da equipe que
 * ensinou um fato do imóvel. Desfazer tira o fato (e as réplicas) do Documento Vivo na hora.
 */
export function LearnedBadge({ learning, conversationId }: { learning: ConversationLearning; conversationId: string }) {
  const qc = useQueryClient();
  const undoFn = useServerFn(undoLearningEntry);
  const [error, setError] = useState<string | null>(null);
  const undo = useMutation({
    mutationFn: () => undoFn({ data: { id: learning.entryId } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["conv-learnings", conversationId] }),
    onError: (e) => setError(friendlyErrorMessage(e, "Não foi possível desfazer.")),
  });
  return (
    <div className="mt-1 flex max-w-full flex-wrap items-center justify-end gap-1.5" data-testid="learned-badge">
      <span
        title={learning.statement}
        className="inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_12%,transparent)]"
      >
        <Sparkles className="size-3 shrink-0" aria-hidden="true" />
        IA aprendeu · {SCOPE_LABEL[learning.scope]}
      </span>
      <button
        type="button"
        disabled={undo.isPending}
        onClick={() => undo.mutate()}
        className="inline-flex min-h-8 items-center gap-1 rounded-full px-3 text-[12px] font-medium text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_18%,transparent)] hover:bg-secondary disabled:opacity-50"
      >
        {undo.isPending ? <Loader2 className="size-3 animate-spin" /> : null}
        Desfazer
      </button>
      {error ? (
        <span role="alert" className="basis-full text-right text-[11px] text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
