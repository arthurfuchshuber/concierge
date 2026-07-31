import { Fragment, type ReactNode } from "react";

// Converte markdown simples ([label](url)) e URLs soltas em links clicáveis.
// Mantém quebras de linha (o container usa whitespace-pre-wrap).
const MD_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL = /(https?:\/\/[^\s<>()]+)/g;

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

export function MessageText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MD_LINK.lastIndex = 0;
  while ((m = MD_LINK.exec(text))) {
    if (m.index > last) nodes.push(...linkify(text.slice(last, m.index), `p${m.index}`));
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
  if (last < text.length) nodes.push(...linkify(text.slice(last), "tail"));
  return <Fragment>{nodes}</Fragment>;
}
