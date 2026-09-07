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
import type { AssistantAsk, AssistantMessage, AssistantSource, PendingAction } from "@/lib/assistant-types";

type AnyClient = { from: (t: string) => any };

/** Quantas mensagens anteriores voltam ao modelo — contexto sem inchar o custo. */
const HISTORY_TURNS = 10;

const AskInput = z.object({
  threadId: z.string().uuid().nullable().optional(),
  message: z.string().trim().min(1).max(2000),
  /** Rota em que a pessoa está — "onde eu marco isso?" depende disso. */
  currentPath: z.string().max(300).nullable().optional(),
});

function instructions(params: { knowledge: string; currentPath: string | null; today: string }): string {
  return [
    "Você é o Assistente do Painel do ConciergeIA — um sistema de gestão de imóveis de aluguel por temporada.",
    "Você atende quem OPERA o sistema: equipe, anfitriões e prestadores (limpeza, manutenção). Nunca hóspedes.",
    "",
    "COMO RESPONDER",
    "· Português do Brasil, direto, sem saudação e sem repetir a pergunta.",
    "· Curto por padrão. Detalhe só quando perguntarem o porquê de algo.",
    "· Ao explicar uma regra, use o racional da documentação abaixo com as palavras dela — é a decisão real que foi tomada, com data. Não reescreva o motivo por conta própria.",
    "· Se a documentação não cobre o que perguntaram, diga que não sabe e sugira quem pode saber. NUNCA invente como o sistema funciona.",
    "· Ao indicar onde fica algo, cite o nome que aparece no menu e o caminho.",
    "",
    "DADOS DA CONTA",
    "· Para qualquer pergunta sobre a operação real (limpezas, chegadas, pendências), use as ferramentas. Não estime.",
    "· Você só enxerga o que esta pessoa já podia ver. Se uma consulta voltar vazia, pode ser falta de permissão — diga isso em vez de afirmar que não existe.",
    "",
    "AÇÕES",
    "· Você NÃO grava nada. As ferramentas `preparar_*` apenas montam a ação para a pessoa confirmar na tela.",
    "· Depois de preparar, diga o que vai acontecer e peça a confirmação. Nunca diga que já foi feito.",
    "· Só prepare quando o pedido for claro e você tiver identificado o imóvel ou a pendência certa. Na dúvida entre dois imóveis, pergunte qual.",
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
    const { retrieveSystemKnowledge, renderSystemDocs } = await import("@/lib/ai/system-knowledge.server");
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
      retrieveSystemKnowledge({ supabase: context.supabase as never, query: data.message, limit: 8 }),
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

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

    const run = await runAgent({
      task: "internal",
      instructions: instructions({
        knowledge: renderSystemDocs(knowledge.docs),
        currentPath: data.currentPath ?? null,
        today,
      }),
      input: [
        ...past.map((m) => ({ type: "message", role: m.role, content: m.content })),
        { type: "message", role: "user", content: data.message },
      ],
      tools,
      maxSteps: 6,
      reasoningEffort: "low",
    });

    // Fontes: os trechos que de fato entraram no prompt, mais as consultas de
    // dados que rodaram. É o que a pessoa vê abaixo da resposta — e o que
    // permite conferir de onde veio a informação.
    const KIND_LABEL: Record<string, string> = { guide: "guia", rule: "regra do sistema", route: "tela" };
    const sources: AssistantSource[] = knowledge.docs
      .slice(0, 3)
      .map((d) => ({ label: d.title.replace(/^Regra — /, ""), kind: KIND_LABEL[d.kind] ?? "doc" }));
    for (const call of run.toolCalls) {
      if (call.name.startsWith("preparar_")) continue;
      sources.push({ label: call.name.replace(/_/g, " "), kind: "consulta" });
    }

    // Tela sugerida: a rota mais bem colocada entre os trechos recuperados.
    const routeDoc = knowledge.docs.find((d) => d.kind === "route");
    const route = routeDoc
      ? {
          path: routeDoc.docKey.replace(/^route:/, ""),
          label: routeDoc.title.replace(/ — tela .*$/, ""),
        }
      : null;

    const answer = run.text.trim() || "Não consegui responder agora. Tenta perguntar de outro jeito?";

    // Grava o par pergunta/resposta. A ação preparada vai no meta: é o registro
    // de que o sistema propôs aquilo, independente de a pessoa ter confirmado.
    const nowIso = new Date().toISOString();
    await db.from("assistant_messages").insert([
      { thread_id: threadId, user_id: context.userId, role: "user", content: data.message, meta: {} },
      {
        thread_id: threadId,
        user_id: context.userId,
        role: "assistant",
        content: answer,
        meta: {
          sources,
          route,
          pendingAction: prepared.current,
          tools: run.toolCalls.map((c) => c.name),
          usage: run.usage,
        },
      },
    ]);
    await db.from("assistant_threads").update({ updated_at: nowIso }).eq("id", threadId);

    return {
      threadId,
      message: {
        id: crypto.randomUUID(),
        role: "assistant",
        content: answer,
        createdAt: nowIso,
        sources,
        route,
        pendingAction: prepared.current,
      },
    };
  });

// ----- Histórico -----

const ThreadInput = z.object({ threadId: z.string().uuid().nullable().optional() }).optional();

export const listAssistantThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ThreadInput.parse(i) ?? {})
  .handler(async ({ data, context }): Promise<{ threadId: string | null; messages: AssistantMessage[] }> => {
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
      route: (r.meta?.route as AssistantMessage["route"]) ?? null,
      // Ação preparada não sobrevive ao recarregar: os dados podem ter mudado
      // desde então, e confirmar às cegas uma proposta velha é como a pessoa
      // gravaria algo que já não faz sentido.
      pendingAction: null,
    }));

    return { threadId, messages };
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
