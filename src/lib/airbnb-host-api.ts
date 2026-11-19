/**
 * Leitura PURA (sem rede, testável) dos dados cadastrais do anúncio vindos da API
 * oficial do anfitrião no Airbnb (`api.airbnb.com/v2`, token OAuth do canal na Channex).
 *
 * Regra de mapeamento (19/11/2026): os dados entram nas colunas NATIVAS que já existem
 * em `properties` (lat, lng, address, city, state, country, gallery_images,
 * checkin_instructions, checkout_instructions, airbnb_*). Não há coluna nova: o CEP
 * entra no endereço composto. Campo editado à mão no sistema nunca é sobrescrito.
 */

export type HostRoom = { room: string; beds: string };
export type HostPhoto = { url: string; caption: string | null; sortOrder: number; roomId: string | null };

export type HostListing = {
  listingId: string;
  street: string | null;
  apt: string | null;
  /** `property_details.number_of_floors` (pavimentos do edifício/casa). */
  numberOfFloors?: number | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  directions: string | null;
  personCapacity: number | null;
  bedrooms: number | null;
  beds: number | null;
  bathrooms: number | null;
  nickname: string | null;
  checkoutTasks: string[];
  /** Instruções de check-in escritas pelo anfitrião no Airbnb (`check_in_option.instruction`). */
  checkInInstruction?: string | null;
  /** Manual da casa escrito pelo anfitrião no Airbnb (`house_manual`). */
  houseManual?: string | null;
  /** Andar do imóvel segundo o anúncio (`property_details.listing_floor`; 1 = térreo). */
  listingFloor?: number | null;
  /** Horário de silêncio do anúncio (`quiet_hours`), já em HH:MM. */
  quietHours?: Array<{ start: string; end: string }>;
  isGuestFavorite: boolean | null;
  isSuperhost: boolean | null;
  name: string | null;
  summary: string | null;
  description: string | null;
  /** Demais seções da descrição do anúncio (todas as que a API devolver). */
  space: string | null;
  access: string | null;
  interaction: string | null;
  neighborhoodOverview: string | null;
  transit: string | null;
  notes: string | null;
  houseRules: string | null;
  propertyType: string | null;
  roomType: string | null;
  checkInStart: string | null;
  checkInEnd: string | null;
  checkOutTime: string | null;
  wifiSsid: string | null;
  wifiPassword: string | null;
  rooms: HostRoom[];
  photos: HostPhoto[];
  fetchedAt: string;
  /** Respostas BRUTAS das 4 chamadas, guardadas sem filtro para nenhum campo se perder. */
  raw?: { listing?: unknown; descriptions?: unknown; rooms?: unknown; photos?: unknown };
};

/** "15" → "15:00"; "9:30" → "09:30"; "FLEXIBLE"/vazio → null. */
export function hhmmOf(v: unknown): string | null {
  const t = String(v ?? "").trim();
  if (/^\d{1,2}$/.test(t) && Number(t) <= 24) return `${t.padStart(2, "0")}:00`;
  if (/^\d{1,2}:\d{2}$/.test(t)) return t.padStart(5, "0");
  return null;
}

const str = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return t ? t : null;
};
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const humanize = (s: string) => {
  const t = s.replace(/[_-]+/g, " ").trim().toLowerCase();
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
};

const CHECKOUT_TASK_LABEL: Record<string, string> = {
  RETURN_KEYS: "Devolver as chaves",
  THROW_TRASH: "Jogar o lixo fora",
  THROW_TRASH_AWAY: "Jogar o lixo fora",
  GATHER_TOWELS: "Juntar as toalhas usadas",
  GATHER_USED_TOWELS: "Juntar as toalhas usadas",
  TURN_THINGS_OFF: "Desligar luzes e aparelhos",
  TURN_OFF_APPLIANCES: "Desligar luzes e aparelhos",
  LOCK_UP: "Trancar a porta ao sair",
  LOCK_DOORS: "Trancar a porta ao sair",
  STRIP_BEDS: "Retirar a roupa de cama",
  WASH_DISHES: "Lavar a louça",
};

const ROOM_LABEL: Record<string, string> = {
  bedroom: "Quarto",
  living_room: "Sala de estar",
  common_space: "Área comum",
  common_spaces: "Áreas comuns",
  kitchen: "Cozinha",
  kitchenette: "Cozinha compacta",
  full_bathroom: "Banheiro",
  bathroom: "Banheiro",
  half_bathroom: "Lavabo",
  dining_room: "Sala de jantar",
  workspace: "Espaço de trabalho",
  office: "Escritório",
  pool: "Piscina",
  hot_tub: "Banheira de hidromassagem",
  patio: "Pátio",
  backyard: "Quintal",
  balcony: "Varanda",
  laundry_room: "Lavanderia",
  garage: "Garagem",
  gym: "Academia",
  studio: "Estúdio",
};

const BED_LABEL: Record<string, string> = {
  king_bed: "cama king",
  queen_bed: "cama queen",
  double_bed: "cama de casal",
  single_bed: "cama de solteiro",
  small_double_bed: "cama de casal pequena",
  sofa_bed: "sofá-cama",
  couch: "sofá",
  bunk_bed: "beliche",
  air_mattress: "colchão inflável",
  floor_mattress: "colchão no chão",
  crib: "berço",
  toddler_bed: "cama infantil",
  hammock: "rede",
  water_bed: "cama d'água",
};

/** A API às vezes embrulha (`{ listing: {...} }`) e às vezes não. */
function unwrap(raw: unknown, key: string): Record<string, any> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const inner = r[key];
  if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner;
  return r;
}
function list(raw: unknown, key: string): Array<Record<string, any>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, any>>;
  const v = raw && typeof raw === "object" ? (raw as Record<string, any>)[key] : null;
  return Array.isArray(v) ? v : [];
}

/** Tarefas de saída do anúncio em português (texto livre do anfitrião vem junto). */
export function checkoutTaskLines(tasks: unknown): string[] {
  // A API devolve um objeto { RETURN_KEYS: { is_present, task_detail } }: a chave É o tipo da tarefa.
  const arr = Array.isArray(tasks)
    ? tasks
    : tasks && typeof tasks === "object"
      ? Object.entries(tasks as Record<string, unknown>)
          .filter(([, v]) => !(v && typeof v === "object" && (v as Record<string, unknown>).is_present === false))
          .map(([k, v]) => ({ ...(v && typeof v === "object" ? (v as object) : {}), type: k }))
      : [];
  const out: string[] = [];
  for (const t of arr) {
    if (typeof t === "string") {
      const k = t.trim().toUpperCase();
      if (k) out.push(CHECKOUT_TASK_LABEL[k] ?? humanize(k));
      continue;
    }
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    const k = String(o.type ?? o.task_type ?? o.name ?? "").trim().toUpperCase();
    const det = str(o.task_detail ?? o.details ?? o.additional_text ?? o.description ?? o.text);
    const free = k === "ADDITIONAL_REQUESTS" || k === "OTHER" || k === "OTHER_REQUESTS";
    const label = k && !(free && det) ? (CHECKOUT_TASK_LABEL[k] ?? humanize(k)) : null;
    const line = [label, det].filter(Boolean).join(": ");
    if (line) out.push(line);
  }
  return [...new Set(out)];
}

