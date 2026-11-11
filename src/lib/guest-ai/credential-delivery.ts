/**
 * ENTREGA DE CREDENCIAIS NA SAÍDA (14/11/2026 · caso Renan: a mensagem saiu para o hóspede com o texto literal
 * "[[CREDENCIAIS]]"). Puro, sem banco nem rede.
 *
 * O modelo NUNCA vê códigos: quando a D9 permite, ele só declara `credentialIntent = would_deliver` e escreve o
 * marcador `[[CREDENCIAIS]]` uma vez. Quem troca o marcador pelos dados reais é a camada de saída
 * (`slot.server.ts`), DEPOIS de a cadeia validar a resposta e SÓ com as credenciais obtidas por um
 * `CredentialGrant` emitido numa reavaliação nova da D9 (`credential-delivery.server.ts`).
 *
 * Regras:
 *  - com credenciais: o marcador vira o bloco de acesso (cofre/fechadura, portão, PIN, instruções; Wi-Fi só se o
 *    assunto for Wi-Fi);
 *  - sem credenciais (D9 negou agora, falha de leitura, imóvel sem código cadastrado): a frase do marcador é
 *    trocada por um aviso seguro e a conversa SEMPRE é encaminhada à equipe — o marcador nunca é exibido;
 *  - rede de segurança final (`stripCredentialMarker`): nenhuma variação do marcador sai para o canal.
 * Nada aqui vai para log; os valores só existem no texto devolvido ao canal.
 */
import { CREDENTIAL_MARKER } from "@/lib/guest-ai/orchestrator/contracts";
import type { GuestCredentials, GuestSurface } from "@/lib/guest-ai/types";

/** Frase que ocupa o lugar do marcador quando não há credencial para entregar. */
export const CREDENTIAL_FALLBACK_SENTENCE =
  "Estou pedindo agora para nossa equipe te passar os dados de acesso por aqui.";
/** Motivo do chamado quando a entrega automática não foi possível. */
export const CREDENTIAL_UNAVAILABLE_REASON =
  "Acesso não entregue automaticamente (credencial indisponível) — enviar os dados de acesso ao hóspede.";

/** Qualquer variação do marcador (caixa, espaços, colchetes simples ou duplos). */
const MARKER_ANY = /\[{1,2}\s*credenciais?\s*\]{1,2}/giu;

export const hasCredentialMarker = (text: string): boolean => {
  MARKER_ANY.lastIndex = 0;
  return text.includes(CREDENTIAL_MARKER) || MARKER_ANY.test(text);
};

const WIFI = /wi-?\s?fi|internet|\brede\b/iu;
const ACCESS = /porta|port[aã]o|cofre|cadeado|fechadura|chave|entrar|entrada|acesso|c[oó]digo|pin\b|senha da (?:porta|entrada)|lockbox/iu;

/** Wi-Fi só quando o assunto é Wi-Fi: na resposta ou na mensagem do hóspede, e sem pedido de acesso. */
function wantsWifi(reply: string, guestText: string): { wifi: boolean; access: boolean } {
  const talk = `${reply}\n${guestText}`;
  const wifi = WIFI.test(talk);
  const access = ACCESS.test(talk);
  return { wifi, access: access || !wifi };
}

/** Destaque do valor por canal: negrito nativo no WhatsApp (`*x*`), Markdown no guia (`**x**`), limpo no Airbnb. */
export function emphasize(value: string, surface: GuestSurface | undefined): string {
  if (surface === "whatsapp") return `*${value}*`;
  if (surface === "guide_chat") return `**${value}**`;
  return value;
}

/** Monta o bloco de acesso; `null` quando não há nenhum dado utilizável. */
export function renderCredentialBlock(
  creds: GuestCredentials | null | undefined,
  ctx: { reply: string; guestText?: string; surface?: GuestSurface },
): string | null {
  if (!creds) return null;
  const want = wantsWifi(ctx.reply.split(CREDENTIAL_MARKER).join(" "), ctx.guestText ?? "");
  const b = (v: string) => emphasize(v, ctx.surface);
  const lines: string[] = [];
  if (want.access) {
    if (creds.lockCode) lines.push(`• Código da fechadura/cofre: ${b(creds.lockCode)}`);
    if (creds.gateCode) lines.push(`• Código do portão: ${b(creds.gateCode)}`);
    if (creds.pinCode) lines.push(`• PIN de acesso: ${b(creds.pinCode)}`);
  }
  if (want.wifi && creds.wifiPassword) lines.push(`• Senha do Wi-Fi: ${b(creds.wifiPassword)}`);
  if (want.access && creds.accessInstructions) lines.push(creds.accessInstructions.trim());
  return lines.length > 0 ? lines.join("\n") : null;
}

const tidy = (s: string) => s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** Frase (limites . ! ? e quebra de linha) que contém o marcador, substituída pelo texto dado. */
function replaceMarkerSentence(text: string, replacement: string): string {
  const at = text.indexOf(CREDENTIAL_MARKER);
  if (at < 0) return text;
  const isEnd = (c: string) => c === "." || c === "!" || c === "?" || c === "\n";
  let start = at;
  while (start > 0 && !isEnd(text[start - 1]!)) start -= 1;
  let end = at + CREDENTIAL_MARKER.length;
  while (end < text.length && !isEnd(text[end]!)) end += 1;
  if (end < text.length && text[end] !== "\n") end += 1; // pontuação final faz parte da frase
  const before = text.slice(0, start).trimEnd();
  const after = text.slice(end).trimStart();
  return tidy([before, replacement, after].filter(Boolean).join(" "));
}

/** Rede de segurança: remove qualquer variação do marcador, sem deixar a frase quebrada. */
export function stripCredentialMarker(text: string): string {
  if (!hasCredentialMarker(text)) return text;
  const normalized = text.replace(MARKER_ANY, CREDENTIAL_MARKER);
  return replaceMarkerSentence(normalized, CREDENTIAL_FALLBACK_SENTENCE).replace(MARKER_ANY, "").trim();
}

export interface CredentialDelivery {
  text: string;
  /** Marcador presente e substituído pelos dados reais. */
  delivered: boolean;
  /** Marcador presente, mas sem dado para entregar: foi trocado pelo aviso seguro (exige encaminhamento). */
  fallback: boolean;
}

/** Troca o marcador pelos dados reais ou, sem dados, pelo aviso seguro. Sem marcador, devolve o texto igual. */
export function applyCredentials(
  text: string,
  creds: GuestCredentials | null | undefined,
  ctx: { guestText?: string; surface?: GuestSurface } = {},
): CredentialDelivery {
  if (!hasCredentialMarker(text)) return { text, delivered: false, fallback: false };
  const canonical = text.replace(MARKER_ANY, CREDENTIAL_MARKER);
  const block = renderCredentialBlock(creds, { reply: canonical, guestText: ctx.guestText, surface: ctx.surface });
  if (!block) return { text: stripCredentialMarker(canonical), delivered: false, fallback: true };
  const [first, ...rest] = canonical.split(CREDENTIAL_MARKER);
  // um marcador só vale; sobras (a cadeia já recusa repetição) viram o aviso seguro, nunca outro marcador
  const tail = rest.join(" ").replace(MARKER_ANY, "");
  const head = (first ?? "").trimEnd();
  const out = tidy([head, block, tail.trim()].filter(Boolean).join("\n\n"));
  return { text: out, delivered: true, fallback: false };
}
