import { describe, expect, it } from "vitest";
import { parseCapacity, parsePublicListingHtml } from "@/lib/airbnb-public-parse";

const pdp = {
  overview: { title: "Espaço inteiro: apartamento em Foz do Iguaçu, Brasil", items: ["3 hóspedes", "1 quarto", "2 camas", "1 banheiro"] },
  sleepingArrangements: {
    stops: [{ name: "Quarto", description: { descriptions: [{ text: "1 cama de casal" }, { text: "1 cama de solteiro" }] } }],
  },
  rules: {
    groupItems: [
      { items: [{ title: "Horário de silêncio", description: { text: "23:00 - 07:00" } }, { title: "Proibido fumar", description: null }] },
      { items: [{ type: "HOUSE_RULES_ADDITIONAL_RULES", title: "Durante a estadia", description: { content: { localizedString: "- Proibido festas" } } }] },
    ],
  },
  safetyAndProperty: { groupItems: [{ items: [{ title: "Não há alarme de fumaça", description: null }] }] },
};
const html = `<meta property="og:title" content="Apartamento · Foz · 1 quarto · 2 camas · 1 banheiro"/><meta property="og:image" content="https://a0.muscache.com/x.jpeg?im_w=720&amp;q=1"/><script id="data-deferred-state-0" type="application/json">${JSON.stringify({ a: [{ data: { node: { pdpPresentation: pdp } } }] })}</script>`;

describe("leitura pública do anúncio", () => {
  it("extrai capacidade, cômodos, regras, segurança, tipo e capa", () => {
    const p = parsePublicListingHtml(html)!;
    expect([p.guests, p.bedrooms, p.beds, p.bathrooms]).toEqual([3, 1, 2, 1]);
    expect(p.roomsBeds).toEqual([{ room: "Quarto", beds: "1 cama de casal, 1 cama de solteiro" }]);
    expect(p.spaceType).toBe("Espaço inteiro: apartamento");
    expect(p.houseRules).toBe("Horário de silêncio\n23:00 - 07:00\nProibido fumar\nRegras adicionais:\n- Proibido festas");
    expect(p.safety).toBe("Não há alarme de fumaça");
    expect(p.cover).toBe("https://a0.muscache.com/x.jpeg");
  });
  it("cai no og:title quando não há overview", () => {
    expect(parseCapacity("Casa · ★5 · 2 quartos · 3 camas · 1,5 banheiro".split("·"))).toEqual({ guests: null, bedrooms: 2, beds: 3, bathrooms: 1.5 });
  });
});
