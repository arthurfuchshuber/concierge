/**
 * Tipos do Assistente do Painel (pedido explícito, 07/09/2026).
 *
 * A decisão central que estes tipos carregam: o assistente NUNCA grava nada
 * sozinho. Quando a pessoa pede uma ação, o servidor apenas MONTA a ação —
 * resolve "o 105" no id do imóvel, escolhe a categoria, calcula para qual
 * limpeza a pendência vai — e devolve uma `AssistantAction` junto de um
 * `preview` legível. Quem executa é o clique de confirmação na interface,
 * chamando exatamente a mesma server function que o resto do painel já usa
 * (`createTask`, `setTaskStatus`, `markNoShow`).
 *
 * Isso evita o pior modo de falha de um agente com poder de escrita — gravar
 * algo que a pessoa não pediu por ter entendido errado — e ainda mantém uma
 * única implementação de cada gravação: se a regra de criação de pendência
 * mudar, muda num lugar só e o assistente acompanha de graça.
 */
import type { TaskCategory, TaskPriority } from "@/lib/tasks-types";

/** Um par rótulo/valor do cartão de confirmação. */
export type ActionPreviewRow = { label: string; value: string };

export type AssistantAction =
  | {
      kind: "create_task";
      /** Espelha o input de `createTask` — o cliente repassa sem transformar. */
      payload: {
        title: string;
        description: string | null;
        category: TaskCategory;
        priority: TaskPriority;
        propertyId: string | null;
        ownerContactId: string | null;
        dueDate: string | null;
        showInCleaning: boolean | null;
      };
    }
  | {
      kind: "complete_task";
      payload: {
        taskId: string;
        resolutionNote: string | null;
      };
    }
  | {
      kind: "no_show";
      payload: {
        logId: string | null;
        reservationId: string | null;
      };
    };

export type PendingAction = {
  action: AssistantAction;
  /** Texto do botão que confirma ("Criar pendência", "Concluir"…). */
  confirmLabel: string;
  /** O que exatamente será gravado, em português, linha a linha. */
  preview: ActionPreviewRow[];
};

/** De onde saiu a resposta — exibido abaixo da mensagem. */
export type AssistantSource = {
  label: string;
  /** "guia" | "regra" | "tela" | nome de uma consulta aos dados. */
  kind: string;
};

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  sources: AssistantSource[];
  /** A tela apontada pela resposta vira link dentro do próprio texto
   * (07/09/2026) — não há mais um campo separado nem um chip embaixo da
   * mensagem repetindo o mesmo caminho. */
  pendingAction: PendingAction | null;
};

export type AssistantAsk = {
  threadId: string;
  message: AssistantMessage;
};
