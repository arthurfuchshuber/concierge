/**
 * SAÍDA DA IA PARA O CANAL · resolução e blindagem universal de tags (14/11/2026). Puro.
 *
 * Nenhuma mensagem autônoma sai para o hóspede (Airbnb, WhatsApp ou guia) com sintaxe crua `[[...]]` ou `{{...}}`.
 * Ordem (`resolveOutboundText`):
 *  1. `[[info:...]]` SENSÍVEL (senhas, códigos, Wi-Fi, instruções de acesso, endereço, telefone) sem credencial
 *     autorizada ⇒ vira o marcador `[[CREDENCIAIS]]` (cai no aviso seguro + encaminhamento). Com credencial
 *     autorizada pela D9 (`CredentialGrant`), expande pelos valores do próprio grant.
 *  2. `[[CREDENCIAIS]]` ⇒ bloco de acesso real (negrito no WhatsApp/guia, limpo no Airbnb) ou aviso seguro.
 *  3. `[[info:...]]` público (horários, regras, anfitrião, marketplace) ⇒ `expandInfoTags` de `@/lib/guide-tags`;
 *     no Airbnb, link do marketplace vira só o rótulo (o canal bloqueia links).
 *  4. `[[tag:...]]` ⇒ guia: link Markdown (`expandTagsAsMarkdown`); WhatsApp: "rótulo (URL)"
 *     (`expandTagsForWhatsapp`); Airbnb ou sem guia publicado: só o nome legível da seção, sem URL.
 *  5. Trava final (catch-all): qualquer `[[...]]` / `{{...}}` restante é removido sem quebrar a frase.
 */
import {
  CREDENTIAL_UNAVAILABLE_REASON,
  applyCredentials,
  stripCredentialMarker,
} from "@/lib/guest-ai/credential-delivery";
import { CREDENTIAL_MARKER } from "@/lib/guest-ai/orchestrator/contracts";
import type { GuestCredentials, GuestSurface } from "@/lib/guest-ai/types";
import {
  GUIDE_TAGS,
  expandInfoTags,
  expandTagsAsMarkdown,
  expandTagsForWhatsapp,
  type GuideInfoSnapshot,
} from "@/lib/guide-tags";

export { CREDENTIAL_UNAVAILABLE_REASON };

/** Origem pública do guia (links no WhatsApp). */
export const DEFAULT_GUIDE_ORIGIN = "https://conciergeia.app";

/**
 * Chaves de `[[info:...]]` que só saem com a D9 autorizando (mesma regra das credenciais): códigos, Wi-Fi,
 * instruções de acesso/chegada (podem conter códigos), endereço e telefone do anfitrião.
 */
export const SENSITIVE_INFO_KEYS = new Set([
  "wifi",
  "wifi-password",
  "gate-code",
  "lock-code",
  "pin-code",
  "gate-instructions",
  "lock-instructions",
  "checkin-instructions",
  "address",
  "host-phone",
]);

/** Campos públicos do imóvel (nunca colunas de segredo). */
export type PublicPropertySnapshot = Pick<
  GuideInfoSnapshot,
  | "checkin_time"
  | "checkin_time_max"
  | "checkout_time"
  | "checkout_time_min"
  | "wifi_ssid"
  | "host_name"
  | "house_rules"
  | "checkout_instructions"
  | "marketplace_links"
> & {
  /** Só usados com a D9 autorizando. */
  address?: string | null;
  host_phone?: string | null;
  checkin_instructions?: string | null;
};

export interface OutboundContext {
  surface: GuestSurface;
  /** Credenciais obtidas por `CredentialGrant` (D9 autorizou agora); `null` = não entregar nada sensível. */
  credentials: GuestCredentials | null;
  property: PublicPropertySnapshot | null;
  /** Slug do guia publicado (links das seções); `null` ⇒ só o nome da seção. */
  guideSlug: string | null;
  origin?: string;
}

export interface OutboundResult {
  text: string;
  /** Algo sensível foi pedido e não pôde ser entregue: a conversa deve ir para a equipe. */
  needsHandoff: boolean;
  /** Credenciais reais foram inseridas no texto. */
  credentialsDelivered: boolean;
}

const INFO_RE = /\[\[\s*info\s*:\s*([a-z0-9-]+)(?::([^\]|]+))?(?:\|([^\]]+))?\s*\]\]/giu;
const TAG_RE = /\[\[\s*tag\s*:\s*([a-z0-9-]+)(?::([a-z0-9-]+))?(?:\|([^\]]+))?\s*\]\]/giu;
const ANY_TAG = /\[\[[^\]]*\]\]|\{\{[^}]*\}\}/gu;
const TAG_LABEL: Record<string, string> = Object.fromEntries(GUIDE_TAGS.map((t) => [t.key, t.label]));

