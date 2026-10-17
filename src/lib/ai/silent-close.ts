/**
 * ENCERRAMENTO POR SILÊNCIO (pedido explícito, 16/10/2026; calibrado 17/10).
 *
 * Hóspede confirma que um passo da entrada (ou da saída) deu certo, a IA
 * responde com o próximo passo e ele some. Passados 10 min sem nova fala, a
 * IA PERGUNTA se deu tudo certo (acesso / saída), deixa a porta aberta e
 * deseja boa estadia/viagem, e dá a baixa no painel. Sem emoji fixo: o texto
 * evita aberturas e emojis já usados com o mesmo hóspede.
 */
export const SILENT_CLOSE_AFTER_MS = 10 * 60 * 1000;

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const NEG = /\b(nao|nem|ainda nao|sem sucesso|nada)\b/;
const PLAN = /\b(amanha|mais tarde|depois|vou sair|vamos sair|vou fazer|pretendo)\b/;

/** O hóspede disse que um passo da ENTRADA funcionou? */
export function isEntryProgress(msg: string): boolean {
  const t = norm(msg);
  if (!t || NEG.test(t)) return false;
  return /\b(deu certo|funcionou|consegui|conseguimos|abriu|abri|abrimos|peguei|pegamos|achei|encontrei|entrei|entramos|acessei|estou dentro|estamos dentro)\b/.test(t);
}

/** O hóspede disse que está saindo / saiu / deixou a chave? */
export function isCheckoutProgress(msg: string): boolean {
  const t = norm(msg);
  if (!t || NEG.test(t) || PLAN.test(t)) return false;
  return /\b(ja sai|ja saimos|saimos|estamos saindo|estou saindo|deixei a chave|deixamos a chave|fiz o checkout|fizemos o checkout|check ?out feito|chave no cofre|fechei a porta|trancamos|tranquei)\b/.test(t);
}

/** Primeiro nome limpo para a saudação. */
export function firstName(name: string | null | undefined): string {
  const f = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!f || /^h[oó]spede$/i.test(f) || /teste/i.test(f)) return "";
  return f.charAt(0).toUpperCase() + f.slice(1).toLowerCase();
}

const EMOJIS = ["💜", "✨", "😊", "🙌", "🏡", ""];
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

const CHECKIN = [
  (n: string) => `${n ? `${n}, ` : ""}deu tudo certo com a sua entrada? Conseguiu acessar e se acomodar bem? Se algo não estiver como esperado, me conta por aqui que a gente resolve. Excelente estadia!`,
  (n: string) => `Oi${n ? `, ${n}` : ""}! Conseguiu entrar no imóvel tranquilamente? Me diz se encontrou tudo em ordem; qualquer detalhe, é só avisar. Aproveite a estadia!`,
  (n: string) => `${n ? `${n}, ` : ""}o acesso funcionou e você já está instalado? Se notar qualquer coisa fora do lugar, nos avise logo para ajudarmos. Ótima estadia!`,
  (n: string) => `E aí${n ? `, ${n}` : ""}, tudo certo por aí? Conseguiu entrar e o imóvel está como esperava? Fico à disposição para o que precisar. Boa estadia!`,
];

const CHECKOUT = [
  (n: string) => `${n ? `${n}, ` : ""}deu tudo certo na saída? Conseguiu fechar tudo e deixar a chave certinho? Obrigado pela estadia, foi um prazer receber você. Boa viagem!`,
  (n: string) => `Oi${n ? `, ${n}` : ""}! A saída correu bem? Se ficou alguma dúvida sobre chave ou porta, me avisa. Muito obrigado pela hospedagem e boa viagem!`,
  (n: string) => `${n ? `${n}, ` : ""}conseguiu finalizar o check-out sem problemas? Qualquer detalhe, é só falar. Foi ótimo ter você conosco, até a próxima!`,
];

/**
 * Texto de encerramento. `previousAi` = falas anteriores da IA com este hóspede:
 * escolhe a variante cuja abertura e emoji ainda não foram usados.
 */
export function silentCloseText(
  kind: "checkin" | "checkout",
  name: string | null | undefined,
  previousAi: string[] = [],
  seed = 0,
): string {
  const n = firstName(name);
  const pool = kind === "checkin" ? CHECKIN : CHECKOUT;
  const used = norm(previousAi.join(" \n "));
  const usedEmojis = new Set(previousAi.join(" ").match(EMOJI_RE) ?? []);
  const ordered = pool.map((_, i) => pool[(i + seed) % pool.length]!);
  const fresh = ordered.find((f) => {
    const opening = norm(f(n)).split(/[?!.]/)[0]!.split(" ").slice(0, 4).join(" ");
    return !used.includes(opening);
  });
  const base = (fresh ?? ordered[0]!)(n);
  const emoji = EMOJIS.find((e, i) => i >= seed % EMOJIS.length && (e === "" || !usedEmojis.has(e)))
    ?? EMOJIS.find((e) => e === "" || !usedEmojis.has(e)) ?? "";
  return emoji ? `${base} ${emoji}` : base;
}
