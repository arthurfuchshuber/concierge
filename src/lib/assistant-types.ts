/**
 * Tipos do Assistente do Painel (pedido explícito, 07/09/2026).
 *
 * A decisão central que estes tipos carregam: o assistente NUNCA grava nada
 * sozinho. Quando a pessoa pede uma ação, o servidor apenas MONTA a ação —
 * resolve "o 105" no id do imóvel, escolhe a categoria, calcula para qual
 * limpeza a pendência vai — e devolve uma `AssistantAction` junto de um
 * `preview` legível. Quem executa é o clique de confirmação na interface,
 * chamando exatamente a mesma server function que o resto do painel já usa
 * (`createTask`, `setTaskStatus`, `markNoShow`, `upsertArrivalStatus`,
 * `advanceArrival`).
 *
 * Isso evita o pior modo de falha de um agente com poder de escrita — gravar
 * algo que a pessoa não pediu por ter entendido errado — e ainda mantém uma
 * única implementação de cada gravação: se a regra de criação de pendência
 * mudar, muda num lugar só e o assistente acompanha de graça.
 *
 * AUTONOMIA MÁXIMA (pedido explícito, 08/09/2026): "quero que a IA interna
 * tenha AUTONOMIA MÁXIMA e que consiga executar QUALQUER coisa solicitada
 * pelo usuário — caso este usuário tenha autonomia para fazer aquilo".
 *
 * Vale registrar como as duas coisas convivem, porque parecem brigar e não
 * brigam. O que limitava a IA não era o cartão de confirmação: era a lista
 * curta de ações que ela sabia montar. Quando o usuário pediu uma pendência
 * recorrente de 30 dias, a IA respondeu "não consigo criar recorrência" — e a
 * coluna `tasks.recurrence_days` existe desde sempre, o `createTask` já a
 * aceita, a tela de Pendências já a oferece. Faltava só a ferramenta expor o
 * campo. Autonomia, aqui, é COBERTURA: tudo que a tela faz, a IA monta.
 *
 * Quem decide o que cada pessoa PODE continua sendo o sistema, nunca a IA:
 * as ferramentas de leitura usam o cliente Supabase do usuário (RLS), e a
 * gravação passa pela mesma server function da tela, com a mesma checagem de
 * permissão. Se a pessoa não pode, a gravação falha — do mesmo jeito que
 * falharia se ela clicasse no botão. A IA nunca é a guardiã da permissão, e
 * por isso também nunca deve recusar por conta própria.
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
        /** Repete a cada N dias (`tasks.recurrence_days`). */
        recurrenceDays: number | null;
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
      /**
       * A MESMA pendência em VÁRIOS imóveis, com UMA confirmação só.
       *
       * Pedido explícito (08/09/2026): "crie a recorrência em todos os imóveis
       * sem me pedir para confirmar a gravação de cada um deles". Antes cada
       * imóvel exigia um cartão, e criar uma rotina em quinze imóveis eram
       * quinze confirmações — o assistente virava um formulário lento.
       *
       * O cartão de confirmação continua existindo: o que muda é o que ele
       * cobre. Um cartão, a lista inteira, uma decisão. E `duplicados` traz os
       * imóveis que JÁ têm pendência parecida — eles ficam de fora por padrão,
       * porque duplicar em silêncio é pior do que não criar.
       */
      kind: "create_task_bulk";
      payload: {
        /** O que será criado, igual em todos os imóveis. */
        base: {
          title: string;
          description: string | null;
          category: TaskCategory;
          priority: TaskPriority;
          dueDate: string | null;
          showInCleaning: boolean | null;
          recurrenceDays: number | null;
        };
        /** Onde criar. */
        properties: Array<{ id: string; name: string }>;
        /** Fora da lista por já terem pendência parecida (informativo). */
        duplicates: Array<{ id: string; name: string; existing: string }>;
      };
    }
  | {
      /** Arquivar (status "canceled") ou reabrir (status "pending"). */
      kind: "set_task_status";
      payload: {
        taskId: string;
        status: "pending" | "canceled";
      };
    }
  | {
      kind: "no_show";
      payload: {
        logId: string | null;
        reservationId: string | null;
      };
    }
  | {
      /** Data e/ou horário PREVISTOS de um card (`upsertArrivalStatus`). */
      kind: "set_prediction";
      payload: {
        logId: string | null;
        reservationId: string | null;
        kind: "checkin" | "checkout";
        arrivalDateOverride: string | null;
        arrivalTimeOverride: string | null;
      };
    }
  | {
      /** Avança o card uma etapa na esteira (`advanceArrival`). */
      kind: "advance";
      payload: {
        logId: string | null;
        reservationId: string | null;
        from: "checkin" | "stay" | "checkout" | "cleaning";
        /** Obrigatório em `from: "cleaning"` — define o preço gravado. */
        cleaningType: "normal" | "completa" | null;
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
