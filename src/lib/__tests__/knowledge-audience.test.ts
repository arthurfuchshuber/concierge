import { describe, expect, it } from "vitest";
import { suggestAudience } from "@/lib/knowledge-audience";

describe("sugestão automática de público", () => {
  it("valores e contatos internos → Equipe Interna", () => {
    expect(suggestAudience("A faxineira recebe R$ 150 por limpeza")?.audience).toBe("I");
    expect(suggestAudience("Telefone pessoal do proprietário: 11 99999-0000")?.audience).toBe("I");
  });
  it("acesso e instruções da estadia → Reserva Ativa", () => {
    expect(suggestAudience("A senha do Wi-Fi da suíte 2 é SigmaGuest")?.audience).toBe("G");
    expect(suggestAudience("O controle do portão é entregue no check-in")?.audience).toBe("G");
  });
  it("informação geral → Público", () => {
    expect(suggestAudience("A casa aceita pets de pequeno porte")?.audience).toBe("P");
    expect(suggestAudience("Tem estacionamento para duas vans")?.audience).toBe("P");
  });
  it("texto curto ou sem pista não sugere nada", () => {
    expect(suggestAudience("ok")).toBeNull();
    expect(suggestAudience("O gato do vizinho gosta de sol")).toBeNull();
  });
  it("interno ganha de reserva ativa quando os dois aparecem", () => {
    expect(suggestAudience("Senha do painel de reservas, uso interno")?.audience).toBe("I");
  });
});
