import { describe, it, expect } from "vitest";
import { PUBLIC_HOST_FACTS, listingFactAudience } from "@/lib/guest-ai/data/listing-normalized";
import {
  HOUSE_MANUAL_ENTRY,
  amenityDetails,
  discoverDynamicHostFacts,
  dynamicFactAudience,
  floorLabelOf,
  parseApt,
  extractUnitFromAddress,
  discoverChannexFacts,
  quietHoursOf,
  quietHoursText,
  checkoutInstructionsText,
  houseManualText,
  checkoutTaskLines,
  composeAddress,
  fullDescriptionText,
  hostFacts,
  hostPropertyPatch,
  mergeHostFacts,
  parseHostListing,
  parsePhotos,
  parseRooms,
} from "@/lib/airbnb-host-api";

const listing = {
  listing: {
    street: "Rua das Cataratas, 100",
    apt: "Casa 2",
    city: "Foz do Iguaçu",
    state: "PR",
    zipcode: "85851-000",
    country_code: "br",
    lat: -25.5,
    lng: -54.58,
    directions: "Após o portão, siga à esquerda.",
    person_capacity: 6,
    bedrooms: 2,
    beds: 3,
    bathrooms: 1.5,
    check_out_tasks: ["RETURN_KEYS", { type: "THROW_TRASH" }, { type: "ADDITIONAL_REQUESTS", details: "Deixe a louça na pia" }],
    quality_standards: { is_guest_favorite: true },
    check_in_time_start: "15",
    check_in_time_end: "22",
    check_out_time: 11,
    wireless_info: { wireless_ssid: "CasaWifi", wireless_password: "segredo123" },
    property_type_group: "house",
    host_roles: { is_super_host: true },
  },
};
const descriptions = { listing_descriptions: [{ locale: "en", name: "EN" }, { locale: "pt", name: "Casa Charmosa", summary: "Resumo", description: "Descrição", space: "Sala ampla", access: "Casa inteira", neighborhood_overview: "Bairro calmo", transit: "Ônibus na esquina", notes: "Sem festas", house_rules: "Silêncio após 22h" }] };
const rooms = {
  listing_rooms: [
    { room_number: 2, beds: [{ type: "single_bed", quantity: 2 }] },
    { room_number: 1, beds: [{ type: "queen_bed", quantity: 1 }] },
    { room_number: 0, beds: [] },
  ],
};
const photos = {
  listing_photos: [
    { sort_order: 2, extra_medium_url: "https://a0.muscache.com/b.jpg", caption: "Sala" },
    { sort_order: 1, extra_medium_url: "https://a0.muscache.com/a.jpg", caption: "Fachada", room_id: 9 },
    { sort_order: 3, extra_medium_url: "http://inseguro.jpg" },
  ],
};

