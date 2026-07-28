// Catálogo de tags do guia.
// Sintaxe suportada:
//   [[tag:key]]                      → link para a seção
//   [[tag:key|rótulo]]               → rótulo customizado
//   [[tag:key:param]]                → link para um item específico (ex.: faq:como-usar-piscina)
//   [[tag:key:param|rótulo]]         → item específico com rótulo custom

export type GuideTagKey =
  | "home"
  | "chegada"
  | "saida"
  | "residencia"
  | "explorar"
  | "senhas-acesso"
  | "wifi"
  | "manual-casa"
  | "faq"
  | "emergencias"
  | "contato-anfitriao"
  | "endereco"
  | "checkin-instrucoes"
  | "checkout-instrucoes"
  | "regras-casa"
  // Chaves que aceitam um parâmetro para item específico:
  | "local"      // uma recomendação/lugar específico
  ;

export type GuideTag = {
  key: GuideTagKey;
  label: string;
  description: string;
  /** Caminho base no guia (relativo a /g/{slug}). */
  path: string;
  /** Aceita parâmetro (item específico). */
  parameterized?: boolean;
};

export const GUIDE_TAGS: readonly GuideTag[] = [
  { key: "home",                 label: "Início",                description: "Página principal do guia",             path: "#home" },
  { key: "chegada",              label: "Chegada",               description: "Aba de check-in",                       path: "#checkin" },
  { key: "checkin-instrucoes",   label: "Instruções de chegada", description: "Como chegar e o que fazer ao entrar",   path: "#checkin" },
  { key: "senhas-acesso",        label: "Senhas de acesso",      description: "Portão, fechadura e cofre",             path: "#checkin" },
  { key: "wifi",                 label: "Wi-Fi",                 description: "Rede e senha",                          path: "#checkin" },
  { key: "endereco",             label: "Endereço",              description: "Localização do imóvel",                 path: "#checkin" },
  { key: "manual-casa",          label: "Manual da casa",        description: "Como usar aparelhos e ambientes",       path: "#residencia" },
  { key: "regras-casa",          label: "Regras da casa",        description: "Combinados de convivência",             path: "#residencia" },
  { key: "residencia",           label: "A residência",          description: "Aba com o manual e regras",             path: "#residencia" },
  { key: "saida",                label: "Saída",                 description: "Aba de check-out",                      path: "#saida" },
  { key: "checkout-instrucoes",  label: "Instruções de saída",   description: "Passo a passo do check-out",            path: "#saida" },
  { key: "explorar",             label: "Explorar a cidade",     description: "Recomendações pela cidade",             path: "/explorar" },
  { key: "local",                label: "Recomendação (lugar)",  description: "Um lugar específico das recomendações", path: "/explorar", parameterized: true },
  { key: "faq",                  label: "Perguntas frequentes",  description: "FAQ do imóvel — todas as perguntas",    path: "#faq", parameterized: true },
  { key: "emergencias",          label: "Emergências",           description: "Contatos de emergência",                path: "#faq" },
  { key: "contato-anfitriao",    label: "Contato do anfitrião",  description: "Fale com o anfitrião",                  path: "#faq" },
] as const;

const TAG_BY_KEY: Record<string, GuideTag> = Object.fromEntries(
  GUIDE_TAGS.map((t) => [t.key, t]),
);

export function isGuideTagKey(k: string): k is GuideTagKey {
  return Object.prototype.hasOwnProperty.call(TAG_BY_KEY, k);
}

export function getGuideTag(k: string): GuideTag | null {
  return TAG_BY_KEY[k] ?? null;
}

/** Slugifica texto para uso em parâmetro de tag (FAQ, recomendação). */
export function slugForTag(input: string): string {
  return (input ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 64);
}

