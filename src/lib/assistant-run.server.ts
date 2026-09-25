/**
 * O TURNO DO ASSISTENTE DO PAINEL — um lugar só, dois caminhos de entrega.
 *
 * Até 20/09/2026 toda a lógica morava dentro da server function `askAssistant`,
 * que só devolve alguma coisa quando o turno inteiro termina. Numa pergunta
 * comum isso eram 90 segundos de "pensando…" com a tela parada — não porque o
 * modelo seja lento, mas porque ninguém via nada até o fim.
 *
 * Agora o turno vive aqui e aceita um ouvinte (`onEvent`):
 *
 *   · a rota SSE (`/api/assistant-stream`) escuta e repassa etapa por etapa e
 *     palavra por palavra — é o caminho normal do painel;
 *   · a server function `askAssistant` chama sem ouvinte e continua devolvendo
 *     a resposta pronta — é a reserva de quando o streaming não sobe.
 *
 * As duas rodam exatamente o mesmo código, com o mesmo cliente do usuário e o
 * mesmo RLS. Não existe caminho de escrita paralelo.
 */
import type { AssistantAsk, AssistantSource, PendingAction } from "@/lib/assistant-types";
import type { AssistantAskData, AssistantEvent } from "@/lib/assistant-run.shared";
import { HOUSE_RULES } from "@/lib/ai/house-rules";
import { looksLikeAction, maxStepsFor, reasoningFor } from "@/lib/ai/reasoning";

type AnyClient = { from: (t: string) => any };

/** Quantas mensagens anteriores voltam ao modelo — contexto sem inchar o custo. */
const HISTORY_TURNS = 10;

/** Nome da ferramenta → o que dizer para quem está esperando. */
function stageLabel(tool: string): string {
  if (tool.startsWith("preparar_")) return "Montando a ação";
  const map: Record<string, string> = {
    listar_pendencias: "Consultando pendências",
    listar_imoveis: "Olhando os imóveis",
    agenda_do_dia: "Consultando a agenda",
    listar_reservas: "Olhando as reservas",
    listar_registros: "Olhando os registros",
  };
  return map[tool] ?? `Consultando ${tool.replace(/_/g, " ")}`;
}

