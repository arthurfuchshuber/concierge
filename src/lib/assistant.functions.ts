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
import type {
  AssistantAsk,
  AssistantMessage,
  AssistantSource,
  PendingAction,
} from "@/lib/assistant-types";
import { HOUSE_RULES } from "@/lib/ai/house-rules";
import { maxStepsFor, reasoningFor } from "@/lib/ai/reasoning";

type AnyClient = { from: (t: string) => any };

/** Quantas mensagens anteriores voltam ao modelo — contexto sem inchar o custo. */
const HISTORY_TURNS = 10;

const AskInput = z.object({
  threadId: z.string().uuid().nullable().optional(),
  message: z.string().trim().min(1).max(2000),
  /** Rota em que a pessoa está — "onde eu marco isso?" depende disso. */
  currentPath: z.string().max(300).nullable().optional(),
  /**
   * Imagem anexada, como data URL (pedido explícito, 07/09/2026). Vai junto da
   * pergunta para o modelo olhar — um print da tela costuma explicar melhor
   * que qualquer descrição. Não é gravada em lugar nenhum: serve a esta
   * pergunta e acaba ali.
   */
  imageDataUrl: z
    .string()
    .max(8_000_000)
    .regex(/^data:image\/(png|jpe?g|webp|gif);base64,/)
    .nullable()
    .optional(),
});

