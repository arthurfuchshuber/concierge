import {
  AUDIENCE_LABEL,
  CUSTOM_OBS,
  FAQ_OBS,
  PLAYBOOK_FIELDS,
  PROVIDER_OBS,
  type Audience,
} from "@/lib/playbook-catalog";

/**
 * PLAYBOOK DO IMÓVEL — monta as linhas a partir do cadastro (puro, testável).
 *
 * O Playbook é o registro/fonte da verdade do imóvel: os valores saem das
 * colunas do próprio imóvel e das listas ligadas a ele (FAQ, checklist,
 * contatos, manuais, prestadores). Campos que não tinham onde morar
 * (voltagem, lixo, disjuntores…) vivem em `property_playbook_entries`, que
 * também guarda a "Nota do anfitrião" de cada linha e as linhas criadas à mão.
 *
 * REGRA DE FONTES: o que vem do Airbnb/anúncio é só leitura (sem botão de
 * editar); só tem lápis o que é cadastro manual. Ler com falha nunca zera um
 * valor anterior — quem chama mantém o último dado bom.
 */

export type PlaybookSource = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  property: Record<string, any>;
  faqs: Array<{ id: string; question: string; answer: string }>;
  checkout: Array<{ id: string; label: string }>;
  emergency: Array<{ id: string; label: string; number: string }>;
  manuals: Array<{ id: string; title: string }>;
  providers: Array<{
    linkId: string;
    name: string;
    category: string | null;
    phone: string | null;
    email: string | null;
  }>;
  entries: PlaybookEntry[];
  /** Título bruto do anúncio como a Channex entrega: "<conta> <apelido> · <título público>". */
  listingTitle?: string | null;
  /** Fatos normalizados do anúncio (Channex): `normalized.facts`. */
  listingFacts?: Array<{ key: string; title: string; content: string }>;
};

export type PlaybookEntry = {
  id: string;
  field_key: string;
  value: string | null;
  note: string | null;
  custom_label: string | null;
  custom_audience: Audience | null;
  section_num: number | null;
};

export type EditKind = "text" | "textarea" | "int" | "bool" | "access";

export type PlaybookRow = {
  /** Identificador estável da linha: f:<campo> · faq:<id> · prov:<id> · custom:<id> */
  id: string;
  label: string;
  value: string;
  /** Texto cru para o editor (sem máscara). */
  raw: string;
  empty: boolean;
  secret: boolean;
  copy: boolean;
  obs: string;
  au: Audience;
  note: string;
  edit: EditKind | null;
  deletable: boolean;
  /** Excluir remove a linha (FAQ, prestador, linha própria) em vez de só esvaziar. */
  removesRow: boolean;
  /** Campo que existia no antigo "Editar guia" (coluna/lista real). Só esses entram no "Adicionar campo". */
  guideField?: boolean;
};

export type PlaybookSectionData = { id: string; num: number; rows: PlaybookRow[] };

export const EMPTY_TEXT = "não cadastrado";

/** Colunas do imóvel que o Playbook edita (manual) — chave do campo → coluna. */
export const COLUMN_FIELDS: Record<string, { column: string; kind: EditKind }> = {
  link_do_mapa: { column: "maps_url", kind: "text" },
  link_mapa_garagem: { column: "garage_maps_url", kind: "text" },
  como_chegar: { column: "address_note", kind: "textarea" },
  ponto_da_porta: { column: "lock_label", kind: "text" },
  codigo_da_porta: { column: "lock_code", kind: "text" },
  instrucoes_da_porta: { column: "lock_instructions", kind: "textarea" },
  imovel_em_condominio: { column: "in_condominium", kind: "bool" },
  maximo_de_veiculos: { column: "vehicles_max", kind: "int" },
  modo_de_acesso: { column: "access_mode", kind: "access" },
  ponto_de_acesso: { column: "gate_label", kind: "text" },
  codigo_do_portao: { column: "gate_code", kind: "text" },
  instrucoes_do_portao: { column: "gate_instructions", kind: "textarea" },
  instrucoes_de_check_in: { column: "checkin_instructions", kind: "textarea" },
  aviso_de_check_in: { column: "checkin_note", kind: "textarea" },
  instrucoes_de_check_out: { column: "checkout_instructions", kind: "textarea" },
  aviso_de_check_out: { column: "checkout_note", kind: "textarea" },
  nome_da_rede_wi_fi: { column: "wifi_ssid", kind: "text" },
  senha_do_wi_fi: { column: "wifi_password", kind: "text" },
  regras_adicionais_da_casa: { column: "house_rules", kind: "textarea" },
  telefone_do_anfitriao: { column: "host_phone", kind: "text" },
};

