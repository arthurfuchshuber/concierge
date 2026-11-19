import { describe, it, expect } from "vitest";
import {
  checkoutTaskLines,
  composeAddress,
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
    host_roles: { is_super_host: true },
  },
};
const descriptions = { listing_descriptions: [{ locale: "en", name: "EN" }, { locale: "pt", name: "Casa Charmosa", summary: "Resumo", description: "Descrição" }] };
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

  it("coordenada 0,0 ou fora do intervalo é descartada", () => {
    expect(parseHostListing("1", { listing: { listing: { lat: 0, lng: 0, city: "X" } } })!.lat).toBeNull();
    expect(parseHostListing("1", { listing: { listing: { lat: 120, lng: 10, city: "X" } } })!.lat).toBeNull();
  });

  it("resposta vazia não gera dado nenhum", () => {
    expect(parseHostListing("1", {})).toBeNull();
  });

  it("fatos do dossiê: como chegar, tarefas de check-out e cômodos (substituindo os antigos)", () => {
    expect(hostFacts(h).map((f) => f.key)).toEqual(["como_chegar", "tarefas_checkout", "distribuicao_comodos"]);
    const merged = mergeHostFacts([{ key: "como_chegar", title: "velho", content: "x" }, { key: "horarios", title: "H", content: "y" }], h);
    expect(merged.filter((f) => f.key === "como_chegar")).toHaveLength(1);
    expect(merged[0]!.key).toBe("horarios");
  });

  it("preenche só o que está vazio e não sobrescreve edição manual", () => {
    const p = hostPropertyPatch(h, { lat: null, lng: null, address: "", city: "Minha cidade", checkin_instructions: "manual", gallery_images: [] });
    expect(p).toMatchObject({ lat: -25.5, lng: -54.58, address: "Rua das Cataratas, 100, Casa 2, CEP 85851-000", state: "PR", country: "BR", airbnb_guest_count: 6 });
    expect(p).not.toHaveProperty("city");
    expect(p).not.toHaveProperty("checkin_instructions");
    expect(p["checkout_instructions"]).toContain("• Devolver as chaves");
    expect(p["gallery_images"]).toEqual(["https://a0.muscache.com/a.jpg", "https://a0.muscache.com/b.jpg"]);
    expect(p["hero_image_url"]).toBe("https://a0.muscache.com/a.jpg");
  });

  it("coordenadas já gravadas não são trocadas", () => {
    expect(hostPropertyPatch(h, { lat: -25.4, lng: -54.5 })).not.toHaveProperty("lat");
  });

  it("galeria curada à mão (fotos do sistema) é preservada", () => {
    const own = "https://x.supabase.co/storage/v1/object/sign/property-images/p/1.jpg";
    const p = hostPropertyPatch(h, { gallery_images: [own, "https://a0.muscache.com/a.jpg"], hero_image_url: own });
    expect(p).not.toHaveProperty("gallery_images");
    expect(p).not.toHaveProperty("hero_image_url");
  });

  it("galeria antiga de 1 foto do Airbnb é substituída pela completa", () => {
    const p = hostPropertyPatch(h, { gallery_images: ["https://a0.muscache.com/capa.jpg"], hero_image_url: "https://a0.muscache.com/capa.jpg" });
    expect(p["gallery_images"]).toHaveLength(2);
  });
});
