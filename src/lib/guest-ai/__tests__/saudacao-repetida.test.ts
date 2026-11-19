import { describe, expect, it } from "vitest";
import { greetedRecently, stripOpeningGreeting } from "@/lib/guest-ai/ack-silence";
import type { HistoryEntry } from "@/lib/guest-ai/history";

const e = (speaker: string, at: string, text = "x") => ({ speaker, at, text, media: null }) as unknown as HistoryEntry;

describe("sem segundo cumprimento (caso Luiz Eduardo, 19/11/2026)", () => {
  it("tira só a abertura e mantém o resto", () => {
    expect(stripOpeningGreeting("Olá, Luiz! Seja bem-vindo.\n\nNesse horário de 1h não é possível receber você.")).toBe(
      "Nesse horário de 1h não é possível receber você.",
    );
    expect(stripOpeningGreeting("Bom dia, Alice!\n\nAs tomadas seguem o padrão da cidade.")).toBe("As tomadas seguem o padrão da cidade.");
    expect(stripOpeningGreeting("Olá, Luiz, bom dia!")).toBe("Olá, Luiz, bom dia!");
    expect(stripOpeningGreeting("O estúdio é privativo. Olá de novo")).toBe("O estúdio é privativo. Olá de novo");
  });

  it("fala nossa há até 30 min antes da mensagem atual ⇒ já cumprimentamos", () => {
    const h = [e("guest", "2026-11-19T12:47:00Z"), e("legacy_ai", "2026-11-19T12:47:30Z"), e("guest", "2026-11-19T12:50:00Z")];
    expect(greetedRecently(h)).toBe(true);
    const longe = [e("legacy_ai", "2026-11-18T12:47:30Z"), e("guest", "2026-11-19T12:50:00Z")];
    expect(greetedRecently(longe)).toBe(false);
    expect(greetedRecently([e("guest", "2026-11-19T12:47:00Z")])).toBe(false);
    const sistema = [e("system", "2026-11-19T12:47:30Z"), e("guest", "2026-11-19T12:50:00Z")];
    expect(greetedRecently(sistema)).toBe(false);
  });
});

describe("dado técnico fora do dossiê (caso Alice, tomadas, 19/11/2026)", () => {
  it("o roteiro manda oferecer o padrão da cidade como referência e encaminhar a confirmação", async () => {
    const { buildSystemPrompt } = await import("@/lib/guest-ai/system-prompt");
    const sys = buildSystemPrompt("airbnb", undefined, { phase: "in_stay" });
    expect(sys).toMatch(/responda com segurança o que você sabe, o padrão da cidade/);
    expect(sys).toMatch(/sem anunciar que a informação falta no cadastro nem soar inseguro/);
    expect(sys).not.toMatch(/como conferir na própria tomada/);
    expect(sys).toMatch(/marque o encaminhamento para a equipe confirmar o dado do imóvel/);
  });
});

describe("chegou não é entrou (caso Larissa, 19/11/2026)", () => {
  it("aviso de chegada sem entrada: pergunta pelo acesso, checagem da casa só depois", async () => {
    const { buildSystemPrompt } = await import("@/lib/guest-ai/system-prompt");
    const sys = buildSystemPrompt("airbnb", undefined, { phase: "in_stay" });
    expect(sys).toMatch(/Avisar que chegou, sem dizer que já entrou, é chegada à porta/);
    expect(sys).toMatch(/a pergunta sobre encontrar tudo como esperado fica para depois da entrada confirmada/);
  });
});