describe("API do anfitrião — leitura pura", () => {
  const h = parseHostListing("123456", { listing, descriptions, rooms, photos })!;

  it("lê endereço, coordenadas, capacidade, descrição em pt e selos", () => {
    expect(h).toMatchObject({ city: "Foz do Iguaçu", countryCode: "BR", lat: -25.5, lng: -54.58, personCapacity: 6, bathrooms: 1.5, name: "Casa Charmosa", isGuestFavorite: true, isSuperhost: true });
    expect(composeAddress(h)).toBe("Rua das Cataratas, 100, Casa 2, CEP 85851-000");
  });

  it("coleta 100% do que a API devolve: todas as seções, horários, Wi-Fi e resposta bruta", () => {
    expect(h).toMatchObject({ space: "Sala ampla", access: "Casa inteira", neighborhoodOverview: "Bairro calmo", transit: "Ônibus na esquina", notes: "Sem festas", houseRules: "Silêncio após 22h", checkInStart: "15:00", checkInEnd: "22:00", checkOutTime: "11:00", wifiSsid: "CasaWifi", wifiPassword: "segredo123", propertyType: "house" });
    expect(h.raw?.listing).toBe(listing);
    const full = fullDescriptionText(h)!;
    for (const t of ["Resumo", "Descrição", "O espaço\nSala ampla", "A vizinhança\nBairro calmo", "Como se locomover\nÔnibus na esquina", "Outras observações\nSem festas"]) expect(full).toContain(t);
  });

  it("horários e Wi-Fi do anúncio substituem os do sistema", () => {
    const p = hostPropertyPatch(h, { checkin_time: "14:00", checkout_time: "11:00", wifi_ssid: "Velho", wifi_password: "x" });
    expect(p).toMatchObject({ checkin_time: "15:00", checkin_time_max: "22:00", wifi_ssid: "CasaWifi", wifi_password: "segredo123" });
    expect(p).not.toHaveProperty("checkout_time");
  });

  it("fotos ordenadas por sort_order, todas (sem limite de 1), só https", () => {
    expect(parsePhotos(photos).map((p) => p.url)).toEqual(["https://a0.muscache.com/a.jpg", "https://a0.muscache.com/b.jpg"]);
  });

  it("cômodos no formato de airbnb_rooms_beds", () => {
    expect(parseRooms(rooms)).toEqual([
      { room: "Quarto 1", beds: "1 cama queen" },
      { room: "Quarto 2", beds: "2 camas de solteiro" },
    ]);
  });

  it("tarefas de saída em português, com o texto livre do anfitrião", () => {
    expect(checkoutTaskLines(listing.listing.check_out_tasks)).toEqual(["Devolver as chaves", "Jogar o lixo fora", "Deixe a louça na pia"]);
  });

  it("formato real da API: objeto por tipo, com task_detail e is_present", () => {
    expect(checkoutTaskLines({ RETURN_KEYS: { is_present: true, task_detail: "" }, THROW_TRASH: { is_present: true, task_detail: "No contêiner da rua" }, STRIP_BEDS: { is_present: false, task_detail: "" } })).toEqual(["Devolver as chaves", "Jogar o lixo fora: No contêiner da rua"]);
  });

  it("estado sem o prefixo em inglês", () => {
    expect(parseHostListing("1", { listing: { listing: { state: "State of Paraná", city: "Foz" } } })!.state).toBe("Paraná");
  });

  it("coordenada 0,0 ou fora do intervalo é descartada", () => {
    expect(parseHostListing("1", { listing: { listing: { lat: 0, lng: 0, city: "X" } } })!.lat).toBeNull();
    expect(parseHostListing("1", { listing: { listing: { lat: 120, lng: 10, city: "X" } } })!.lat).toBeNull();
  });

  it("resposta vazia não gera dado nenhum", () => {
    expect(parseHostListing("1", {})).toBeNull();
  });

  it("fatos do dossiê: como chegar, tarefas de check-out e cômodos (substituindo os antigos)", () => {
    const keys = hostFacts(h).map((f) => f.key);
    for (const k of ["descricao_anfitriao", "o_espaco", "acesso_hospede", "vizinhanca", "transporte", "outras_observacoes", "regras_anfitriao", "tipo_imovel", "selos_anuncio", "fotos_legendas", "como_chegar", "tarefas_checkout", "distribuicao_comodos"]) expect(keys).toContain(k);
    expect(JSON.stringify(hostFacts(h))).not.toContain("segredo123");
    const merged = mergeHostFacts([{ key: "como_chegar", title: "velho", content: "x" }, { key: "horarios", title: "H", content: "y" }], h);
    expect(merged.filter((f) => f.key === "como_chegar")).toHaveLength(1);
    expect(merged[0]!.key).toBe("horarios");
  });

  it("anúncio soberano nos dados cadastrais e nas instruções, cada uma no seu campo", () => {
    const comCheckin = parseHostListing("1", { listing: { listing: { ...listing.listing, check_in_option: { category: "lockbox", instruction: "1. Abra o cofre." } } } })!;
    const p = hostPropertyPatch(comCheckin, { lat: -25.4, lng: -54.5, address: "", city: "Minha cidade", checkin_instructions: "https://conciergeia.app/g/x", checkout_instructions: "guia da equipe", address_note: "antigo", gallery_images: [] });
    expect(p).toMatchObject({ lat: -25.5, lng: -54.58, address: "Rua das Cataratas, 100, Casa 2, CEP 85851-000", city: "Foz do Iguaçu", state: "PR", country: "BR", airbnb_guest_count: 6 });
    expect(p["checkin_instructions"]).toBe("1. Abra o cofre.");
    expect(p["checkout_instructions"]).toContain("• Devolver as chaves");
    expect(p["address_note"]).toBe("Após o portão, siga à esquerda.");
  });

  it("Como chegar: link do Maps vai para Link do mapa, link do guia fica de fora; cópia antiga sai de Instruções de check-in", () => {
    const comLink = (d: string) => parseHostListing("1", { listing: { listing: { ...listing.listing, directions: d } } })!;
    const maps = hostPropertyPatch(comLink("https://maps.app.goo.gl/abc"), { checkin_instructions: "https://maps.app.goo.gl/abc" });
    expect(maps["maps_url"]).toBe("https://maps.app.goo.gl/abc");
    expect(maps).not.toHaveProperty("address_note");
    expect(maps["checkin_instructions"]).toBeNull();
    const guia = hostPropertyPatch(comLink("https://conciergeia.app/g/studio101"), { address_note: "texto da equipe" });
    expect(guia).not.toHaveProperty("address_note");
    expect(guia).not.toHaveProperty("maps_url");
    expect(hostFacts(comLink("https://conciergeia.app/g/studio101")).some((f) => f.key === "como_chegar")).toBe(false);
  });

  it("tarefa de saída já numerada pelo anfitrião entra sem marcador por cima", () => {
    expect(checkoutInstructionsText({ checkoutTasks: ["1. Retire o veículo.\n2. Feche o portão.", "Jogar o lixo fora"] })).toBe("1. Retire o veículo.\n2. Feche o portão.\n• Jogar o lixo fora");
  });

  it("manual da casa do anúncio vira o campo Manual da casa do dossiê (seção 3, Reserva Ativa)", () => {
    const m = parseHostListing("1", { listing: { listing: { ...listing.listing, house_manual: "Toalhas nos armários." } } })!;
    expect(houseManualText(m)).toBe("Toalhas nos armários.");
    expect(HOUSE_MANUAL_ENTRY).toMatchObject({ fieldKey: expect.stringMatching(/^custom:/), label: "Manual da casa", section: 3, audience: "G" });
    expect(houseManualText(h)).toBeNull();
  });

  it("instruções vazias são preenchidas pelo anúncio", () => {
    const p = hostPropertyPatch(h, { checkin_instructions: "", checkout_instructions: null });
    expect(p["address_note"]).toBe("Após o portão, siga à esquerda.");
    expect(p["checkout_instructions"]).toContain("• Devolver as chaves");
    expect(p["hero_image_url"]).toBe("https://a0.muscache.com/a.jpg");
  });

  it("uma foto divergente substitui a galeria inteira pelas do anúncio", () => {
    const own = "https://x.supabase.co/storage/v1/object/sign/property-images/p/1.jpg";
    const p = hostPropertyPatch(h, { gallery_images: [own, "https://a0.muscache.com/b.jpg"], hero_image_url: own });
    expect(p["gallery_images"]).toEqual(["https://a0.muscache.com/a.jpg", "https://a0.muscache.com/b.jpg"]);
    expect(p["hero_image_url"]).toBe("https://a0.muscache.com/a.jpg");
  });

  it("ordem diferente também é divergência", () => {
    const p = hostPropertyPatch(h, { gallery_images: ["https://a0.muscache.com/b.jpg", "https://a0.muscache.com/a.jpg"] });
    expect(p["gallery_images"]).toEqual(["https://a0.muscache.com/a.jpg", "https://a0.muscache.com/b.jpg"]);
  });

  it("tudo igual ao anúncio: nada é regravado; dado ausente na API não apaga o salvo", () => {
    const full = { ...hostPropertyPatch(h, {}) } as Record<string, unknown>;
    expect(hostPropertyPatch(h, full)).toEqual({});
    const semFotos = parseHostListing("2", { listing: { listing: { city: "X" } } })!;
    expect(hostPropertyPatch(semFotos, { gallery_images: ["https://a0.muscache.com/z.jpg"], address: "Rua A", city: "X" })).toEqual({});
  });
});