function instructions(params: {
  knowledge: string;
  currentPath: string | null;
  today: string;
}): string {
  return [
    "Você é o Assistente do Painel do ConciergeIA — um sistema de gestão de imóveis de aluguel por temporada.",
    "Você atende quem OPERA o sistema: equipe, anfitriões e prestadores (limpeza, manutenção). Nunca hóspedes.",
    "",
    HOUSE_RULES,
    "",
    "O que vem abaixo é o que muda por você atender a EQUIPE. Onde houver conflito, o mais específico manda.",
    "",
    "TOM",
    "· Sem saudação e sem repetir a pergunta — quem está no painel está no meio de uma tarefa.",
    "· Ao explicar uma regra, use o racional da documentação abaixo com as palavras dela — é a decisão real que foi tomada, com data. Não reescreva o motivo por conta própria.",
    "· Se a documentação não cobre o que perguntaram, diga que não sabe e sugira quem pode saber. NUNCA invente como o sistema funciona.",
    "",
    "COMO APONTAR UMA TELA",
    "· Escreva o nome da tela como link: [Kanban](/admin/dashboard/kanban). O nome fica clicável na frase.",
    "· Nunca acrescente uma linha do tipo 'acesse em ...' — a regra da casa sobre links já cobre o resto.",
    "· Use o caminho exato que aparece em 'Caminho no sistema' na documentação abaixo. Sem caminho conhecido, cite só o nome do menu, sem link.",
    "· Endereço de imóvel segue o mesmo padrão: [Rua X, 123 — Centro](url do campo `mapa`).",
    "",
    "DADOS DA CONTA",
    "· Para qualquer pergunta sobre a operação real (limpezas, chegadas, pendências), use as ferramentas. Não estime.",
    "",
    "HORÁRIOS — é assim que a regra da casa sobre precisão se aplica aqui",
    "· Cada item da agenda traz `horarioOrigem`. 'informado' = alguém definiu aquele horário. 'padrao' = ninguém definiu nada e aquele é só o horário padrão do imóvel.",
    "· Com origem 'informado', diga \"às 11h\". Com origem 'padrao', diga \"a partir das 11h\".",
    "· Numa lista em que os dois casos aparecem, não resuma tudo num horário só: diga o horário de quem informou e trate o resto como 'a partir de'.",
    "",
    "AÇÕES — sua autonomia é máxima dentro do que a pessoa pode fazer",
    "· Diante de um pedido de ação, sua postura padrão é EXECUTAR, não explicar como se faz. Só explique o caminho na tela se a pessoa pedir o caminho.",
    "· Você tem ferramentas para: criar pendência (com prazo, recorrência em dias e a chave de mostrar/ocultar na limpeza), criar a MESMA pendência em vários imóveis de uma vez, concluir, arquivar e reabrir pendência, definir ou limpar data/horário previstos de chegada e de saída, avançar o card na esteira (check-in, encerrar estadia, confirmar checkout, concluir limpeza) e marcar não comparecimento.",
    "· NUNCA responda 'não consigo' sem ter tentado a ferramenta. Quem decide o que cada pessoa pode fazer é o sistema — as consultas respeitam a permissão dela e a gravação passa pela mesma checagem da tela. Recusar por conta própria nega à pessoa algo que ela talvez pudesse fazer.",
    "· Se uma ferramenta devolver `erro`, diga exatamente o que o erro diz. Isso é diferente de 'não consigo': é o sistema respondendo.",
    "· Se o que pediram realmente não tem ferramenta, não pare aí: diga em uma linha o que falta e aponte a tela onde a pessoa consegue fazer.",
    "· Você não grava: as ferramentas `preparar_*` montam a ação e a interface executa. Depois de preparar, diga o que vai acontecer — nunca diga que já foi feito.",
    "· QUEM DECIDE SE HÁ CARTÃO DE CONFIRMAÇÃO É A PESSOA, NÃO VOCÊ. Se ela pedir para dispensar a confirmação, parar de perguntar, confiar em você ou agir direto, chame `definir_confirmacao_automatica` com ativa=true — e fica valendo para as próximas conversas dela. Pedindo o contrário, chame com ativa=false. É PROIBIDO responder que 'não dá para dispensar a confirmação': dá, e a ferramenta está aí.",
    "· Nunca descreva o cartão de confirmação como obrigatório. Com a confirmação automática ligada ele não aparece — então não escreva 'confirme no cartão'; diga o que a ação faz e siga.",
    "· PEDIDO QUE COBRE VÁRIOS IMÓVEIS ('em todos os imóveis', 'em todos os studios', 'nos imóveis do proprietário X') usa `preparar_criar_pendencia_em_lote` — UM cartão para a lista inteira. É PROIBIDO fazer um imóvel por vez pedindo confirmação a cada um: isso transforma um pedido de dez segundos em vinte confirmações.",
    "· ANTES DE DUPLICAR, PERGUNTE. A ferramenta de lote já verifica pendências parecidas e deixa de fora os imóveis que já têm uma. Quando ela devolver `duplicados`, diga quais são e pergunte se a pessoa quer criar assim mesmo; só depois de ela autorizar você chama de novo com `incluirDuplicados: true`. O mesmo vale para um imóvel só: existindo pendência parecida, pergunte antes de criar a segunda.",
    "· Fora o lote, um pedido é um cartão: prepare UMA ação por resposta. Se pediram várias coisas diferentes, faça a primeira e ofereça a próxima.",
    "· Só prepare quando tiver identificado o imóvel, a pendência ou o card certo. Na dúvida entre dois imóveis, pergunte qual — perguntar é diferente de recusar.",
    "",
    `Hoje é ${params.today}.`,
    params.currentPath ? `A pessoa está agora na tela: ${params.currentPath}` : "",
    "",
    "DOCUMENTAÇÃO DO SISTEMA (recuperada para esta pergunta)",
    params.knowledge,
  ]
    .filter(Boolean)
    .join("\n");
}

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AskInput.parse(i))
  .handler(async ({ data, context }): Promise<AssistantAsk> => {
    const db = context.supabase as unknown as AnyClient;
    const { accessiblePropertyIds } = await import("@/lib/dashboard.functions");
    const { retrieveSystemKnowledge, renderSystemDocs } =
      await import("@/lib/ai/system-knowledge.server");
    const { buildAssistantTools } = await import("@/lib/ai/assistant-tools.server");
    const { runAgent } = await import("@/lib/ai/gateway.server");

    // Thread: reaproveita a informada, senão abre uma nova. Uma por conversa;
    // o painel sempre continua a última.
    let threadId = data.threadId ?? null;
    if (threadId) {
      const { data: owned } = await db
        .from("assistant_threads")
        .select("id")
        .eq("id", threadId)
        .maybeSingle();
      if (!owned) threadId = null;
    }
    if (!threadId) {
      const { data: created, error } = await db
        .from("assistant_threads")
        .insert({ user_id: context.userId, title: data.message.slice(0, 80) })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      threadId = (created as { id: string }).id;
    }

    const [propertyIds, knowledge, history] = await Promise.all([
      accessiblePropertyIds(context.supabase as never, null, context.userId),
      retrieveSystemKnowledge({
        supabase: context.supabase as never,
        query: data.message,
        limit: 8,
      }),
      db
        .from("assistant_messages")
        .select("role, content")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: false })
        .limit(HISTORY_TURNS),
    ]);

    const past = ((history as { data?: Array<{ role: string; content: string }> }).data ?? [])
      .slice()
      .reverse();

    const prepared: { current: PendingAction | null } = { current: null };
    const tools = buildAssistantTools({
      supabase: context.supabase as never,
      userId: context.userId,
      propertyIds,
      prepared,
    });

    // Pedido de ação nunca roda no esforço mínimo: interpretar errado aqui
    // monta uma gravação errada para a pessoa confirmar.
    const effort = reasoningFor(data.message, { isAction: true });

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
      new Date(),
    );

    const run = await runAgent({
      task: "internal",
      instructions: instructions({
        knowledge: renderSystemDocs(knowledge.docs),
        currentPath: data.currentPath ?? null,
        today,
      }),
      input: [
        ...past.map((m) => ({ type: "message", role: m.role, content: m.content })),
        data.imageDataUrl
          ? {
              type: "message",
              role: "user",
              content: [
                { type: "input_text", text: data.message },
                { type: "input_image", image_url: data.imageDataUrl },
              ],
            }
          : { type: "message", role: "user", content: data.message },
      ],
      tools,
      // Mesma política de raciocínio do atendimento (ver src/lib/ai/reasoning.ts):
      // pensa de verdade quando a pergunta pede, e não gasta em "ok, obrigado".
      maxSteps: maxStepsFor(effort),
      reasoningEffort: effort,
    });

    // Fontes: os trechos que de fato entraram no prompt, mais as consultas de
    // dados que rodaram. É o que a pessoa vê abaixo da resposta — e o que
    // permite conferir de onde veio a informação.
    const KIND_LABEL: Record<string, string> = {
      guide: "guia",
      rule: "regra do sistema",
      route: "tela",
    };
    const sources: AssistantSource[] = knowledge.docs
      .slice(0, 3)
      .map((d) => ({ label: d.title.replace(/^Regra — /, ""), kind: KIND_LABEL[d.kind] ?? "doc" }));
    for (const call of run.toolCalls) {
      if (call.name.startsWith("preparar_")) continue;
      sources.push({ label: call.name.replace(/_/g, " "), kind: "consulta" });
    }

    const answer =
      run.text.trim() || "Não consegui responder agora. Tenta perguntar de outro jeito?";

    // Grava o par pergunta/resposta. A ação preparada vai no meta: é o registro
    // de que o sistema propôs aquilo, independente de a pessoa ter confirmado.
    const nowIso = new Date().toISOString();
    await db.from("assistant_messages").insert([
      {
        thread_id: threadId,
        user_id: context.userId,
        role: "user",
        content: data.message,
        meta: {},
      },
      {
        thread_id: threadId,
        user_id: context.userId,
        role: "assistant",
        content: answer,
        meta: {
          sources,
          pendingAction: prepared.current,
          tools: run.toolCalls.map((c) => c.name),
          usage: run.usage,
        },
      },
    ]);
    await db.from("assistant_threads").update({ updated_at: nowIso }).eq("id", threadId);

    /**
     * A preferência é lida DEPOIS do run, de propósito: a própria conversa
     * pode ter acabado de ligá-la (ver `definir_confirmacao_automatica`). Lida
     * antes, o "dispense a confirmação" só valeria a partir da mensagem
     * seguinte — e a pessoa veria um cartão logo depois de pedir para não ver
     * mais cartões.
     */
    const { data: prefRow } = await db
      .from("profiles")
      .select("assistant_auto_confirm")
      .eq("id", context.userId)
      .maybeSingle();
    const autoConfirm =
      (prefRow as { assistant_auto_confirm?: boolean } | null)?.assistant_auto_confirm === true;

    return {
      threadId,
      autoConfirm,
      message: {
        id: crypto.randomUUID(),
        role: "assistant",
        content: answer,
        createdAt: nowIso,
        sources,
        pendingAction: prepared.current,
      },
    };
  });

