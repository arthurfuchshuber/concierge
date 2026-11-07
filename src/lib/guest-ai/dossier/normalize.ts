/**
 * F2-B · B2.2 — NORMALIZAÇÃO do Dossiê de UM imóvel (pura, determinística, sem mutação).
 *
 * Reaproveita as fontes de verdade existentes (nenhuma segunda verdade):
 *  - linhas do Dossiê aprovado: `buildPlaybook` (mesma regra de audiência), projetadas por
 *    `projectDossier` (retém segredos, chaves de credencial, audiência I e não concedida);
 *  - anúncio: `pickNormalized` (cobertura integral aprovada: fatos, regras, página pública, reviews
 *    públicos; fora: feedback privado e co-anfitriões) e `detectListingConflicts` (horários);
 *  - manuais (com `description` e `images`, que faltavam), recomendações (distância em LINHA RETA;
 *    minutos estimados por velocidade presumida NUNCA entram).
 *
 * Regras: nada é truncado, resumido ou inferido. Ausente = desconhecido. Fontes divergentes viram
 * conflito explícito (com procedência), sem escolher uma. Avaliações são opinião datada (histórico),
 * descrição comercial não é garantia. Duplicata exata é unificada mantendo a procedência (`alsoIn`).
 * Linha de outro imóvel ⇒ erro (fail-closed). Os dados originais nunca são alterados.
 */
import { projectDossier, type DossierRowLike } from "@/lib/guest-ai/data/dossier-projection";
import { pickNormalized } from "@/lib/guest-ai/data/listing-normalized";
import { detectListingConflicts } from "@/lib/guest-ai/data/listing.server";
import { publicPropertyTitle } from "@/lib/guest-ai/data/public-title";
import type { BuildPlaybookFn } from "@/lib/guest-ai/data/dossier.server";
import { resolveDomain, type FactClaim, type FactDomain, type ResolvedFact } from "./authority";
import {
  DOSSIER_SOURCES,
  DossierError,
  type CapacityFacts,
  type DossierAudience,
  type DossierEntry,
  type DossierEntryKind,
  type DossierManual,
  type DossierSource,
  type Known,
  type GuidePlace,
  type PropertyDossier,
  type PropertyRole,
} from "./contracts";

type Row = Record<string, unknown>;

export interface DossierSources {
  property: Row;
  faqs: Array<{ id: string; question: string; answer: string }>;
  checkout: Array<{ id: string; label: string }>;
  emergency: Array<{ id: string; label: string; number: string }>;
  manuals: Array<{ id: string; title: string | null; description: string | null; body: string | null; images: unknown }>;
  entries: Row[];
  /** `property_listing_raw_data.normalized` da linha mais recente DO MESMO imóvel (ou null). */
  listingNormalized: unknown;
  recommendations: Row[];
  /** Referências da cidade do Explorar (mesma resolução do guia público: grupo vinculado ou o próprio imóvel). */
  cityReferences?: Row[];
  /** Grupo de referências do imóvel (`city_reference_group_members`), ou null. */
  cityReferenceGroupId?: string | null;
}

export interface NormalizeInput {
  target: { propertyId: string; tenantId: string; role: PropertyRole; audiences: readonly DossierAudience[] };
  sources: DossierSources;
  retrievedAt: string;
  buildPlaybook: BuildPlaybookFn;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Hosts oficiais do Google Maps aceitos como link da recomendação (qualquer outro ⇒ null). */
const GOOGLE_MAPS_HOSTS = new Set([
  "maps.google.com",
  "www.google.com",
  "google.com",
  "maps.app.goo.gl",
  "goo.gl",
  "www.google.com.br",
  "google.com.br",
  "maps.google.com.br",
]);
export function googleMapsUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 2048) return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    if (!GOOGLE_MAPS_HOSTS.has(host)) return null;
    // em google.com, só caminhos do Maps
    if ((host.endsWith("google.com") || host.endsWith("google.com.br")) && host !== "maps.google.com" && host !== "maps.google.com.br" && !u.pathname.startsWith("/maps"))
      return null;
    return u.toString();
  } catch {
    return null;
  }
}
const dedupeKey = (v: string) => v.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

