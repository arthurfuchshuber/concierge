/**
 * Alguns eventos antigos da Linha do Tempo foram gravados no formato bruto
 * de antes da reescrita de `diffPayload` (stakeholders.functions.ts):
 *   "Cadastro atualizado — N informação(ões) alterada(s): Campo: "A" → "B""
 * Esse texto já está gravado no banco — não temos acesso direto pra
 * reescrever o histórico, e a mensagem é salva como texto puro no momento
 * da edição (não guarda os valores estruturados de antes/depois). Por isso
 * a "tradução" pro formato objetivo acontece aqui, na hora de exibir,
 * sem tocar no dado original: eventos novos já nascem no formato objetivo
 * (gerado pelo servidor) e passam por aqui sem qualquer alteração; só os
 * antigos, no formato bruto reconhecido, são reescritos na tela.
 */

const LEGACY_PREFIX = /^Cadastro atualizado — \d+ informaç(?:ão|ões) alterada\(s\):\s*/;
const LEGACY_SEGMENT = /^(.+?):\s*"([^"]*)"\s*→\s*"([^"]*)"$/;

const DATE_LABELS = new Set(["Início do contrato", "Fim do contrato", "Data de nascimento"]);

function isVazio(v: string): boolean {
  const t = v.trim();
  return t === "" || t.toLowerCase() === "vazio";
}

/** dd/mm/aaaa a partir de "aaaa-mm-dd" — mesma conversão usada no servidor
 *  para os campos de data (contrato, nascimento). */
function toBRDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

function contractPhrase(startVal: string | null, endVal: string | null): string {
  const startPhrase =
    startVal == null
      ? null
      : isVazio(startVal)
        ? "Data de início do contrato removida"
        : `Data de início do contrato alterada para ${startVal}`;
  const endTail = endVal == null ? null : isVazio(endVal) ? "data final removida" : `data final alterada para ${endVal}`;
  const endPhrase =
    endVal == null ? null : isVazio(endVal) ? "Data final do contrato removida" : `Data final do contrato alterada para ${endVal}`;

  if (startPhrase && endTail) return `${startPhrase} e ${endTail}`;
  return (startPhrase ?? endPhrase) as string;
}

/** Reescreve uma mensagem de evento "Cadastro atualizado — ..." do formato
 *  bruto antigo pro formato objetivo atual. Mensagens que não batem com o
 *  padrão reconhecido (já no formato novo, ou de outro tipo de evento)
 *  voltam exatamente como vieram. */
export function humanizeEventMessage(raw: string): string {
  if (!raw) return raw;
  const prefixMatch = LEGACY_PREFIX.exec(raw);
  if (!prefixMatch) return raw;

  const segments = raw
    .slice(prefixMatch[0].length)
    .split("; ")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!segments.length) return raw;

  const phrases: string[] = [];
  let startVal: string | null = null;
  let endVal: string | null = null;

  for (const seg of segments) {
    const m = LEGACY_SEGMENT.exec(seg);
    if (!m) {
      phrases.push(seg);
      continue;
    }
    const [, label, , rawNewVal] = m;
    const value = DATE_LABELS.has(label) && !isVazio(rawNewVal) ? toBRDate(rawNewVal) : rawNewVal;

    if (label === "Início do contrato") {
      startVal = value;
    } else if (label === "Fim do contrato") {
      endVal = value;
    } else {
      phrases.push(isVazio(value) ? `${label} removido(a)` : `${label} alterado(a) para "${value}"`);
    }
  }

  if (startVal !== null || endVal !== null) {
    phrases.unshift(contractPhrase(startVal, endVal));
  }

  return phrases.length ? phrases.join("; ") : raw;
}