/** "cama de casal" → "camas de casal"; "sofá-cama" → "sofás-cama"; "berço" → "berços". */
function plural(label: string): string {
  const [first, ...rest] = label.split(" ");
  const p = first!.endsWith("ão") ? first!.slice(0, -2) + "ões" : first!.replace(/^(sofá)-cama$/, "sofás-cama");
  const head = p === first ? (/[aeiouáéíóú]$/.test(first!) ? first + "s" : first) : p;
  return [head, ...rest].join(" ");
}

function bedsText(beds: unknown): string {
  const parts: string[] = [];
  for (const b of Array.isArray(beds) ? beds : []) {
    if (!b || typeof b !== "object") continue;
    const o = b as Record<string, unknown>;
    const type = String(o.type ?? o.bed_type ?? "").trim().toLowerCase();
    const qty = num(o.quantity ?? o.count) ?? 1;
    if (!type || qty <= 0) continue;
    const label = BED_LABEL[type] ?? humanize(type).toLowerCase();
    parts.push(`${qty} ${qty > 1 ? plural(label) : label}`);
  }
  return parts.join(", ");
}

/** Cômodos no mesmo formato de `properties.airbnb_rooms_beds` ({ room, beds }). */
export function parseRooms(raw: unknown): HostRoom[] {
  const out: HostRoom[] = [];
  let bedroomN = 0;
  const sorted = list(raw, "listing_rooms").slice().sort((a, b) => (num(a.room_number) ?? 0) - (num(b.room_number) ?? 0));
  for (const r of sorted) {
    const type = String(r.room_type ?? r.type ?? (num(r.room_number) === 0 ? "common_space" : "bedroom")).trim().toLowerCase();
    const beds = bedsText(r.beds);
    let room = str(r.name) ?? ROOM_LABEL[type] ?? humanize(type);
    if (type === "bedroom" && !str(r.name)) room = `Quarto ${++bedroomN}`;
    if (!beds && type === "common_space") continue;
    out.push({ room: room.slice(0, 80), beds: (beds || "sem camas").slice(0, 200) });
  }
  return out.slice(0, 30);
}

