import { beforeEach, describe, expect, it, vi } from "vitest";

// createServerFn → devolve o handler direto, para chamá-lo como função comum.
vi.mock("@tanstack/react-start", () => {
  const make = () => {
    const b: Record<string, unknown> = {};
    b.middleware = () => b;
    b.inputValidator = (v: (i: unknown) => unknown) => {
      b.validator = v;
      return b;
    };
    b.handler = (h: (a: unknown) => unknown) => async (input: { data: unknown }) =>
      h({ data: (b.validator as (i: unknown) => unknown)(input.data), context: ctx });
    return b;
  };
  return { createServerFn: () => make() };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
const reindex = vi.fn(async () => ({ indexed: 0 }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/ai/indexing.server", () => ({ reindexProperty: reindex }));
const geocode = vi.fn();
vi.mock("@/lib/maps.functions", () => ({ searchAddressCandidatesGoogle: geocode }));

type Op = { table: string; op: string; args: unknown[]; filters: Array<[string, unknown]> };
let ops: Op[] = [];
let results: Record<string, unknown> = {};
let allowed = true;

function from(table: string) {
  const rec: Op = { table, op: "select", args: [], filters: [] };
  ops.push(rec);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "update", "delete", "insert", "upsert"]) {
    b[m] = (...a: unknown[]) => {
      rec.op = m;
      rec.args = a;
      return b;
    };
  }
  for (const m of ["eq", "in"]) b[m] = (k: string, v: unknown) => (rec.filters.push([k, v]), b);
  for (const m of ["order", "limit"]) b[m] = () => b;
  b.maybeSingle = () => Promise.resolve({ data: results[table] ?? null, error: null });
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: results[table] ?? [], error: null }).then(res);
  return b;
}
const ctx = { userId: "u1", supabase: { from, rpc: async () => ({ data: allowed, error: null }) } };

const PID = "11111111-1111-4111-8111-111111111111";
const lastOps = (table: string, op: string) => ops.filter((o) => o.table === table && o.op === op);

beforeEach(() => {
  ops = [];
  results = {};
  allowed = true;
  reindex.mockClear();
  geocode.mockReset();
});