/** Constrói a URL absoluta do deep-link, com sub-âncora quando houver param. */
export function buildTagUrl(
  origin: string,
  slug: string,
  key: GuideTagKey,
  param?: string | null,
): string {
  const t = TAG_BY_KEY[key];
  if (!t) return `${origin}/g/${slug}`;
  const base = `${origin}/g/${slug}`;
  if (t.path.startsWith("#")) {
    if (param && t.parameterized) {
      // Ex.: #faq-como-usar-piscina — o guia procura por esse id.
      return `${base}${t.path}-${param}`;
    }
    return `${base}${t.path}`;
  }
  // Caminho absoluto (ex.: /explorar).
  if (param && t.parameterized) return `${base}${t.path}#item-${param}`;
  return `${base}${t.path}`;
}

/** Casa [[tag:key]], [[tag:key|rótulo]], [[tag:key:param]] e [[tag:key:param|rótulo]]. */
const TAG_RE = /\[\[tag:([a-z0-9-]+)(?::([a-z0-9-]+))?(?:\|([^\]]+))?\]\]/gi;

/** Expande todas as tags para "rótulo (URL)" — para envio via WhatsApp. */
export function expandTagsForWhatsapp(
  text: string,
  ctx: { origin: string; slug: string },
): string {
  return text.replace(TAG_RE, (_m, rawKey: string, rawParam?: string, rawLabel?: string) => {
    const key = rawKey.toLowerCase();
    if (!isGuideTagKey(key)) return "";
    const tag = TAG_BY_KEY[key];
    const label = (rawLabel ?? tag.label).trim() || tag.label;
    const url = buildTagUrl(ctx.origin, ctx.slug, key as GuideTagKey, rawParam ?? null);
    return `${label} (${url})`;
  });
}

/** Token separando trechos de texto e tags — para renderização inline. */
export type TagToken =
  | { kind: "text"; value: string }
  | { kind: "tag"; key: GuideTagKey; label: string; param: string | null };

