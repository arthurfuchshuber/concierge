/**
 * Portfólio SINTÉTICO para os testes da B2.2: 3 imóveis do tenant T1 (principal + 2 candidatos), 1
 * arquivado do T1 e 1 de outro tenant (T2). Cada imóvel tem marcadores únicos (para provar que nada
 * se mistura) e segredos plantados em texto livre (para provar que nada vaza). As tabelas trazem
 * colunas que NÃO podem ser lidas (senhas, minutos estimados) para provar que a projeção as ignora.
 */
import type { GuestAiDb } from "@/lib/guest-ai/data/client.server";

type Row = Record<string, unknown>;

export const T1 = "aaaaaaaa-0000-4000-8000-000000000001";
export const T2 = "bbbbbbbb-0000-4000-8000-000000000002";
export const P1 = "11111111-0000-4000-8000-000000000001"; // principal (T1)
export const P2 = "22222222-0000-4000-8000-000000000002"; // candidato (T1)
export const P3 = "33333333-0000-4000-8000-000000000003"; // candidato (T1)
export const PA = "44444444-0000-4000-8000-000000000004"; // arquivado (T1)
export const PX = "99999999-0000-4000-8000-000000000009"; // outro tenant (T2)

/** Segredos plantados em texto livre (valores sintéticos). Nenhum pode chegar ao prompt. */
export const PLANTED_SECRETS = ["Praia2024", "7788", "9911", "Netflix55", "4821", "Zk81Lm02Pq93Rs"];
/** Colunas protegidas presentes na tabela (nunca podem ser lidas). */
export const PROTECTED_VALUES = ["LOCK-SECRET-1", "GATE-SECRET-1", "WIFIPASS-SECRET-1", "PIN-SECRET-1"];

function property(id: string, owner: string, n: number, extra: Row = {}): Row {
  return {
    id,
    owner_id: owner,
    archived_at: null,
    name: `AP0${n} - Flat Marcador${n}`,
    short_description: `Apartamento inteiro MARCADOR-${n}`,
    airbnb_description_full: n === 2 ? "Ao chegar, digite 7788 no teclado da portaria. Vista para o mar MARCADOR-2." : `Descrição comercial do imóvel MARCADOR-${n}.`,
    address: `Rua Privada ${n}00, Centro`,
    city: "Foz do Iguaçu",
    state: "PR",
    country: "Brasil",
    maps_url: null,
    garage_maps_url: null,
    address_note: null,
    lock_label: null,
    in_condominium: false,
    apartment_number: null,
    apartment_floor: null,
    vehicles_max: null,
    access_mode: "pin",
    gate_label: null,
    checkin_instructions: null,
    checkin_note: null,
    checkout_instructions: null,
    checkout_note: null,
    wifi_ssid: `Rede-${n}`,
    house_rules: `REGRA-P${n}: sem festas.`,
    host_phone: null,
    airbnb_rating: null,
    airbnb_guest_count: n + 1,
    airbnb_bedroom_count: n,
    airbnb_bed_count: n === 3 ? null : n + 1,
    airbnb_bathroom_count: 1,
    airbnb_rooms_beds: null,
    airbnb_amenities: null,
    airbnb_house_rules: null,
    airbnb_cancellation_policy: null,
    airbnb_safety_info: null,
    airbnb_listing_url: null,
    airbnb_cancellation_category: null,
    checkin_time: "15:00",
    checkout_time: "11:00",
    parking_spots: null,
    has_elevator: true,
    // colunas protegidas (nunca projetadas)
    lock_code: "LOCK-SECRET-1",
    gate_code: "GATE-SECRET-1",
    wifi_password: "WIFIPASS-SECRET-1",
    pin_code: "PIN-SECRET-1",
    ...extra,
  };
}

function listing(propertyId: string, n: number, extra: Row = {}): Row {
  return {
    property_id: propertyId,
    synced_at: "2026-11-02T10:00:00Z",
    normalized: {
      facts: [
        { key: "identificacao", title: "Identificação", content: `Título do anúncio: Conta Sigma 5511999990000 · Flat Marcador${n}\nCidade: Foz do Iguaçu` },
        { key: "regras", title: "Regras", content: `Proibido fumar REGRA-LISTING-P${n}` },
      ],
      house_rules: null,
      checkout_time: n === 1 ? "10:00" : "11:00",
      checkin_window: { start: "15:00", end: "22:00" },
      cancellation_policy_label: "Moderada",
      instant_booking_enabled: true,
      public_listing: {
        guests: n === 2 ? 5 : n + 1,
        bedrooms: n,
        beds: n + 1,
        bathrooms: 1,
        amenities: [`AMENIDADE-P${n}`, "Wi-Fi"],
        unavailable: ["Secadora"],
        descriptions: [`Descrição pública P${n}`],
        houseRules: `Regras públicas P${n}`,
        safety: "Detector de fumaça",
        spaceType: "Apartamento inteiro",
        roomsBeds: [{ room: "Quarto 1", beds: "1 cama de casal" }],
        cover: `https://cdn.example.com/p${n}.jpg?token=Zk81Lm02Pq93Rs`,
      },
      reviews: [
        { id: "r1", score: 5, received_at: "2026-09-01T00:00:00Z", content: `Public review: Ótima estadia P${n}! Private feedback: o vizinho fez barulho PRIVADO-P${n}`, reply: `Obrigado, volte sempre P${n}` },
      ],
      cohosts: [{ name: null, role: "co-anfitrião (repasse automático nas reservas)" }],
      ...extra,
    },
  };
}

