/**
 * CHECKLIST DE IMÓVEL (Anfitrião Sigma) — catálogo e regras de quantidade.
 *
 * Módulo puro (sem React, sem rede): recebe as informações do imóvel e devolve
 * as categorias com os itens e as quantidades mínimas. Fica isolado do resto
 * do Concierge de propósito — a página `/checklist` é a única que o usa.
 */

export type Info = {
  tipo: "Studio" | "Apartamento" | "Casa" | "Quarto/Suíte";
  hospedes: number;
  dormitorios: number;
  banheiros: number;
  queen: number;
  solteiro: number;
  sofaCama: number;
  geladeira: number;
  frigobar: number;
  fogao: number;
  fogaoBocas: number;
  mesa: number;
  mesaLugares: number;
};

export const INFO_PADRAO: Info = {
  tipo: "Apartamento",
  hospedes: 6,
  dormitorios: 3,
  banheiros: 2,
  queen: 1,
  solteiro: 2,
  sofaCama: 1,
  geladeira: 1,
  frigobar: 0,
  fogao: 1,
  fogaoBocas: 4,
  mesa: 1,
  mesaLugares: 6,
};

export type Item = { id: string; nome: string; regra: string; qtd: number; cor?: string };
export type Categoria = { id: string; titulo: string; base: string; itens: Item[] };

/** Camas Queen e sofás-cama têm 2 lugares; solteiro tem 1. */
export function lugaresDeDormir(i: Info): number {
  return 2 * i.queen + i.solteiro + 2 * i.sofaCama;
}
export function totalCamas(i: Info): number {
  return i.queen + i.solteiro + i.sofaCama;
}
/** Diferença entre lugares de dormir e hóspedes (0 = camas atendem a capacidade). */
export function saldoDeLugares(i: Info): number {
  return lugaresDeDormir(i) - i.hospedes;
}
export function infoValida(i: Info): boolean {
  return i.hospedes > 0 && i.dormitorios > 0 && i.banheiros > 0 && saldoDeLugares(i) === 0;
}

const it = (nome: string, regra: string, qtd: number, cor?: string): Item => ({
  id: nome,
  nome,
  regra,
  qtd,
  cor,
});

const UM = "1 por imóvel";

// Itens que só fazem sentido com o equipamento correspondente.
const SEM_FRIO = ["Jarra de água", "Forma de gelo"];
const SEM_FOGAO = [
  "Panela pequena",
  "Panela média",
  "Panela grande",
  "Luva térmica",
  "Jogo de espátulas, conchas e escumadeiras",
  "Escorredor de macarrão grande",
  "Assadeira",
  "Travessa de servir",
  "Chaleira",
  "Leiteira",
  "Garrafa térmica",
  "Frigideira grande antiaderente",
  "Pano de prato",
];
const SEM_MESA = ["Descanso de panela", "Prato de sobremesa", "Prato fundo"];