export function tokenizeTags(text: string): TagToken[] {
  const out: TagToken[] = [];
  let last = 0;
  const src = text ?? "";
  for (const m of src.matchAll(TAG_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", value: src.slice(last, idx) });
    const key = m[1].toLowerCase();
    const param = (m[2] ?? "").toLowerCase() || null;
    if (isGuideTagKey(key)) {
      const tag = TAG_BY_KEY[key];
      const label = (m[3] ?? tag.label).trim() || tag.label;
      out.push({ kind: "tag", key: key as GuideTagKey, label, param });
    }
    last = idx + m[0].length;
  }
  if (last < src.length) out.push({ kind: "text", value: src.slice(last) });
  return out;
}

// =====================================================================
// [[info:...]] — expande para valor concreto vindo da propriedade.
// Ex.: [[info:checkin-time]] → "15:00"
//      [[info:wifi]]         → "SSID · senha ..."
//      [[info:marketplace:mercado]] → URL do link do marketplace com label "mercado"
// =====================================================================

export type GuideInfoKey =
  | "checkin-time"
  | "checkin-time-max"
  | "checkout-time"
  | "checkout-time-min"
  | "wifi"
  | "wifi-ssid"
  | "wifi-password"
  | "gate-code"
  | "lock-code"
  | "pin-code"
  | "address"
  | "host-name"
  | "host-phone"
  | "house-rules"
  | "checkin-instructions"
  | "checkout-instructions"
  | "gate-instructions"
  | "lock-instructions"
  | "marketplace";

export type GuideInfoDef = {
  key: GuideInfoKey;
  label: string;
  description: string;
  parameterized?: boolean;
};

export const GUIDE_INFOS: readonly GuideInfoDef[] = [
  { key: "checkin-time",           label: "Horário de check-in",        description: "Ex.: 15:00" },
  { key: "checkin-time-max",       label: "Check-in até",               description: "Horário limite de chegada" },
  { key: "checkout-time",          label: "Horário de check-out",       description: "Ex.: 11:00" },
  { key: "checkout-time-min",      label: "Check-out a partir de",      description: "Horário inicial de saída" },
  { key: "wifi",                   label: "Wi-Fi (rede + senha)",       description: "Rede e senha em uma linha" },
  { key: "wifi-ssid",              label: "Wi-Fi — rede",               description: "Somente o nome da rede" },
  { key: "wifi-password",          label: "Wi-Fi — senha",              description: "Somente a senha" },
  { key: "gate-code",              label: "Código do portão",           description: "Código de acesso ao portão" },
  { key: "lock-code",              label: "Código da fechadura",        description: "Código da fechadura" },
  { key: "pin-code",               label: "PIN do guia",                description: "PIN para acessar o guia" },
  { key: "address",                label: "Endereço",                   description: "Endereço completo do imóvel" },
  { key: "host-name",              label: "Nome do anfitrião",          description: "Nome exibido no guia" },
  { key: "host-phone",             label: "Telefone do anfitrião",      description: "Contato do anfitrião" },
  { key: "house-rules",            label: "Regras da casa",             description: "Texto das regras" },
  { key: "checkin-instructions",   label: "Instruções de chegada",      description: "Texto das instruções" },
  { key: "checkout-instructions",  label: "Instruções de saída",        description: "Texto das instruções" },
  { key: "gate-instructions",      label: "Instruções do portão",       description: "Texto das instruções" },
  { key: "lock-instructions",      label: "Instruções da fechadura",    description: "Texto das instruções" },
  { key: "marketplace",            label: "Link do marketplace",        description: "Use [[info:marketplace:rótulo]]", parameterized: true },
] as const;

const INFO_BY_KEY: Record<string, GuideInfoDef> = Object.fromEntries(
  GUIDE_INFOS.map((i) => [i.key, i]),
);

export function isGuideInfoKey(k: string): k is GuideInfoKey {
  return Object.prototype.hasOwnProperty.call(INFO_BY_KEY, k);
}

/** Snapshot dos campos do imóvel usados por `[[info:...]]`. */
export type GuideInfoSnapshot = {
  checkin_time?: string | null;
  checkin_time_max?: string | null;
  checkout_time?: string | null;
  checkout_time_min?: string | null;
  wifi_ssid?: string | null;
  wifi_password?: string | null;
  gate_code?: string | null;
  lock_code?: string | null;
  pin_code?: string | null;
  address?: string | null;
  host_name?: string | null;
  host_phone?: string | null;
  house_rules?: string | null;
  checkin_instructions?: string | null;
  checkout_instructions?: string | null;
  gate_instructions?: string | null;
  lock_instructions?: string | null;
  marketplace_links?: unknown;
};

function normalizeInfoLabel(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** Resolve `[[info:key(:param)?]]` para uma string exibível. */
export function resolveInfoValue(
  key: GuideInfoKey,
  param: string | null,
  p: GuideInfoSnapshot | null | undefined,
): string {
  if (!p) return "";
  const v = (x: unknown) => (x == null ? "" : String(x).trim());
  switch (key) {
    case "checkin-time":          return v(p.checkin_time);
    case "checkin-time-max":      return v(p.checkin_time_max);
    case "checkout-time":         return v(p.checkout_time);
    case "checkout-time-min":     return v(p.checkout_time_min);
    case "wifi": {
      const s = v(p.wifi_ssid), pw = v(p.wifi_password);
      if (!s && !pw) return "";
      if (s && pw) return `${s} · senha ${pw}`;
      return s || pw;
    }
    case "wifi-ssid":             return v(p.wifi_ssid);
    case "wifi-password":         return v(p.wifi_password);
    case "gate-code":             return v(p.gate_code);
    case "lock-code":             return v(p.lock_code);
    case "pin-code":              return v(p.pin_code);
    case "address":               return v(p.address);
    case "host-name":             return v(p.host_name);
    case "host-phone":            return v(p.host_phone);
    case "house-rules":           return v(p.house_rules);
    case "checkin-instructions":  return v(p.checkin_instructions);
    case "checkout-instructions": return v(p.checkout_instructions);
    case "gate-instructions":     return v(p.gate_instructions);
    case "lock-instructions":     return v(p.lock_instructions);
    case "marketplace": {
      const list = Array.isArray(p.marketplace_links) ? (p.marketplace_links as Array<Record<string, unknown>>) : [];
      if (!list.length) return "";
      const want = param ? normalizeInfoLabel(param) : "";
      const hit = want
        ? list.find((l) => normalizeInfoLabel(String(l.label ?? l.name ?? "")) === want) ??
          list.find((l) => normalizeInfoLabel(String(l.label ?? l.name ?? "")).includes(want))
        : list[0];
      return v(hit?.url);
    }
  }
}

const INFO_RE = /\[\[info:([a-z0-9-]+)(?::([^\]|]+))?(?:\|([^\]]+))?\]\]/gi;

