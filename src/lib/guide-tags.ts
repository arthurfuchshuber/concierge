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