describe("API do anfitrião — andar, silêncio e comodidades detalhadas", () => {
  const rich = {
    listing: {
      ...listing.listing,
      property_details: { listing_floor: 3, listing_size: { size: 35, size_unit: "SQUARE_METERS" }, number_of_floors: 4 },
      quiet_hours: [{ start_time: "23", end_time: "7" }],
      amenities: {
        AC: { is_present: true, metadata: { ac: { ac_options: ["SPLIT_TYPE_DUCTLESS"] } }, room_attachment_infos: [{ is_attached: true, room_id: "11" }, { is_attached: true, room_id: "12" }] },
        TV: { is_present: true, metadata: { tv: { quality: "HD", services: ["CHROMECAST"], size_in_inch: 55 } }, room_attachment_infos: [{ is_attached: true, room_id: "13" }] },
        STOVE: { is_present: true, metadata: { stove: { stove_type: "GAS", number_of_burners: 5, stove_materials: ["STAINLESS_STEEL"] } } },
        WASHER: { is_present: true, metadata: { laundry: { amenity_price: { price_category: "FREE" }, location: "IN_UNIT" } } },
        FREE_PARKING: { is_present: true, metadata: { parking: { number_of_spaces: 2, parking_type: "RESIDENTIAL_GARAGE" } } },
        HAIR_DRYER: { is_present: true, instruction: "" },
        CARBON_MONOXIDE_DETECTOR: { is_present: false, metadata: { carbon_monoxide_detector: { confirmed_safe: true } } },
        CLEANING_BEFORE_CHECKOUT: {
          is_present: true,
          metadata: {
            cleaning_before_checkout: {
              amenity_price: { price_category: "PAID" },
              day_availability: { service_day_availability_type: "EVERY_DAY" },
              time_availability: { available_times: [{ start_time: "0800", end_time: "2000" }], service_time_availability_type: "SPECIFIC_TIMES" },
            },
          },
        },
      },
    },
  };
  const richRooms = {
    listing_rooms: [
      { id: "11", room_type: "bedroom", beds: [{ type: "queen_bed", quantity: 1 }] },
      { id: "12", room_type: "bedroom", beds: [{ type: "double_bed", quantity: 1 }] },
      { id: "13", room_type: "living_room", beds: [{ type: "sofa_bed", quantity: 1 }] },
    ],
  };
  const h = parseHostListing("999", { listing: rich, descriptions, rooms: richRooms, photos })!;
  const fact = (key: string) => hostFacts(h).find((f) => f.key === key)?.content ?? null;

  it("andar do anúncio vira o campo apartment_floor (regra por número de pavimentos)", () => {
    expect(floorLabelOf(0)).toBe("Térreo");
    expect(floorLabelOf(1, 1)).toBe("Térreo");
    expect(floorLabelOf(1, 4)).toBe("1º andar");
    expect(floorLabelOf(1, null, true)).toBe("1º andar");
    expect(floorLabelOf(1)).toBe("Térreo");
    expect(floorLabelOf(2, 4)).toBe("2º andar");
    expect(floorLabelOf(3)).toBe("3º andar");
    expect(floorLabelOf(null)).toBeNull();
    // Apê da Lívia: prédio de 4 pavimentos, listing_floor 1 → 1º andar (não térreo)
    const livia = parseHostListing("2", { listing: { listing: { street: "Rua A, 1", apt: "Apto 202, Bloco 1 - Garagem 202", property_details: { listing_floor: 1, number_of_floors: 4 } } } })!;
    expect(hostPropertyPatch(livia, {})["apartment_floor"]).toBe("1º andar");
    const casa = parseHostListing("3", { listing: { listing: { street: "Rua A, 1", apt: "Casa", property_details: { listing_floor: 1, number_of_floors: 1 } } } })!;
    expect(hostPropertyPatch(casa, {})["apartment_floor"]).toBe("Térreo");
    expect(hostPropertyPatch(casa, {})).not.toHaveProperty("apartment_number");
    expect(h.listingFloor).toBe(3);
    expect(hostPropertyPatch(h, {})["apartment_floor"]).toBe("3º andar");
    expect(hostPropertyPatch(h, { apartment_floor: "3º andar" })).not.toHaveProperty("apartment_floor");
    // anúncio soberano: divergência substitui o que estava salvo
    expect(hostPropertyPatch(h, { apartment_floor: "5" })["apartment_floor"]).toBe("3º andar");
    // sem o dado na API, nada é apagado
    const semAndar = parseHostListing("1", { listing: { listing: { city: "X" } } })!;
    expect(hostPropertyPatch(semAndar, { apartment_floor: "Térreo" })).not.toHaveProperty("apartment_floor");
  });

  it("o andar também sai do JSON bruto de anúncios sincronizados antes do campo existir", () => {
    const antigo = { ...h, listingFloor: undefined, quietHours: undefined };
    expect(hostPropertyPatch(antigo, {})["apartment_floor"]).toBe("3º andar");
    expect(quietHoursText(antigo)).toBe("23:00 às 07:00");
  });

  it("horário de silêncio estruturado (quiet_hours)", () => {
    expect(h.quietHours).toEqual([{ start: "23:00", end: "07:00" }]);
    expect(quietHoursOf({ quiet_hours: [{ start_time: "22", end_time: "08" }, { start_time: "x" }] })).toEqual([{ start: "22:00", end: "08:00" }]);
    expect(quietHoursOf({})).toEqual([]);
    expect(fact("horario_silencio")).toBe("23:00 às 07:00");
  });

  it("área e estrutura entram nos fatos", () => {
    expect(fact("estrutura_imovel")).toContain("Área: 35 m²");
  });

  it("comodidades detalhadas por grupo, com cômodos atendidos", () => {
    expect(fact("comodidade_climatizacao")).toBe("• Ar-condicionado: split · em Quarto 1, Quarto 2");
    expect(fact("comodidade_entretenimento")).toBe("• TV: HD · Chromecast · 55 polegadas · em Sala de estar");
    expect(fact("comodidade_cozinha_e_sala_de_jantar")).toBe("• Fogão: a gás · 5 bocas · aço inox");
    expect(fact("comodidade_quarto_e_lavanderia")).toBe("• Máquina de lavar: grátis · dentro da unidade");
    expect(fact("comodidade_garagem")).toBe("• Estacionamento gratuito no local: 2 vagas · garagem residencial");
  });

  it("serviço com preço, dias e horários não perde nenhum dado", () => {
    expect(fact("comodidade_areas_externas")).toBe("• Limpeza antes do check-out: pago · todos os dias · das 08:00 às 20:00");
  });

  it("comodidade ausente declarada pela API vai para o rol de ausentes; presente sem detalhe não gera linha", () => {
    expect(fact("comodidades_ausentes_api")).toBe("• Detector de monóxido de carbono");
    expect(fact("comodidade_banheiro")).toBeNull();
  });

  it("amenidade desconhecida não é descartada: entra com o nome humanizado", () => {
    const x = amenityDetails({ SOME_NEW_THING: { is_present: true, metadata: { some: { fenced: true, privacy: "PRIVATE" } } } }, null);
    expect(x.details).toEqual([{ group: "areas_externas", line: "• Some new thing: cercado · privativo" }]);
  });

  it("cada fato emitido tem etiqueta declarada (G só para os quatro de reserva; o resto é P explícito)", () => {
    const G = ["como_chegar", "instrucoes_checkin", "tarefas_checkout", "manual_casa_anuncio"];
    const full = parseHostListing("999", {
      listing: { listing: { ...rich.listing, directions: "Siga reto", house_manual: "Manual", check_in_option: { category: "keypad", instruction: "Use o código" }, listing_views: ["GARDEN_VIEW"], check_out_tasks: ["RETURN_KEYS"] } },
      descriptions,
      rooms: richRooms,
      photos: { listing_photos: [{ sort_order: 1, extra_medium_url: "https://a0.muscache.com/a.jpg", caption: "Fachada" }] },
    })!;
    for (const f of hostFacts(full)) {
      if (G.includes(f.key)) expect(listingFactAudience(f.key)).toBe("G");
      else {
        expect(PUBLIC_HOST_FACTS.has(f.key), `chave sem etiqueta explícita: ${f.key}`).toBe(true);
        expect(listingFactAudience(f.key)).toBe("P");
      }
    }
  });
});