/** Fotos ordenadas por `sort_order` (todas, sem o limite antigo de 1). */
export function parsePhotos(raw: unknown): HostPhoto[] {
  const out: HostPhoto[] = [];
  for (const p of list(raw, "listing_photos")) {
    const url = str(p.extra_medium_url ?? p.large_url ?? p.x_large_url ?? p.xl_picture_url ?? p.picture ?? p.url);
    if (!url || !/^https:\/\//.test(url)) continue;
    out.push({ url, caption: str(p.caption), sortOrder: num(p.sort_order) ?? 9999, roomId: str(p.room_id) });
  }
  out.sort((a, b) => a.sortOrder - b.sortOrder);
  const seen = new Set<string>();
  return out.filter((p) => (seen.has(p.url) ? false : (seen.add(p.url), true)));
}

/** Descrição no idioma do anfitrião: prefere pt, depois a primeira disponível. */
function pickDescription(raw: unknown): Record<string, any> | null {
  const arr = list(raw, "listing_descriptions");
  if (!arr.length) return unwrap(raw, "listing_description");
  return arr.find((d) => /^pt/i.test(String(d.locale ?? ""))) ?? arr[0] ?? null;
}

const validCoord = (lat: number | null, lng: number | null) =>
  lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

export function parseHostListing(
  listingId: string,
  parts: { listing?: unknown; descriptions?: unknown; rooms?: unknown; photos?: unknown },
  now = new Date(),
): HostListing | null {
  const l = unwrap(parts.listing, "listing") ?? {};
  const d = pickDescription(parts.descriptions) ?? {};
  const lat = num(l.lat);
  const lng = num(l.lng);
  const coords = validCoord(lat, lng);
  const qs = (l.quality_standards ?? {}) as Record<string, unknown>;
  const wifi = (l.wireless_info ?? l.wifi_info ?? {}) as Record<string, unknown>;
  const roles = (l.host_roles ?? {}) as Record<string, unknown>;
  const out: HostListing = {
    listingId,
    street: str(l.street),
    apt: str(l.apt),
    city: str(l.city),
    state: str(l.state)?.replace(/^(state|estado) (of|de|do) /i, "") ?? null,
    zipcode: str(l.zipcode),
    countryCode: str(l.country_code)?.toUpperCase() ?? null,
    lat: coords ? lat : null,
    lng: coords ? lng : null,
    directions: str(l.directions),
    personCapacity: num(l.person_capacity),
    bedrooms: num(l.bedrooms),
    beds: num(l.beds),
    bathrooms: num(l.bathrooms),
    nickname: str(l.listing_nickname),
    checkoutTasks: checkoutTaskLines(l.check_out_tasks),
    checkInInstruction: checkInInstructionOf(l),
    houseManual: str(l.house_manual),
    listingFloor: listingFloorOf(l),
    numberOfFloors: numberOfFloorsOf(l),
    quietHours: quietHoursOf(l),
    isGuestFavorite: typeof qs.is_guest_favorite === "boolean" ? qs.is_guest_favorite : null,
    isSuperhost: typeof roles.is_super_host === "boolean" ? roles.is_super_host : null,
    name: str(d.name),
    summary: str(d.summary),
    description: str(d.description),
    space: str(d.space ?? l.space),
    access: str(d.access ?? l.access),
    interaction: str(d.interaction ?? l.interaction),
    neighborhoodOverview: str(d.neighborhood_overview ?? l.neighborhood_overview),
    transit: str(d.transit ?? l.transit),
    notes: str(d.notes ?? l.notes),
    houseRules: str(d.house_rules ?? l.house_rules),
    propertyType: str(l.property_type_group ?? l.property_type ?? l.property_type_category),
    roomType: str(l.room_type_category ?? l.room_type),
    checkInStart: hhmmOf(l.check_in_time_start),
    checkInEnd: hhmmOf(l.check_in_time_end),
    checkOutTime: hhmmOf(l.check_out_time),
    wifiSsid: str(wifi.wireless_ssid ?? wifi.ssid ?? l.wifi_network ?? l.wireless_ssid),
    wifiPassword: str(wifi.wireless_password ?? wifi.password ?? l.wifi_password ?? l.wireless_password),
    rooms: parseRooms(parts.rooms),
    photos: parsePhotos(parts.photos),
    fetchedAt: now.toISOString(),
    raw: { listing: parts.listing, descriptions: parts.descriptions, rooms: parts.rooms, photos: parts.photos },
  };
  const anything =
    out.street || out.city || out.lat != null || out.directions || out.personCapacity != null ||
    out.rooms.length || out.photos.length || out.description || out.checkoutTasks.length || out.name || out.space || out.houseRules;
  return anything ? out : null;
}

/** Endereço composto: rua, complemento e CEP (o CEP não tem coluna própria). */
export function composeAddress(h: Pick<HostListing, "street" | "apt" | "zipcode">): string | null {
  if (!h.street) return null;
  return [h.street, h.apt, h.zipcode ? `CEP ${h.zipcode}` : null].filter(Boolean).join(", ");
}

/** `check_in_option.instruction` do anúncio (texto livre do anfitrião). */
export function checkInInstructionOf(l: Record<string, unknown> | null | undefined): string | null {
  const opt = (l?.check_in_option ?? null) as Record<string, unknown> | null;
  return opt && typeof opt === "object" ? str(opt.instruction) : null;
}

function innerRawListing(h: HostListing): Record<string, unknown> | null {
  const raw = h.raw?.listing as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  return (raw["listing"] && typeof raw["listing"] === "object" ? raw["listing"] : raw) as Record<string, unknown>;
}

/**
 * Lê também do JSON BRUTO guardado (`raw.listing`): anúncios sincronizados antes deste campo existir já têm o
 * texto lá (caso Larissa/Whyll, 19/11/2026: "Abriremos o portão da garagem remotamente" estava só no bruto).
 */
function rawListingField(h: HostListing, pick: (l: Record<string, unknown>) => string | null): string | null {
  const l = innerRawListing(h);
  return l ? pick(l) : null;
}

const CHECKIN_CATEGORY: Record<string, string> = {
  lockbox: "Autoatendimento com cofre de chaves",
  smartlock: "Autoatendimento com fechadura inteligente",
  keypad: "Autoatendimento com teclado numérico",
  doorman_entry: "Recepção por porteiro",
  building_staff: "Recepção pela equipe do prédio",
  host_checkin: "Recepção pelo anfitrião",
  other_checkin: "Outro método de check-in",
};

const VIEW_LABEL: Record<string, string> = {
  COURTYARD_VIEW: "pátio",
  GARDEN_VIEW: "jardim",
  POOL_VIEW: "piscina",
  CITY_SKYLINE_VIEW: "cidade",
  MOUNTAIN_VIEW: "montanhas",
  PARK_VIEW: "parque",
  RIVER_VIEW: "rio",
  LAKE_VIEW: "lago",
  BEACH_VIEW: "praia",
  OCEAN_VIEW: "oceano",
  SEA_VIEW: "mar",
  VALLEY_VIEW: "vale",
};

/** `property_details.listing_floor` (1 = térreo). */
export function listingFloorOf(l: Record<string, unknown> | null | undefined): number | null {
  const d = (l?.property_details ?? null) as Record<string, unknown> | null;
  const f = d && typeof d === "object" ? num(d.listing_floor) : null;
  return f !== null && f >= 0 ? Math.round(f) : null;
}

/** `property_details.number_of_floors` (pavimentos do edifício/casa). */
export function numberOfFloorsOf(l: Record<string, unknown> | null | undefined): number | null {
  const d = (l?.property_details ?? null) as Record<string, unknown> | null;
  const n = d && typeof d === "object" ? num(d.number_of_floors) : null;
  return n !== null && n >= 1 ? Math.round(n) : null;
}

/**
 * Andar no formato do campo `apartment_floor` (regra do titular, 19/11/2026). No Airbnb `listing_floor: 1`
 * é o primeiro pavimento e só é "Térreo" em imóvel de um pavimento; em prédio/condomínio é "1º andar".
 *  - 0 → "Térreo";
 *  - 1 → "Térreo" se `number_of_floors === 1`; "1º andar" se > 1; sem o dado, "1º andar" só em apartamento/condomínio;
 *  - ≥ 2 → "<n>º andar".
 */
export function floorLabelOf(
  listingFloor: number | null | undefined,
  numberOfFloors?: number | null,
  multiUnit?: boolean | null,
): string | null {
  if (listingFloor == null || !Number.isFinite(listingFloor) || listingFloor < 0) return null;
  if (listingFloor === 0) return "Térreo";
  if (listingFloor === 1) {
    if (numberOfFloors === 1) return "Térreo";
    if (numberOfFloors != null && numberOfFloors > 1) return "1º andar";
    return multiUnit ? "1º andar" : "Térreo";
  }
  return `${listingFloor}º andar`;
}

const MULTI_UNIT_TYPE = /apartment|apartamento|condo|flat|loft|studio|kitnet/i;
const isMultiUnitType = (t: string | null | undefined) => !!t && MULTI_UNIT_TYPE.test(t);

/** Número da unidade e vaga a partir do `apt` do anúncio ("Apto 202, Bloco 1 - Garagem 202"). "Casa"/"Studio" sem número → nada. */
export function parseApt(apt: string | null | undefined): { unit: string | null; parking: string | null } {
  const raw = (apt ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return { unit: null, parking: null };
  let parking: string | null = null;
  let rest = raw.replace(/\s*[-–,;]?\s*\b(?:garagem|vagas?)\s*(?:n[°ºo.]?\s*)?([0-9][0-9A-Za-z]*)/i, (_m, v: string) => {
    parking = v;
    return "";
  });
  rest = rest.replace(/[\s,;-]+$/, "").trim();
  const m = rest.match(/^(?:apto?\.?|apartamento|ap\.?|studio|sala|unidade|conj(?:unto)?\.?)?\s*(?:n[°ºo.]?\s*)?([0-9][0-9A-Za-z]*)\s*(.*)$/i);
  if (!m) return { unit: null, parking };
  const tail = (m[2] ?? "").replace(/^[\s,;-]+/, "").trim();
  const unit = tail ? `${m[1]}, ${tail}` : m[1]!;
  return { unit: unit.slice(0, 40), parking };
}

/** Fallback para imóveis sem API: procura "Apto 101" / "Studio n° 4" nos trechos do endereço salvo. */
export function extractUnitFromAddress(address: string | null | undefined): { unit: string | null; parking: string | null } {
  for (const seg of (address ?? "").split(",")) {
    const t = seg.trim();
    if (!/^(?:apto?\.?|apartamento|ap\.?|studio)\b/i.test(t)) continue;
    const r = parseApt(t);
    if (r.unit) return r;
  }
  return { unit: null, parking: null };
}

/** `quiet_hours` do anúncio: [{ start_time: "23", end_time: "7" }] → [{ start: "23:00", end: "07:00" }]. */
export function quietHoursOf(l: Record<string, unknown> | null | undefined): Array<{ start: string; end: string }> {
  const q = l?.quiet_hours;
  const out: Array<{ start: string; end: string }> = [];
  for (const e of Array.isArray(q) ? q : []) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const start = hhmmOf(o.start_time ?? o.start);
    const end = hhmmOf(o.end_time ?? o.end);
    if (start && end) out.push({ start, end });
  }
  return out;
}

export function quietHoursText(h: Pick<HostListing, "quietHours" | "raw"> | null | undefined): string | null {
  if (!h) return null;
  const list = h.quietHours?.length ? h.quietHours : quietHoursOf(innerRawListing(h as HostListing));
  return list.length ? list.map((x) => `${x.start} às ${x.end}`).join(" · ") : null;
}

/** Estrutura física e método de check-in do anúncio (`property_details`, `listing_views`, `check_in_option.category`). */
export function propertyStructureText(l: Record<string, unknown>): string | null {
  const d = (l.property_details ?? {}) as Record<string, unknown>;
  const size = (d.listing_size ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  const area = num(size.size);
  if (area) lines.push(`Área: ${area} ${size.size_unit === "SQUARE_FEET" ? "pés²" : "m²"}`);
  const floor = num(d.listing_floor);
  const floors = num(d.number_of_floors);
  const floorText = floor !== null ? floorLabelOf(floor, floors, isMultiUnitType(str(l.property_type_group ?? l.property_type_category))) : null;
  if (floorText) lines.push(`Andar do imóvel: ${floorText.toLowerCase()}`);
  if (floors) lines.push(`Pavimentos do edifício/casa: ${floors}`);
  const year = num(d.year_built);
  if (year) lines.push(`Ano de construção: ${year}`);
  const views = Array.isArray(l.listing_views) ? (l.listing_views as unknown[]).map((v) => VIEW_LABEL[String(v)] ?? "").filter(Boolean) : [];
  if (views.length) lines.push(`Vista: ${views.join(", ")}`);
  const cat = str(((l.check_in_option ?? {}) as Record<string, unknown>).category);
  if (cat && CHECKIN_CATEGORY[cat]) lines.push(`Método de check-in: ${CHECKIN_CATEGORY[cat]}`);
  return lines.length ? lines.join("\n") : null;
}

export function checkoutInstructionsText(h: Pick<HostListing, "checkoutTasks">): string | null {
  // Texto que o anfitrião já numerou ("1. Retire o veículo…") entra como está, sem marcador por cima.
  return Array.isArray(h.checkoutTasks) && h.checkoutTasks.length ? h.checkoutTasks.map((t) => (/^\s*\d+[.)]\s/.test(t) ? t : `• ${t}`)).join("\n") : null;
}

const SECTIONS: Array<[keyof HostListing, string, string]> = [
  ["space", "o_espaco", "O espaço"],
  ["access", "acesso_hospede", "Acesso do hóspede"],
  ["interaction", "interacao_hospede", "Interação com o hóspede"],
  ["neighborhoodOverview", "vizinhanca", "A vizinhança"],
  ["transit", "transporte", "Como se locomover"],
  ["notes", "outras_observacoes", "Outras observações"],
];

/** Descrição COMPLETA do anúncio, com todas as seções que a API devolveu. */
export function fullDescriptionText(h: HostListing): string | null {
  const parts: string[] = [];
  const main = [h.summary, h.description].filter(Boolean).join("\n\n");
  if (main) parts.push(main);
  for (const [k, , title] of SECTIONS) {
    const v = h[k];
    if (typeof v === "string" && v) parts.push(`${title}\n${v}`);
  }
  return parts.length ? parts.join("\n\n") : null;
}

/**
 * Manual da casa do anúncio vira um campo do próprio Dossiê (seção 3, "Manual da casa", Reserva Ativa),
 * no mesmo formato dos campos que o usuário cria. Chave fixa: a sincronização atualiza o mesmo campo.
 */
export const HOUSE_MANUAL_ENTRY = { fieldKey: "custom:airbnb-manual-da-casa", label: "Manual da casa", section: 3, audience: "G" } as const;

export function houseManualText(h: HostListing | null | undefined): string | null {
  if (!h) return null;
  return h.houseManual ?? rawListingField(h, (l) => str(l.house_manual));
}

/** Onde o "Como chegar" do anúncio se encaixa no Dossiê. */
export function directionsTarget(v: string | null | undefined): { kind: "maps" | "text"; value: string } | { kind: "none" } {
  const t = (v ?? "").trim();
  if (!t) return { kind: "none" };
  if (/^https?:\/\/\S+$/i.test(t)) {
    if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)\b/i.test(t)) return { kind: "maps", value: t };
    return { kind: "none" };
  }
  return { kind: "text", value: t };
}