export function portfolioTables(): Record<string, Row[]> {
  return {
    properties: [
      property(P1, T1, 1),
      property(P2, T1, 2),
      property(P3, T1, 3),
      property(PA, T1, 4, { archived_at: "2026-10-01T00:00:00Z" }),
      property(PX, T2, 9),
    ],
    property_faqs: [
      { id: "faq-1", property_id: P1, question: "Qual a senha do Wi-Fi?", answer: "A senha do Wi-Fi é Praia2024", position: 1 },
      { id: "faq-2", property_id: P2, question: "Tem secador?", answer: "Sim, no banheiro MARCADOR-2", position: 1 },
      { id: "faq-9", property_id: PX, question: "Outro tenant", answer: "DADO-DE-OUTRO-TENANT", position: 1 },
    ],
    property_checkout_items: [{ id: "co-1", property_id: P1, label: "Desligar o ar", position: 1 }],
    property_emergency_contacts: [{ id: "em-1", property_id: P1, label: "Bombeiros", number: "193", position: 1 }],
    property_manual_items: [
      { id: "man-1", property_id: P1, title: "TV", description: "Como usar a TV MARCADOR-1", body: "Ligue no botão vermelho. A senha da TV: Netflix55", images: ["https://cdn.example.com/tv.jpg"], position: 1 },
      { id: "man-2", property_id: P2, title: "Cofre P2", description: "MANUAL-P2", body: "Manual do cofre", images: [], position: 1 },
    ],
    property_playbook_entries: [],
    property_listing_raw_data: [listing(P1, 1), listing(P2, 2), listing(P3, 3), listing(PX, 9)],
    property_recommendations: [
      { id: "rec-1", property_id: P1, name: "Padaria P1", category: "padaria", type: "bakery", rating: 4.7, user_ratings_total: 120, distance_meters: 350, opening_hours: ["seg–sáb 6h–20h"], note: "Ótimo pão", position: 1, walk_minutes: 4, drive_minutes: 1, distance_text: "350 m · 4 min a pé" },
      { id: "rec-3", property_id: P3, name: "Mercado P3", category: "mercado", type: "supermarket", rating: null, user_ratings_total: null, distance_meters: 1800, opening_hours: null, note: "código do portão 9911 para clientes", position: 1, walk_minutes: 23, drive_minutes: 3, distance_text: "1.8 km · 3 min de carro" },
    ],
  };
}

export interface DbCall {
  table: string;
  select: string | null;
  filters: Array<[string, unknown]>;
  signal: AbortSignal | null;
}

/** Banco falso que respeita a PROJEÇÃO: só devolve as colunas pedidas, filtradas por `eq`. */
export function portfolioDb(tables: Record<string, Row[]> = portfolioTables(), opts: { failTable?: string; ignoreFiltersOn?: string } = {}) {
  const calls: DbCall[] = [];
  const db: GuestAiDb = {
    from(table: string) {
      const st: DbCall = { table, select: null, filters: [], signal: null };
      calls.push(st);
      const rows = () => {
        const cols = (st.select ?? "").split(",").map((c) => c.trim()).filter(Boolean);
        return (tables[table] ?? [])
          .filter((r) => opts.ignoreFiltersOn === table || st.filters.every(([k, v]) => r[k] === v))
          .map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
      };
      const result = () => (opts.failTable === table ? { data: null, error: { message: "fail" } } : { data: rows(), error: null });
      const q: Record<string, unknown> = {
        select(c: string) { st.select = c; return q; },
        abortSignal(s: AbortSignal) { st.signal = s; return q; },
        eq(k: string, v: unknown) { st.filters.push([k, v]); return q; },
        order() { return q; },
        limit() { return q; },
        maybeSingle() {
          const r = result();
          return Promise.resolve(r.error ? r : { data: (r.data as Row[])[0] ?? null, error: null });
        },
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
          return Promise.resolve(result()).then(res, rej);
        },
      };
      return q;
    },
  };
  return { db, calls };
}
