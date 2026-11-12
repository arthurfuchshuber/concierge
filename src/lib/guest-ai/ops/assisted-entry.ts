/**
 * ENTRADA ASSISTIDA PELA EQUIPE (puro: sem banco, rede nem relógio). Caso Ary (12/11/2026).
 *
 * O hóspede avisou que chegou ao imóvel ("acabamos de chegar"), um atendente HUMANO liberou o acesso no chat
 * ("Aberto", "podem seguir com as demais orientações") e o hóspede respondeu sem relatar problema ("Perfeito",
 * "muito obrigado por tudo"). Ninguém escreveu "entramos", mas a entrada está consumada: é o mesmo fato que o
 * marco checkin_confirmed, só que distribuído em três mensagens. Este detector não depende do modelo: roda na
 * política em todo turno, como a concessão de late checkout da equipe.
 *
 * Travas (na dúvida, null): chegada declarada como fato e no imóvel (nada de aeroporto, bairro, a caminho);
 * liberação vinda da equipe (`speaker = team`) DEPOIS da chegada e em até 90 min; toda mensagem do hóspede depois
 * da última liberação sem pergunta, negação, dificuldade ou problema; ao menos uma resposta dele depois dela.
 * Dia do check-in, card pendente e reserva ativa ficam com `policy.ts`.
 */
import { normalizeText } from "./lexical";

export interface AssistedEntryHistoryEntry {
  messageId: string;
  speaker: string;
  text: string;
  at: string;
}

/** Janela máxima entre o aviso de chegada e a liberação da equipe. */
export const ASSISTED_ENTRY_WINDOW_MS = 90 * 60 * 1000;
/** A liberação precisa ser recente em relação ao turno avaliado. */
export const ASSISTED_ENTRY_LOOKBACK_MS = 6 * 3600 * 1000;

const W = (words: string[]) => new RegExp(`(?:^|[^a-z0-9'])(?:${words.join("|")})(?=$|[^a-z0-9'])`);

const ARRIVAL = W([
  "chegamos",
  "cheguei",
  "acabamos de chegar",
  "acabei de chegar",
  "ja chegamos",
  "ja cheguei",
  "estamos (?:aqui )?(?:na|em frente a|em frente da|diante da) (?:porta|casa|frente|entrada|portao)",
  "estou (?:aqui )?(?:na|em frente a|em frente da|diante da) (?:porta|casa|frente|entrada|portao)",
  "estamos aqui",
  "estou aqui",
  "we arrived",
  "we(?:'re| are) here",
  "i(?:'m| am) here",
  "just arrived",
  "llegamos",
  "ya llegamos",
  "estamos aca",
]);
/** Chegada que NÃO é no imóvel (ou não é chegada): aeroporto, cidade, a caminho… */
const ARRIVAL_ELSEWHERE = W([
  "aeroporto",
  "rodoviaria",
  "cidade",
  "bairro",
  "hotel",
  "uber",
  "taxi",
  "caminho",
  "estrada",
  "pousamos",
  "pousou",
  "airport",
  "city",
  "on (?:the|our) way",
  "aeropuerto",
]);
const NOT_FACT = W([
  "nao",
  "ainda",
  "quando",
  "assim que",
  "se",
  "caso",
  "vamos",
  "iremos",
  "vou",
  "talvez",
  "not",
  "yet",
  "when",
  "once",
  "if",
  "will",
  "cuando",
  "todavia",
]);
const RELEASE = W([
  "aberto",
  "aberta",
  "abri",
  "abrimos",
  "abri a porta",
  "abrimos a porta",
  "liberad[oa]",
  "liberei",
  "liberamos",
  "pode(?:m)? entrar",
  "pode(?:m)? subir",
  "pode(?:m)? seguir",
  "basta seguir",
  "porta (?:ja )?(?:esta )?destravada",
  "destravad[oa]",
  "it's open",
  "it is open",
  "door is open",
  "you can (?:come|go) in",
  "abierto",
  "abierta",
  "pueden entrar",
]);
const RELEASE_BLOCK = W([
  "nao",
  "ainda",
  "se",
  "caso",
  "quando",
  "assim que",
  "aguard[a-z]*",
  "verific[a-z]*",
  "chamado",
  "not",
  "if",
  "when",
  "wait",
]);
/** Resposta do hóspede depois da liberação que derruba a entrada (dúvida, dificuldade, negação). */
const GUEST_TROUBLE = W([
  "nao",
  "ainda",
  "nem",
  "problema",
  "errad[ao]s?",
  "travou",
  "travad[ao]",
  "trancad[ao]s?",
  "ajuda",
  "socorro",
  "fechad[ao]",
  "not",
  "yet",
  "problem",
  "wrong",
  "stuck",
  "locked",
  "help",
  "closed",
  "no funciona",
  "no abre",
  "ayuda",
]);

