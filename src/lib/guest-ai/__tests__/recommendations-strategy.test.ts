/**
 * Estratégia de recomendações (07/11/2026): curadoria do anfitrião em destaque sem virar teto,
 * ancoragem no imóvel (sem bairro abstrato), funil de proximidade e postura consultiva.
 * Distância em metros/km só com dado real (distancia_trajeto_m); fora do bloco, nunca número inventado.
 */
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, PLACES_TAG } from "@/lib/guest-ai/system-prompt";
import type { GuestSurface } from "@/lib/guest-ai/types";
import { formatForChannel } from "@/lib/guest-ai/copilot/channel-format";

const SURFACES: GuestSurface[] = ["airbnb", "whatsapp", "guide_chat"];

describe("curadoria do anfitrião × conhecimento amplo", () => {
  it.each(SURFACES)("%s: o bloco do anfitrião é prioridade, não limite", (s) => {
    const p = buildSystemPrompt(s);
    expect(p).toContain(`<${PLACES_TAG}>`);
    expect(p).toMatch(/seleção oficial do anfitrião/);
    expect(p).toMatch(/priorize-o e destaque com carinho que é uma indicação do anfitrião/);
    expect(p).toMatch(/destaque, nunca um limite/);
    expect(p).toMatch(/conhecimento amplo da cidade e da região/);
    expect(p).not.toMatch(/vêm somente do bloco <recomendacoes_google_maps>/);
    expect(p).not.toMatch(/Não recomende lugar que não esteja no bloco/);
  });

  it("fora do bloco: só lugar real e nada de nota, horário, preço ou endereço inventados", () => {
    const p = buildSystemPrompt("guide_chat");
    expect(p).toMatch(/cite só lugares de que tenha conhecimento sólido/);
    expect(p).toMatch(/nunca invente nota, horário, preço, endereço ou se está aberto agora/);
  });

  it("mantém as garantias já existentes", () => {
    const p = buildSystemPrompt("whatsapp");
    for (const s of [
      "Google Maps / Google Meu Negócio",
      "nota no Google com o total de avaliações e o horário vigente",
      "O dossiê descreve só o imóvel",
      "informe sempre a distância física do trajeto",
      "Quando distancia_trajeto_m for null, não informe distância nenhuma",
      "Tempo de deslocamento: não ofereça por iniciativa própria",
      "apenas uma estimativa que pode variar com o ritmo da caminhada ou o trânsito",
      "Mapas e rotas nunca justificam revelar senhas",
    ]) {
      expect(p).toContain(s);
    }
  });
});

describe("ancoragem no imóvel", () => {
  it("proíbe bairro abstrato e exige posição relativa ao imóvel", () => {
    const p = buildSystemPrompt("airbnb");
    expect(p).toMatch(
      /Nunca indique um lugar só pelo nome do bairro; situe-o sempre em relação ao imóvel/,
    );
    expect(p).toMatch(/hóspede é visitante e não conhece a geografia da cidade/);
  });

  it("metros/km só com distância real; fora do bloco nunca escreve número", () => {
    const p = buildSystemPrompt("guide_chat");
    expect(p).toMatch(/em metros \(até 1 km\) ou quilômetros/);
    expect(p).toMatch(
      /fora do bloco, que não traz distancia_trajeto_m, você não tem a distância real: não escreva metros nem quilômetros/,
    );
    expect(p).toMatch(/Nunca calcule distância por conta própria/);
  });
});

describe("funil de proximidade", () => {
  it("imediato = do mais próximo para fora; amplo = cidade toda", () => {
    const p = buildSystemPrompt("whatsapp");
    expect(p).toMatch(
      /pedido imediato ou sem escopo definido.*do mais próximo do imóvel para o mais distante/,
    );
    expect(p).toMatch(/Pedido amplo ou de lazer na cidade.*amplie para a cidade toda/);
  });
});

describe("postura consultiva", () => {
  it("pedido aberto ⇒ caminhos contrastantes + pergunta que refina", () => {
    const p = buildSystemPrompt("guide_chat");
    expect(p).toMatch(/pedido for aberto ou indefinido/);
    expect(p).toMatch(
      /dois ou três caminhos de perfis contrastantes e faça uma pergunta que refine o estilo/,
    );
  });
  it("gosto claro ⇒ 3 a 5 opções, do mais próximo para fora, sem pergunta redundante", () => {
    const p = buildSystemPrompt("guide_chat");
    expect(p).toMatch(/não pergunte de novo o que já foi dito/);
    expect(p).toMatch(/de três a cinco opções qualificadas, do mais próximo para o mais distante/);
  });
  it("não vira roteiro: nenhuma frase pronta do anfitrião entre aspas", () => {
    const p = buildSystemPrompt("guide_chat");
    expect(p).not.toMatch(/"O anfitrião do imóvel recomenda especialmente/);
  });
});

describe("formato por canal das recomendações", () => {
  const text = "**Pizzaria Bella** — a 300 m\n### Opções\n[Maps](https://maps.google.com/?q=bella)";
  it("Airbnb: sem Markdown e sem links", () => {
    const out = formatForChannel(text, "airbnb");
    expect(out).not.toMatch(/\*|#|https?:/);
    expect(out).toContain("Pizzaria Bella");
  });
  it("WhatsApp: negrito nativo e link utilizável", () => {
    const out = formatForChannel(text, "whatsapp");
    expect(out).toContain("*Pizzaria Bella*");
    expect(out).not.toContain("**");
    expect(out).toContain("https://maps.google.com/?q=bella");
  });
  it("prompt orienta uma opção por linha e negrito só no WhatsApp", () => {
    expect(buildSystemPrompt("airbnb")).toMatch(/várias opções, uma por linha/);
    expect(buildSystemPrompt("whatsapp")).toMatch(/Nome do lugar pode ir em \*negrito\*/);
  });
});