// ── Comodidades detalhadas da API (`listing.amenities`) ─────────────────────────────────────────
// O scrap público só traz o NOME de cada comodidade. A API do anfitrião traz também os metadados
// (tamanho da TV, tipo de fogão, lava e seca na unidade, tipo de vaga, cômodos atendidos…). Nada
// disso é descartado: o que não tem tradução própria entra pelo texto genérico do próprio campo.

export type AmenityGroup =
  | "climatizacao"
  | "cozinha_e_sala_de_jantar"
  | "entretenimento"
  | "quarto_e_lavanderia"
  | "banheiro"
  | "garagem"
  | "areas_externas";

export const AMENITY_GROUP_TITLE: Record<AmenityGroup, string> = {
  climatizacao: "Climatização",
  cozinha_e_sala_de_jantar: "Cozinha e sala de jantar",
  entretenimento: "Entretenimento",
  quarto_e_lavanderia: "Quarto e lavanderia",
  banheiro: "Banheiro",
  garagem: "Estacionamento",
  areas_externas: "Áreas externas, acesso e outros",
};

const AMENITY_INFO: Record<string, [AmenityGroup, string]> = {
  AC: ["climatizacao", "Ar-condicionado"],
  HEATING: ["climatizacao", "Aquecimento"],
  PORTABLE_FANS: ["climatizacao", "Ventiladores portáteis"],
  CEILING_FAN: ["climatizacao", "Ventilador de teto"],
  KITCHEN: ["cozinha_e_sala_de_jantar", "Cozinha"],
  KITCHENETTE: ["cozinha_e_sala_de_jantar", "Cozinha compacta"],
  REFRIGERATOR: ["cozinha_e_sala_de_jantar", "Geladeira"],
  MINI_FRIDGE: ["cozinha_e_sala_de_jantar", "Frigobar"],
  FREEZER: ["cozinha_e_sala_de_jantar", "Freezer"],
  MICROWAVE: ["cozinha_e_sala_de_jantar", "Micro-ondas"],
  STOVE: ["cozinha_e_sala_de_jantar", "Fogão"],
  OVEN: ["cozinha_e_sala_de_jantar", "Forno"],
  COFFEE_MAKER: ["cozinha_e_sala_de_jantar", "Cafeteira"],
  POUR_OVER_COFFEE: ["cozinha_e_sala_de_jantar", "Coador de café"],
  BLENDER: ["cozinha_e_sala_de_jantar", "Liquidificador"],
  DISHES_AND_SILVERWARE: ["cozinha_e_sala_de_jantar", "Pratos e talheres"],
  COOKING_BASICS: ["cozinha_e_sala_de_jantar", "Itens básicos de cozinha"],
  TRASH_COMPACTER: ["cozinha_e_sala_de_jantar", "Compactador de lixo"],
  DINING_TABLE: ["cozinha_e_sala_de_jantar", "Mesa de jantar"],
  ALFRESCO_DINING: ["cozinha_e_sala_de_jantar", "Mesa de jantar externa"],
  BARBEQUE_UTENSILS: ["cozinha_e_sala_de_jantar", "Utensílios de churrasco"],
  CLEANING_PRODUCTS: ["cozinha_e_sala_de_jantar", "Produtos de limpeza"],
  CHILDRENS_DINNERWARE: ["cozinha_e_sala_de_jantar", "Louça infantil"],
  TV: ["entretenimento", "TV"],
  POOL: ["entretenimento", "Piscina"],
  BBQ_AREA: ["entretenimento", "Churrasqueira"],
  CHILDRENS_BOOKS_AND_TOYS: ["entretenimento", "Livros e brinquedos infantis"],
  BED_LINENS: ["quarto_e_lavanderia", "Roupa de cama"],
  EXTRA_PILLOWS_AND_BLANKETS: ["quarto_e_lavanderia", "Travesseiros e cobertores extras"],
  WARDROBE_OR_CLOSET: ["quarto_e_lavanderia", "Guarda-roupa ou closet"],
  HANGERS: ["quarto_e_lavanderia", "Cabides"],
  ROOM_DARKENING_SHADES: ["quarto_e_lavanderia", "Cortinas blackout"],
  IRON: ["quarto_e_lavanderia", "Ferro de passar"],
  WASHER: ["quarto_e_lavanderia", "Máquina de lavar"],
  DRYER: ["quarto_e_lavanderia", "Secadora"],
  CLOTHES_DRYING_RACK: ["quarto_e_lavanderia", "Varal"],
  CRIB: ["quarto_e_lavanderia", "Berço"],
  PACK_N_PLAY_TRAVEL_CRIB: ["quarto_e_lavanderia", "Berço portátil"],
  HAIR_DRYER: ["banheiro", "Secador de cabelo"],
  HOT_WATER: ["banheiro", "Água quente"],
  ESSENTIALS: ["banheiro", "Itens essenciais (toalhas, sabonete e papel higiênico)"],
  FREE_PARKING: ["garagem", "Estacionamento gratuito no local"],
  PAID_PARKING_ON_PREMISES: ["garagem", "Estacionamento pago no local"],
  PAID_PARKING_OFF_PREMISES: ["garagem", "Estacionamento pago fora do local"],
  STREET_PARKING: ["garagem", "Estacionamento na rua"],
  EV_CHARGER: ["garagem", "Carregador de veículo elétrico"],
  PATIO: ["areas_externas", "Pátio"],
  PATIO_OR_BELCONY: ["areas_externas", "Pátio ou varanda"],
  GARDEN_OR_BACKYARD: ["areas_externas", "Jardim ou quintal"],
  OUTDOOR_SEATING: ["areas_externas", "Área de estar externa"],
  OUTDOOR_KITCHEN: ["areas_externas", "Cozinha externa"],
  LAPTOP_FRIENDLY_WORKSPACE: ["areas_externas", "Espaço de trabalho"],
  PRIVATE_ENTRANCE: ["areas_externas", "Entrada privativa"],
  PRIVATE_LIVING_ROOM: ["areas_externas", "Sala de estar privativa"],
  SINGLE_LEVEL_HOME: ["areas_externas", "Imóvel em um único andar"],
  WHEELCHAIR_ACCESSIBLE: ["areas_externas", "Acessível para cadeira de rodas"],
  LONG_TERM_STAYS_ALLOWED: ["areas_externas", "Estadias longas permitidas"],
  DOORMAN: ["areas_externas", "Porteiro"],
  GATED_COMMUNITY: ["areas_externas", "Condomínio fechado"],
  LAUNDROMAT_NEARBY: ["areas_externas", "Lavanderia comercial por perto"],
  CLEANING_BEFORE_CHECKOUT: ["areas_externas", "Limpeza antes do check-out"],
  CARBON_MONOXIDE_DETECTOR: ["areas_externas", "Detector de monóxido de carbono"],
  SMOKE_ALARM: ["areas_externas", "Detector de fumaça"],
  FIRE_EXTINGUISHER: ["areas_externas", "Extintor de incêndio"],
  FIRST_AID_KIT: ["areas_externas", "Kit de primeiros socorros"],
};