describe("API do anfitrião — auto-descoberta de fatos novos (extra_*)", () => {
  // Payload simulando campos que o Airbnb passou a devolver e que o código ainda não conhece.
  const novo = {
    // já mapeados: nunca viram extra_
    street: "Rua A, 1",
    city: "Foz do Iguaçu",
    amenities: { TV: { is_present: true } },
    quiet_hours: [{ start_time: "23", end_time: "7" }],
    property_details: { listing_floor: 2, number_of_floors: 3, elevator_floor_access: true },
    // inéditos e públicos
    ev_charger_speed: "FAST_CHARGER",
    display_exact_location_to_guest: false,
    categories: ["National parks"],
    parking_rules: { guest_spots: 2, visitors_allowed: false, nested: { deep: "x" } },
    pool_hours: "08:00–20:00",
    // inéditos com termo de acesso/trajeto na chave: G
    key_pickup_location: "Cofre ao lado do portão",
    gate_instructions: "Toque a campainha e aguarde",
    // credencial: nunca vira fato
    lockbox_code: "4821",
    door_pin: 9911,
    backup_password: "segredo",
    // ruído técnico
    user_id: "123",
    listing_id: "999",
    updated_at: "2026-11-19T10:00:00Z",
    host_token: "abc",
    hash_ref: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    promo_link: "https://airbnb.com/r/abc?utm_source=x",
    reservation_issues: ["x"],
    has_availability: true,
    empty_text: "   ",
    empty_list: [],
    objeto_em_lista: [{ a: 1 }],
  };
  const found = discoverDynamicHostFacts(novo);
  const by = (k: string) => found.find((f) => f.key === k);

  it("campo inédito público vira fato extra_<chave> com título em português e sem sufixo técnico", () => {
    expect(by("extra_ev_charger_speed")).toEqual({ key: "extra_ev_charger_speed", title: "Velocidade do carregador veicular (Airbnb)", content: "fast charger" });
    expect(by("extra_display_exact_location_to_guest")!.content).toBe("Não");
    expect(by("extra_categories")!.content).toBe("National parks");
    expect(by("extra_pool_hours")!.content).toBe("08:00–20:00");
  });

  it("segundo nível: campos primitivos do objeto entram; mais fundo que isso fica de fora", () => {
    expect(by("extra_parking_rules_guest_spots")!.content).toBe("2");
    expect(by("extra_parking_rules_visitors_allowed")!.content).toBe("Não");
    expect(found.some((f) => f.key.includes("nested") || f.key.includes("deep"))).toBe(false);
  });

  it("campo novo dentro de property_details também é descoberto; os conhecidos não", () => {
    expect(by("extra_property_details_elevator_floor_access")!.content).toBe("Sim");
    expect(found.some((f) => /listing_floor|number_of_floors/.test(f.key))).toBe(false);
  });

  it("chaves já mapeadas nunca duplicam", () => {
    expect(found.some((f) => /street|city|amenities|quiet_hours/.test(f.key))).toBe(false);
  });

  it("ruído técnico, vazios e estruturas complexas ficam de fora", () => {
    for (const k of ["user_id", "listing_id", "updated_at", "host_token", "hash_ref", "promo_link", "reservation_issues", "has_availability", "empty_text", "empty_list", "objeto_em_lista"]) {
      expect(found.some((f) => f.key === `extra_${k}`), k).toBe(false);
    }
  });

  it("credencial (código, PIN, senha) nunca vira fato, nem como G", () => {
    for (const k of ["lockbox_code", "door_pin", "backup_password"]) expect(found.some((f) => f.key === `extra_${k}`), k).toBe(false);
    expect(JSON.stringify(found)).not.toMatch(/4821|9911|segredo/);
  });

  it("etiqueta dinâmica: termo de acesso/trajeto na chave = G; qualquer outro = P", () => {
    expect(listingFactAudience("extra_key_pickup_location")).toBe("G");
    expect(listingFactAudience("extra_gate_instructions")).toBe("G");
    expect(by("extra_key_pickup_location")!.content).toBe("Cofre ao lado do portão");
    for (const k of ["extra_ev_charger_speed", "extra_pool_hours", "extra_categories", "extra_parking_rules_guest_spots", "extra_pinned_note"]) {
      expect(listingFactAudience(k), k).toBe("P");
    }
    expect(dynamicFactAudience("extra_trajeto_alternativo")).toBe("G");
    // fatos fixos seguem como antes
    expect(listingFactAudience("como_chegar")).toBe("G");
    expect(listingFactAudience("estrutura_imovel")).toBe("P");
  });

  it("integrado ao hostFacts a partir do bruto guardado (anúncio já sincronizado ganha os fatos sem nova coleta)", () => {
    const h = parseHostListing("777", { listing: { listing: novo } })!;
    const keys = hostFacts(h).map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["extra_ev_charger_speed", "extra_key_pickup_location", "horario_silencio"]));
    expect(keys).not.toContain("extra_lockbox_code");
    // regravação: o fato novo substitui o antigo de mesma chave
    const merged = mergeHostFacts([{ key: "extra_pool_hours", title: "x", content: "velho" }], h);
    expect(merged.filter((f) => f.key === "extra_pool_hours")).toHaveLength(1);
    expect(merged.find((f) => f.key === "extra_pool_hours")!.content).toBe("08:00–20:00");
  });
});

