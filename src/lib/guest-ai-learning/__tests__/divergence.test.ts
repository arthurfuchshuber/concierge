import { describe, expect, it } from "vitest";
import { CREDENTIAL_FIELD, findDossierDivergences } from "../divergence";

const entry = (id: string, statement: string, propertyId = "p1", category = "equipamentos") => ({
  id,
  propertyId,
  category,
  statement,
  decidedAt: "2026-11-10T10:00:00Z",
  decidedBy: "staff",
});

describe("divergências entre o Documento Vivo e o dossiê", () => {
  it("mesmo objeto no dossiê e no bloco vivo ⇒ divergência lado a lado (Bancada × Armário)", () => {
    const d = findDossierDivergences(
      [entry("e1", "O ferro de passar fica no armário do corredor.")],
      [{ propertyId: "p1", label: "Manual · Lavanderia", text: "O ferro de passar fica na bancada da lavanderia. Use a tábua dobrável." }],
    );
    expect(d).toEqual([
      {
        entryId: "e1",
        propertyId: "p1",
        dossierLabel: "Manual · Lavanderia",
        dossierExcerpt: "O ferro de passar fica na bancada da lavanderia.",
        livingStatement: "O ferro de passar fica no armário do corredor.",
        decidedAt: "2026-11-10T10:00:00Z",
        decidedBy: "staff",
      },
    ]);
  });
  it("isolamento: trecho de outro imóvel nunca conta", () => {
    expect(
      findDossierDivergences(
        [entry("e1", "O ferro de passar fica no armário do corredor.")],
        [{ propertyId: "p2", label: "Manual", text: "O ferro de passar fica na bancada." }],
      ),
    ).toEqual([]);
  });
  it("objeto ausente do dossiê ⇒ não é divergência; fato idêntico ao dossiê ⇒ também não", () => {
    expect(findDossierDivergences([entry("e1", "O ferro de passar fica no armário do corredor.")], [{ propertyId: "p1", label: "FAQ", text: "A cafeteira fica na cozinha." }])).toEqual([]);
    expect(
      findDossierDivergences(
        [entry("e1", "O ferro de passar fica no armário do corredor.")],
        [{ propertyId: "p1", label: "FAQ", text: "Dica: o ferro de passar fica no armário do corredor." }],
      ),
    ).toEqual([]);
  });
  it("trecho do dossiê com segredo é saneado antes de aparecer", () => {
    const d = findDossierDivergences(
      [entry("e1", "O Wi-Fi da varanda depende do repetidor da sala.")],
      [{ propertyId: "p1", label: "Playbook · Internet", text: "O Wi-Fi da varanda usa a rede Casa_5G com senha Varanda#2024 e repetidor." }],
    );
    expect(d).toHaveLength(1);
    expect(d[0]!.dossierExcerpt).not.toContain("Varanda#2024");
  });
  it("campos de credencial do playbook são reconhecidos para ficar fora", () => {
    for (const k of ["wifi_password", "door_code", "lockbox", "senha_portao", "chave_reserva"]) expect(CREDENTIAL_FIELD.test(k)).toBe(true);
    expect(CREDENTIAL_FIELD.test("checkout_instructions")).toBe(false);
  });
});
