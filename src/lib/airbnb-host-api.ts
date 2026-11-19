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

export function checkoutInstructionsText(h: Pick<HostListing, "checkoutTasks">): string | null {
  return h.checkoutTasks.length ? h.checkoutTasks.map((t) => `• ${t}`).join("\n") : null;
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

export type HostFact = { key: string; title: string; content: string };

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
  const legendas = h.photos.filter((x) => x.caption).map((x) => `• ${x.caption}`);
  if (legendas.length) out.push({ key: "fotos_legendas", title: "Fotos do anúncio e o que mostram (Airbnb)", content: legendas.join("\n") });
  if (h.directions) out.push({ key: "como_chegar", title: "Orientações de Trajeto (Airbnb)", content: h.directions });
  const co = checkoutInstructionsText(h);
  if (co) out.push({ key: "tarefas_checkout", title: "Instruções de Check-out do Anúncio", content: co });
  if (h.rooms.length) out.push({ key: "distribuicao_comodos", title: "Cômodos e Camas Detalhados", content: h.rooms.map((r) => `${r.room}: ${r.beds}`).join("\n") });
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
  // Instruções de chegada/saída: o texto do guia escrito pela equipe é mais rico que as tarefas
  // padrão do Airbnb; só preenche quando vazio (as tarefas sempre entram como fato do dossiê).
  const blank = (v: unknown) => v == null || (typeof v === "string" && !v.trim());
  if (blank(cur.checkin_instructions) && h.directions) p["checkin_instructions"] = h.directions.slice(0, 10_000);
  const co = checkoutInstructionsText(h);
  if (blank(cur.checkout_instructions) && co) p["checkout_instructions"] = co.slice(0, 10_000);
  if (h.personCapacity != null && h.personCapacity > 0) set("airbnb_guest_count", Math.min(200, Math.round(h.personCapacity)));
  if (h.bedrooms != null && h.bedrooms >= 0) set("airbnb_bedroom_count", Math.min(200, Math.round(h.bedrooms)));
  if (h.beds != null && h.beds >= 0) set("airbnb_bed_count", Math.min(200, Math.round(h.beds)));
  if (h.bathrooms != null && h.bathrooms >= 0) set("airbnb_bathroom_count", Math.min(200, h.bathrooms));
  if (h.rooms.length) set("airbnb_rooms_beds", h.rooms);
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