const VALUE_PT: Record<string, string> = {
  SPLIT_TYPE_DUCTLESS: "split",
  CENTRAL: "central",
  CENTRAL_AC: "central",
  WINDOW: "de janela",
  PORTABLE: "portátil",
  GAS: "a gás",
  ELECTRIC: "elétrico",
  INDUCTION: "por indução",
  STAINLESS_STEEL: "aço inox",
  SINGLE: "simples",
  DOUBLE: "duplo",
  IN_UNIT: "dentro da unidade",
  IN_BUILDING: "no prédio",
  FREE: "grátis",
  PAID: "pago",
  COTTON: "algodão",
  PRIVATE: "privativo",
  PRIVATE_SPACE: "privativo",
  SHARED: "compartilhado",
  CHARCOAL: "a carvão",
  POUR_OVER_COFFEE: "coador",
  CHROMECAST: "Chromecast",
  NETFLIX: "Netflix",
  HD: "HD",
  FULL_HD: "Full HD",
  UHD_4K: "4K",
  RESIDENTIAL_GARAGE: "garagem residencial",
  DRESSER: "cômoda",
  WARDROBE: "guarda-roupa",
  CLOSET: "closet",
  EVERY_DAY: "todos os dias",
  SHEETS_PROVIDED: "com lençóis",
  ALWAYS_AVAILABLE: "sempre disponível",
  PACK_N_PLAY: "berço portátil",
  STANDARD: "padrão",
  SINK: "pia",
};

const valuePt = (v: unknown): string => {
  const t = String(v ?? "").trim();
  return VALUE_PT[t.toUpperCase()] ?? humanize(t).toLowerCase();
};

const hhmm4 = (v: unknown) => {
  const t = String(v ?? "").replace(/\D/g, "");
  return t.length === 4 ? `${t.slice(0, 2)}:${t.slice(2)}` : (hhmmOf(v) ?? String(v ?? ""));
};

/** Frases de um campo de metadado; recursivo para objetos aninhados (preço, dias, horários). */
function metaPhrases(key: string, v: unknown, amenityKey: string): string[] {
  if (v == null || v === "" || v === false) return [];
  if (Array.isArray(v)) {
    if (key === "available_times") {
      return v.map((t) => (t && typeof t === "object" ? `das ${hhmm4((t as any).start_time)} às ${hhmm4((t as any).end_time)}` : "")).filter(Boolean);
    }
    const items = v.map((x) => (x && typeof x === "object" ? "" : valuePt(x))).filter(Boolean);
    return items.length ? [items.join(", ")] : [];
  }
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => metaPhrases(k, x, amenityKey));
  }
  if (typeof v === "boolean") return key === "fenced" ? ["cercado"] : key === "confirmed_safe" ? [] : [humanize(key).toLowerCase()];
  if (typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v))) {
    const n = Number(v);
    if (key === "size_in_inch") return [`${n} polegadas`];
    if (key === "number_of_burners") return [`${n} ${n === 1 ? "boca" : "bocas"}`];
    if (key === "number_of_spaces") return [amenityKey.includes("PARKING") ? `${n} ${n === 1 ? "vaga" : "vagas"}` : `${n} lugares`];
    return [`${humanize(key).toLowerCase()}: ${n}`];
  }
  if (key === "brand") return [`marca ${String(v)}`];
  if (key === "service_day_availability_type" || key === "service_time_availability_type") {
    return /SPECIFIC_TIMES/i.test(String(v)) ? [] : [valuePt(v)];
  }
  if (key === "price_category") return [valuePt(v)];
  return [valuePt(v)];
}

/** Cômodos por id, com o mesmo nome que `parseRooms` dá a cada um. */
function roomNamesById(rawRooms: unknown): Map<string, string> {
  const out = new Map<string, string>();
  let bedroomN = 0;
  const sorted = list(rawRooms, "listing_rooms").slice().sort((a, b) => (num(a.room_number) ?? 0) - (num(b.room_number) ?? 0));
  for (const r of sorted) {
    const type = String(r.room_type ?? r.type ?? (num(r.room_number) === 0 ? "common_space" : "bedroom")).trim().toLowerCase();
    const id = str(r.id);
    if (!id) continue;
    let name = str(r.name) ?? ROOM_LABEL[type] ?? (type === "exterior" ? "Área externa" : humanize(type));
    if (type === "bedroom" && !str(r.name)) name = `Quarto ${++bedroomN}`;
    out.set(id, name);
  }
  return out;
}

export type AmenityDetail = { group: AmenityGroup; line: string };

function amenityEntries(raw: unknown): Array<[string, Record<string, any>]> {
  if (Array.isArray(raw)) {
    return raw
      .filter((a) => a && typeof a === "object")
      .map((a) => [String((a as any).amenity_type ?? (a as any).type ?? (a as any).name ?? "").toUpperCase(), a as Record<string, any>] as [string, Record<string, any>])
      .filter(([k]) => k);
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, v]) => v && typeof v === "object")
      .map(([k, v]) => [k.toUpperCase(), v as Record<string, any>] as [string, Record<string, any>]);
  }
  return [];
}