// ----- Histórico -----

const ThreadInput = z.object({ threadId: z.string().uuid().nullable().optional() }).optional();

export const listAssistantThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ThreadInput.parse(i) ?? {})
  .handler(
    async ({
      data,
      context,
    }): Promise<{ threadId: string | null; messages: AssistantMessage[] }> => {
      const db = context.supabase as unknown as AnyClient;

      let threadId = data.threadId ?? null;
      if (!threadId) {
        const { data: last } = await db
          .from("assistant_threads")
          .select("id")
          .order("updated_at", { ascending: false })
          .limit(1);
        threadId = (last?.[0] as { id: string } | undefined)?.id ?? null;
      }
      if (!threadId) return { threadId: null, messages: [] };

      const { data: rows } = await db
        .from("assistant_messages")
        .select("id, role, content, meta, created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true })
        .limit(60);

      const messages: AssistantMessage[] = (
        (rows ?? []) as Array<{
          id: string;
          role: string;
          content: string;
          meta: Record<string, unknown> | null;
          created_at: string;
        }>
      ).map((r) => ({
        id: r.id,
        role: r.role === "user" ? "user" : "assistant",
        content: r.content,
        createdAt: r.created_at,
        sources: (r.meta?.sources as AssistantSource[]) ?? [],
        // Ação preparada não sobrevive ao recarregar: os dados podem ter mudado
        // desde então, e confirmar às cegas uma proposta velha é como a pessoa
        // gravaria algo que já não faz sentido.
        pendingAction: null,
      }));

      return { threadId, messages };
    },
  );

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
