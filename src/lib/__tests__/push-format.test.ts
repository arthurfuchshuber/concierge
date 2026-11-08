import { describe, expect, it } from "vitest";
import {
  arrivalStepBody,
  arrivalStepTitle,
  bodyByCity,
  conversationBody,
  conversationTitle,
  dashboardWindowUrl,
  guestPushBody,
  inDailyWindow,
  isPushWindow,
  opsTitles,
  rankScanCandidates,
  truncateLine,
} from "@/lib/push-format";
import { internalPushPath } from "@/hooks/usePushNavigation";

describe("truncateLine (imóvel em 1 linha)", () => {
  it("corta em 34 caracteres contando as reticências", () => {
    expect(truncateLine("Studio n° 102 Aconchegante Próximo ao Paraguai")).toBe(
      "Studio n° 102 Aconchegante Próxim…",
    );
    expect(truncateLine("Casa Completa em Bairro Residencial")).toBe(
      "Casa Completa em Bairro Residenci…",
    );
    expect(truncateLine("Studio n° 102 Aconchegante Próximo ao Paraguai")).toHaveLength(34);
  });
  it("não mexe no que já cabe", () => {
    expect(truncateLine("Studio n° 104 Próximo ao Paraguai")).toBe(
      "Studio n° 104 Próximo ao Paraguai",
    );
  });
});

describe("títulos da operação (mockup 07/11/2026)", () => {
  it("acompanham a pluralidade e só atraso leva 🔴", () => {
    expect(opsTitles.checkinsLate(1)).toBe("🔴 Check-In Atrasado");
    expect(opsTitles.checkinsLate(2)).toBe("🔴 Check-Ins Atrasados");
    expect(opsTitles.checkoutsLate(1)).toBe("🔴 Check-Out Atrasado");
    expect(opsTitles.checkoutsLate(3)).toBe("🔴 Check-Outs Atrasados");
    expect(opsTitles.checkinsToday(3)).toBe("Check-Ins de Hoje");
    expect(opsTitles.checkinsToday(1)).toBe("Check-In de Hoje");
    expect(opsTitles.checkoutsTomorrow(5)).toBe("Check-Outs de Amanhã");
    expect(opsTitles.cleaningPending()).toBe("🧹 Aguardando Limpeza");
  });
  it("título não traz número", () => {
    for (const n of [1, 2, 7]) {
      for (const t of [
        opsTitles.checkinsLate(n),
        opsTitles.checkoutsLate(n),
        opsTitles.checkinsToday(n),
        opsTitles.checkoutsTomorrow(n),
      ]) {
        expect(t).not.toMatch(/\d/);
      }
    }
  });
  it("corpo só com a contagem por cidade; limpeza com imóvel/imóveis", () => {
    const m = new Map([
      ["Ourinhos", 1],
      ["Foz do Iguaçu", 3],
    ]);
    expect(bodyByCity(m)).toBe("3 em Foz do Iguaçu\n1 em Ourinhos");
    expect(bodyByCity(m, { one: "imóvel", many: "imóveis" })).toBe(
      "3 imóveis em Foz do Iguaçu\n1 imóvel em Ourinhos",
    );
  });
});

describe("baixas e conversas", () => {
  it("títulos de baixa com iniciais maiúsculas, exceto palavras de ligação", () => {
    expect(arrivalStepTitle("checkout", { who: "" })).toBe("Check-Out Confirmado");
    expect(arrivalStepTitle("checkin", { who: "Anfitrião Sigma" })).toBe(
      "Check-In Confirmado por Anfitrião Sigma",
    );
    expect(arrivalStepTitle("checkin", { guest: true })).toBe("Check-In Feito pelo Hóspede");
  });
  it("corpo de baixa: imóvel (1 linha) + hóspede, sem proprietário", () => {
    expect(arrivalStepBody("Studio n° 102 Aconchegante Próximo ao Paraguai", "Itallo Lira")).toBe(
      "Studio n° 102 Aconchegante Próxim…\nHóspede: Itallo Lira",
    );
    expect(arrivalStepBody("Studio n° 104 Próximo ao Paraguai", "")).toBe(
      "Studio n° 104 Próximo ao Paraguai",
    );
  });
  it("atendimento no padrão Airbnb", () => {
    expect(conversationTitle("Thiana Costa", "4–8 de nov.")).toBe("Thiana Costa • 4–8 de nov.");
    expect(conversationTitle("Dayane", "")).toBe("Dayane");
    expect(conversationBody("Casa Completa em Bairro Residencial Livia", "Entramos na casa")).toBe(
      "Casa Completa em Bairro Residenci…\nEntramos na casa",
    );
  });
  it("push ao hóspede: 📍 cidade + mensagem curta", () => {
    const body = guestPushBody(
      "Foz do Iguaçu",
      "A limpeza foi concluída! Verifique com a equipe se há possibilidade de antecipação!",
    );
    expect(body.split("\n")[0]).toBe("📍 Foz do Iguaçu");
    expect(body.split("\n")[1]).toBe(
      "A limpeza foi concluída! Verifique com a equipe se há possibilidade de antecipação!",
    );
    expect(guestPushBody("Foz", "x".repeat(200)).split("\n")[1]).toHaveLength(90);
  });
});

describe("destinos do clique", () => {
  it("monta a URL da janela e só aceita janelas conhecidas", () => {
    expect(dashboardWindowUrl("checkins")).toBe("/admin/dashboard?janela=checkins");
    expect(isPushWindow("limpeza")).toBe(true);
    expect(isPushWindow("qualquer")).toBe(false);
    expect(isPushWindow("toString")).toBe(false);
  });
  it("navegação só para caminhos internos", () => {
    expect(internalPushPath("/admin/dashboard?janela=limpeza")).toBe(
      "/admin/dashboard?janela=limpeza",
    );
    expect(internalPushPath("https://evil.example")).toBeNull();
    expect(internalPushPath("//evil.example")).toBeNull();
    expect(internalPushPath(undefined)).toBeNull();
  });
});

describe("timing: 1 por rodada, por prioridade", () => {
  it("primeiro aviso de atraso vence; avisos do dia vencem repetição", () => {
    const order = rankScanCandidates([
      { kind: "checkins-late" as const, repeat: true },
      { kind: "checkins-today" as const },
      { kind: "checkouts-late" as const, repeat: true },
    ]).map((c) => c.kind);
    expect(order).toEqual([
      "checkins-today",
      "checkouts-late",
      "checkins-late",
    ]);
  });
  it("atraso novo fica na frente de tudo, saída antes de entrada", () => {
    const order = rankScanCandidates([
      { kind: "checkouts-tomorrow" as const },
      { kind: "checkins-late" as const },
      { kind: "checkouts-late" as const },
    ]).map((c) => c.kind);
    expect(order).toEqual(["checkouts-late", "checkins-late", "checkouts-tomorrow"]);
  });
  it("avisos do dia têm uma janela de 2h para sair mesmo se adiados", () => {
    expect(inDailyWindow(7, 7)).toBe(true);
    expect(inDailyWindow(8, 7)).toBe(true);
    expect(inDailyWindow(9, 7)).toBe(false);
    expect(inDailyWindow(21, 20)).toBe(true);
    expect(inDailyWindow(6, 7)).toBe(false);
  });
});