describe("número do apartamento, vaga e condomínio (apt)", () => {
  it("parseApt extrai unidade e garagem", () => {
    expect(parseApt("Apto 202, Bloco 1 - Garagem 202")).toEqual({ unit: "202, Bloco 1", parking: "202" });
    expect(parseApt("Apto 101")).toEqual({ unit: "101", parking: null });
    expect(parseApt("Studio n° 4")).toEqual({ unit: "4", parking: null });
    expect(parseApt("Casa")).toEqual({ unit: null, parking: null });
    expect(parseApt("Studio")).toEqual({ unit: null, parking: null });
    expect(parseApt(null)).toEqual({ unit: null, parking: null });
  });

  it("fallback pelo endereço salvo", () => {
    expect(extractUnitFromAddress("Rua Bento Gonçalves, 60, Apto 102, CEP 85868-070").unit).toBe("102");
    expect(extractUnitFromAddress("Rua Ataláia, 312, Studio n° 4, CEP 85855-715").unit).toBe("4");
    expect(extractUnitFromAddress("Rua Maracatu, 621, Casa").unit).toBeNull();
  });

  it("hostPropertyPatch grava apartment_number, in_condominium e vaga (sem apagar vaga já cadastrada)", () => {
    const h = parseHostListing("2", { listing: { listing: { street: "Rua A, 1", apt: "Apto 202, Bloco 1 - Garagem 202", property_details: { listing_floor: 1, number_of_floors: 4 } } } })!;
    const p = hostPropertyPatch(h, { in_condominium: false, parking_spots: [] });
    expect(p["apartment_number"]).toBe("202, Bloco 1");
    expect(p["in_condominium"]).toBe(true);
    expect(p["parking_spots"]).toEqual(["202"]);
    const manual = hostPropertyPatch(h, { in_condominium: true, parking_spots: ["A1"] });
    expect(manual).not.toHaveProperty("parking_spots");
    expect(manual).not.toHaveProperty("in_condominium");
  });
});

