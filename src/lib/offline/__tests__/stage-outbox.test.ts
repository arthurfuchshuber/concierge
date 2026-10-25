import { describe, expect, it } from "vitest";
import {
  cancelarEtapa,
  configurarEtapas,
  enfileirarEtapa,
  ehRecusaDefinitiva,
  etapasPendentes,
  processarEtapas,
  semPendentes,
} from "@/lib/offline/stage-outbox";

const base = { from: "cleaning" as const, rotulo: "Apê", reservationId: "r1" };

describe("stage-outbox", () => {
  it("mantém a conclusão na fila quando a internet falha e entrega depois", async () => {
    let online = false;
    let entregas = 0;
    configurarEtapas(async () => {
      if (!online) throw new Error("Failed to fetch");
      entregas += 1;
    });
    await enfileirarEtapa({ ...base, rowId: "a" });
    await processarEtapas();
    expect(etapasPendentes().has("a")).toBe(true);
    online = true;
    await processarEtapas();
    expect(etapasPendentes().has("a")).toBe(false);
    expect(entregas).toBe(1);
  });

  it("esconde das listas o card com conclusão pendente", async () => {
    configurarEtapas(async () => {
      throw new Error("Failed to fetch");
    });
    await enfileirarEtapa({ ...base, rowId: "b" });
    const out = semPendentes({ rows: [{ logId: "b" }, { logId: "c" }] });
    expect(out.rows.map((r) => r.logId)).toEqual(["c"]);
    expect(await cancelarEtapa("b")).toBe(true);
    expect(etapasPendentes().has("b")).toBe(false);
  });

  it("falha de rede nunca é recusa definitiva", () => {
    expect(ehRecusaDefinitiva(new Error("Failed to fetch"))).toBe(false);
    expect(ehRecusaDefinitiva(new Error("Card não encontrado"))).toBe(true);
  });
});
