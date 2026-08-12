import type { SupabaseClient } from "@supabase/supabase-js";

/** Regras determinísticas para situações em que o modelo não pode decidir sozinho. */
export type GuestSafetyDecision =
  | { kind: "none"; reply: "" }
  | { kind: "credential_guidance"; reply: string }
  | { kind: "access_incident"; reply: string };

const ACCESS_INCIDENT =
  /\b(estou (?:no|na|em frente (?:a|à)|diante (?:d[eo])?) (?:port[aã]o|porta|casa|imóvel|endere[cç]o)|cheguei(?: e)?\s*(?:mas\s*)?n[aã]o consigo|entrei(?: e)?\s*(?:mas\s*)?n[aã]o consigo|sem acesso|n[aã]o consigo (?:entrar|acessar|abrir)|(?:porta|port[aã]o|fechadura|cadeado(?:-?cofre)?|cofre|senha|c[oó]digo|pin|chave|tag)\s*(?:n[aã]o|nao)\s*(?:abre|abriu|funciona|aceita|encontr\w*)|n[aã]o (?:encontro|acho) (?:o |a )?(?:cadeado|cofre|chave|controle|tag)|trancad[oa]|ningu[eé]m (?:me )?(?:atendeu|recebeu|est[aá] aqui|apareceu)|n[aã]o (?:tem|h[aá]) ningu[eé]m)\b/i;

const CREDENTIAL_REQUEST =
  /\b(senha(?: do)? (?:wi-?fi|port[aã]o|port[aã]ozinho|cadeado|cofre)|c[oó]digo(?: de)? (?:acesso|port[aã]o|fechadura|cofre)|pin|ver senha|qual (?:a )?senha)\b/i;

/** Palavras que indicam que um item do manual/FAQ trata de chegada/acesso (não do conteúdo em si, só do título). */
const ARRIVAL_KEYWORDS = ["acesso", "chave", "chegada", "chegar", "entrada", "port", "cadeado", "cofre", "fechadura"];

function guideLink(slug: string): string {
  return `/g/${encodeURIComponent(slug)}#senhas-acesso`;
}

/**
 * Remove qualquer trecho que pareça senha/código (letra + número colados, 4+ caracteres).
 * Defesa extra: mesmo indicando só TÍTULOS de itens do manual/FAQ (nunca o corpo/resposta),
 * um anfitrião pode ter escrito o próprio código no título por engano.
 */
function scrubPossibleCode(text: string): string {
  return text.replace(/\b(?=\w*[a-zA-Z])(?=\w*\d)\w{4,}\b/g, "•••");
}

/**
 * Busca, sem LLM e sem revelar conteúdo sensível, se o anfitrião já documentou um
 * procedimento de chegada para este imóvel — só para apontar o hóspede ao item certo
 * dentro do guia, nunca para substituir a leitura dele.
 */
async function findArrivalPointers(supabase: SupabaseClient, propertyId: string): Promise<string[]> {
  try {
    const [manualR, faqsR] = await Promise.all([
      supabase.from("property_manual_items").select("title").eq("property_id", propertyId).limit(30),
      supabase.from("property_faqs").select("question").eq("property_id", propertyId).limit(30),
    ]);
    const candidates: string[] = [
      ...((manualR.data ?? []) as Array<{ title: string | null }>).map((r) => r.title ?? ""),
      ...((faqsR.data ?? []) as Array<{ question: string | null }>).map((r) => r.question ?? ""),
    ].filter(Boolean);
    const matches = candidates.filter((t) => ARRIVAL_KEYWORDS.some((k) => t.toLowerCase().includes(k)));
    return [...new Set(matches)].slice(0, 3).map(scrubPossibleCode);
  } catch (err) {
    console.error("[ai] findArrivalPointers falhou", err);
    return [];
  }
}

export async function guestSafetyDecision(
  message: string,
  propertySlug: string,
  ctx?: { supabase: SupabaseClient; propertyId: string },
): Promise<GuestSafetyDecision> {
  const link = guideLink(propertySlug);
  if (ACCESS_INCIDENT.test(message)) {
    let pointers = "";
    if (ctx) {
      const found = await findArrivalPointers(ctx.supabase, ctx.propertyId);
      if (found.length) {
        pointers =
          `\n\nO anfitrião já deixou instruções sobre isso no guia: ${found.map((f) => `"${f}"`).join(", ")}. ` +
          `Abra o guia para ver o passo a passo completo.`;
      }
    }
    return {
      kind: "access_incident",
      reply:
        `Entendi que você está sem acesso. Eu não consigo abrir portões, confirmar abertura remota ou validar códigos pelo chat. Consulte [Chegada e senhas de acesso](${link}) e siga as instruções de check-in exibidas ali; a equipe responsável acompanhará esta ocorrência por aqui.${pointers}`,
    };
  }
  if (CREDENTIAL_REQUEST.test(message)) {
    return {
      kind: "credential_guidance",
      reply:
        `Para proteger seu acesso, não envio senhas ou códigos pelo chat. Abra [Ver senhas e códigos no guia](${link}) e siga as instruções de chegada mostradas ali — elas informam como o anfitrião libera a visualização.`,
    };
  }
  return { kind: "none", reply: "" };
}
