/**
 * TRAVAS DE CONTEXTO DAS VARREDURAS PROATIVAS (17/10/2026, decisão do anfitrião).
 *
 * 1) Pausa humana vencida: a IA só retoma se a mensagem pendente do hóspede for
 *    uma dúvida cuja resposta está EXPLÍCITA no cadastro do imóvel no sistema
 *    (todas as áreas, não só o guia) e não tiver relação com o assunto que a
 *    equipe está tratando. Na dúvida, não retoma (fail-closed).
 * 2) Checagem de resolução: só pergunta se a IA deu um passo prático para o
 *    hóspede testar, e a pergunta cita o problema concreto. Sem contexto, nada.
 */
type Admin = any;

type Msg = { role: string; sender_type?: string | null; content: string | null };

function transcript(list: Msg[]): string {
  return list
    .map((m) => {
      const who = m.role === "user" ? "Hóspede" : m.sender_type === "human" ? "Equipe (humano)" : "IA";
      return `${who}: ${(m.content ?? "").slice(0, 600)}`;
    })
    .join("\n");
}

async function propertyKnowledge(admin: Admin, propertyId: string): Promise<string | null> {
  const { data: prop } = await admin.from("properties").select("*").eq("id", propertyId).maybeSingle();
  if (!prop) return null;
  const { buildAgentContext } = await import("./context.server");
  const ctx = await buildAgentContext({ supabase: admin, property: prop, guestName: null, memory: null });
  const { data: raw } = await admin
    .from("property_listing_raw_data")
    .select("normalized")
    .eq("property_id", propertyId)
    .maybeSingle();
  const listing = raw?.normalized ? `\n\n## Anúncio (Airbnb)\n${JSON.stringify(raw.normalized).slice(0, 12000)}` : "";
  return `${ctx.text}${listing}`.slice(0, 40000);
}

/** Pode a IA retomar após a pausa humana vencida? Fail-closed. */
export async function canResumeAfterPause(admin: Admin, conversationId: string, propertyId: string): Promise<boolean> {
  try {
    const { data: msgs } = await admin
      .from("property_chat_messages")
      .select("role, sender_type, content, created_at")
      .eq("conversation_id", conversationId)
      .not("is_internal_note", "is", true)
      .order("created_at", { ascending: false })
      .limit(14);
    const list = ((msgs ?? []) as Msg[]).reverse();
    if (!list.length || list[list.length - 1]!.role !== "user") return false;
    const knowledge = await propertyKnowledge(admin, propertyId);
    if (!knowledge) return false;
    const { chatJson } = await import("./gateway.server");
    const { data } = await chatJson<{ explicit_answer: boolean; tied_to_human_case: boolean }>("validation", [
      {
        role: "system",
        content:
          "Você decide se uma IA de hospedagem pode retomar uma conversa que a EQUIPE HUMANA assumiu. " +
          "Responda JSON {\"explicit_answer\": boolean, \"tied_to_human_case\": boolean}. " +
          "explicit_answer = true SOMENTE se TODAS as perguntas pendentes do hóspede (mensagens após a última fala da equipe/IA) " +
          "têm resposta literal e explícita no CADASTRO DO IMÓVEL abaixo. Dedução, suposição ou 'provavelmente' = false. " +
          "tied_to_human_case = true se a mensagem continua, cobra ou depende do assunto que a equipe humana está tratando " +
          "(pedidos, exceções, autorizações, manutenção, negociação, retorno prometido) ou se é apenas reação/agradecimento.\n\n" +
          `# CADASTRO DO IMÓVEL\n${knowledge}`,
      },
      { role: "user", content: `# CONVERSA (mais antiga → mais recente)\n${transcript(list)}` },
    ]);
    return data?.explicit_answer === true && data?.tied_to_human_case === false;
  } catch (e) {
    console.error("[resume-gate] falhou", conversationId, e);
    return false;
  }
}

/**
 * Pergunta contextual de resolução, ou null quando o contexto não pede.
 * `recentAi` evita repetir frases/emojis já usados com este hóspede.
 */
export async function contextualResolutionQuestion(
  list: Msg[],
  guestFirstName: string,
): Promise<string | null> {
  try {
    const { chatJson } = await import("./gateway.server");
    const { data } = await chatJson<{ ask: boolean; question: string }>("validation", [
      {
        role: "system",
        content:
          "Você revisa uma conversa entre IA de hospedagem e hóspede. Responda JSON {\"ask\": boolean, \"question\": string}. " +
          "ask = true SOMENTE se o hóspede relatou um PROBLEMA prático no imóvel (algo não funciona, não acha, não abre etc.) " +
          "e a última fala da IA deu um passo concreto para ele testar/fazer. Perguntas informativas, recomendações, " +
          "conversa social, agradecimentos ou assuntos encerrados = false. " +
          "Se ask = true, escreva em pt-BR UMA pergunta curta e natural citando o problema concreto (ex.: o Wi-Fi, o chuveiro), " +
          (guestFirstName ? `podendo usar o nome ${guestFirstName}, ` : "") +
          "oferecendo ajuda se não resolveu. Não repita palavras, aberturas ou emojis já usados pela IA na conversa; emoji é opcional. " +
          "Sem promessas de ação, sem prazos.",
      },
      { role: "user", content: transcript([...list].reverse()) },
    ]);
    const q = (data?.question ?? "").trim();
    return data?.ask === true && q ? q : null;
  } catch (e) {
    console.error("[resolution-gate] falhou", e);
    return null;
  }
}