const amenityInfo = (key: string): [AmenityGroup, string] => AMENITY_INFO[key] ?? ["areas_externas", humanize(key)];

/**
 * Detalhes (metadados e cômodos atendidos) das comodidades PRESENTES e rol das AUSENTES.
 * Comodidade sem detalhe algum não gera linha: a presença já vem pelo nome do anúncio público.
 */
export function amenityDetails(rawAmenities: unknown, rawRooms: unknown): { details: AmenityDetail[]; absent: string[] } {
  const rooms = roomNamesById(rawRooms);
  const details: AmenityDetail[] = [];
  const absent: string[] = [];
  for (const [key, a] of amenityEntries(rawAmenities)) {
    const [group, label] = amenityInfo(key);
    if (a.is_present === false) {
      absent.push(label);
      continue;
    }
    if (a.is_present !== true && a.is_present !== undefined) continue;
    const phrases = Object.values((a.metadata ?? {}) as Record<string, unknown>).flatMap((m) =>
      m && typeof m === "object" ? Object.entries(m as Record<string, unknown>).flatMap(([k, v]) => metaPhrases(k, v, key)) : [],
    );
    // FREE_PARKING / PAID_PARKING_*: o tipo de cobrança já está no rótulo.
    const attached = (Array.isArray(a.room_attachment_infos) ? a.room_attachment_infos : [])
      .filter((r: any) => r && r.is_attached !== false)
      .map((r: any) => rooms.get(String(r.room_id)) ?? "")
      .filter(Boolean);
    if (attached.length) phrases.push(`em ${[...new Set(attached)].join(", ")}`);
    const instruction = str(a.instruction);
    if (instruction) phrases.push(instruction);
    const unique = [...new Set(phrases.filter(Boolean))];
    if (unique.length) details.push({ group, line: `• ${label}: ${unique.join(" · ")}` });
  }
  return { details, absent };
}

export type HostFact = { key: string; title: string; content: string };

// ── Auto-descoberta de fatos novos (Dynamic Fact Extractor) ─────────────────────────────────────
// Todo campo que o Airbnb passar a devolver em `listing` (ou em `property_details`) e que ainda não tem
// mapeamento fixo vira um fato `extra_<chave>` sozinho, sem código novo. A etiqueta de audiência sai da
// própria chave (`dynamicFactAudience`): termos de acesso/trajeto = G; o resto = P.

/** Chaves de `listing` que já têm mapeamento fixo (campo, fato ou parser próprio): a descoberta as ignora. */
export const KNOWN_HOST_KEYS: ReadonlySet<string> = new Set([
  "street", "apt", "city", "state", "zipcode", "country_code", "lat", "lng", "directions",
  "person_capacity", "bedrooms", "beds", "bathrooms", "listing_nickname",
  "check_out_tasks", "check_in_option", "house_manual", "quality_standards", "host_roles",
  "space", "access", "interaction", "neighborhood_overview", "transit", "notes", "house_rules", "summary", "description",
  "property_type_group", "property_type", "property_type_category", "room_type_category", "room_type",
  "check_in_time_start", "check_in_time_end", "check_out_time",
  "wireless_info", "wifi_info", "wifi_network", "wifi_password", "wireless_ssid", "wireless_password",
  "amenities", "listing_views", "quiet_hours", "property_details", "name",
]);

/** Chaves de `property_details` já lidas por `propertyStructureText`/`listingFloorOf`. */
const KNOWN_PROPERTY_DETAILS: ReadonlySet<string> = new Set(["listing_floor", "listing_size", "number_of_floors", "year_built"]);

/** Chaves técnicas ou de operação interna do Airbnb: não são informação para o hóspede. */
const NOISE_HOST_KEY = /(^|_)(id|ids|uuid|hash|token|tokens|user|created|updated|deleted|tracking|track|utm|pixel|click|redirect|signature|etag|cursor)(_|$)|_at$/i;
/** Estado interno de operação/sincronização do Airbnb (sem valor para o hóspede). */
const OPERATIONAL_HOST_KEYS: ReadonlySet<string> = new Set([
  "has_availability", "has_active_disaster", "reservation_issues", "synchronization_category", "tier", "locked_attributes",
]);
const isNoiseKey = (k: string) => OPERATIONAL_HOST_KEYS.has(k.toLowerCase()) || NOISE_HOST_KEY.test(k);

/** Termos de acesso/trajeto na CHAVE: o fato dinâmico só vale com reserva (G). */
const SENSITIVE_TOKENS: ReadonlySet<string> = new Set([
  "code", "pin", "password", "passcode", "senha", "key", "chave", "lock", "gate", "portao", "route", "trajeto", "secret",
]);
/**
 * Dentre eles, o que é CREDENCIAL (código, PIN, senha, segredo): nunca vira fato. Credencial só chega ao hóspede
 * pela D9 (`CredentialGrant`, com janela de liberação e vetos de no-show/checkout); um fato G a entregaria fora dela.
 */
const CREDENTIAL_TOKENS: ReadonlySet<string> = new Set(["code", "pin", "password", "passcode", "senha", "secret"]);

const tokensOf = (k: string) => k.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Audiência de um fato `extra_*`: G quando a chave tem termo de acesso/trajeto; P no resto. */
export function dynamicFactAudience(key: string): "P" | "G" {
  return tokensOf(key.replace(/^extra_/, "")).some((t) => SENSITIVE_TOKENS.has(t)) ? "G" : "P";
}

const isCredentialKey = (k: string) => tokensOf(k).some((t) => CREDENTIAL_TOKENS.has(t));

const TOKEN_PT: Record<string, string> = {
  speed: "velocidade", charger: "carregador", charging: "carregamento", vehicle: "veicular", vehicles: "veículos", ev: "elétrico",
  display: "exibir", exact: "exata", location: "localização", guest: "hóspede", guests: "hóspedes", accessibility: "acessibilidade",
  features: "recursos", feature: "recurso", categories: "categorias", category: "categoria", parking: "estacionamento", pool: "piscina",
  security: "segurança", safety: "segurança", pets: "animais", pet: "animal", smoking: "fumar", noise: "ruído", cameras: "câmeras",
  camera: "câmera", elevator: "elevador", stairs: "escadas", building: "prédio", host: "anfitrião", check: "check", in: "in", out: "out",
  time: "horário", hours: "horas", minimum: "mínimo", maximum: "máximo", max: "máximo", min: "mínimo", number: "número", of: "de",
  rooms: "cômodos", room: "cômodo", beds: "camas", bathrooms: "banheiros", size: "tamanho", type: "tipo", description: "descrição",
  instructions: "instruções", instruction: "instrução", rules: "regras", wifi: "Wi-Fi", internet: "internet", noisy: "barulhento",
  to: "para", the: "o", and: "e", is: "é", has: "tem", allowed: "permitido", available: "disponível", free: "grátis", paid: "pago",
};

/** Frases conhecidas, onde a ordem em português difere da do inglês. */
const PHRASE_PT: Record<string, string> = {
  ev_charger_speed: "Velocidade do carregador veicular",
  display_exact_location_to_guest: "Exibir localização exata ao hóspede",
  categories: "Categorias do anúncio",
  accessibility_features: "Recursos de acessibilidade",
};