function sentences(text: string): string[] {
  return normalizeText(text)
    .split(/(?<=[.!?;\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "chegamos em/no/na <lugar>": só vale se o lugar for o próprio imóvel. */
const ARRIVAL_PLACE = /cheg(?:amos|uei|ar) (?:em|no|na|ao|a) ([a-z]+)/;
const PROPERTY_PLACES = new Set(["casa", "porta", "frente", "entrada", "imovel", "apartamento", "ap", "apto", "predio", "portao", "local", "endereco", "studio", "estudio"]);

function isArrival(text: string): boolean {
  return sentences(text).some((s) => {
    if (s.includes("?") || !ARRIVAL.test(s) || ARRIVAL_ELSEWHERE.test(s) || NOT_FACT.test(s)) return false;
    const place = ARRIVAL_PLACE.exec(s);
    return !place || PROPERTY_PLACES.has(place[1]!);
  });
}

function isRelease(text: string): boolean {
  return sentences(text).some((s) => !s.includes("?") && RELEASE.test(s) && !RELEASE_BLOCK.test(s));
}

function isTrouble(text: string): boolean {
  const t = normalizeText(text);
  return t.includes("?") || GUEST_TROUBLE.test(t);
}

/**
 * Entrada consumada com ajuda da equipe? Devolve a mensagem do hóspede que fecha o ciclo (primeira resposta dele
 * depois da última liberação) ou `null`.
 */
export function detectStaffAssistedEntry(
  history: readonly AssistedEntryHistoryEntry[],
  opts: { now: Date },
): { messageId: string; releaseMessageId: string; arrivalMessageId: string } | null {
  const nowMs = opts.now.getTime();
  // última liberação da equipe (a palavra mais recente da equipe sobre o acesso é a que vale)
  let r = -1;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const e = history[i]!;
    if (e.speaker !== "team") continue;
    const at = Date.parse(e.at);
    if (!Number.isFinite(at) || at > nowMs) continue;
    if (nowMs - at > ASSISTED_ENTRY_LOOKBACK_MS) break;
    if (isRelease(e.text)) {
      r = i;
      break;
    }
  }
  if (r < 0) return null;
  const release = history[r]!;
  const releaseAt = Date.parse(release.at);

  // aviso de chegada do hóspede ANTES da liberação, dentro da janela
  let arrival: AssistedEntryHistoryEntry | null = null;
  for (let i = r - 1; i >= 0; i -= 1) {
    const e = history[i]!;
    const at = Date.parse(e.at);
    if (!Number.isFinite(at)) continue;
    if (releaseAt - at > ASSISTED_ENTRY_WINDOW_MS) break;
    if (e.speaker === "guest" && isArrival(e.text)) {
      arrival = e;
      break;
    }
  }
  if (!arrival) return null;

  // respostas do hóspede depois da liberação: ao menos uma, nenhuma com dúvida ou dificuldade
  const after = history.slice(r + 1).filter((e) => e.speaker === "guest");
  if (after.length === 0) return null;
  if (after.some((e) => isTrouble(e.text))) return null;
  // foto sem texto não confirma nada sozinha: precisa de ao menos uma resposta escrita
  const firstWritten = after.find((e) => normalizeText(e.text).replace(/\[[^\]]*\]/g, "").trim().length > 0);
  if (!firstWritten) return null;
  return { messageId: firstWritten.messageId, releaseMessageId: release.messageId, arrivalMessageId: arrival.messageId };
}