describe("auto-descoberta Channex", () => {
  const meta = { title: "X", city: "Foz", property_kind: "apartment", checkin_token: "abc" };
  const settings = {
    booking_setting: { check_in_time_start: 14, smart_lock_code: "1234", parking_available: true, pet_fee_note: "Taxa de R$ 50" },
    availability_rule: { default_min_nights: 1, gap_nights: 2 },
    rate_plan_id: "zzz",
  };
  const facts = discoverChannexFacts(meta, settings);
  const keys = facts.map((f) => f.key);
  it("fatos novos viram extra_channex_*", () => {
    expect(keys).toContain("extra_channex_meta_property_kind");
    expect(keys).toContain("extra_channex_booking_setting_parking_available");
    expect(keys).toContain("extra_channex_booking_setting_pet_fee_note");
    expect(keys).toContain("extra_channex_availability_rule_gap_nights");
    expect(facts.find((f) => f.key.endsWith("parking_available"))?.content).toBe("Sim");
  });
  it("mapeados, credenciais e ruído ficam de fora", () => {
    expect(keys.join()).not.toMatch(/check_in_time_start|default_min_nights|smart_lock_code|rate_plan_id|token|meta_title/);
  });
});

describe("térreo pela descrição do anúncio (23/11/2026)", () => {
  it("listing_floor 1 em prédio de 2 pavimentos, descrição diz térreo → Térreo", () => {
    const h = parseHostListing("9", { listing: { listing: { street: "Rua A, 1", apt: "Apto 101", property_details: { listing_floor: 1, number_of_floors: 2 } } }, descriptions: { listing_description: { description: "Studio n° 101 no térreo, próximo ao Paraguai." } } })!;
    expect(hostPropertyPatch(h, {})["apartment_floor"]).toBe("Térreo");
  });
  it("sem menção a térreo continua 1º andar", () => {
    const h = parseHostListing("9", { listing: { listing: { street: "Rua A, 1", apt: "Apto 202", property_details: { listing_floor: 1, number_of_floors: 4 } } }, descriptions: { listing_description: { description: "Apê aconchegante." } } })!;
    expect(hostPropertyPatch(h, {})["apartment_floor"]).toBe("1º andar");
  });
});

