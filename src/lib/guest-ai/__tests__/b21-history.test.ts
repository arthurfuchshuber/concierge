import { describe, expect, it } from "vitest";
import { classifyChannel, classifyDelivery, classifySpeaker, instantKey, normalizeHistory, type HistoryRow } from "@/lib/guest-ai/history";
import { CONV, MSG, OTHER_CONV, row } from "./helpers/b21-fixtures";

const scope = { conversationId: CONV, currentMessageId: MSG };
const at = (s: string) => `2026-11-03T10:00:${s}+00:00`;

function available(rows: HistoryRow[]) {
  const r = normalizeHistory(rows, scope);
  if (r.status !== "available") throw new Error(`esperado available, veio ${r.reason}`);
  return r;
}

describe("B2.1 · histórico — falantes (D7)", () => {
  it("mapeia exatamente as quatro combinações conhecidas", () => {
    expect(classifySpeaker("user", "guest")).toBe("guest");
    expect(classifySpeaker("assistant", "human")).toBe("team");
    expect(classifySpeaker("assistant", "ai")).toBe("legacy_ai");
    expect(classifySpeaker("assistant", "system")).toBe("system");
  });
  it("qualquer outra combinação é unknown (inclui role=user + sender=ai, 48 linhas legadas)", () => {
    for (const [r, s] of [["user", "ai"], ["user", "human"], ["user", "system"], ["assistant", "guest"], [null, "guest"], ["user", null], ["", ""], ["toString", "x"], ["__proto__", ""]] as const) {
      expect(classifySpeaker(r, s), `${r}|${s}`).toBe("unknown");
    }
  });
  it("canal e entrega", () => {
    expect(classifyChannel("web")).toBe("guide_chat");
    expect(classifyChannel("whatsapp")).toBe("whatsapp");
    expect(classifyChannel("airbnb")).toBe("airbnb");
    expect(classifyChannel("sms")).toBe("unknown");
    expect(classifyChannel(null)).toBe("unknown");
    expect(classifyChannel("constructor")).toBe("unknown");
    expect(classifyDelivery("failed")).toBe("failed");
    expect(classifyDelivery("sent")).toBe("sent");
    expect(classifyDelivery("delivered")).toBe("delivered");
    expect(classifyDelivery(null)).toBe("recorded");
    expect(classifyDelivery("weird")).toBe("recorded");
  });
});

describe("B2.1 · histórico — cronologia integral", () => {
  it("ordena por instante e entrega TUDO até a mensagem atual, sem truncar", () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      row({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, created_at: `2026-11-03T${String(10 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000000+00:00`, content: `m${i}` }),
    );
    rows[99] = { ...rows[99]!, id: MSG };
    const shuffled = [...rows].reverse();
    const r = available(shuffled);
    expect(r.entries).toHaveLength(100);
    expect(r.entries.map((e) => e.text)).toEqual(rows.map((x) => x.content));
    expect(r.entries.map((e) => e.ref)).toEqual(rows.map((_, i) => `hist:guest:h${i + 1}`));
    expect(r.counts).toEqual({ loaded: 100, included: 100, internalNotesExcluded: 0, afterCurrentExcluded: 0, duplicatesRemoved: 0 });
  });

  it("microssegundos ordenam mensagens no mesmo milissegundo (não a ordem do id)", () => {
    const a = row({ id: "ffffffff-0000-4000-8000-000000000000", created_at: "2026-11-03T10:00:00.000100+00:00", content: "primeira" });
    const b = row({ id: MSG, created_at: "2026-11-03T10:00:00.000900+00:00", content: "segunda" });
    expect(available([b, a]).entries.map((e) => e.text)).toEqual(["primeira", "segunda"]);
    expect(instantKey("2026-11-03T10:00:00.000100+00:00")).toBeLessThan(instantKey("2026-11-03T10:00:00.000900+00:00")!);
  });

  it("empate exato no instante desempata pelo id (determinístico)", () => {
    const t = at("05.000000");
    const x = row({ id: "aaaaaaaa-0000-4000-8000-000000000000", created_at: t, content: "x" });
    const cur = row({ id: MSG, created_at: at("09.000000") });
    const y = row({ id: "0aaaaaaa-0000-4000-8000-000000000000", created_at: t, content: "y" });
    expect(available([x, cur, y]).entries.map((e) => e.text).slice(0, 2)).toEqual(["y", "x"]);
    expect(available([y, x, cur]).entries.map((e) => e.text).slice(0, 2)).toEqual(["y", "x"]);
  });

  it("mensagens posteriores à atual saem e são CONTADAS (sem corte silencioso)", () => {
    const r = available([row({ created_at: at("01.0") }), row({ id: MSG, created_at: at("02.0") }), row({ created_at: at("03.0") }), row({ created_at: at("04.0") })]);
    expect(r.entries).toHaveLength(2);
    expect(r.entries[1]!.current).toBe(true);
    expect(r.entries.filter((e) => e.current)).toHaveLength(1);
    expect(r.counts.afterCurrentExcluded).toBe(2);
  });

  it("o id citável carrega o falante (base da prova de marco pelo hóspede)", () => {
    const r = available([
      row({ role: "assistant", sender_type: "human", created_at: at("01.0") }),
      row({ role: "assistant", sender_type: "ai", created_at: at("02.0") }),
      row({ role: "user", sender_type: "ai", created_at: at("03.0") }),
      row({ role: "assistant", sender_type: "system", created_at: at("04.0") }),
      row({ id: MSG, created_at: at("05.0") }),
    ]);
    expect(r.entries.map((e) => e.ref)).toEqual(["hist:team:h1", "hist:legacy_ai:h2", "hist:unknown:h3", "hist:system:h4", "hist:guest:h5"]);
  });

  it("a mensagem atual é sempre a última e a única marcada", () => {
    const r = available([row({ id: MSG, created_at: at("09.0") }), row({ created_at: at("01.0") })]);
    expect(r.entries.at(-1)!.messageId).toBe(MSG);
    expect(r.entries.at(-1)!.current).toBe(true);
    expect(r.entries[0]!.current).toBe(false);
  });

  it("duplicata entra uma vez e é contada", () => {
    const d = row({ created_at: at("01.0") });
    const r = available([d, { ...d }, row({ id: MSG, created_at: at("02.0") })]);
    expect(r.entries).toHaveLength(2);
    expect(r.counts.duplicatesRemoved).toBe(1);
  });
});