describe("Playbook · funções de servidor", () => {
  it("nega acesso a quem não enxerga o imóvel", async () => {
    allowed = false;
    const { savePlaybookRow } = await import("@/lib/playbook.functions");
    await expect(savePlaybookRow({ data: { propertyId: PID, rowId: "f:link_do_mapa", value: "x" } })).rejects.toThrow(/acesso/i);
    expect(ops).toHaveLength(0);
  });

  it("campo manual grava na MESMA coluna do imóvel (guia e IA leem dali) e reindexa", async () => {
    const { savePlaybookRow } = await import("@/lib/playbook.functions");
    await savePlaybookRow({ data: { propertyId: PID, rowId: "f:nome_da_rede_wi_fi", value: "  MinhaRede " } });
    const u = lastOps("properties", "update")[0];
    expect(u.args[0]).toEqual({ wifi_ssid: "MinhaRede" });
    expect(u.filters).toContainEqual(["id", PID]);
    expect(reindex).toHaveBeenCalledWith(expect.anything(), PID);
  });

  it("converte número e sim/não e recusa valores inválidos", async () => {
    const { savePlaybookRow } = await import("@/lib/playbook.functions");
    await savePlaybookRow({ data: { propertyId: PID, rowId: "f:maximo_de_veiculos", value: "3" } });
    await savePlaybookRow({ data: { propertyId: PID, rowId: "f:imovel_em_condominio", value: "true" } });
    await savePlaybookRow({ data: { propertyId: PID, rowId: "f:modo_de_acesso", value: "pin" } });
    const us = lastOps("properties", "update").map((o) => o.args[0]);
    expect(us).toEqual([{ vehicles_max: 3 }, { in_condominium: true }, { access_mode: "pin" }]);
    await expect(savePlaybookRow({ data: { propertyId: PID, rowId: "f:modo_de_acesso", value: "xyz" } })).rejects.toThrow();
    await expect(savePlaybookRow({ data: { propertyId: PID, rowId: "f:titulo_publico", value: "x" } })).rejects.toThrow(/não é editável/);
    await expect(savePlaybookRow({ data: { propertyId: PID, rowId: "f:camas", value: "9" } })).rejects.toThrow(/não é editável/);
  });

  it("checklist de saída troca a lista inteira, tirando a numeração", async () => {
    const { savePlaybookRow } = await import("@/lib/playbook.functions");
    await savePlaybookRow({ data: { propertyId: PID, rowId: "f:checklist_de_saida", value: "1. Apague as luzes\n2) Feche o portão\n\n" } });
    expect(lastOps("property_checkout_items", "delete")).toHaveLength(1);
    expect(lastOps("property_checkout_items", "insert")[0].args[0]).toEqual([
      { property_id: PID, label: "Apague as luzes", position: 0 },
      { property_id: PID, label: "Feche o portão", position: 1 },
    ]);
  });

  it("contatos de emergência: 'nome: número'", async () => {
    const { savePlaybookRow } = await import("@/lib/playbook.functions");
    await savePlaybookRow({ data: { propertyId: PID, rowId: "f:contatos_de_emergencia", value: "Bombeiros: 193\nSíndico" } });
    expect(lastOps("property_emergency_contacts", "insert")[0].args[0]).toEqual([
      { property_id: PID, label: "Bombeiros", number: "193", position: 0 },
      { property_id: PID, label: "Síndico", number: "", position: 1 },
    ]);
  });

  it("campos sem coluna (voltagem) e linhas próprias vão para a tabela do Playbook", async () => {
    const { savePlaybookRow } = await import("@/lib/playbook.functions");
    await savePlaybookRow({ data: { propertyId: PID, rowId: "f:voltagem_das_tomadas", value: "220V" } });
    const up = lastOps("property_playbook_entries", "upsert")[0];
    expect(up.args[0]).toMatchObject({ property_id: PID, field_key: "f:voltagem_das_tomadas", value: "220V" });
    expect(up.args[1]).toEqual({ onConflict: "property_id,field_key" });
    expect(lastOps("properties", "update")).toHaveLength(0);
  });

  it("FAQ: edita a resposta só deste imóvel; excluir remove a FAQ", async () => {
    const { savePlaybookRow, deletePlaybookRow } = await import("@/lib/playbook.functions");
    await savePlaybookRow({ data: { propertyId: PID, rowId: "faq:abc", value: " Nova resposta " } });
    const u = lastOps("property_faqs", "update")[0];
    expect(u.args[0]).toEqual({ answer: "Nova resposta" });
    expect(u.filters).toEqual([["id", "abc"], ["property_id", PID]]);
    await deletePlaybookRow({ data: { propertyId: PID, rowId: "faq:abc" } });
    expect(lastOps("property_faqs", "delete")[0].filters).toEqual([["id", "abc"], ["property_id", PID]]);
  });

  it("excluir só mexe em cadastro manual — nunca no que vem do anúncio", async () => {
    const { deletePlaybookRow } = await import("@/lib/playbook.functions");
    for (const rowId of ["f:titulo_publico", "f:cidade", "f:camas", "f:horario_de_check_in", "f:link_do_mapa", "f:nome_da_rede_wi_fi"]) {
      await expect(deletePlaybookRow({ data: { propertyId: PID, rowId } })).rejects.toThrow(/não pode ser excluído/);
    }
    expect(ops.filter((o) => o.op === "update" || o.op === "delete")).toHaveLength(0);
    await deletePlaybookRow({ data: { propertyId: PID, rowId: "f:regras_adicionais_da_casa" } });
    expect(lastOps("properties", "update")[0].args[0]).toEqual({ house_rules: null });
    await deletePlaybookRow({ data: { propertyId: PID, rowId: "f:descarte_de_lixo" } });
    expect(lastOps("property_playbook_entries", "upsert")[0].args[0]).toMatchObject({ field_key: "f:descarte_de_lixo", value: null });
  });

  it("prestador: excluir apenas desvincula do imóvel", async () => {
    const { deletePlaybookRow } = await import("@/lib/playbook.functions");
    await deletePlaybookRow({ data: { propertyId: PID, rowId: "prov:link1" } });
    expect(lastOps("property_providers", "delete")[0].filters).toEqual([["id", "link1"], ["property_id", PID]]);
    expect(ops.some((o) => o.table === "service_providers")).toBe(false);
  });

  it("nota e nova linha: guarda, valida e reindexa", async () => {
    const { savePlaybookNote, addPlaybookRow } = await import("@/lib/playbook.functions");
    await savePlaybookNote({ data: { propertyId: PID, rowId: "f:bairro", note: "  Perto do mercado " } });
    expect(lastOps("property_playbook_entries", "upsert")[0].args[0]).toMatchObject({ field_key: "f:bairro", note: "Perto do mercado" });
    const r = await addPlaybookRow({ data: { propertyId: PID, section: 2, label: "Coleta de lixo", value: "Terça", audience: "G" } });
    expect(r.rowId).toMatch(/^custom:/);
    expect(lastOps("property_playbook_entries", "upsert")[1].args[0]).toMatchObject({ custom_label: "Coleta de lixo", custom_audience: "G", section_num: 2 });
    await expect(addPlaybookRow({ data: { propertyId: PID, section: 9, label: "x", value: "", audience: "G" } })).rejects.toThrow();
    await expect(addPlaybookRow({ data: { propertyId: PID, section: 1, label: "  ", value: "", audience: "G" } })).rejects.toThrow();
    expect(reindex).toHaveBeenCalledTimes(2);
  });

  it("leitura: guarda bairro/CEP do Google uma única vez e usa o título bruto da Channex", async () => {
    results = {
      properties: { id: PID, name: "Casa X", address: "R. A, 1 - Centro, Foz - PR", lat: -25.5, lng: -54.5, owner_contact_id: null },
      property_listing_raw_data: { listing_meta: { title: "Conta 1 · Casa X" }, normalized: { facts: [] } },
      property_playbook_entries: [],
    };
    geocode.mockResolvedValue([
      { district: "Longe", cep: "00000000", lat: 10, lng: 10 },
      { district: "Centro", cep: "85853705", lat: -25.5, lng: -54.5 },
    ]);
    const { getPlaybook } = await import("@/lib/playbook.functions");
    const out = await getPlaybook({ data: { propertyId: PID } });
    expect(out.source.listingTitle).toBe("Conta 1 · Casa X");
    const saved = lastOps("property_playbook_entries", "upsert").map((o) => o.args[0]);
    expect(saved).toContainEqual(expect.objectContaining({ field_key: "f:bairro", value: "Centro" }));
    expect(saved).toContainEqual(expect.objectContaining({ field_key: "f:cep", value: "85853-705" }));
    expect(saved).toContainEqual(expect.objectContaining({ field_key: "f:_geo" }));
    expect(out.source.entries.find((e) => e.field_key === "f:cep")?.value).toBe("85853-705");
    // Já consultado: não chama o Google de novo.
    geocode.mockClear();
    results.property_playbook_entries = [{ id: "1", field_key: "f:_geo", value: "1", note: null, custom_label: null, custom_audience: null, section_num: null }];
    await getPlaybook({ data: { propertyId: PID } });
    expect(geocode).not.toHaveBeenCalled();
  });

  it("leitura: falha do Google não derruba a tela", async () => {
    results = { properties: { id: PID, name: "Casa X", address: "R. A, 1", owner_contact_id: null } };
    geocode.mockRejectedValue(new Error("boom"));
    const { getPlaybook } = await import("@/lib/playbook.functions");
    const out = await getPlaybook({ data: { propertyId: PID } });
    expect(out.propertyName).toBe("Casa X");
  });
});