/** Campos sem coluna própria: o valor mora em `property_playbook_entries`. */
export const ENTRY_FIELDS = new Set([
  "bairro",
  "cep",
  "voltagem_das_tomadas",
  "descarte_de_lixo",
  "fechadura_eletronica",
  "senhas_temporarias_por_reserva",
  "manuais_de_equipamentos",
  "chuveiros_e_aquecedores",
  "localizacao_dos_disjuntores",
  "registro_de_agua",
  "chave_do_gas",
  "procedimento_se_faltar_energia",
  "bateria_da_fechadura",
]);

/** Campos que gravam em listas ligadas ao imóvel (uma linha de texto por item). */
export const LIST_FIELDS = new Set(["checklist_de_saida", "contatos_de_emergencia"]);

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function plural(count: number | null, one: string, many: string): string {
  return count === null ? "" : `${count} ${count === 1 ? one : many}`;
}

type Amenity = { name: string; available: boolean; category: string | null };
function amenities(p: Record<string, unknown>): Amenity[] {
  const raw = p.airbnb_amenities;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => a as Record<string, unknown>)
    .filter((a) => typeof a?.name === "string")
    .map((a) => ({ name: String(a.name).trim(), available: a.available !== false, category: typeof a.category === "string" ? a.category : null }));
}

const AMENITY_GROUPS: Array<{ key: string; test: RegExp }> = [
  { key: "climatizacao", test: /ar[- ]condicionado|ventilador|aquecedor|aquecimento|calefa|climatiza/i },
  {
    key: "cozinha_e_sala_de_jantar",
    test: /refriger|micro-?ondas|prato|talher|freezer|fog[aã]o|forno|liquidific|lixeira|mesa de jantar|cafeteira|cozinha|lou[cç]a|utens[ií]lio|chaleira|torradeira|panela|geladeira/i,
  },
  { key: "entretenimento", test: /\btv\b|televis|som |netflix|streaming|jogo|videogame|piscina|churrasqueira/i },
  {
    key: "quarto_e_lavanderia",
    test: /m[aá]quina de lavar|secadora|roupas? de cama|cobertor|travesseiro|cortina|ferro de passar|varal|guardar (as )?roupas|len[cç]ol|cabides|lavanderia/i,
  },
  { key: "banheiro", test: /secador de cabelo|[aá]gua quente|chuveiro|toalha|papel higi|banheira|banheiro/i },
];

/**
 * O anúncio traz as comodidades numa lista única em que um CABEÇALHO ("Banheiro",
 * "Climatização"…) vem seguido dos itens dele. Quando os cabeçalhos existem,
 * agrupamos por eles (é a classificação do próprio Airbnb); sem cabeçalho, por
 * palavras-chave.
 */
const HEADER_TO_GROUP: Record<string, string> = {
  "climatização": "climatizacao",
  "aquecimento e ar-condicionado": "climatizacao",
  "cozinha e sala de jantar": "cozinha_e_sala_de_jantar",
  entretenimento: "entretenimento",
  "quarto e lavanderia": "quarto_e_lavanderia",
  banheiro: "banheiro",
};
const OTHER_HEADERS = new Set([
  "segurança doméstica",
  "internet e escritório",
  "características da localização",
  "estacionamento e instalações",
  "serviços",
  "não incluso",
  "vistas",
  "ar livre",
]);

function amenityLine(p: Record<string, unknown>, group: string): string {
  const all = amenities(p).filter((a) => a.available);
  const norm = (t: string) => t.trim().toLowerCase();
  // Classificador híbrido (22/10/2026): o cabeçalho do Airbnb manda quando existe; item que vem ANTES do
  // primeiro cabeçalho (os "destaques" do topo), sob cabeçalho sem grupo no Playbook ou sem cabeçalho nenhum
  // é classificado pela tabela de palavras-chave. Nenhuma comodidade disponível se perde por falta de cabeçalho.
  const byKeyword = (name: string) => AMENITY_GROUPS.find((g) => g.test.test(name))?.key ?? null;
  let current: string | null = null;
  const out: string[] = [];
  for (const a of all) {
    const k = norm(a.name);
    if (k in HEADER_TO_GROUP) {
      current = HEADER_TO_GROUP[k];
      continue;
    }
    if (OTHER_HEADERS.has(k)) {
      current = null;
      continue;
    }
    if ((current ?? byKeyword(a.name)) === group) out.push(a.name);
  }
  return out.join(" · ");
}

