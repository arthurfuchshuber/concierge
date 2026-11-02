import { describe, expect, it } from "vitest";
import { projectDossier, type DossierRowLike } from "@/lib/guest-ai/data/dossier-projection";
import { validateTurnScope, GuestAiScopeError } from "@/lib/guest-ai/data/scope.server";
import { IDS, makeDb } from "./helpers/fixtures";

const row = (o: Partial<DossierRowLike>): DossierRowLike => ({
  id: "f:x",
  label: "x",
  value: "v",
  raw: "v",
  empty: false,
  secret: false,
  au: "P",
  note: "",
  ...o,
});

describe("projeção do Dossiê por audiência (defesa em profundidade)", () => {
  it("linha secreta é retida MESMO se chegar preenchida (ex.: alguém trocar a projeção por engano)", () => {
    const out = projectDossier([row({ id: "f:senha_do_wi_fi", raw: "WIFI-X", value: "••••", secret: true, au: "G" })], new Set(["P", "G"]));
    expect(out.items).toEqual([]);
    expect(out.withheldByPolicy).toBe(1);
  });
  it("chaves de credencial são retidas mesmo sem a marca secret (instruções que podem embutir código)", () => {
    for (const key of ["codigo_do_portao", "codigo_da_porta", "instrucoes_do_portao", "instrucoes_da_porta", "senhas_temporarias_por_reserva"]) {
      const out = projectDossier([row({ id: `f:${key}`, raw: "contém 1234", au: "G" })], new Set(["P", "G"]));
      expect(out.items, key).toEqual([]);
    }
  });
  it("Equipe Interna nunca; Reserva Ativa só com G; Público sempre; vazias ignoradas", () => {
    const rows = [
      row({ id: "f:nome_interno", au: "I", raw: "interno" }),
      row({ id: "f:endereco_rua_e_numero", au: "G", raw: "Rua A, 1" }),
      row({ id: "f:titulo_publico", au: "P", raw: "Casa" }),
      row({ id: "f:cep", au: "G", raw: "", empty: true }),
    ];
    expect(projectDossier(rows, new Set(["P"])).items.map((i) => i.id)).toEqual(["f:titulo_publico"]);
    expect(projectDossier(rows, new Set(["P", "G"])).items.map((i) => i.id)).toEqual(["f:endereco_rua_e_numero", "f:titulo_publico"]);
    expect(projectDossier(rows, new Set(["P", "G", "I"])).items.map((i) => i.id)).not.toContain("f:nome_interno");
  });
  it("a nota do anfitrião herda a audiência da linha", () => {
    const rows = [row({ id: "f:endereco_rua_e_numero", au: "G", raw: "Rua A", note: "portão azul" })];
    expect(projectDossier(rows, new Set(["P"])).items).toEqual([]);
    expect(projectDossier(rows, new Set(["P", "G"])).items[0]?.note).toBe("portão azul");
  });
  it("manuais só com Reserva Ativa", () => {
    const manuals = [{ title: "Ar-condicionado", body: "Use o controle branco" }];
    expect(projectDossier([], new Set(["P"]), manuals).manuals).toEqual([]);
    expect(projectDossier([], new Set(["P", "G"]), manuals).manuals).toEqual(manuals);
  });
});

describe("F0 · cada checagem do escopo vale sozinha (sem depender de outra)", () => {
  const code = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof GuestAiScopeError ? e.code : "other"));
  it("papel 'user' mas remetente da equipe ⇒ recusado (não basta o papel)", async () => {
    const db = makeDb();
    Object.assign(db.tables["property_chat_messages"]!.find((m) => m["id"] === IDS.msgHuman)!, { role: "user", sender_type: "human" });
    expect(await code(validateTurnScope({ surface: "guide_chat", conversationId: IDS.conv1, messageId: IDS.msgHuman }, { db }))).toBe("message_not_from_guest");
  });
  it("remetente 'guest' mas papel de resposta ⇒ recusado", async () => {
    const db = makeDb();
    Object.assign(db.tables["property_chat_messages"]!.find((m) => m["id"] === IDS.msgHuman)!, { role: "assistant", sender_type: "guest" });
    expect(await code(validateTurnScope({ surface: "guide_chat", conversationId: IDS.conv1, messageId: IDS.msgHuman }, { db }))).toBe("message_not_from_guest");
  });
  it("mensagem gravada como airbnb numa conversa de sessão do GUIA ⇒ alegar 'airbnb' é recusado pela sessão", async () => {
    const db = makeDb();
    db.tables["property_chat_messages"]!.find((m) => m["id"] === IDS.msg1)!["channel"] = "airbnb";
    expect(await code(validateTurnScope({ surface: "airbnb", conversationId: IDS.conv1, messageId: IDS.msg1 }, { db }))).toBe("surface_mismatch");
  });
  it("sessão vazia ⇒ recusado", async () => {
    const db = makeDb();
    db.tables["property_chat_conversations"]!.find((c) => c["id"] === IDS.conv1)!["guest_session_id"] = "";
    expect(await code(validateTurnScope({ surface: "guide_chat", conversationId: IDS.conv1, messageId: IDS.msg1 }, { db }))).toBe("surface_mismatch");
  });
});
