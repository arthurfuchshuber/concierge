/**
 * FORMATAÇÃO POR CANAL do texto sugerido pelo Copiloto (Pilar 3, 06/11/2026) — puro e determinístico.
 *
 * O System Prompt já pede o formato certo; isto é a rede de segurança de FORMA (não de conteúdo): nada é
 * acrescentado, nenhuma palavra é trocada, só marcação e caracteres que quebram o canal são normalizados.
 *  - todos os canais: letras estilizadas (Unicode matemático "𝐧𝐞𝐠𝐫𝐢𝐭𝐨", largura total "ｔｅｘｔｏ") voltam a
 *    caracteres comuns; espaços no fim da linha saem; 3+ quebras viram uma linha em branco;
 *  - Airbnb: sem links (o canal bloqueia), sem Markdown (negrito, itálico, títulos, tabelas, marcadores de
 *    lista) — texto limpo com quebras de linha simples;
 *  - WhatsApp: formatação nativa leve (`*negrito*`, `_itálico_`); `**x**` vira `*x*`; títulos e tabelas viram
 *    texto; `[texto](url)` vira "texto: url";
 *  - Guia digital: texto limpo, sem Markdown.
 * O marcador de credenciais (`[[CREDENCIAIS]]`) é preservado intacto.
 */
import { CREDENTIAL_MARKER } from "@/lib/guest-ai/orchestrator/contracts";
import type { GuestSurface } from "@/lib/guest-ai/types";

/** Letras e dígitos estilizados (Mathematical Alphanumeric Symbols) e formas de largura total. */
const STYLED = /[\u{1D400}-\u{1D7FF}\u{FF01}-\u{FF5E}]/gu;

export function unstyleUnicode(text: string): string {
  // NFC no fim: letra estilizada + acento combinante ("𝐚́") vira a letra acentuada comum ("á")
  return text.replace(STYLED, (c) => c.normalize("NFKC")).normalize("NFC");
}

const PLACEHOLDER = "\u0000CRED\u0000";

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"]/gi;

/** Linha de tabela Markdown (`| a | b |`) ⇒ células separadas por " – "; linha separadora ⇒ removida. */
function flattenTables(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l))
    .map((l) =>
      /^\s*\|.*\|\s*$/.test(l)
        ? l
            .trim()
            .replace(/^\||\|$/g, "")
            .split("|")
            .map((c) => c.trim())
            .filter(Boolean)
            .join(" – ")
        : l,
    )
    .join("\n");
}

function stripHeadings(text: string): string {
  return text.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
}

function common(text: string): string {
  return unstyleUnicode(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function forAirbnb(text: string): string {
  let t = flattenTables(stripHeadings(text));
  t = t.replace(/\[([^\]\n]+)\]\((?:[^)\s]+)\)/g, "$1"); // [texto](url) ⇒ texto
  t = t.replace(URL_RE, "").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([.,;:!?])/g, "$1");
  t = t.replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, "$2"); // **negrito** / __negrito__
  t = t.replace(/(^|[\s(])[*_](?=\S)([^*_\n]*?\S)[*_](?=$|[\s.,;:!?)])/gm, "$1$2"); // *x* / _x_
  t = t.replace(/`([^`\n]+)`/g, "$1");
  t = t.replace(/^[ \t]*(?:[-*•▪◦]|\d+[.)])[ \t]+/gm, ""); // marcadores de lista
  return t;
}

function forWhatsApp(text: string): string {
  let t = flattenTables(stripHeadings(text));
  t = t.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, "$1: $2");
  t = t.replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "*$1*");
  t = t.replace(/__(?=\S)([^\n]*?\S)__/g, "_$1_");
  t = t.replace(/^[ \t]*[*•▪◦][ \t]+/gm, "- ");
  return t;
}

function forGuide(text: string): string {
  let t = flattenTables(stripHeadings(text));
  t = t.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, "$1: $2");
  t = t.replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, "$2");
  t = t.replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s.,;:!?)])/gm, "$1$2");
  t = t.replace(/`([^`\n]+)`/g, "$1");
  t = t.replace(/^[ \t]*[*•▪◦][ \t]+/gm, "- ");
  return t;
}

/** Texto final da sugestão no formato do canal. Nunca lança; texto vazio continua vazio. */
export function formatForChannel(text: string, surface: GuestSurface | string): string {
  if (typeof text !== "string" || !text) return text;
  const protectedText = text.split(CREDENTIAL_MARKER).join(PLACEHOLDER);
  const shaped =
    surface === "airbnb" ? forAirbnb(protectedText) : surface === "whatsapp" ? forWhatsApp(protectedText) : forGuide(protectedText);
  return common(shaped).split(PLACEHOLDER).join(CREDENTIAL_MARKER);
}