function absentAmenities(p: Record<string, unknown>): string {
  return amenities(p)
    .filter((a) => !a.available)
    .map((a) => a.name)
    .join(" · ");
}

function rulesText(p: Record<string, unknown>): string {
  return s(p.airbnb_house_rules);
}

function ruleLine(p: Record<string, unknown>, re: RegExp): string | null {
  for (const line of rulesText(p).split("\n")) if (re.test(line)) return line.trim();
  return null;
}

/** "Horário de silêncio" e o intervalo podem vir em linhas seguidas: olha a própria linha e a seguinte. */
function silenceRange(p: Record<string, unknown>): [string, string] | null {
  const lines = rulesText(p).split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/hor[aá]rio de sil[eê]ncio/i.test(lines[i])) continue;
    const m = `${lines[i]} ${lines[i + 1] ?? ""}`.match(/(\d{1,2}:\d{2})\s*(?:[-–—]|[aà]s|a)\s*(\d{1,2}:\d{2})/i);
    if (m) return [m[1], m[2]];
  }
  return null;
}

function additionalRules(p: Record<string, unknown>): string {
  const own = s(p.house_rules);
  if (own) return own;
  const t = rulesText(p);
  const i = t.search(/Regras adicionais:?/i);
  if (i < 0) return "";
  return t
    .slice(i)
    .split("\n")
    .slice(1)
    .map((l) => l.replace(/^\s*[-•]\s*/, "").replace(/^Proibido\s+/i, "").trim())
    .filter(Boolean)
    .map((l) => l.charAt(0).toUpperCase() + l.slice(1))
    .join("\n");
}

function parseAddress(p: Record<string, unknown>) {
  const a = s(p.address);
  const cep = a.match(/\b\d{5}-?\d{3}\b/)?.[0] ?? "";
  const dash = a.match(/\s-\s([^,-]+),/);
  return { cep, district: dash ? dash[1].trim() : "" };
}

/** Rótulo curto do modo de acesso (coluna `access_mode`). */
export function accessModeText(p: Record<string, unknown>): string {
  const mode = s(p.access_mode);
  if (mode === "pin") return "Com código (PIN) · o hóspede recebe um código para entrar";
  if (mode === "public") {
    const gate = s(p.gate_label) || s(p.gate_code);
    return gate ? `Público · sem fechadura eletrônica: entrada pelo ${gate.toLowerCase()}` : "Público · sem fechadura eletrônica";
  }
  return "";
}

function faqAudience(question: string): Audience {
  return /check|endere[cç]o|senha|c[oó]digo|wi-?fi|port[aã]o|entrada|sa[ií]da|chave/i.test(question) ? "G" : "P";
}

const MASK = "••••••";

const STATE_NAME: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo",
  GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba",
  PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

const SEP = " · ";
const trimSep = (t: string) => t.replace(/[\s·\-–—]+$/u, "").replace(/^[\s·\-–—]+/u, "").trim();

/**
 * Separa o título do anúncio em NOME INTERNO (conta + apelido, antes do
 * separador) e TÍTULO PÚBLICO (depois). A Channex entrega
 * "<conta> <apelido> · <título público>" (ponto médio, não hífen) e o anfitrião
 * pode ter hífen — ou até " · " — dentro do próprio título público. Por isso NÃO
 * se parte por separador às cegas: se o título público já cadastrado (`name`) é
 * o final do título bruto, o nome interno é exatamente o que sobra antes dele.
 * Só sem essa referência cai no primeiro " · " (o prefixo interno quase nunca
 * contém separador; o título público, às vezes, sim).
 */