/** `ev_charger_speed` → "Velocidade do carregador veicular": frase conhecida, ou palavra a palavra (o que não tem tradução fica humanizado). */
export function humanizeDynamicTitle(key: string): string {
  const bare = key.replace(/^extra_/, "");
  if (PHRASE_PT[bare]) return PHRASE_PT[bare]!;
  const words = tokensOf(bare);
  const pt = words.map((w) => TOKEN_PT[w] ?? w);
  const text = pt.join(" ");
  return text ? text[0]!.toUpperCase() + text.slice(1) : key;
}

const isPlainString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const HASHLIKE = /^(?:[0-9a-f]{24,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const TRACKING_URL = /^https?:\/\/\S*(?:utm_|track|click|pixel|redirect|\/r\/)\S*$/i;

function renderPrimitive(v: unknown): string | null {
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (!isPlainString(v)) return null;
  const t = v.trim();
  if (HASHLIKE.test(t) || TRACKING_URL.test(t)) return null;
  return /^[A-Z][A-Z0-9_]+$/.test(t) ? valuePt(t) : t.slice(0, 5000);
}

function renderValue(v: unknown): string | null {
  if (Array.isArray(v)) {
    if (!v.length || v.length > 30 || v.some((x) => x !== null && typeof x === "object")) return null;
    const items = v.map(renderPrimitive).filter((x): x is string => !!x);
    return items.length ? items.join(", ") : null;
  }
  return renderPrimitive(v);
}

/**
 * Varre o primeiro e o segundo nível de `listing` e de `property_details`. Para cada chave nova com valor
 * primitivo útil (texto, número, booleano ou lista simples) gera `extra_<chave>`. Credenciais não viram fato.
 */
export function discoverDynamicHostFacts(rawListing: Record<string, unknown> | null | undefined): HostFact[] {
  if (!rawListing || typeof rawListing !== "object") return [];
  const out: HostFact[] = [];
  const seen = new Set<string>();
  const add = (path: string, value: unknown) => {
    if (isCredentialKey(path) || isNoiseKey(path)) return;
    const content = renderValue(value);
    if (!content) return;
    const key = `extra_${path.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
    if (key === "extra_" || seen.has(key)) return;
    seen.add(key);
    out.push({ key, title: `${humanizeDynamicTitle(key)} (Airbnb)`, content });
  };
  const walk = (obj: Record<string, unknown>, prefix: string, known: ReadonlySet<string>) => {
    for (const [k, v] of Object.entries(obj)) {
      if (known.has(k) || isCredentialKey(k) || isNoiseKey(k)) continue;
      const path = prefix ? `${prefix}_${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
          if (v2 && typeof v2 === "object" && !Array.isArray(v2)) continue; // só até o segundo nível
          add(`${path}_${k2}`, v2);
        }
      } else add(path, v);
    }
  };
  walk(rawListing, "", KNOWN_HOST_KEYS);
  const pd = rawListing.property_details;
  if (pd && typeof pd === "object" && !Array.isArray(pd)) {
    for (const [k, v] of Object.entries(pd as Record<string, unknown>)) {
      if (KNOWN_PROPERTY_DETAILS.has(k) || (v && typeof v === "object" && !Array.isArray(v))) continue;
      add(`property_details_${k}`, v);
    }
  }
  return out;
}


/** Caminhos (e chaves de qualquer nível) da Channex que `normalizeListing` já converte em fatos fixos. */
const CHANNEX_MAPPED: ReadonlySet<string> = new Set([
  "title", "city", "occupancies",
  "check_in_time_start", "check_in_time_end", "check_out_time", "instant_book_welcome_message", "listing_expectations_for_guests",
  "allows_children_as_host", "allows_infants_as_host", "allows_pets_as_host", "allows_events_as_host", "allows_smoking_as_host",
  "pet_capacity", "children_not_allowed_details",
  "cancellation_policy_category", "non_refundable_price_factor",
  "default_daily_price", "guests_included", "price_per_extra_person", "weekend_price", "weekly_price_factor", "monthly_price_factor",
  "security_deposit", "standard_fees",
  "default_min_nights", "default_max_nights", "booking_lead_time", "max_days_notice", "instant_booking_allowed_category", "seasonal_min_nights",
]);

/**
 * Auto-descoberta da Channex (titular, 19/11/2026): varre `listing_meta` e `raw_settings` (até 3 níveis) e transforma toda
 * chave ainda não mapeada, com valor primitivo útil, em `extra_channex_<caminho>`. Credenciais e ruído técnico ficam de fora;
 * a etiqueta (P/G) sai de `dynamicFactAudience`.
 */
export function discoverChannexFacts(
  meta: Record<string, unknown> | null | undefined,
  settings: Record<string, unknown> | null | undefined,
): HostFact[] {
  const out: HostFact[] = [];
  const seen = new Set<string>();
  const add = (path: string, value: unknown) => {
    if (isCredentialKey(path) || isNoiseKey(path)) return;
    const content = renderValue(value);
    if (!content) return;
    const slug = path.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!slug) return;
    const key = `extra_channex_${slug}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, title: `${humanizeDynamicTitle(`extra_${slug}`)} (Channex)`, content });
  };
  const walk = (obj: unknown, prefix: string, depth: number) => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (CHANNEX_MAPPED.has(k) || isCredentialKey(k) || isNoiseKey(k)) continue;
      const path = prefix ? `${prefix}_${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if (depth < 3) walk(v, path, depth + 1);
      } else add(path, v);
    }
  };
  walk(meta, "meta", 1);
  walk(settings, "", 1);
  return out;
}


/** Fatos ricos para o dossiê da IA. */
export function hostFacts(h: HostListing | null | undefined): HostFact[] {
  if (!h) return [];
  const out: HostFact[] = [];
  const main = [h.summary, h.description].filter(Boolean).join("\n\n");
  if (main) out.push({ key: "descricao_anfitriao", title: "Descrição do anúncio (Airbnb)", content: main });
  for (const [k, key, title] of SECTIONS) {
    const v = h[k];
    if (typeof v === "string" && v) out.push({ key, title: `${title} (Airbnb)`, content: v });
  }
  if (h.houseRules) out.push({ key: "regras_anfitriao", title: "Regras escritas pelo anfitrião (Airbnb)", content: h.houseRules });
  const tipo = [h.propertyType, h.roomType].filter(Boolean).map((x) => humanize(String(x))).join(" · ");
  if (tipo) out.push({ key: "tipo_imovel", title: "Tipo de imóvel (Airbnb)", content: tipo });
  const selos = [h.isSuperhost ? "Anfitrião é Superhost" : null, h.isGuestFavorite ? "Anúncio é Preferido dos hóspedes" : null].filter(Boolean);
  if (selos.length) out.push({ key: "selos_anuncio", title: "Selos do anúncio (Airbnb)", content: selos.join("\n") });
  const legendas = (Array.isArray(h.photos) ? h.photos : []).filter((x) => x.caption).map((x) => `• ${x.caption}`);
  if (legendas.length) out.push({ key: "fotos_legendas", title: "Fotos do anúncio e o que mostram (Airbnb)", content: legendas.join("\n") });
  const route = directionsTarget(h.directions);
  if (route.kind !== "none") out.push({ key: "como_chegar", title: "Orientações de Trajeto (Airbnb)", content: route.value });
  const checkin = h.checkInInstruction ?? rawListingField(h, checkInInstructionOf);
  if (checkin) out.push({ key: "instrucoes_checkin", title: "Instruções de Check-in do Anúncio", content: checkin });
  const manual = h.houseManual ?? rawListingField(h, (l) => str(l.house_manual));
  if (manual) out.push({ key: "manual_casa_anuncio", title: "Manual da casa (Airbnb)", content: manual });
  const co = checkoutInstructionsText(h);
  if (co) out.push({ key: "tarefas_checkout", title: "Instruções de Check-out do Anúncio", content: co });
  const structure = rawListingField(h, propertyStructureText);
  if (structure) out.push({ key: "estrutura_imovel", title: "Estrutura do imóvel (Airbnb)", content: structure });
  const silencio = quietHoursText(h);
  if (silencio) out.push({ key: "horario_silencio", title: "Horário de silêncio (Airbnb)", content: silencio });
  const rawListing = innerRawListing(h);
  if (rawListing) {
    const { details, absent } = amenityDetails(rawListing.amenities, h.raw?.rooms);
    for (const group of Object.keys(AMENITY_GROUP_TITLE) as AmenityGroup[]) {
      const lines = details.filter((d) => d.group === group).map((d) => d.line);
      if (lines.length) out.push({ key: `comodidade_${group}`, title: `Detalhes de ${AMENITY_GROUP_TITLE[group].toLowerCase()} (Airbnb)`, content: lines.join("\n") });
    }
    if (absent.length) out.push({ key: "comodidades_ausentes_api", title: "Comodidades que o anúncio declara NÃO ter (Airbnb)", content: absent.map((a) => `• ${a}`).join("\n") });
    // Campos que o Airbnb passar a devolver e ainda não têm mapeamento fixo entram sozinhos (`extra_*`).
    out.push(...discoverDynamicHostFacts(rawListing));
  }
  if (Array.isArray(h.rooms) && h.rooms.length) out.push({ key: "distribuicao_comodos", title: "Cômodos e Camas Detalhados", content: h.rooms.map((r) => `${r.room}: ${r.beds}`).join("\n") });
  return out;
}