describe("B2.1 · histórico — negativos", () => {
  it("linha de outra conversa invalida o resultado inteiro (nunca mistura)", () => {
    expect(normalizeHistory([row({ id: MSG }), row({ conversation_id: OTHER_CONV })], scope)).toEqual({ status: "unavailable", reason: "scope_mismatch" });
  });
  it("mensagem atual ausente ⇒ current_message_missing", () => {
    expect(normalizeHistory([row(), row()], scope)).toEqual({ status: "unavailable", reason: "current_message_missing" });
  });
  it("instante não comprovável ⇒ chronology_unprovable (não chuta posição)", () => {
    for (const bad of [null, "", "ontem", "2026-13-45T99:00:00Z"]) {
      expect(normalizeHistory([row({ created_at: bad }), row({ id: MSG })], scope), String(bad)).toEqual({ status: "unavailable", reason: "chronology_unprovable" });
    }
  });
  it("nota interna nunca entra, nem com is_internal_note nulo; é contada", () => {
    const r = available([row({ is_internal_note: true, content: "NOTA INTERNA", created_at: at("01.0") }), row({ is_internal_note: null, content: "NULA", created_at: at("02.0") }), row({ id: MSG, created_at: at("03.0") })]);
    expect(r.entries.map((e) => e.text)).not.toContain("NOTA INTERNA");
    expect(r.entries.map((e) => e.text)).not.toContain("NULA");
    expect(r.counts.internalNotesExcluded).toBe(2);
  });
  it("a mensagem atual sendo nota interna ⇒ current_message_missing", () => {
    expect(normalizeHistory([row({ id: MSG, is_internal_note: true })], scope)).toEqual({ status: "unavailable", reason: "current_message_missing" });
  });
  it("entrada não-array ⇒ lookup_failed", () => {
    expect(normalizeHistory(null as never, scope)).toEqual({ status: "unavailable", reason: "lookup_failed" });
  });
});

describe("B2.1 · histórico — mídia e entrega", () => {
  it("áudio com e sem texto derivado; tipo desconhecido; conteúdo nulo vira vazio", () => {
    const r = available([
      row({ attachment_type: "audio", attachment_duration_ms: 4200, attachment_transcript: "oi", content: "", created_at: at("01.0") }),
      row({ attachment_type: "audio", attachment_transcript: "   ", content: null, created_at: at("02.0") }),
      row({ attachment_type: "video", created_at: at("03.0") }),
      row({ id: MSG, delivery_status: "failed", created_at: at("04.0") }),
    ]);
    expect(r.entries[0]!.media).toEqual({ kind: "audio", durationMs: 4200, derivedText: { status: "available", text: "oi" } });
    expect(r.entries[1]!.media).toEqual({ kind: "audio", durationMs: null, derivedText: { status: "missing" } });
    expect(r.entries[1]!.text).toBe("");
    expect(r.entries[2]!.media!.kind).toBe("unknown");
    expect(r.entries[3]!.media).toBeNull();
    expect(r.entries[3]!.delivery).toBe("failed");
  });
});
