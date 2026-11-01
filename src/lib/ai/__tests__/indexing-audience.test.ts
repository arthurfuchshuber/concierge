import { describe, expect, it } from "vitest";
import { isGuestShareable } from "@/lib/ai/indexing.server";

describe("filtro duro de público do Playbook", () => {
  it("G e P podem ser informados; I (Equipe Interna) nunca", () => {
    expect(isGuestShareable("G")).toBe(true);
    expect(isGuestShareable("P")).toBe(true);
    expect(isGuestShareable(null)).toBe(true);
    expect(isGuestShareable("I")).toBe(false);
  });
});

import { effectiveAudience, faqAutoAudience } from "@/lib/ai/indexing.server";

describe("público efetivo (mesma regra do Dossiê)", () => {
  it("campo do catálogo: padrão, mas a escolha do usuário vale (exceto segredos)", () => {
    expect(effectiveAudience({ fieldKey: "f:x", catalogAu: "G", chosen: null })).toBe("G");
    expect(effectiveAudience({ fieldKey: "f:x", catalogAu: "G", chosen: "I" })).toBe("I");
    expect(effectiveAudience({ fieldKey: "f:x", catalogAu: "G", catalogSecret: true, chosen: "I" })).toBe("G");
  });
  it("linha criada à mão sem escolha é interna; com escolha vale a escolha", () => {
    expect(effectiveAudience({ fieldKey: "custom:1", chosen: null })).toBe("I");
    expect(effectiveAudience({ fieldKey: "custom:1", chosen: "G" })).toBe("G");
  });
  it("FAQ: automático por assunto, ou o escolhido", () => {
    expect(faqAutoAudience("Qual a senha do wifi?")).toBe("G");
    expect(faqAutoAudience("Aceita pets?")).toBe("P");
    expect(effectiveAudience({ fieldKey: "faq:1", chosen: null, faqQuestion: "Aceita pets?" })).toBe("P");
    expect(effectiveAudience({ fieldKey: "faq:1", chosen: "I", faqQuestion: "Aceita pets?" })).toBe("I");
  });
});
