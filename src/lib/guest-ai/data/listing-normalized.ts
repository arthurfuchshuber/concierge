/**
 * Conhecimento do anúncio a partir de `property_listing_raw_data.normalized` (PURO).
 *
 * COBERTURA INTEGRAL (F2, Parte 4, aprovada em 02/11/2026): todos os fatos do anúncio entram,
 * inclusive `identificacao`, os reviews públicos e a página pública processada (`public_listing`).
 * Só três recortes, cada um com motivo explícito:
 *  1. `identificacao`: o título bruto da Channex é "<conta> <apelido> · <título público>". O prefixo
 *     interno (nome/telefone do anfitrião) é ISOLADO com `splitListingTitle` e nunca entra no
 *     conhecimento; ficam o título público e as demais linhas (cidade, capacidade). Se o título
 *     não puder ser separado com segurança, a linha do título sai inteira (nunca o bruto).
 *  2. reviews: entra o "Public review" integral, a nota, a data e a resposta pública do anfitrião.
 *     O "Private feedback" é mensagem PRIVADA do hóspede ao anfitrião (não é review público) e não
 *     entra. Em produção (02/11/2026): 82 reviews, todos com "Public review:", 42 com "Private feedback:".
 *  3. `cohosts`: só traz o papel de repasse automático de pagamento (configuração interna), não é
 *     informação do anúncio para o hóspede.
 * Nada é truncado nem resumido.
 */
import type { ListingFacts } from "@/lib/guest-ai/types";
import { splitListingTitle } from "@/lib/playbook-build";

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const TITLE_LINE = /^(\s*T[ií]tulo do an[uú]ncio\s*:\s*)(.*)$/i;
/** Sequência longa de dígitos (telefone/documento) nunca vai ao modelo dentro do título. */
const LONG_DIGITS = /\d{6,}/;

/**
 * Remove o prefixo interno do título dentro do fato `identificacao`.
 * `publicName` = `properties.name` (o título público oficial, mesma fonte do Dossiê).
 */
export function sanitizeIdentificacao(content: string, publicName: string | null): string {
  return content
    .split(/\r?\n/)
    .flatMap((line) => {
      const m = TITLE_LINE.exec(line);
      if (!m) return [line];
      const raw = (m[2] ?? "").trim();
      const pub = (publicName ?? "").trim();
      const { internal, publicTitle } = splitListingTitle(raw, pub || null);
      // Só aceita o título quando a separação foi comprovada (havia prefixo interno identificado
      // ou o título bruto JÁ é o público) e ele não carrega números longos.
      const proven = (internal !== "" || (pub !== "" && raw === pub)) && !!publicTitle;
      const title = proven ? publicTitle : pub;
      if (!title || LONG_DIGITS.test(title)) return [];
      return [`${m[1]}${title}`];
    })
    .join("\n");
}

export interface PublicReview {
  score: number | null;
  receivedAt: string | null;
  text: string;
  hostReply: string | null;
}

/** Extrai só a parte pública de um review da Channex. Sem marcador público = não é review público. */
export function publicReviewText(content: unknown): string | null {
  if (typeof content !== "string") return null;
  const start = content.search(/Public review:/i);
  if (start < 0) return null;
  const after = content.slice(start).replace(/^Public review:\s*/i, "");
  const cut = after.search(/Private feedback:/i);
  const text = (cut >= 0 ? after.slice(0, cut) : after).trim();
  return text || null;
}

export function publicReviews(raw: unknown): { reviews: PublicReview[]; withheld: number } {
  if (!Array.isArray(raw)) return { reviews: [], withheld: 0 };
  const reviews: PublicReview[] = [];
  let withheld = 0;
  for (const item of raw) {
    const r = (item ?? {}) as Row;
    const text = publicReviewText(r["content"]);
    if (!text) {
      withheld += 1;
      continue;
    }
    reviews.push({
      score: typeof r["score"] === "number" ? r["score"] : null,
      receivedAt: s(r["received_at"]),
      text,
      hostReply: s(r["reply"]),
    });
  }
  return { reviews, withheld };
}

export function pickNormalized(raw: unknown, publicName: string | null): ListingFacts["normalized"] {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Row;
  const facts = Array.isArray(n["facts"])
    ? (n["facts"] as unknown[])
        .map((f) => f as Row)
        .filter((f) => typeof f?.["key"] === "string" && typeof f?.["content"] === "string")
        .map((f) => {
          const key = String(f["key"]);
          const content = String(f["content"]);
          return {
            key,
            title: String(f["title"] ?? ""),
            content: key === "identificacao" ? sanitizeIdentificacao(content, publicName) : content,
          };
        })
    : [];
  const w = n["checkin_window"] as Row | undefined;
  const pl = n["public_listing"];
  const { reviews } = publicReviews(n["reviews"]);
  return {
    facts,
    houseRules: n["house_rules"] ?? null,
    checkoutTime: s(n["checkout_time"]),
    checkinWindow: w && typeof w === "object" ? { start: s(w["start"]), end: s(w["end"]) } : null,
    cancellationPolicyLabel: s(n["cancellation_policy_label"]),
    cancellationPolicyDefault: n["cancellation_policy_default"] ?? null,
    instantBookingEnabled: typeof n["instant_booking_enabled"] === "boolean" ? n["instant_booking_enabled"] : null,
    instantBookingCategory: s(n["instant_booking_category"]),
    publicListing: pl && typeof pl === "object" && !Array.isArray(pl) ? (pl as Record<string, unknown>) : null,
    publicCheckedAt: s(n["public_checked_at"]),
    reviews,
  };
}