function instructions(params: {
  knowledge: string;
  currentPath: string | null;
  today: string;
  attachment: AssistantAskData["attachment"];
}): string {
  const TIPO: Record<string, string> = {
    photo: "foto",
    video: "vídeo",
    audio: "áudio",
    file: "arquivo",
  };
  const a = params.attachment;
  const anexo = a
    ? `ARQUIVO ANEXADO A ESTA MENSAGEM: ${TIPO[a.kind] ?? "arquivo"} "${a.name}" (${a.mime}, ${(a.sizeBytes / 1_000_000).toFixed(1)} MB). Ele ainda está no aparelho da pessoa e só sobe quando ela confirmar a ação.`
    : "";
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
    "· ARQUIVO ANEXADO: quando a mensagem vier com um arquivo (a ficha dele aparece abaixo), você CONSEGUE anexá-lo a uma estadia ou a uma limpeza. Descubra o imóvel (`listar_imoveis`) e a estadia (`agenda` para os próximos dias, `reservas_do_imovel` para o que já passou) e chame `preparar_anexar_midia`. Nunca responda que não dá para anexar pelo chat, e nunca mande a pessoa fazer isso pela tela sem ter tentado.",
    "· O que você NUNCA altera é a reserva em si (datas, hóspede, status): ela vem sincronizada do canal. Anexar registro, criar pendência e mover a esteira não são alteração de reserva — isso você faz.",
    "· Diante de um pedido de ação, sua postura padrão é EXECUTAR, não explicar como se faz. Só explique o caminho na tela se a pessoa pedir o caminho.",
    "· ENTENDER ANTES DE SUGERIR: em pedido aberto ou ambíguo (imóvel não identificado, período não dito, qual estadia, o que exatamente registrar), faça 1 ou 2 perguntas curtas e objetivas antes de propor ou preparar qualquer coisa. Nunca chute o imóvel nem a estadia. Se a mensagem já traz tudo, não pergunte: execute.",
    "· RESOLVER AMBIGUIDADE (imóvel, hóspede, reserva, prestador, proprietário citados de forma vaga): passe para a busca as palavras como a pessoa escreveu, incluindo nome do proprietário, rua ou bairro (`listar_imoveis` busca tudo isso e tolera erro de digitação). 1 resultado provável → siga e diga qual entendeu (\"Entendi como Residência Florata, do Arthur\"). 2 a 5 → pergunte numa frase curta qual é, citando as opções. 0 → mostre as `sugestoes` ou pergunte o nome cadastrado, bairro ou proprietário. No máximo 2 buscas pela mesma coisa antes de perguntar; nunca repita a mesma busca e nunca desista sem uma pergunta.",
    "· Você tem ferramentas para: criar pendência (com prazo, recorrência em dias e a chave de mostrar/ocultar na limpeza), criar a MESMA pendência em vários imóveis de uma vez, concluir, arquivar e reabrir pendência, definir ou limpar data/horário previstos de chegada e de saída, avançar o card na esteira (check-in, encerrar estadia, confirmar checkout, concluir limpeza) e marcar não comparecimento.",
    "· NUNCA responda 'não consigo' sem ter tentado a ferramenta. Quem decide o que cada pessoa pode fazer é o sistema — as consultas respeitam a permissão dela e a gravação passa pela mesma checagem da tela. Recusar por conta própria nega à pessoa algo que ela talvez pudesse fazer.",
    "· Se uma ferramenta devolver `erro`, diga exatamente o que o erro diz. Isso é diferente de 'não consigo': é o sistema respondendo.",
    "· Se o que pediram realmente não tem ferramenta, não pare aí: diga em uma linha o que falta e aponte a tela onde a pessoa consegue fazer.",
    "· Você não grava: as ferramentas `preparar_*` montam a ação e a interface executa. Depois de preparar, diga o que vai acontecer — nunca diga que já foi feito.",
    "· QUEM DECIDE SE HÁ CARTÃO DE CONFIRMAÇÃO É A PESSOA, NÃO VOCÊ. Se ela pedir para dispensar a confirmação, parar de perguntar, confiar em você ou agir direto, chame `definir_confirmacao_automatica` com ativa=true — e fica valendo para as próximas conversas dela. Pedindo o contrário, chame com ativa=false. É PROIBIDO responder que 'não dá para dispensar a confirmação': dá, e a ferramenta está aí.",
    "· Nunca descreva o cartão de confirmação como obrigatório. Com a confirmação automática ligada ele não aparece — então não escreva 'confirme no cartão'; diga o que a ação faz e siga.",
    "· PEDIDO QUE COBRE VÁRIAS PENDÊNCIAS ('remova todas', 'apague as que você criou', 'arquive as de limpeza') usa `preparar_acao_em_lote_pendencias` — UM cartão para a lista inteira. ARQUIVAR tira da lista e mantém a linha; EXCLUIR apaga de vez. Se a pessoa disser 'excluir', 'apagar', 'remover de vez' ou '100%', é EXCLUIR — não ofereça arquivar como se fosse a mesma coisa, e nunca diga que só consegue arquivar.",
    "· Antes de uma exclusão, diga QUANTAS e QUAIS serão apagadas e que não tem desfazer. Depois disso é a pessoa quem decide — não insista nem proponha arquivar no lugar.",
    "· PEDIDO QUE COBRE VÁRIOS IMÓVEIS ('em todos os imóveis', 'em todos os studios', 'nos imóveis do proprietário X') usa `preparar_criar_pendencia_em_lote` — UM cartão para a lista inteira. É PROIBIDO fazer um imóvel por vez pedindo confirmação a cada um: isso transforma um pedido de dez segundos em vinte confirmações.",
    "· ANTES DE DUPLICAR, PERGUNTE. A ferramenta de lote já verifica pendências parecidas e deixa de fora os imóveis que já têm uma. Quando ela devolver `duplicados`, diga quais são e pergunte se a pessoa quer criar assim mesmo; só depois de ela autorizar você chama de novo com `incluirDuplicados: true`. O mesmo vale para um imóvel só: existindo pendência parecida, pergunte antes de criar a segunda.",
    "· Fora o lote, um pedido é um cartão: prepare UMA ação por resposta. Se pediram várias coisas diferentes, faça a primeira e ofereça a próxima.",
    "· Só prepare quando tiver identificado o imóvel, a pendência ou o card certo. Na dúvida entre dois imóveis, pergunte qual — perguntar é diferente de recusar.",
    "",
    `Hoje é ${params.today}.`,
    params.currentPath ? `A pessoa está agora na tela: ${params.currentPath}` : "",
    anexo,
    "",
    "DOCUMENTAÇÃO DO SISTEMA (recuperada para esta pergunta)",
    params.knowledge,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runAssistantTurn(params: {
  supabase: unknown;
  userId: string;
  data: AssistantAskData;
  onEvent?: (event: AssistantEvent) => void;
  signal?: AbortSignal;
}): Promise<AssistantAsk> {
  const { data, userId } = params;
  const db = params.supabase as unknown as AnyClient;
  const emit = (e: AssistantEvent) => {
    try {
      params.onEvent?.(e);
    } catch {
      /* quem escuta pode ter fechado a aba — nunca derruba o turno */
    }
  };

  const { accessiblePropertyIds } = await import("@/lib/dashboard.functions");
  const { retrieveSystemKnowledge, renderSystemDocs } = await import(
    "@/lib/ai/system-knowledge.server"
  );
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
      .insert({ user_id: userId, title: data.message.slice(0, 80) })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    threadId = (created as { id: string }).id;
  }

  emit({ type: "stage", label: "Lendo a documentação do sistema" });

  const [propertyIds, knowledge, history] = await Promise.all([
    accessiblePropertyIds(params.supabase as never, null, userId),
    retrieveSystemKnowledge({
      supabase: params.supabase as never,
      query: data.message,
      limit: 6,
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
  const baseTools = buildAssistantTools({
    supabase: params.supabase as never,
    userId,
    propertyIds,
    prepared,
    attachment: data.attachment ?? null,
  });
  // Cada ferramenta avisa antes de rodar: é isso que troca o "pensando…" mudo
  // por "consultando pendências" na tela de quem espera.
  const tools = baseTools.map((t) => ({
    ...t,
    execute: async (args: Record<string, unknown>) => {
      emit({ type: "stage", label: stageLabel(t.name) });
      return t.execute(args);
    },
  }));

  /**
   * ESFORÇO NA MEDIDA DA PERGUNTA (20/09/2026).
   *
   * Aqui estava fixo `isAction: true`, o que forçava o topo do raciocínio em
   * TODA mensagem do painel — inclusive "como faço para anexar um vídeo?",
   * que levou 90 segundos. Agora quem decide é o que a mensagem escreve: pedido
   * de ação, dinheiro, hóspede ou julgamento continuam no máximo; pergunta
   * informativa roda em "alto", que responde igual e chega bem antes.
   */
  // Mensagem com arquivo anexado é pedido de ação por definição: vai virar
  // registro no imóvel de alguém, então o raciocínio não desce.
  const effort = reasoningFor(data.message, {
    isAction: looksLikeAction(data.message) || Boolean(data.attachment),
  });

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    new Date(),
  );

  const run = await runAgent({
    task: "internal",
    instructions: instructions({
      knowledge: renderSystemDocs(knowledge.docs),
      currentPath: data.currentPath ?? null,
      today,
      attachment: data.attachment ?? null,
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
    maxSteps: maxStepsFor(effort),
    reasoningEffort: effort,
    signal: params.signal,
    onTextDelta: params.onEvent ? (text, step) => emit({ type: "delta", text, step }) : undefined,
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
    run.text.trim() ||
    "Não achei o que você pediu com essas informações. Pode me dizer o nome do imóvel como está cadastrado, o bairro ou o nome do proprietário?";

  // Grava o par pergunta/resposta. A ação preparada vai no meta: é o registro
  // de que o sistema propôs aquilo, independente de a pessoa ter confirmado.
  const nowIso = new Date().toISOString();
  await db.from("assistant_messages").insert([
    {
      thread_id: threadId,
      user_id: userId,
      role: "user",
      content: data.message,
      meta: {},
    },
    {
      thread_id: threadId,
      user_id: userId,
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
    .eq("id", userId)
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
}
