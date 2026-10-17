import type { SupabaseClient } from "@supabase/supabase-js";

/** Regras determinísticas para situações em que o modelo não pode decidir sozinho. */
export type GuestSafetyDecision =
  | { kind: "none"; reply: "" }
  | { kind: "credential_guidance"; reply: string }
  | { kind: "access_incident"; reply: string };

/**
 * NORMALIZAÇÃO (17/10/2026): todas as regras abaixo rodam sobre o texto sem
 * acento, minúsculo e com espaços colapsados. Antes, `\b` ao lado de letra
 * acentuada ("ninguém", "código") e mistura de "n[aã]o" deixavam variações
 * escaparem; e padrões largos ("estou na casa", "trancad[oa]" solto, "não tem
 * ninguém") geravam falsos positivos (hóspede DENTRO do imóvel, "tranquei a
 * casa", "não tem ninguém na piscina").
 */
function normalize(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const ITEM = "(?:porta|portao|portaria|fechadura|cadeado|cofre|caixinha|senha|codigo|pin|chave|tag|controle)";

const ACCESS_INCIDENT = new RegExp(
  "\\b(?:" +
    // posição física na entrada (NÃO "estou na casa/imóvel": isso é estar dentro)
    "estou (?:aqui )?(?:no|na|em frente (?:a|ao)|diante d[aeo]) (?:portao|porta|portaria|entrada|predio|condominio)|" +
    "estamos (?:aqui )?(?:no|na|em frente (?:a|ao)|diante d[aeo]) (?:portao|porta|portaria|entrada|predio|condominio)|" +
    "(?:estou|estamos) em frente (?:a|ao) (?:casa|imovel|apartamento)|" +
    // chegou e não conseguiu
    "(?:cheguei|chegamos)(?: aqui)?(?: e)? ?(?:mas )?nao (?:consigo|conseguimos|consegui|achei|achamos|encontro|encontramos)|" +
    "sem acesso|" +
    "nao (?:consigo|consegui|conseguimos) (?:entrar|acessar|abrir)|" +
    // item que não funciona
    ITEM + " (?:nao|n) (?:abre|abriu|funciona|funcionou|aceita|aceitou|da certo|deu certo|encontr\\w*)|" +
    // item que não acha
    "nao (?:encontro|encontrei|acho|achei|achamos|encontramos) (?:o |a )?(?:cadeado|cofre|chave|controle|tag|caixinha|portao|porta)|" +
    // trancado do lado de fora
    "(?:estou|estamos|fiquei|ficamos) trancad[oa]s?(?: do lado de fora| la fora| fora)?|" +
    "(?:porta|portao) (?:esta |ta )?trancad[oa]|" +
    // ninguém para receber
    "ninguem (?:me |nos )?(?:atendeu|recebeu|apareceu|abriu|esta aqui)|" +
    "nao (?:tem|ha) ninguem (?:aqui|para (?:me |nos )?(?:receber|atender|abrir))" +
    ")\\b",
);

const DEPARTURE = new RegExp(
  "\\b(?:ja (?:sai|saimos|fui embora|fomos embora|fiz (?:o )?check-? ?out)|fiz (?:o )?check-? ?out|estou indo embora|" +
    "deixei (?:a )?chave|deixamos (?:a )?chave|entreguei (?:a )?chave|chave (?:esta )?(?:no|na) (?:local|lugar|cofre|caixa)|" +
    "tranquei (?:a|o|tudo)|trancamos)\\b",
);

/** Hóspede relatando que JÁ SAIU (checkout), não que está sem acesso. */
export function isDepartureReport(message: string): boolean {
  return DEPARTURE.test(normalize(message));
}

const CREDENTIAL_REQUEST = new RegExp(
  "\\b(?:senha(?: d[oa])? (?:wi-? ?fi|wifi|portao|portaozinho|cadeado|cofre)|codigo(?: de| d[oa])? (?:acesso|portao|fechadura|cofre)|ver senha|qual (?:a )?senha|me (?:passa|manda|envia|informa) (?:a )?senha)\\b",
);

/**
 * Afirmações de AÇÃO REMOTA que a IA nunca pode fazer (ela não abre portões,
 * não valida códigos, não "libera" nada). Usado como filtro da resposta do
 * modelo no modo conversacional de incidente de acesso.
 */
const REMOTE_ACTION_CLAIM = new RegExp(
  "\\b(?:(?:acabei de|ja|vou|irei|estou) (?:abrir|abrindo|destravar|destravando|liberar|liberando|desbloquear|desbloqueando|acionar|acionando|resetar|resetando|validar|validando)|" +
    "(?:abri|destravei|liberei|desbloqueei|acionei|resetei|validei) (?:o |a |as |os )?(?:portao|porta|fechadura|cadeado|cofre|acesso|codigo|senha|trava)|" +
    "(?:portao|porta|fechadura) (?:foi|esta) (?:aberto|aberta|liberad[oa]|destravad[oa]) (?:por mim|remotamente)|" +
    "i (?:just )?(?:opened|unlocked|released) (?:the )?(?:gate|door|lock))\\b",
);

/** A resposta alega ação remota? Se sim, deve ser descartada. */
export function claimsRemoteAction(reply: string): boolean {
  return REMOTE_ACTION_CLAIM.test(normalize(reply));
}

/** Pedido de credencial (usado também para decidir a orientação de check-in). */
export function isCredentialRequest(message: string): boolean {
  return CREDENTIAL_REQUEST.test(normalize(message));
}

/** Mensagem relata incidente físico de acesso (já descartando relato de saída). */
export function isAccessIncident(message: string): boolean {
  const n = normalize(message);
  return ACCESS_INCIDENT.test(n) && !DEPARTURE.test(n);
}

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
  ctx?: { supabase: SupabaseClient; propertyId: string; stayOpen?: boolean },
): Promise<GuestSafetyDecision> {
  // Estadia em andamento (não "Não Compareceu"): pedido de senha/código é
  // respondido diretamente pela IA com os dados oficiais — nunca desviado.
  const n = normalize(message);
  if (ctx?.stayOpen && CREDENTIAL_REQUEST.test(n) && !ACCESS_INCIDENT.test(n)) {
    return { kind: "none", reply: "" };
  }
  const link = guideLink(propertySlug);
  // Saída concluída ("já saí e a casa está trancada", "deixei a chave") não é
  // incidente de acesso: deixa o modelo agradecer/confirmar (ou perguntar se ambíguo).
  if (ACCESS_INCIDENT.test(n) && !DEPARTURE.test(n)) {
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
  if (CREDENTIAL_REQUEST.test(n)) {
    return {
      kind: "credential_guidance",
      reply:
        `Para proteger seu acesso, não envio senhas ou códigos pelo chat. Abra [Ver senhas e códigos no guia](${link}) e siga as instruções de chegada mostradas ali — elas informam como o anfitrião libera a visualização.`,
    };
  }
  return { kind: "none", reply: "" };
}
