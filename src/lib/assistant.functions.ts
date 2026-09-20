/**
 * Server functions do Assistente do Painel (pedido explícito, 07/09/2026).
 *
 * O caminho de uma pergunta:
 *
 *   1. Recupera o que o sistema sabe sobre si mesmo (`retrieveSystemKnowledge`)
 *      e injeta no prompt. Isso vai SEMPRE, antes de qualquer ferramenta: a
 *      maioria das perguntas é "como faço X" ou "por que isso é assim", e nessas
 *      o RAG já resolve sem gastar uma rodada de tool calling.
 *
 *   2. Roda o agente com as ferramentas de leitura e de preparação de ação.
 *      As de leitura usam o cliente do usuário, então o RLS limita o que cada
 *      pessoa recebe — inclusive prestadores.
 *
 *   3. Se alguma ferramenta preparou uma ação, ela volta como `pendingAction`.
 *      Nada foi gravado ainda: a gravação acontece quando a pessoa confirma na
 *      interface, que chama a mesma server function do resto do painel.
 *
 * Mesmos padrões do resto do projeto: createServerFn + requireSupabaseAuth +
 * zod, com AnyClient nas tabelas que ainda não estão no types.ts gerado.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { AssistantAsk, AssistantMessage, AssistantSource } from "@/lib/assistant-types";
import { AssistantAskInput } from "@/lib/assistant-run.shared";

type AnyClient = { from: (t: string) => any };

/**
 * Caminho SEM streaming (reserva).
 *
 * O painel normalmente conversa pela rota `/api/assistant-stream`, que mostra a
 * resposta enquanto ela é escrita. Quando o streaming não sobe (rede da equipe
 * oscilando, proxy que segura SSE), o painel cai aqui e recebe a resposta
 * pronta. É o MESMO turno, o mesmo modelo, as mesmas ferramentas — muda só
 * quando a pessoa vê o texto.
 */
export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AssistantAskInput.parse(i))
  .handler(async ({ data, context }): Promise<AssistantAsk> => {
    const { runAssistantTurn } = await import("@/lib/assistant-run.server");
    return runAssistantTurn({
      supabase: context.supabase,
      userId: context.userId,
      data,
    });
  });

// ----- Histórico -----

/**
 * HISTÓRICO PERMANENTE (pedido explícito, 09/09/2026): "o histórico COMPLETO
 * da conversa do usuário com a IA precisa permanecer eternamente no chat —
 * todas as conversas, todas as decisões, tudo".
 *
 * Três coisas escondiam o passado, e nenhuma delas apagava nada — o que torna
 * a correção puramente de leitura:
 *
 *   1. A consulta lia UMA thread só (a mais recente). Tudo que veio antes de
 *      um "nova conversa" continuava no banco e sumia da tela.
 *   2. Ela parava em 60 mensagens.
 *   3. As ações CONFIRMADAS não viravam mensagem: o cartão sumia e, depois de
 *      recarregar, não havia registro nenhum de que aquilo tinha sido feito.
 *      O (3) está resolvido em `recordAssistantAction`, logo abaixo.
 *
 * Agora a leitura é por USUÁRIO, não por thread, e vem paginada do fim para o
 * começo: a tela abre com as últimas `PAGE` mensagens e busca as anteriores
 * conforme a pessoa sobe. Trazer dez mil mensagens de uma vez seria a única
 * forma de "mostrar tudo" que trava o navegador — paginar é o que mantém a
 * promessa de que nada some.
 *
 * `threadId` de cada mensagem vem junto para a interface desenhar a divisória
 * de "nova conversa" onde ela existiu.
 */
const HISTORY_PAGE = 100;

const ThreadInput = z
  .object({
    threadId: z.string().uuid().nullable().optional(),
    /** Busca as mensagens ANTERIORES a este instante (paginação para trás). */
    before: z.string().nullable().optional(),
  })
  .optional();

