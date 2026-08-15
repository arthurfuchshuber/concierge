import { Fragment, type ReactNode } from "react";

// Converte markdown simples ([label](url)) e URLs soltas em links clicáveis.
// Mantém quebras de linha (o container usa whitespace-pre-wrap).
const MD_LINK = /\[([^\]\n]+)\]\(((?:https?:\/\/|\/)[^\s)]+)\)/g;
const BARE_URL = /(https?:\/\/[^\s<>()]+)/g;
const MD_BOLD = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;

function linkify(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  BARE_URL.lastIndex = 0;
  while ((m = BARE_URL.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a
        key={`${keyBase}-u${m.index}`}
        href={m[1]}
        target="_blank"
        rel="noreferrer noopener"
        className="underline underline-offset-2 break-all hover:opacity-80"
      >
        {m[1]}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Negrito markdown (**texto** ou *texto*) aplicado antes da linkificação.
function richify(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MD_BOLD.lastIndex = 0;
  while ((m = MD_BOLD.exec(text))) {
    if (m.index > last) out.push(...linkify(text.slice(last, m.index), `${keyBase}-t${m.index}`));
    out.push(
      <strong key={`${keyBase}-b${m.index}`} className="font-semibold">
        {linkify(m[1] ?? m[2] ?? "", `${keyBase}-bi${m.index}`)}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...linkify(text.slice(last), `${keyBase}-e`));
  return out;
}


export function MessageText({ text }: { text: string }) {
  // Cada quebra de linha do texto original vira um espaçamento visual de
  // parágrafo (linha em branco) — sem isso, frases em linhas separadas
  // ficavam grudadas umas nas outras, só com o whitespace-pre-wrap do
  // container respeitando a quebra simples, sem gerar nenhum respiro visual.
  const spaced = text.replace(/\n+/g, "\n\n");
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MD_LINK.lastIndex = 0;
  while ((m = MD_LINK.exec(spaced))) {
    if (m.index > last) nodes.push(...richify(spaced.slice(last, m.index), `p${m.index}`));
    nodes.push(
      <a
        key={`l${m.index}`}
        href={m[2]}
        target="_blank"
        rel="noreferrer noopener"
        className="font-medium underline underline-offset-2 break-words hover:opacity-80"
      >
        {m[1]}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < spaced.length) nodes.push(...richify(spaced.slice(last), "tail"));
  return <Fragment>{nodes}</Fragment>;
}