/** Chaves cujo valor é sensível — deve ser mascarado antes do check-in ou sem PIN. */
export const PROTECTED_INFO_KEYS: ReadonlySet<GuideInfoKey> = new Set<GuideInfoKey>([
  "wifi",
  "wifi-password",
  "gate-code",
  "lock-code",
]);

export function isProtectedInfoKey(k: string): k is GuideInfoKey {
  return isGuideInfoKey(k) && PROTECTED_INFO_KEYS.has(k as GuideInfoKey);
}

/** Substitui todas as `[[info:...]]` pelos valores atuais da propriedade. */
export function expandInfoTags(text: string, prop: GuideInfoSnapshot | null | undefined): string {
  if (!text) return text;
  return text.replace(INFO_RE, (_m, rawKey: string, rawParam?: string, rawLabel?: string) => {
    const key = rawKey.toLowerCase();
    if (!isGuideInfoKey(key)) return "";
    const val = resolveInfoValue(key as GuideInfoKey, (rawParam ?? "").trim() || null, prop);
    if (!val) return "";
    return rawLabel?.trim() ? `${rawLabel.trim()} (${val})` : val;
  });
}

// ---- Combined tokenizer (tag + info) for inline rendering ---------------------

export type AnyToken =
  | { kind: "text"; value: string }
  | { kind: "tag"; key: GuideTagKey; label: string; param: string | null }
  | { kind: "info"; key: GuideInfoKey; label: string | null; param: string | null };

/** Percorre o texto uma vez, extraindo tags e infos em ordem. */
export function tokenizeAll(text: string): AnyToken[] {
  const src = text ?? "";
  const matches: Array<{ idx: number; len: number; tok: AnyToken }> = [];
  for (const m of src.matchAll(TAG_RE)) {
    const key = m[1].toLowerCase();
    if (!isGuideTagKey(key)) continue;
    const tag = TAG_BY_KEY[key];
    const label = (m[3] ?? tag.label).trim() || tag.label;
    const param = (m[2] ?? "").toLowerCase() || null;
    matches.push({ idx: m.index ?? 0, len: m[0].length, tok: { kind: "tag", key: key as GuideTagKey, label, param } });
  }
  for (const m of src.matchAll(INFO_RE)) {
    const key = m[1].toLowerCase();
    if (!isGuideInfoKey(key)) continue;
    const label = (m[3] ?? "").trim() || null;
    const param = (m[2] ?? "").trim() || null;
    matches.push({ idx: m.index ?? 0, len: m[0].length, tok: { kind: "info", key: key as GuideInfoKey, label, param } });
  }
  matches.sort((a, b) => a.idx - b.idx);
  const out: AnyToken[] = [];
  let last = 0;
  for (const m of matches) {
    if (m.idx < last) continue; // overlap safety
    if (m.idx > last) out.push({ kind: "text", value: src.slice(last, m.idx) });
    out.push(m.tok);
    last = m.idx + m.len;
  }
  if (last < src.length) out.push({ kind: "text", value: src.slice(last) });
  return out;
}