export const listAssistantThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ThreadInput.parse(i) ?? {})
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      threadId: string | null;
      messages: AssistantMessage[];
      /** Existem mensagens mais antigas do que a primeira desta página. */
      hasMore: boolean;
    }> => {
      const db = context.supabase as unknown as AnyClient;

      // A thread ATUAL (onde a próxima pergunta entra) continua sendo a mais
      // recente — o histórico ser completo não muda onde a conversa continua.
      let threadId = data.threadId ?? null;
      if (!threadId) {
        const { data: last } = await db
          .from("assistant_threads")
          .select("id")
          .order("updated_at", { ascending: false })
          .limit(1);
        threadId = (last?.[0] as { id: string } | undefined)?.id ?? null;
      }

      // Ordena DESC para pegar as mais recentes (ou as anteriores ao cursor) e
      // inverte no fim — não dá para "pegar as últimas N" ordenando ASC.
      let q = db
        .from("assistant_messages")
        .select("id, thread_id, role, content, meta, created_at")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(HISTORY_PAGE + 1);
      if (data.before) q = q.lt("created_at", data.before);
      const { data: rows } = await q;

      const raw = (rows ?? []) as Array<{
        id: string;
        thread_id: string | null;
        role: string;
        content: string;
        meta: Record<string, unknown> | null;
        created_at: string;
      }>;
      const hasMore = raw.length > HISTORY_PAGE;
      const page = (hasMore ? raw.slice(0, HISTORY_PAGE) : raw).reverse();

      const messages: AssistantMessage[] = page.map((r) => ({
        id: r.id,
        threadId: r.thread_id,
        role: r.role === "user" ? "user" : "assistant",
        content: r.content,
        createdAt: r.created_at,
        sources: (r.meta?.sources as AssistantSource[]) ?? [],
        /** O que foi de fato GRAVADO naquele turno — ver recordAssistantAction. */
        executedAction: (r.meta?.executedAction as string | undefined) ?? null,
        // Ação PREPARADA não sobrevive ao recarregar: os dados podem ter mudado
        // desde então, e confirmar às cegas uma proposta velha é como a pessoa
        // gravaria algo que já não faz sentido. O que fica registrado para
        // sempre é o que foi executado, não o que foi proposto.
        pendingAction: null,
      }));

      return { threadId, messages, hasMore };
    },
  );

/**
 * Registra no histórico que uma ação foi EXECUTADA.
 *
 * Sem isto, "todas as decisões" não se sustentava: o cartão de confirmação era
 * um objeto de tela: sumia ao confirmar e não deixava rastro nenhum na
 * conversa. Depois de recarregar, a pergunta "isso chegou a ser feito?" não
 * tinha resposta ali dentro — e com a confirmação automática ligada nem cartão
 * existe para ver.
 *
 * Vira uma mensagem do assistente com `meta.executedAction`, na mesma thread.
 * Fica no histórico como qualquer outra, para sempre.
 */
export const recordAssistantAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        threadId: z.string().uuid(),
        label: z.string().trim().min(1).max(300),
        detail: z.string().trim().max(2000).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const db = context.supabase as unknown as AnyClient;
    await db.from("assistant_messages").insert({
      thread_id: data.threadId,
      user_id: context.userId,
      role: "assistant",
      content: data.detail ? `${data.label}\n${data.detail}` : data.label,
      meta: { executedAction: data.label },
    });
    await db
      .from("assistant_threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", data.threadId);
    return { ok: true };
  });

/**
 * Transcreve um áudio gravado no painel (pedido explícito, 07/09/2026).
 *
 * O áudio não vira anexo nem fica guardado: ele é convertido em texto e esse
 * texto entra na conversa como a pergunta da pessoa. Assim ditar "abre uma
 * pendência de manutenção no 105, chuveiro pingando" percorre exatamente o
 * mesmo caminho de quem digitou — inclusive o cartão de confirmação antes de
 * gravar. Falar vira só outra forma de escrever, não um segundo fluxo com
 * regras próprias.
 *
 * Mesmo endpoint de transcrição que os detalhes do imóvel já usam.
 */
export const transcribeAssistantAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        audioBase64: z.string().min(100).max(20_000_000),
        mimeType: z.string().max(120).default("audio/webm"),
      })
      .parse(i),
  )
  .handler(async ({ data }): Promise<{ text: string }> => {
    const { transcribeAudioBase64 } = await import("@/lib/ai/transcribe.server");
    return { text: await transcribeAudioBase64(data.audioBase64, data.mimeType) };
  });

/** Começa uma conversa nova, deixando a anterior no histórico. */
export const startAssistantThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ threadId: string }> => {
    const db = context.supabase as unknown as AnyClient;
    const { data, error } = await db
      .from("assistant_threads")
      .insert({ user_id: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { threadId: (data as { id: string }).id };
  });
