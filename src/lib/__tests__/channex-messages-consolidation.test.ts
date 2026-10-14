import { describe, expect, it } from "vitest";
import { consolidatedGuestBlock } from "@/lib/channex-messages.server";

type Msg = { role: string; content: string; created_at: string };

/** Banco falso mínimo: encadeia filtros e devolve as mensagens já filtradas. */
function fakeAdmin(messages: Msg[]) {
  return {
    from() {
      let rows = messages.map((m) => ({ ...m, conversation_id: "c1" }));
      let single = false;
      const b: any = {
        select: () => b,
        eq: (c: string, v: string) => {
          rows = rows.filter((r) => (r as any)[c] === v);
          return b;
        },
        not: () => b,
        gt: (c: string, v: string) => {
          rows = rows.filter((r) => (r as any)[c] > v);
          return b;
        },
        order: (_c: string, o: { ascending: boolean }) => {
          rows.sort((x, y) => (x.created_at < y.created_at ? -1 : 1) * (o.ascending ? 1 : -1));
          return b;
        },
        limit: () => b,
        maybeSingle: () => {
          single = true;
          return b;
        },
        then: (res: (v: unknown) => unknown) => res({ data: single ? (rows[0] ?? null) : rows }),
      };
      return b;
    },
  };
}

describe("consolidatedGuestBlock", () => {
  it("junta as frases picadas depois da última resposta, uma por linha", async () => {
    const admin = fakeAdmin([
      { role: "user", content: "Oi, tudo bem?", created_at: "2026-10-14T16:50:00Z" },
      { role: "assistant", content: "Olá!", created_at: "2026-10-14T16:50:30Z" },
      {
        role: "user",
        content: "Estamos em foz já, podemos entrar umas 14:30?",
        created_at: "2026-10-14T16:59:15Z",
      },
      { role: "user", content: "Ou só as 15:00", created_at: "2026-10-14T16:59:21Z" },
    ]);
    const r = await consolidatedGuestBlock(admin, "c1");
    expect(r.text).toBe("Estamos em foz já, podemos entrar umas 14:30?\nOu só as 15:00");
    expect(r.count).toBe(2);
    expect(r.lastAt).toBe("2026-10-14T16:59:21Z");
  });

  it("não devolve nada quando a última mensagem já foi respondida", async () => {
    const admin = fakeAdmin([
      { role: "user", content: "Obrigado", created_at: "2026-10-14T16:50:00Z" },
      { role: "assistant", content: "De nada!", created_at: "2026-10-14T16:50:30Z" },
    ]);
    const r = await consolidatedGuestBlock(admin, "c1");
    expect(r.count).toBe(0);
    expect(r.lastAt).toBeNull();
  });
});