export function montarChecklist(i: Info): Categoria[] {
  const G = i.hospedes;
  const B = i.banheiros;
  const R = i.dormitorios;
  const camas = totalCamas(i);
  const lugares = lugaresDeDormir(i);

  const dormitorios: Categoria = {
    id: "q",
    titulo: "Dormitórios",
    base: `${camas} camas · ${lugares} lugares de dormir`,
    itens: [
      it("Edredom", "1 por cama", camas, "Branco"),
      it("Capa de Edredom", "1 por edredom", camas),
      it("Lençol elástico", "3 por cama", 3 * camas, "Branco"),
      it("Travesseiro", "1 por lugar de dormir", lugares),
      it("Fronha de travesseiro", "3 por travesseiro", 3 * lugares),
      it("Ar-condicionado", "1 por dormitório", R),
      it("Ventilador de chão", "1 por dormitório", R),
      it("Espelho corporal", "1 por imóvel", 1),
      it("Cortina", "1 por dormitório", R),
      it("Blackout", "1 por dormitório", R),
      it("Guarda-roupa, arara ou closet", "1 por imóvel", 1),
      it("Cabide", "6 por imóvel", 6),
      it("Protetor impermeável de colchão", "1 por colchão", camas),
      it("Capa protetora de travesseiro", "1 por travesseiro", lugares),
    ],
  };

  const banheiros: Categoria = {
    id: "b",
    titulo: "Banheiros",
    base: `${G} hóspedes · ${B} banheiros`,
    itens: [
      it("Toalha de banho", "3 por hóspede", 3 * G, "Branca"),
      it("Toalha de rosto", "3 por banheiro", 3 * B, "Branca"),
      it("Secador de cabelo", "1 por banheiro", B),
      it("Espelho", "1 por banheiro", B),
      it("Lixeira compactadora", "1 por banheiro", B),
      it("Tapete de chão", "3 por banheiro", 3 * B, "Branco"),
      it("Suporte para papel higiênico", "1 por banheiro", B),
      it("Suporte para sabonete pedra", "1 por banheiro", B),
      it("Suporte para shampoo", "1 por banheiro", B),
      it("Suporte para condicionador", "1 por banheiro", B),
    ],
  };

  const mesa = ["Garfo", "Faca", "Colher de sopa", "Colher de açúcar", "Copo", "Xícara de café", "Prato raso"].map(
    (n) => it(n, "2 por hóspede", 2 * G),
  );
  const cozinhaTodos: Item[] = [
    ...mesa,
    it("Jarra de água", UM, 1),
    it("Filtro de água de parede", UM, 1),
    it("Pano de prato", "3 por imóvel", 3),
    it("Porta-detergente", UM, 1),
    it("Porta-esponja", UM, 1),
    it("Lixeira compactadora de chão com tampa", UM, 1),
    it("Lixeira compactadora de pia com tampa", UM, 1),
    it("Escorredor de louças", UM, 1),
    it("Prato fundo", "1 por hóspede", G),
    it("Prato de sobremesa", "1 por hóspede", G),
    it("Faca de pão grande", UM, 1),
    it("Faca de corte de carne", UM, 1),
    it("Tábua grande de corte", UM, 1),
    it("Panela pequena", UM, 1),
    it("Panela média", "2 por imóvel", 2),
    it("Panela grande", UM, 1),
    it("Frigideira grande antiaderente", UM, 1),
    it("Leiteira", UM, 1),
    it("Chaleira", UM, 1),
    it("Garrafa térmica", UM, 1),
    it("Assadeira", UM, 1),
    it("Travessa de servir", UM, 1),
    it("Tigela", UM, 1),
    it("Jogo de potes com tampa", UM, 1),
    it("Escorredor de macarrão grande", UM, 1),
    it("Jogo de espátulas, conchas e escumadeiras", UM, 1),
    it("Saca-rolhas", UM, 1),
    it("Descanso de panela", "1 por panela", 4),
    it("Luva térmica", UM, 1),
    it("Forma de gelo", UM, 1),
  ];

  const semFrio = i.geladeira + i.frigobar === 0;
  const semFogao = i.fogao === 0;
  const semMesa = i.mesa === 0;
  const ocultos = new Set<string>([
    ...(semFrio ? SEM_FRIO : []),
    ...(semFogao ? SEM_FOGAO : []),
    ...(semMesa ? SEM_MESA : []),
  ]);
  const migram = new Set<string>([...(semFrio ? SEM_FRIO : []), ...(semFogao ? SEM_FOGAO : [])]);

  const cozinha: Categoria = {
    id: "c",
    titulo: "Utensílios de Cozinha",
    base: `${G} hóspedes · utensílios pequenos`,
    itens: cozinhaTodos.filter((x) => !ocultos.has(x.nome)),
  };

  const lavanderia: Categoria = {
    id: "l",
    titulo: "Lavanderia",
    base: "",
    itens: [
      it("Vassoura", UM, 1),
      it("Rodo grande", UM, 1),
      it("Pá de lixo com vassoura", UM, 1),
      it("Pano de chão", "3 por imóvel", 3),
      it("Balde grande", UM, 1),
      it("Pano multiuso", "2 por imóvel", 2),
      it("Escova para vaso sanitário", UM, 1),
      it("Varal portátil ou fixo", UM, 1),
      it("Ferro de passar", UM, 1),
      it("Tábua de passar", UM, 1),
      it("Máquina de lavar 14kg", UM, 1),
      it("Mangueira longa de área de lazer", UM, 1),
    ],
  };

  const eletro: Categoria = {
    id: "e",
    titulo: "Eletrodomésticos",
    base: "",
    itens: [
      it("Geladeira com congelador", UM, 1),
      it("Fogão ou cooktop", UM, 1),
      it("Forno ou forno elétrico", UM, 1),
      it("Micro-ondas", UM, 1),
      it('Smart TV 40"+', UM, 1),
    ],
  };

  const seguranca: Categoria = {
    id: "s",
    titulo: "Segurança",
    base: "",
    itens: [
      it("Câmera de áudio e vídeo frontal", UM, 1),
      it("Portão eletrônico", UM, 1),
      it("Sonoff no motor do portão", UM, 1),
      it("Cadeado-cofre no muro frontal", UM, 1),
    ],
  };

  const opcionais: Categoria = {
    id: "o",
    titulo: "Opcionais recomendados",
    base: "",
    itens: [
      it("Air fryer", UM, 1),
      it("Sanduicheira", UM, 1),
      it("Liquidificador", UM, 1),
      it("Panela de pressão", UM, 1),
      it("Luminária de cabeceira", "1 por lugar de dormir", lugares),
      it("Kit de suporte para sal, açúcar, café e óleo", UM, 1),
      ...cozinhaTodos.filter((x) => migram.has(x.nome)),
    ],
  };

  return [dormitorios, banheiros, cozinha, lavanderia, eletro, seguranca, opcionais];
}

/** Progresso: quantos itens (não quantidades) já foram marcados como comprados. */
export function progresso(cat: Categoria, marcados: ReadonlySet<string>) {
  const total = cat.itens.length;
  const feitos = cat.itens.filter((x) => marcados.has(x.id)).length;
  return { feitos, total, pct: total ? Math.round((100 * feitos) / total) : 0 };
}
