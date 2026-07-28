// Catálogo de tags do guia (Fase 1).
// Sintaxe: [[tag:key]] ou [[tag:key|rótulo customizado]]
// Ao renderizar/enviar, expandimos para uma URL de deep-link do guia.

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
  | "regras-casa";

export type GuideTag = {
  key: GuideTagKey;
  label: string;      // rótulo padrão exibido/enviado
  description: string; // mostrado no picker
  /** Caminho final no guia (relativo ao /g/{slug}). Inclui hash se aplicável. */
  path: string;
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
  { key: "faq",                  label: "Perguntas frequentes",  description: "FAQ do imóvel",                         path: "#faq" },
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

/** Constrói a URL absoluta do deep-link. */
export function buildTagUrl(origin: string, slug: string, key: GuideTagKey): string {
  const t = TAG_BY_KEY[key];
  if (!t) return `${origin}/g/${slug}`;
  // path começa com "#..." ou "/..."
  if (t.path.startsWith("#")) return `${origin}/g/${slug}${t.path}`;
  return `${origin}/g/${slug}${t.path}`;
}

// Casa [[tag:key]] e [[tag:key|rótulo]]
const TAG_RE = /\[\[tag:([a-z0-9-]+)(?:\|([^\]]+))?\]\]/gi;

/**
 * Substitui todos os `[[tag:...]]` por texto pronto para WhatsApp:
 * "rótulo (URL)". Tags desconhecidas são removidas silenciosamente.
 */
export function expandTagsForWhatsapp(
  text: string,
  ctx: { origin: string; slug: string },
): string {
  return text.replace(TAG_RE, (_m, rawKey: string, rawLabel?: string) => {
    const key = rawKey.toLowerCase();
    if (!isGuideTagKey(key)) return "";
    const tag = TAG_BY_KEY[key];
    const label = (rawLabel ?? tag.label).trim() || tag.label;
    const url = buildTagUrl(ctx.origin, ctx.slug, key as GuideTagKey);
    return `${label} (${url})`;
  });
}

/** Percorre o texto separando trechos "texto" e "tag" — útil para renderizar
 * links no editor / respostas da IA (Fase 2). */
export type TagToken =
  | { kind: "text"; value: string }
  | { kind: "tag"; key: GuideTagKey; label: string };

export function tokenizeTags(text: string): TagToken[] {
  const out: TagToken[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", value: text.slice(last, idx) });
    const key = m[1].toLowerCase();
    if (isGuideTagKey(key)) {
      const tag = TAG_BY_KEY[key];
      const label = (m[2] ?? tag.label).trim() || tag.label;
      out.push({ kind: "tag", key: key as GuideTagKey, label });
    }
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}