/** Remove fatos antigos com as mesmas chaves e anexa os do anfitrião. */
export function mergeHostFacts<T extends { key: string }>(facts: T[], h: HostListing | null | undefined): Array<T | HostFact> {
  const extra = hostFacts(h);
  const keys = new Set(extra.map((f) => f.key));
  return [...facts.filter((f) => !keys.has(f.key)), ...extra];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export type HostCurrent = {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  checkin_instructions?: string | null;
  checkout_instructions?: string | null;
  address_note?: string | null;
  maps_url?: string | null;
  apartment_floor?: string | null;
  apartment_number?: string | null;
  in_condominium?: boolean | null;
  parking_spots?: string[] | null;
  hero_image_url?: string | null;
  gallery_images?: string[] | null;
  airbnb_guest_count?: number | null;
  airbnb_bedroom_count?: number | null;
  airbnb_bed_count?: number | null;
  airbnb_bathroom_count?: number | null;
  airbnb_rooms_beds?: unknown;
  wifi_ssid?: string | null;
  wifi_password?: string | null;
  checkin_time?: string | null;
  checkin_time_max?: string | null;
  checkout_time?: string | null;
};

/**
 * Patch de `properties` — o ANÚNCIO É SOBERANO (regra do proprietário, 19/11/2026): todo dado
 * que a API informa substitui o do sistema sempre que houver QUALQUER divergência, inclusive
 * edições manuais. Fotos: uma única divergência (foto, quantidade ou ordem) substitui a galeria
 * inteira pelas fotos do anúncio, e a capa passa a ser a 1ª. Dado ausente na API não apaga o salvo.
 * Só entram no patch os campos que realmente mudaram.
 */
export function hostPropertyPatch(h: HostListing, cur: HostCurrent): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const set = (k: keyof HostCurrent, v: unknown) => {
    if (v == null || (typeof v === "string" && !v.trim())) return;
    if (!same(cur[k], v)) p[k] = v;
  };
  if (h.lat != null && h.lng != null) {
    set("lat", h.lat);
    set("lng", h.lng);
    if ("lat" in p || "lng" in p) { p["lat"] = h.lat; p["lng"] = h.lng; }
  }
  set("address", composeAddress(h)?.slice(0, 500));
  set("city", h.city?.slice(0, 120));
  set("state", h.state?.slice(0, 120));
  set("country", h.countryCode?.slice(0, 8));
  // Instruções do anúncio, cada uma no seu campo do Dossiê (titular, 19/11/2026; antes o "Como chegar"
  // do Airbnb caía em Instruções de check-in só quando vazio e as instruções reais nunca entravam):
  //  - Instruções de check-in ← `check_in_option.instruction`;
  //  - Instruções de check-out ← tarefas de saída;
  //  - Como chegar ← `directions` em texto; link do Google Maps vai para Link do mapa; link do próprio
  //    Guia Digital não é trajeto e fica de fora.
  const checkin = h.checkInInstruction ?? rawListingField(h, checkInInstructionOf);
  set("checkin_instructions", checkin?.slice(0, 10_000));
  if (!checkin && h.directions && cur.checkin_instructions === h.directions) p["checkin_instructions"] = null;
  set("checkout_instructions", checkoutInstructionsText(h)?.slice(0, 10_000));
  const route = directionsTarget(h.directions);
  if (route.kind === "maps") set("maps_url", route.value.slice(0, 2_000));
  if (route.kind === "text") set("address_note", route.value.slice(0, 10_000));
  if (h.personCapacity != null && h.personCapacity > 0) set("airbnb_guest_count", Math.min(200, Math.round(h.personCapacity)));
  if (h.bedrooms != null && h.bedrooms >= 0) set("airbnb_bedroom_count", Math.min(200, Math.round(h.bedrooms)));
  if (h.beds != null && h.beds >= 0) set("airbnb_bed_count", Math.min(200, Math.round(h.beds)));
  if (h.bathrooms != null && h.bathrooms >= 0) set("airbnb_bathroom_count", Math.min(200, h.bathrooms));
  if (h.rooms.length) set("airbnb_rooms_beds", h.rooms);
  // Andar do imóvel (P: serve a dúvidas de escada/acessibilidade antes da reserva). O número do apartamento é outro campo (G).
  const rawL = innerRawListing(h);
  const multiUnit = isMultiUnitType(h.propertyType) || cur.in_condominium === true;
  set("apartment_floor", floorLabelOf(h.listingFloor ?? listingFloorOf(rawL), h.numberOfFloors ?? numberOfFloorsOf(rawL), multiUnit));
  // Unidade e vaga: `apt` do anúncio (fonte principal) ou, sem API, o endereço salvo. Identificou apartamento → condomínio.
  const fromApi = parseApt(h.apt);
  const unitInfo = fromApi.unit ? fromApi : extractUnitFromAddress(cur.address);
  if (unitInfo.unit) {
    set("apartment_number", unitInfo.unit);
    if (cur.in_condominium !== true) p["in_condominium"] = true;
  }
  if (unitInfo.parking && !(cur.parking_spots ?? []).length) p["parking_spots"] = [unitInfo.parking];
  set("checkin_time", h.checkInStart);
  set("checkin_time_max", h.checkInEnd);
  set("checkout_time", h.checkOutTime);
  set("wifi_ssid", h.wifiSsid?.slice(0, 120));
  set("wifi_password", h.wifiPassword?.slice(0, 120));
  if (h.photos.length) {
    const urls = h.photos.slice(0, 100).map((x) => x.url);
    set("gallery_images", urls);
    set("hero_image_url", urls[0]);
  }
  return p;
}
