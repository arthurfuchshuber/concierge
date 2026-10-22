import { describe, expect, it } from "vitest";
import { buildPlaybook, matchesQuery, splitListingTitle, toggleRow, toggleSection, type PlaybookSource } from "@/lib/playbook-build";

const src = (over: Partial<PlaybookSource> = {}): PlaybookSource => ({
  property: {
    name: "Casa Charmosa",
    address: "R. Maracatu, 621 - São Roque, Foz do Iguaçu - PR, 85853-705",
    city: "Foz do Iguaçu",
    gate_code: "1234",
    wifi_ssid: "Rede",
    in_condominium: false,
    vehicles_max: 2,
    checkin_time: "15:00",
    checkin_time_max: "23:00",
    checkout_time: "11:00",
    airbnb_house_rules: "Horário de silêncio 23:00 - 07:00\nPermitido animais de estimação\nProibido fumar",
    airbnb_amenities: [
      { name: "Ar-condicionado split", available: true, category: null },
      { name: "Detector de fumaça", available: false, category: null },
    ],
  },
  faqs: [{ id: "f1", question: "Qual é a senha do Wi-Fi?", answer: "Fica no guia." }],
  checkout: [{ id: "c1", label: "Desligue as luzes" }],
  emergency: [],
  manuals: [],
  providers: [{ linkId: "l1", name: "Esther", category: "Limpeza", phone: "+55", email: null }],
  entries: [],
  ...over,
});
const find = (s: ReturnType<typeof buildPlaybook>, id: string) => s.flatMap((x) => x.rows).find((r) => r.id === id)!;

describe("buildPlaybook", () => {
  it("cria as 5 seções e deriva valores do cadastro", () => {
    const s = buildPlaybook(src());
    expect(s).toHaveLength(5);
    expect(find(s, "f:cep").raw).toBe("85853-705");
    expect(find(s, "f:bairro").raw).toBe("São Roque");
    expect(find(s, "f:horario_de_check_in").value).toBe("A partir das 15:00 · até as 23:00");
    expect(find(s, "f:horario_de_silencio").value).toBe("23:00 às 07:00");
    expect(find(s, "f:climatizacao").value).toBe("Ar-condicionado split");
    expect(find(s, "f:ausentes_no_anuncio").value).toBe("Detector de fumaça");
    expect(find(s, "f:checklist_de_saida").raw).toBe("1. Desligue as luzes");
  });
  it("mascara segredos e marca vazio como 'não cadastrado'", () => {
    const s = buildPlaybook(src());
    expect(find(s, "f:codigo_do_portao").value).toBe("••••••");
    expect(find(s, "f:codigo_do_portao").raw).toBe("1234");
    expect(find(s, "f:voltagem_das_tomadas").value).toBe("não cadastrado");
    expect(find(s, "f:voltagem_das_tomadas").empty).toBe(true);
  });
  it("só dá edição ao que é cadastro manual; anúncio é só leitura", () => {
    const s = buildPlaybook(src());
    expect(find(s, "f:link_do_mapa").edit).toBe("text");
    expect(find(s, "f:titulo_publico").edit).toBeNull();
    expect(find(s, "f:camas").edit).toBeNull();
    expect(find(s, "f:voltagem_das_tomadas").deletable).toBe(true);
    expect(find(s, "f:cidade").deletable).toBe(false);
  });
  it("FAQ, prestador e linhas próprias entram com audiência e exclusão que remove a linha", () => {
    const s = buildPlaybook(
      src({ entries: [{ id: "e1", field_key: "custom:x", value: "v", note: null, custom_label: "Lixo", custom_audience: "G", section_num: 1 }] }),
    );
    expect(find(s, "faq:f1").au).toBe("G");
    expect(find(s, "prov:l1").au).toBe("I");
    expect(find(s, "prov:l1").removesRow).toBe(true);
    expect(s[0].rows.some((r) => r.id === "custom:x" && r.label === "Lixo")).toBe(true);
  });
  it("carrega o valor e a nota guardados nas entradas", () => {
    const s = buildPlaybook(
      src({ entries: [{ id: "e2", field_key: "f:voltagem_das_tomadas", value: "220V", note: "Cuidado", custom_label: null, custom_audience: null, section_num: null }] }),
    );
    expect(find(s, "f:voltagem_das_tomadas").value).toBe("220V");
    expect(find(s, "f:voltagem_das_tomadas").note).toBe("Cuidado");
  });
});

describe("busca e abertura", () => {
  it("a busca nunca enxerga o valor de segredos", () => {
    const row = find(buildPlaybook(src()), "f:codigo_do_portao");
    expect(matchesQuery(row, "1234")).toBe(false);
    expect(matchesQuery(row, "portão")).toBe(true);
    expect(matchesQuery({ ...row, note: "ligar para o zelador" }, "zelador")).toBe(true);
    expect(matchesQuery({ ...row, note: "" }, "zelador")).toBe(false);
  });
  it("linhas abertas sem limite e 1 seção por vez", () => {
    expect(toggleRow(toggleRow(toggleRow([], "a"), "b"), "c")).toEqual(["a", "b", "c"]);
    expect(toggleRow(["a"], "a")).toEqual([]);
    expect(toggleSection("s1", "s2")).toBe("s2");
    expect(toggleSection("s1", "s1")).toBeNull();
  });
});