export function splitListingTitle(raw: string | null | undefined, publicName?: string | null) {
  const full = (raw ?? "").trim();
  const pub = (publicName ?? "").trim();
  if (!full) return { internal: "", publicTitle: pub };
  if (pub && full.endsWith(pub) && full.length > pub.length) {
    return { internal: trimSep(full.slice(0, full.length - pub.length)), publicTitle: pub };
  }
  const i = full.indexOf(SEP);
  if (i < 0) return { internal: "", publicTitle: pub || full };
  return { internal: full.slice(0, i).trim(), publicTitle: pub || full.slice(i + SEP.length).trim() };
}

/** Monta as 5 seções do Playbook a partir do cadastro. */
export function buildPlaybook(src: PlaybookSource): PlaybookSectionData[] {
  const p = src.property;
  const entryByKey = new Map(src.entries.map((e) => [e.field_key, e] as const));
  const noteOf = (rowId: string) => entryByKey.get(rowId)?.note ?? "";
  const entryValue = (key: string) => s(entryByKey.get(`f:${key}`)?.value);
  const addr = parseAddress(p);
  const garage = amenities(p).find((a) => a.available && /garagem|estacionamento|vaga/i.test(a.name))?.name ?? "";
  const parking = Array.isArray(p.parking_spots) && p.parking_spots.length ? String(p.parking_spots.length) : "";
  const roomsBeds = Array.isArray(p.airbnb_rooms_beds)
    ? (p.airbnb_rooms_beds as Array<Record<string, unknown>>)
        .map((r) => [s(r.room), s(r.beds)].filter(Boolean).join(": "))
        .filter(Boolean)
        .join("\n")
    : "";
  const guests = n(p.airbnb_guest_count);
  const veh = n(p.vehicles_max);
  const condo = p.in_condominium === true;
  const cin = s(p.checkin_time);
  const cinMax = s(p.checkin_time_max);
  const cout = s(p.checkout_time);

  const silence = silenceRange(p);
  const petsLine = ruleLine(p, /animais/i);
  const petsMax = petsLine?.match(/at[eé]\s+(\d+)/i)?.[1];
  const maxGuestsRule = ruleLine(p, /m[aá]ximo de \d+ h[oó]spedes/i)?.match(/(\d+)/)?.[1];
  const additional = additionalRules(p);
  const safety = s(p.airbnb_safety_info);
  const cameraLine = safety.split("\n").find((l) => /c[aâ]mera/i.test(l))?.trim() ?? "";

  // Políticas e taxas vêm da Channex: os fatos normalizados do anúncio ("precos" e "cancelamento").
  const factLines = (key: string) =>
    (src.listingFacts ?? [])
      .filter((f) => f.key === key)
      .flatMap((f) => f.content.split("\n"))
      .map((l) => l.trim())
      .filter(Boolean);
  const priceLines = factLines("precos");
  const priceLine = (re: RegExp) => priceLines.find((l) => re.test(l)) ?? "";
  const cancelCategory = s(p.airbnb_cancellation_category);
  const cancellation =
    [s(p.airbnb_cancellation_policy), cancelCategory ? `Categoria: ${cancelCategory}` : ""].filter(Boolean).join("\n") ||
    factLines("cancelamento").join("\n");

  const values: Record<string, string> = {
    titulo_publico: s(p.name) || splitListingTitle(src.listingTitle, s(p.name)).publicTitle,
    tipo_de_espaco: s(p.short_description),
    descricao_completa_anuncio: s(p.airbnb_description_full),
    // Só rua e número: bairro, cidade e estado têm linha própria.
    endereco_rua_e_numero: s(p.address).split(/\s-\s/)[0].trim(),
    bairro: entryValue("bairro") || addr.district,
    cidade: [s(p.city), STATE_NAME[s(p.state).toUpperCase()] ?? s(p.state), s(p.country)].filter(Boolean).join(" · "),
    cep: entryValue("cep") || addr.cep,
    link_do_mapa: s(p.maps_url),
    imovel_em_condominio: p.in_condominium == null ? "" : condo ? `Sim${s(p.apartment_number) ? ` · apto ${s(p.apartment_number)}` : ""}${s(p.apartment_floor) ? `, andar ${s(p.apartment_floor)}` : ""}` : "Não · casa independente, sem portaria",
    vagas_de_garagem: garage || (parking ? `${parking} vaga(s) cadastrada(s)` : ""),
    maximo_de_veiculos: veh === null ? "" : plural(veh, "veículo", "veículos"),
    hospedes_maximo: guests === null ? "" : `${plural(guests, "hóspede", "hóspedes")} (incluindo crianças)`,
    quartos: n(p.airbnb_bedroom_count)?.toString() ?? "",
    camas: n(p.airbnb_bed_count)?.toString() ?? "",
    banheiros: n(p.airbnb_bathroom_count)?.toString() ?? "",
    distribuicao_das_camas: roomsBeds,
    nome_interno: splitListingTitle(src.listingTitle, s(p.name)).internal,
    modo_de_acesso: accessModeText(p),
    ponto_de_acesso: s(p.gate_label),
    codigo_do_portao: s(p.gate_code),
    instrucoes_do_portao: s(p.gate_instructions),
    horario_de_check_in: cin ? `A partir das ${cin}${cinMax ? ` · até as ${cinMax}` : ""}` : "",
    instrucoes_de_check_in: s(p.checkin_instructions),
    aviso_de_check_in: s(p.checkin_note),
    horario_de_check_out: cout ? `Até as ${cout}` : "",
    instrucoes_de_check_out: s(p.checkout_instructions),
    checklist_de_saida: src.checkout.map((c, i) => `${i + 1}. ${c.label}`).join("\n"),
    aviso_de_check_out: s(p.checkout_note),
    nome_da_rede_wi_fi: s(p.wifi_ssid),
    senha_do_wi_fi: s(p.wifi_password),
    climatizacao: amenityLine(p, "climatizacao"),
    cozinha_e_sala_de_jantar: amenityLine(p, "cozinha_e_sala_de_jantar"),
    entretenimento: amenityLine(p, "entretenimento"),
    quarto_e_lavanderia: amenityLine(p, "quarto_e_lavanderia"),
    banheiro: amenityLine(p, "banheiro"),
    ausentes_no_anuncio: absentAmenities(p),
    manuais_de_equipamentos: src.manuals.map((m) => m.title).filter(Boolean).join("\n") || entryValue("manuais_de_equipamentos"),
    horario_de_silencio: silence ? `${silence[0]} às ${silence[1]}` : "",
    animais_de_estimacao: petsLine ? (/n[aã]o/i.test(petsLine) ? "Não permitidos" : `Permitidos${petsMax ? ` · até ${petsMax} animais` : ""}`) : "",
    fumar: ruleLine(p, /fumar/i) ? `Proibido${/independentemente do ambiente/i.test(additional) ? " em qualquer ambiente do imóvel" : ""}` : "",
    festas_e_eventos: rulesText(p) ? (ruleLine(p, /n[aã]o s[aã]o permitidas festas/i) ? "Não permitidos" : "Permitidos") : "",
    criancas_e_bebes: rulesText(p) ? (/n[aã]o (adequado|permitid\w*)[^\n]*crian/i.test(rulesText(p)) ? "Não permitidos" : "Permitidos") : "",
    fotografia_comercial: rulesText(p) ? (ruleLine(p, /n[aã]o [eé] permitido fotografia/i) ? "Não permitida" : "Permitida") : "",
    maximo_de_hospedes: maxGuestsRule ?? "",
    cameras_aviso_ao_hospede:
      src.listingFacts?.find((f) => /c[aâ]mera/i.test(`${f.title} ${f.content}`) && f.key.startsWith("aviso"))?.content.trim() ||
      cameraLine,
    texto_de_seguranca: safety,
    regras_adicionais_da_casa: additional,
    contatos_de_emergencia: src.emergency.map((c) => `${c.label}: ${c.number}`.trim()).join("\n"),
    telefone_do_anfitriao: s(p.host_phone),
    politica_de_cancelamento: cancellation,
    taxa_de_limpeza: priceLine(/^Taxa de limpeza(?! para)/i),
    taxa_hospede_adicional: [priceLine(/^Hóspedes incluídos/i), priceLine(/^Por hóspede adicional/i)].filter(Boolean).join("\n"),
    taxa_pet: priceLine(/^Taxa de pet/i),
  };
  for (const k of ENTRY_FIELDS) values[k] = values[k] || entryValue(k);

  const sections: PlaybookSectionData[] = [1, 2, 3, 4, 5].map((num) => ({ id: `s${num}`, num, rows: [] }));
  const put = (num: number, row: PlaybookRow) => sections[num - 1].rows.push(row);

  for (const meta of PLAYBOOK_FIELDS) {
    const raw = values[meta.key] ?? "";
    const col = COLUMN_FIELDS[meta.key];
    const isList = LIST_FIELDS.has(meta.key);
    const isEntry = ENTRY_FIELDS.has(meta.key);
    const hasEntryOverride = isEntry && !!entryValue(meta.key);
    const editable = !!col || isList || isEntry;
    const kind: EditKind | null = col ? col.kind : isList || isEntry ? "textarea" : null;
    const empty = !raw;
    // Manuais: se a lista do guia tem itens, eles mandam — editar aqui só vale para o texto próprio.
    const editLocked = meta.key === "manuais_de_equipamentos" && src.manuals.length > 0 && !hasEntryOverride;
    put(meta.section, {
      id: `f:${meta.key}`,
      label: meta.label,
      value: empty ? EMPTY_TEXT : meta.secret ? MASK : raw,
      raw,
      empty,
      secret: meta.secret,
      copy: meta.copy && !empty,
      obs: meta.obs,
      au: meta.au,
      note: noteOf(`f:${meta.key}`),
      edit: editable && !editLocked ? kind : null,
      deletable: editable && !editLocked && (isEntry || isList || meta.key === "telefone_do_anfitriao" || meta.key === "regras_adicionais_da_casa"),
      removesRow: false,
      guideField: !!col || isList,
    });
  }

  // FAQs (seção 4) — uma linha por pergunta cadastrada.
  src.faqs.forEach((f) => {
    const raw = f.answer.trim();
    put(4, {
      id: `faq:${f.id}`,
      label: `FAQ · ${f.question.trim()}`,
      value: raw || EMPTY_TEXT,
      raw,
      empty: !raw,
      secret: false,
      copy: false,
      obs: FAQ_OBS,
      au: faqAudience(f.question),
      note: noteOf(`faq:${f.id}`),
      edit: "textarea",
      deletable: true,
      removesRow: true,
    });
  });

  // Prestadores de apoio (seção 5) — equipe interna.
  src.providers.forEach((pv) => {
    const cat = pv.category ? pv.category.charAt(0).toUpperCase() + pv.category.slice(1) : null;
    const raw = [cat, pv.phone, pv.email].filter((x) => x && String(x).trim()).join("\n");
    put(5, {
      id: `prov:${pv.linkId}`,
      label: `Prestador de apoio · ${pv.name}`,
      value: raw || EMPTY_TEXT,
      raw,
      empty: !raw,
      secret: false,
      copy: !!raw,
      obs: PROVIDER_OBS,
      au: "I",
      note: noteOf(`prov:${pv.linkId}`),
      edit: null,
      deletable: true,
      removesRow: true,
    });
  });

  // Linhas criadas pelo anfitrião.
  src.entries
    .filter((e) => e.field_key.startsWith("custom:"))
    .forEach((e) => {
      const raw = s(e.value);
      put(e.section_num && e.section_num >= 1 && e.section_num <= 5 ? e.section_num : 5, {
        id: e.field_key,
        label: s(e.custom_label) || "Novo campo",
        value: raw || EMPTY_TEXT,
        raw,
        empty: !raw,
        secret: false,
        copy: !!raw,
        obs: CUSTOM_OBS,
        au: e.custom_audience ?? "I",
        note: s(e.note),
        edit: "textarea",
        deletable: true,
        removesRow: true,
      });
    });

  return sections;
}

export function matchesQuery(row: PlaybookRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  // Segredo mascarado: o valor real nunca entra na busca.
  const hay = `${row.label} ${row.secret ? "" : row.value} ${row.obs} ${row.note ?? ""} ${AUDIENCE_LABEL[row.au]}`.toLowerCase();
  return hay.includes(needle);
}

/**
 * Regra de abertura: a tela SEMPRE abre tudo recolhido e só uma seção fica
 * aberta por vez; dentro da seção ativa, quantas linhas quiser podem ficar abertas.
 */
export function toggleRow(open: string[], id: string): string[] {
  return open.includes(id) ? open.filter((x) => x !== id) : [...open, id];
}
export function toggleSection(current: string | null, id: string): string | null {
  return current === id ? null : id;
}
