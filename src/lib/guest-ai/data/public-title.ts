/**
 * Título PÚBLICO do imóvel para o conhecimento do hóspede (PURO, sem efeitos colaterais).
 *
 * `properties.name` às vezes começa com um código interno de gestão ("AP014 - Flat ao lado da
 * Santa Casa"). O catálogo do Dossiê define o nome interno como "a parte antes do hífen". Aqui o
 * código é separado SÓ na representação pública; `properties.name` nunca é alterado e o valor bruto
 * continua no banco para uso administrativo.
 *
 * Padrão verificado nos 44 imóveis de produção (02/11/2026): 32 nomes com código, todos no formato
 * `<2+ LETRAS MAIÚSCULAS><DÍGITOS> - <título>` (AP005…AP017, CS001…CS011, CS020, KT001…KT003,
 * LF001, SB001…SB003). Os 12 nomes sem código ("Studio n° 101…", "Apê…", "Casa…") não casam.
 * Regras de segurança contra remoção acidental:
 *  - o código precisa ser letras MAIÚSCULAS seguidas de dígitos, no INÍCIO, e depois um traço
 *    (hífen, meia-risca ou travessão);
 *  - se o que sobra depois do traço for vazio, nada é removido.
 */
const INTERNAL_CODE_PREFIX = /^([A-Z]{2,}\d+)\s*[-–—]\s*(\S.*)$/u;

export interface PublicTitle {
  /** Título para o hóspede (nunca vazio quando o nome original não é vazio). */
  publicTitle: string;
  /** Código interno separado, se houver (uso administrativo; não vai ao modelo). */
  internalCode: string | null;
  /** Nome original, intacto. */
  original: string;
}

export function splitPublicPropertyTitle(name: string | null | undefined): PublicTitle {
  const original = typeof name === "string" ? name : "";
  const trimmed = original.trim();
  const m = INTERNAL_CODE_PREFIX.exec(trimmed);
  if (!m || !m[2] || !m[2].trim()) return { publicTitle: trimmed, internalCode: null, original };
  return { publicTitle: m[2].trim(), internalCode: m[1] ?? null, original };
}

/** Atalho: só o título público (ou `null` quando não há nome). */
export function publicPropertyTitle(name: string | null | undefined): string | null {
  const t = splitPublicPropertyTitle(name).publicTitle;
  return t ? t : null;
}