function knownOf(cands: Array<{ value: number | null; source: string }>): Known<number> {
  const present = cands.filter((c): c is { value: number; source: string } => c.value !== null);
  if (present.length === 0) return { status: "unknown" };
  const distinct = new Set(present.map((c) => c.value));
  if (distinct.size === 1) return { status: "confirmed", value: present[0]!.value, sources: present.map((c) => c.source) };
  return { status: "conflict", values: present.map((c) => ({ value: c.value, source: c.source })) };
}

function kindOfPlaybookRow(id: string): { kind: DossierEntryKind; source: DossierSource } {
  if (id.startsWith("faq:")) return { kind: "faq", source: "property_faqs" };
  const key = id.replace(/^(f|custom):/, "");
  if (/regra|norma|silencio|proibid|permitid|animais|festa|fumar/.test(key)) return { kind: "rule", source: "playbook" };
  if (/descricao|tipo_de_espaco|titulo/.test(key)) return { kind: "commercial_description", source: "playbook" };
  if (/instruc|checkin|checkout|chegada|saida|acesso/.test(key)) return { kind: "instruction", source: "playbook" };
  if (/seguranca|camera|emergenc|extintor/.test(key)) return { kind: "safety", source: "playbook" };
  return { kind: "fact", source: "playbook" };
}

function listingFactKind(key: string): DossierEntryKind {
  if (/regra|rule/.test(key)) return "rule";
  if (/descri|identificacao|espaco|sobre/.test(key)) return "commercial_description";
  if (/seguranca|safety|aviso/.test(key)) return "safety";
  return "fact";
}

