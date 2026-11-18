import { describe, expect, it } from "vitest";
import { analyzeReplyCommitments } from "@/lib/guest-ai/validation/commitment-text";
import { blockedDraft } from "@/lib/guest-ai/turn-chain";
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";

const T = { officialCheckin: "15:00", officialCheckout: "11:00" };

// Caso Marcela (17/11/2026): "lá tem porteiro?" — a resposta natural explica a entrada pelo cofre.
describe("credencial: informar como funciona ≠ prometer ou entregar", () => {
  it("descrever a entrada não é barrado", () => {
    for (const s of [
      "Não há porteiro, Marcela. A entrada é autônoma: o código do cofre é liberado no dia do check-in.",
      "O código do cofre é liberado um pouco antes da entrada.",
      "Você pega a chave no cofre da portaria usando o código.",
    ]) {
      const a = analyzeReplyCommitments(s, T);
      expect(a.unclassifiable, s).toBe(0);
      expect(a.claims.filter((c) => c.kind === "credential_release"), s).toEqual([]);
    }
  });
  it("prometer ou dizer que enviou o código em 1ª pessoa continua detectado", () => {
    expect(analyzeReplyCommitments("Vou te enviar o código do cofre agora.", T).claims.map((c) => c.kind)).toContain("credential_release");
    expect(analyzeReplyCommitments("Já te enviei o código do cofre.", T).claims.map((c) => c.kind)).toContain("credential_release");
  });
});

describe("rascunho barrado para a auditoria", () => {
  const guard = { scan: (t: string) => SECRET_SCRUBBER.scan(t) } as never;
  it("texto seguro vai ao rastro com bloqueios e afirmações", () => {
    expect(blockedDraft("Não há porteiro.", ["text_commitment_unclassifiable"], ["credential_release"], guard)).toEqual({
      reply: "Não há porteiro.",
      blocks: ["text_commitment_unclassifiable"],
      kinds: ["credential_release"],
    });
  });
  it("texto com segredo vai ao rastro já mascarado pela varredura (caso Gleici)", () => {
    expect(blockedDraft("O código é 4471.", ["x"], [], guard).reply).toBe("O código é [segredo removido].");
  });
  it("sem guard ou guard que não aprova ⇒ o texto não é guardado", () => {
    expect(blockedDraft("O código é 4471.", ["x"], [], null).reply).toBeNull();
    const deny = { scan: (t: string) => ({ status: "redacted", text: t, findings: [1] }) };
    expect(blockedDraft("O código é 4471.", ["x"], [], deny).reply).toBeNull();
  });
});
