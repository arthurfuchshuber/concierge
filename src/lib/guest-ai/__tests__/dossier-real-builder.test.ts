import { describe, expect, it } from "vitest";
import { buildPlaybook } from "@/lib/playbook-build";
import { projectDossier, type DossierRowLike } from "@/lib/guest-ai/data/dossier-projection";
import { PROPERTY_DOSSIER_COLUMNS } from "@/lib/guest-ai/data/projections";

/**
 * Integração com o construtor REAL do Dossiê (`buildPlaybook`): alimentado só com a
 * projeção sem credenciais, as linhas de senha nascem vazias e nada secreto sai da projeção.
 * (No sandbox de desenvolvimento `buildPlaybook` é um stub e este bloco é pulado; no
 * repositório ele roda de verdade.)
 */
const property: Record<string, unknown> = Object.fromEntries(PROPERTY_DOSSIER_COLUMNS.map((c) => [c, null]));
Object.assign(property, {
  id: "p1",
  name: "Casa Teste",
  city: "Foz do Iguaçu",
  country: "Brasil",
  address: "Rua das Flores, 100 - Centro, Foz do Iguaçu - PR, 85851-000",
  wifi_ssid: "CasaWifi",
  checkin_time: "15:00",
  checkout_time: "11:00",
  access_mode: "pin",
});
const src = {
  property,
  faqs: [{ id: "f1", question: "Qual a senha do Wi-Fi?", answer: "Enviada no dia da chegada." }],
  checkout: [],
  emergency: [],
  manuals: [],
  providers: [],
  entries: [],
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sections = (buildPlaybook as any)(src) as Array<{ rows: DossierRowLike[] }>;
const rows = sections.flatMap((s) => s.rows);

describe.skipIf(rows.length === 0)("Dossiê real × projeção sem credenciais", () => {
  it("linhas de senha ficam vazias por construção (nada foi carregado)", () => {
    for (const key of ["senha_do_wi_fi", "codigo_da_porta", "codigo_do_portao", "instrucoes_da_porta", "instrucoes_do_portao"]) {
      const r = rows.find((x) => x.id === `f:${key}`);
      if (r) expect(r.raw, key).toBe("");
    }
  });
  it("a projeção nunca entrega linha secreta nem Equipe Interna, nem com G", () => {
    const out = projectDossier(rows, new Set(["P", "G"]));
    const ids = out.items.map((i) => i.id);
    for (const r of rows.filter((x) => x.secret || x.au === "I")) expect(ids).not.toContain(r.id);
    expect(ids).toContain("f:titulo_publico");
  });
  it("sem reserva (só P): endereço e Wi-Fi ficam de fora", () => {
    const ids = projectDossier(rows, new Set(["P"])).items.map((i) => i.id);
    expect(ids).not.toContain("f:endereco_rua_e_numero");
    expect(ids).not.toContain("f:nome_da_rede_wi_fi");
  });
});