export function normalizePropertyDossier(input: NormalizeInput): PropertyDossier {
  const { target, sources: src, retrievedAt, buildPlaybook } = input;
  if (!target || typeof target.propertyId !== "string" || typeof target.tenantId !== "string") throw new DossierError("target_invalid");
  const audiences = new Set<DossierAudience>(target.audiences);
  if (!audiences.has("P") || [...audiences].some((a) => a !== "P" && a !== "G")) throw new DossierError("audiences_invalid");
  if (target.role === "candidate" && audiences.has("G")) throw new DossierError("candidate_cannot_have_reservation_audience");

  const p = src.property;
  if (!p || p["id"] !== target.propertyId) throw new DossierError("cross_property_row");
  for (const r of src.recommendations) if (r["property_id"] !== target.propertyId) throw new DossierError("cross_property_row");
  const groupId = src.cityReferenceGroupId ?? null;
  for (const r of src.cityReferences ?? []) {
    const own = groupId ? r["group_id"] === groupId : r["property_id"] === target.propertyId && r["group_id"] == null;
    if (!own) throw new DossierError("cross_property_row");
  }

  const publicName = publicPropertyTitle(str(p["name"]));
  const listing = pickNormalized(src.listingNormalized, publicName);
  const pub = (listing?.publicListing ?? null) as Row | null;

  // 1) Linhas do Dossiê aprovado (mesmo construtor da tela), projetadas pela audiência concedida.
  const sections = buildPlaybook({
    property: { ...p, name: publicName },
    faqs: src.faqs.map((f) => ({ ...f })),
    checkout: src.checkout.map((c) => ({ ...c })),
    emergency: src.emergency.map((e) => ({ ...e })),
    manuals: src.manuals.map((m) => ({ id: m.id, title: m.title ?? "" })),
    providers: [],
    entries: src.entries.map((e) => ({ ...e })) as never,
    listingFacts: listing?.facts ?? [],
  });
  const rows: DossierRowLike[] = sections.flatMap((s) => s.rows);
  const projected = projectDossier(rows, audiences, []);
  let withheld = projected.withheldByPolicy;

  const entries: DossierEntry[] = [];
  const seen = new Map<string, DossierEntry>();
  const push = (e: Omit<DossierEntry, "alsoIn">) => {
    if (!e.value.trim()) return;
    const key = dedupeKey(e.value);
    const prior = seen.get(key);
    if (prior) {
      if (prior.source !== e.source && !prior.alsoIn.includes(e.source)) prior.alsoIn.push(e.source);
      return;
    }
    const full: DossierEntry = { ...e, alsoIn: [] };
    seen.set(key, full);
    entries.push(full);
  };

  for (const it of projected.items) {
    // `projectDossier` nunca devolve audiência I; a checagem é defesa em profundidade.
    if (it.audience !== "P" && it.audience !== "G") throw new DossierError("internal_audience_leak");
    const { kind, source } = kindOfPlaybookRow(it.id);
    push({ id: it.id, label: it.label, value: it.value, kind, source, audience: it.audience, note: it.note, temporal: "current", observedAt: null });
  }

  // 2) Anúncio (Channex normalizado + página pública). Audiência P.
  if (listing) {
    for (const f of listing.facts) {
      push({ id: `listing:fact:${f.key}`, label: f.title || f.key, value: f.content, kind: listingFactKind(f.key), source: "listing_channex", audience: "P", note: null, temporal: "current", observedAt: null });
    }
    if (listing.checkoutTime) push({ id: "listing:checkout_time", label: "Horário de checkout (anúncio)", value: listing.checkoutTime, kind: "fact", source: "listing_channex", audience: "P", note: null, temporal: "current", observedAt: null });
    if (listing.checkinWindow && (listing.checkinWindow.start || listing.checkinWindow.end)) {
      push({ id: "listing:checkin_window", label: "Janela de check-in (anúncio)", value: [listing.checkinWindow.start, listing.checkinWindow.end].map((x) => x ?? "?").join(" – "), kind: "fact", source: "listing_channex", audience: "P", note: null, temporal: "current", observedAt: null });
    }
    if (listing.cancellationPolicyLabel) push({ id: "listing:cancellation", label: "Política de cancelamento (anúncio)", value: listing.cancellationPolicyLabel, kind: "rule", source: "listing_channex", audience: "P", note: null, temporal: "current", observedAt: null });
    if (listing.instantBookingEnabled !== null) push({ id: "listing:instant_booking", label: "Reserva instantânea (anúncio)", value: listing.instantBookingEnabled ? "ativada" : "desativada", kind: "fact", source: "listing_channex", audience: "P", note: null, temporal: "current", observedAt: null });

    if (pub) {
      const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
      const descs = strings(pub["descriptions"]);
      descs.forEach((d, i) => push({ id: `listing:public:description:${i + 1}`, label: "Descrição pública do anúncio", value: d, kind: "commercial_description", source: "listing_public_page", audience: "P", note: null, temporal: "current", observedAt: null }));
      const amen = strings(pub["amenities"]);
      if (amen.length) push({ id: "listing:public:amenities", label: "Comodidades informadas no anúncio", value: amen.join("\n"), kind: "amenity", source: "listing_public_page", audience: "P", note: null, temporal: "current", observedAt: null });
      const unav = strings(pub["unavailable"]);
      if (unav.length) push({ id: "listing:public:unavailable", label: "Itens que o anúncio informa como NÃO disponíveis", value: unav.join("\n"), kind: "amenity_unavailable", source: "listing_public_page", audience: "P", note: null, temporal: "current", observedAt: null });
      const rules = str(pub["houseRules"]);
      if (rules) push({ id: "listing:public:house_rules", label: "Regras da casa (página pública)", value: rules, kind: "rule", source: "listing_public_page", audience: "P", note: null, temporal: "current", observedAt: null });
      const safety = str(pub["safety"]);
      if (safety) push({ id: "listing:public:safety", label: "Segurança (página pública)", value: safety, kind: "safety", source: "listing_public_page", audience: "P", note: null, temporal: "current", observedAt: null });
      const space = str(pub["spaceType"]);
      if (space) push({ id: "listing:public:space_type", label: "Tipo de espaço (página pública)", value: space, kind: "fact", source: "listing_public_page", audience: "P", note: null, temporal: "current", observedAt: null });
      const rooms = Array.isArray(pub["roomsBeds"])
        ? (pub["roomsBeds"] as unknown[])
            .map((r) => (r && typeof r === "object" ? (r as Row) : {}))
            .map((r) => [str(r["room"]), str(r["beds"])].filter(Boolean).join(": "))
            .filter(Boolean)
        : [];
      if (rooms.length) push({ id: "listing:public:rooms_beds", label: "Quartos e camas (página pública)", value: rooms.join("\n"), kind: "fact", source: "listing_public_page", audience: "P", note: null, temporal: "current", observedAt: null });
    }

    listing.reviews.forEach((r, i) => {
      const n = i + 1;
      push({ id: `listing:review:${n}`, label: r.score !== null ? `Avaliação pública de hóspede (nota ${r.score})` : "Avaliação pública de hóspede", value: r.text, kind: "guest_review", source: "listing_channex", audience: "P", note: null, temporal: "historical", observedAt: r.receivedAt });
      if (r.hostReply) push({ id: `listing:review:${n}:reply`, label: "Resposta pública do anfitrião", value: r.hostReply, kind: "host_reply", source: "listing_channex", audience: "P", note: null, temporal: "historical", observedAt: r.receivedAt });
    });
  }

  // 3) Capacidade com procedência (cadastro sincronizado × página pública): conflito nunca é resolvido aqui.
  const capacity: CapacityFacts = {
    guests: knownOf([{ value: num(p["airbnb_guest_count"]), source: "properties.airbnb_guest_count" }, { value: num(pub?.["guests"]), source: "listing.public.guests" }]),
    bedrooms: knownOf([{ value: num(p["airbnb_bedroom_count"]), source: "properties.airbnb_bedroom_count" }, { value: num(pub?.["bedrooms"]), source: "listing.public.bedrooms" }]),
    beds: knownOf([{ value: num(p["airbnb_bed_count"]), source: "properties.airbnb_bed_count" }, { value: num(pub?.["beds"]), source: "listing.public.beds" }]),
    bathrooms: knownOf([{ value: num(p["airbnb_bathroom_count"]), source: "properties.airbnb_bathroom_count" }, { value: num(pub?.["bathrooms"]), source: "listing.public.bathrooms" }]),
  };

  const conflicts: string[] = [
    ...detectListingConflicts(listing, { checkInTime: str(p["checkin_time"]), checkOutTime: str(p["checkout_time"]) }),
  ];
  // B2.4: resolução por autoridade de domínio (horários padrão, capacidade, regras da casa).
  const resolved = resolveDossierFacts(target.propertyId, p, listing, pub, retrievedAt);
  const unknown: string[] = [];
  for (const [k, v] of Object.entries(capacity) as Array<[keyof CapacityFacts, Known<number>]>) {
    if (v.status === "unknown") unknown.push(`capacity.${k}`);
    if (v.status === "conflict") conflicts.push(`capacity.${k}: ${v.values.map((x) => `${x.source}=${x.value}`).join(" × ")}`);
  }
  if (!publicName) unknown.push("public_name");

  // 4) Manuais (audiência G no catálogo: só com reserva ativa, nunca para candidato).
  const manuals: DossierManual[] = [];
  if (audiences.has("G")) {
    for (const m of src.manuals) {
      const imageRefs = Array.isArray(m.images) ? (m.images as unknown[]).filter((u): u is string => typeof u === "string" && !!u.trim()) : [];
      if (!str(m.title) && !str(m.description) && !str(m.body) && imageRefs.length === 0) continue;
      manuals.push({ id: `manual:${m.id}`, title: m.title ?? "", description: str(m.description), body: str(m.body), imageRefs });
    }
  } else {
    withheld += src.manuals.length;
  }

  // 5) Recomendações do guia (Google Maps). Distância só de TRAJETO confirmado pelo servidor (Pilar 2).
  const hoursOf = (v: unknown) =>
    Array.isArray(v) ? (v as unknown[]).filter((h): h is string => typeof h === "string") : null;
  const places: GuidePlace[] = [
    ...src.recommendations
      .filter((r) => (r["scope"] ?? "nearby") === "nearby")
      .map((r): GuidePlace => {
        const meters = num(r["distance_meters"]);
        const routed = r["distance_kind"] === "route" && meters !== null && meters >= 0;
        const minutes = (v: unknown) => {
          const n = num(v);
          return n !== null && n > 0 ? Math.round(n) : null;
        };
        return {
          id: `rec:${String(r["id"])}`,
          scope: "nearby",
          name: str(r["name"]) ?? "",
          category: str(r["category"]),
          type: str(r["type"]),
          rating: num(r["rating"]),
          ratingsTotal: num(r["user_ratings_total"]),
          openingHours: hoursOf(r["opening_hours"]),
          note: str(r["note"]),
          mapsUrl: googleMapsUrl(r["maps_url"]),
          route: routed ? { meters: Math.round(meters!), walkMinutes: minutes(r["walk_minutes"]), driveMinutes: minutes(r["drive_minutes"]) } : null,
        };
      }),
    ...(src.cityReferences ?? []).map(
      (r): GuidePlace => ({
        id: `cref:${String(r["id"])}`,
        scope: "city",
        name: str(r["name"]) ?? "",
        category: str(r["category"]),
        type: str(r["type"]),
        rating: num(r["rating"]),
        ratingsTotal: num(r["user_ratings_total"]),
        openingHours: hoursOf(r["opening_hours"]),
        note: str(r["note"]),
        mapsUrl: googleMapsUrl(r["maps_url"]),
        route: null,
      }),
    ),
  ].filter((x) => x.name.trim());

  const mediaRefs: PropertyDossier["mediaRefs"] = [];
  const cover = str(pub?.["cover"]);
  if (cover) mediaRefs.push({ id: "listing:public:cover", url: cover, source: "listing_public_page" });

  const present = new Set<DossierSource>();
  if (projected.items.some((i) => !i.id.startsWith("faq:"))) present.add("playbook");
  if (src.faqs.some((f) => (f.question ?? "").trim() || (f.answer ?? "").trim())) present.add("property_faqs");
  if (listing) present.add("listing_channex");
  if (pub) present.add("listing_public_page");
  if (manuals.length) present.add("property_manual_items");
  if (places.some((x) => x.scope === "nearby")) present.add("property_recommendations");
  if (places.some((x) => x.scope === "city")) present.add("city_references");

  return {
    version: 1,
    propertyId: target.propertyId,
    tenantId: target.tenantId,
    role: target.role,
    publicName,
    audiences: [...target.audiences],
    retrievedAt,
    capacity,
    entries,
    manuals,
    places,
    mediaRefs,
    conflicts,
    unknown,
    completeness: {
      sourcesPresent: DOSSIER_SOURCES.filter((s) => present.has(s)),
      sourcesMissing: DOSSIER_SOURCES.filter((s) => !present.has(s)),
      withheldByPolicy: withheld,
    },
    availability: { status: "not_consulted" },
    resolved,
  };
}