describe("nome interno e título público", () => {
  it("separa pelo título público já cadastrado, mesmo com hífen ou ponto médio nele", () => {
    expect(splitListingTitle("45998276006 Arthur Tenório · Casa Charmosa Próx. a Avenida das Cataratas", "Casa Charmosa Próx. a Avenida das Cataratas")).toEqual({
      internal: "45998276006 Arthur Tenório",
      publicTitle: "Casa Charmosa Próx. a Avenida das Cataratas",
    });
    expect(splitListingTitle("Ana Silva · Studio - Centro · Vista", "Studio - Centro · Vista").internal).toBe("Ana Silva");
  });
  it("sem referência, usa o primeiro separador; sem separador não inventa nome interno", () => {
    expect(splitListingTitle("Ana Silva · Studio - Centro").internal).toBe("Ana Silva");
    expect(splitListingTitle("Studio - Centro", "").internal).toBe("");
  });
  it("monta as linhas com o título bruto da Channex", () => {
    const s = buildPlaybook(src({ listingTitle: "45998276006 Arthur Tenório · Casa Charmosa" , property: { ...src().property, name: "Casa Charmosa" } }));
    expect(find(s, "f:nome_interno").value).toBe("45998276006 Arthur Tenório");
    expect(find(s, "f:nome_interno").edit).toBeNull();
    expect(find(s, "f:titulo_publico").value).toBe("Casa Charmosa");
  });
  it("bairro e CEP guardados no cadastro têm prioridade sobre o texto do endereço", () => {
    const s = buildPlaybook(
      src({ entries: [{ id: "g", field_key: "f:cep", value: "85853-000", note: null, custom_label: null, custom_audience: null, section_num: null }] }),
    );
    expect(find(s, "f:cep").raw).toBe("85853-000");
    expect(find(s, "f:cep").edit).toBe("textarea");
  });
});

describe("lacunas do dossiê (22/10/2026)", () => {
  const rules = (text: string) => src({ property: { ...src().property, airbnb_house_rules: text } });
  it("comodidades antes do primeiro cabeçalho não se perdem", () => {
    const s = buildPlaybook(
      src({
        property: {
          ...src().property,
          airbnb_amenities: [
            { name: "Ar-condicionado", available: true, category: null },
            { name: "TV", available: true, category: null },
            { name: "Secador de cabelo", available: true, category: null },
            { name: "Banheiro", available: true, category: null },
            { name: "Chuveiro", available: true, category: null },
            { name: "Cozinha e sala de jantar", available: true, category: null },
            { name: "Geladeira", available: true, category: null },
          ],
        },
      }),
    );
    expect(find(s, "f:climatizacao").value).toBe("Ar-condicionado");
    expect(find(s, "f:entretenimento").value).toBe("TV");
    expect(find(s, "f:banheiro").value).toBe("Secador de cabelo · Chuveiro");
    expect(find(s, "f:cozinha_e_sala_de_jantar").value).toBe("Geladeira");
  });
  it("horário de silêncio com o intervalo na linha seguinte", () => {
    const s = buildPlaybook(rules("Horário de silêncio\n22:00 - 08:00\nProibido fumar"));
    expect(find(s, "f:horario_de_silencio").value).toBe("22:00 às 08:00");
  });
  it("regras adicionais sem dois-pontos", () => {
    const s = buildPlaybook(rules("Proibido fumar\nRegras adicionais\nProibido festas\n- não deixar lixo"));
    expect(find(s, "f:regras_adicionais_da_casa").value).toBe("Festas\nNão deixar lixo");
  });
  it("descrição completa do anúncio entra na seção 1", () => {
    const s = buildPlaybook(src({ property: { ...src().property, airbnb_description_full: "Texto longo do anúncio." } }));
    const row = find(s, "f:descricao_completa_anuncio");
    expect(row.value).toBe("Texto longo do anúncio.");
    expect(row.label).toBe("Descrição do anúncio no Airbnb");
    expect(row.au).toBe("P");
    expect(s[0].rows.includes(row)).toBe(true);
    expect(row.edit).toBeNull();
  });
  it("política de cancelamento e taxas vêm do anúncio/Channex", () => {
    const s = buildPlaybook(
      src({
        property: { ...src().property, airbnb_cancellation_policy: "Flexível", airbnb_cancellation_category: "FLEXIBLE" },
        listingFacts: [
          {
            key: "precos",
            title: "Preços",
            content: "Hóspedes incluídos na diária: 2\nPor hóspede adicional: R$ 50,00 por noite\nTaxa de limpeza R$ 120,00 por reserva\nTaxa de pet R$ 30,00 por reserva por pet",
          },
        ],
      }),
    );
    expect(find(s, "f:politica_de_cancelamento").value).toBe("Flexível\nCategoria: FLEXIBLE");
    expect(find(s, "f:taxa_de_limpeza").value).toBe("Taxa de limpeza R$ 120,00 por reserva");
    expect(find(s, "f:taxa_hospede_adicional").value).toBe("Hóspedes incluídos na diária: 2\nPor hóspede adicional: R$ 50,00 por noite");
    expect(find(s, "f:taxa_pet").value).toBe("Taxa de pet R$ 30,00 por reserva por pet");
    expect(find(s, "f:taxa_de_limpeza").au).toBe("P");
  });
});