/** Limpa espaços deixados por remoções: espaço duplo, espaço antes de pontuação, linhas vazias em excesso. */
function tidy(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Trava final: remove qualquer `[[...]]` ou `{{...}}` que tenha sobrado, sem quebrar a frase. */
export function sanitizeResidualTags(text: string): string {
  if (!text) return text;
  const noMarker = stripCredentialMarker(text);
  ANY_TAG.lastIndex = 0;
  if (!ANY_TAG.test(noMarker)) return noMarker;
  return tidy(noMarker.replace(ANY_TAG, ""));
}

/** Expande `[[tag:...]]` conforme o canal. */
export function expandGuideTags(text: string, ctx: Pick<OutboundContext, "surface" | "guideSlug" | "origin">): string {
  const canonical = text.replace(TAG_RE, (_m, k: string, p?: string, l?: string) =>
    `[[tag:${k.toLowerCase()}${p ? `:${p.toLowerCase()}` : ""}${l ? `|${l.trim()}` : ""}]]`,
  );
  if (ctx.surface === "airbnb" || !ctx.guideSlug) {
    // Airbnb bloqueia links: só o nome legível da seção/item
    return canonical.replace(TAG_RE, (_m, k: string, _p?: string, l?: string) => (l?.trim() || TAG_LABEL[k.toLowerCase()]) ?? "");
  }
  if (ctx.surface === "whatsapp")
    return expandTagsForWhatsapp(canonical, { origin: ctx.origin ?? DEFAULT_GUIDE_ORIGIN, slug: ctx.guideSlug });
  return expandTagsAsMarkdown(canonical, { slug: ctx.guideSlug });
}

/** Snapshot completo para `expandInfoTags`: públicos + (só com D9) os valores do grant. */
function infoSnapshot(ctx: OutboundContext): GuideInfoSnapshot {
  const p = ctx.property ?? {};
  const c = ctx.credentials;
  const base: GuideInfoSnapshot = {
    checkin_time: p.checkin_time ?? null,
    checkin_time_max: p.checkin_time_max ?? null,
    checkout_time: p.checkout_time ?? null,
    checkout_time_min: p.checkout_time_min ?? null,
    wifi_ssid: p.wifi_ssid ?? null,
    host_name: p.host_name ?? null,
    house_rules: p.house_rules ?? null,
    checkout_instructions: p.checkout_instructions ?? null,
    marketplace_links: p.marketplace_links ?? null,
  };
  if (!c) return base;
  return {
    ...base,
    wifi_password: c.wifiPassword ?? null,
    gate_code: c.gateCode ?? null,
    lock_code: c.lockCode ?? null,
    pin_code: c.pinCode ?? null,
    gate_instructions: c.accessInstructions ?? null,
    lock_instructions: c.accessInstructions ?? null,
    checkin_instructions: p.checkin_instructions ?? null,
    address: p.address ?? null,
    host_phone: p.host_phone ?? null,
  };
}

export function resolveOutboundText(text: string, ctx: OutboundContext): OutboundResult {
  if (!text) return { text, needsHandoff: false, credentialsDelivered: false };
  let out = text;
  let needsHandoff = false;
  // 1) info sensível sem D9 ⇒ marcador (aviso seguro + equipe); com D9, só destaca o valor no canal
  out = out.replace(INFO_RE, (m, rawKey: string, rawParam?: string, rawLabel?: string) => {
    const key = rawKey.toLowerCase();
    if (!SENSITIVE_INFO_KEYS.has(key)) return m;
    if (!ctx.credentials) return CREDENTIAL_MARKER;
    return `[[info:${key}${rawParam ? `:${rawParam}` : ""}${rawLabel ? `|${rawLabel}` : ""}]]`;
  });
  // 2) marcador de credenciais (um só vale; repetição já é recusada pela cadeia)
  const firstAt = out.indexOf(CREDENTIAL_MARKER);
  if (firstAt >= 0) {
    out = out.slice(0, firstAt + CREDENTIAL_MARKER.length) + out.slice(firstAt + CREDENTIAL_MARKER.length).split(CREDENTIAL_MARKER).join("");
  }
  const cred = applyCredentials(out, ctx.credentials, { surface: ctx.surface });
  out = cred.text;
  needsHandoff = cred.fallback;
  // 3) info públicas (e sensíveis já autorizadas)
  const snapshot = infoSnapshot(ctx);
  if (ctx.surface === "airbnb") {
    // marketplace sem URL no Airbnb: só o rótulo
    out = out.replace(INFO_RE, (m, rawKey: string, rawParam?: string, rawLabel?: string) =>
      rawKey.toLowerCase() === "marketplace" ? (rawLabel?.trim() || rawParam?.trim() || "marketplace") : m,
    );
  }
  out = expandInfoTags(out, snapshot, { markdownLinks: ctx.surface === "guide_chat" });
  // 4) seções do guia
  out = expandGuideTags(out, ctx);
  // 5) trava final
  out = sanitizeResidualTags(tidy(out));
  return { text: out, needsHandoff, credentialsDelivered: cred.delivered };
}

/** O texto pede algo que só sai com a D9 (marcador ou `[[info:...]]` sensível)? */
export function needsCredentialLookup(text: string): boolean {
  if (!text) return false;
  if (/\[{1,2}\s*credenciais?\s*\]{1,2}/iu.test(text)) return true;
  for (const m of text.matchAll(INFO_RE)) if (SENSITIVE_INFO_KEYS.has(m[1]!.toLowerCase())) return true;
  return false;
}

/** O texto tem alguma sintaxe de tag (`[[...]]` / `{{...}}`)? Sem tag, nada a carregar. */
export function hasAnyTag(text: string): boolean {
  ANY_TAG.lastIndex = 0;
  return !!text && (ANY_TAG.test(text) || /\[\s*credenciais?\s*\]/iu.test(text));
}