/** Horário HH:MM normalizado (o banco guarda `HH:MM:SS`). */
const hm = (v: unknown): string | null => {
  const t = str(v);
  return t && /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : null;
};

/**
 * Afirmações por domínio a partir das fontes já carregadas (nenhuma leitura nova) e resolução
 * por autoridade. Fontes ausentes simplesmente não geram afirmação.
 */
function resolveDossierFacts(
  propertyId: string,
  p: Row,
  listing: ReturnType<typeof pickNormalized>,
  pub: Row | null,
  now: string,
): ResolvedFact[] {
  const claims: FactClaim[] = [];
  const add = (domain: FactDomain, value: string | number | null, source: FactClaim["source"], sourceRef: string) => {
    if (value === null || value === "") return;
    claims.push({ domain, propertyId, value, source, sourceRef, observedAt: null, validUntil: null, temporal: "current" });
  };
  add("checkin_time_standard", hm(p["checkin_time"]), "official_property_record", "properties.checkin_time");
  add("checkin_time_standard", hm(listing?.checkinWindow?.start), "listing_public", "listing.checkin_window.start");
  add("checkout_time_standard", hm(p["checkout_time"]), "official_property_record", "properties.checkout_time");
  add("checkout_time_standard", hm(listing?.checkoutTime), "listing_public", "listing.checkout_time");
  add("max_guests", num(p["airbnb_guest_count"]), "listing_sync_copy", "properties.airbnb_guest_count");
  add("max_guests", num(pub?.["guests"]), "listing_public", "listing.public.guests");
  add("house_rules", str(p["house_rules"]), "official_property_record", "properties.house_rules");
  add("house_rules", str(p["airbnb_house_rules"]), "listing_sync_copy", "properties.airbnb_house_rules");
  add("house_rules", str(pub?.["houseRules"]), "listing_public", "listing.public.house_rules");
  const domains: FactDomain[] = ["checkin_time_standard", "checkout_time_standard", "max_guests", "house_rules"];
  return domains.map((d) => resolveDomain(d, propertyId, claims, now));
}
