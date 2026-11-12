/**
 * CABEÇALHO DA CONVERSA (11/11/2026, caso Clarisse): a reserva vem do vínculo da própria conversa, instantânea e
 * independente da lista; "Consulta" só quando de fato não há reserva.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildStayView } from "@/components/handoff/stay-view";
import { pickConversationReservation, selectConversationStay, stayMatchFromReservation, type StayReservationRow } from "@/lib/handoff-stay";

const SRC = path.resolve(__dirname, "../..");
const CLARISSE: StayReservationRow = {
  id: "res-clarisse",
  property_id: "p105",
  checkin_date: "2026-11-19",
  checkout_date: "2026-11-23",
  source: "channex",
  status: "confirmed",
  guest_hint: "Clarisse Stuckert",
  guest_contacts: { names: ["Clarisse Stuckert"], ota_thread_id: "2703324258", code: "HMJBBHF9ZQ" },
  occupancy: { adults: 4, children: 0 },
};
const OTHER: StayReservationRow = { ...CLARISSE, id: "res-x", checkin_date: "2026-11-12", checkout_date: "2026-11-18", guest_hint: "Carlos", guest_contacts: { names: ["Carlos"], ota_thread_id: "1" } };

describe("reserva da conversa", () => {
  it("vínculo direto manda, mesmo com o nome diferente ('Clarisse' no Airbnb, completo no guia)", () => {
    const hit = pickConversationReservation({ reservation_id: "res-clarisse", property_id: "p105", guest_name: "Fulana", guest_session_id: "x" }, [OTHER, CLARISSE], "2026-11-11");
    expect(hit?.id).toBe("res-clarisse");
  });
  it("sem vínculo: thread do Airbnb, depois nome único; nome ambíguo ou ausente ⇒ nada", () => {
    expect(pickConversationReservation({ property_id: "p105", guest_session_id: "airbnb:2703324258", guest_name: "Clarisse" }, [OTHER, CLARISSE], "2026-11-11")?.id).toBe("res-clarisse");
    expect(pickConversationReservation({ property_id: "p105", guest_session_id: "g", guest_name: "Clarisse Stuckert" }, [OTHER, CLARISSE], "2026-11-11")?.id).toBe("res-clarisse");
    expect(pickConversationReservation({ property_id: "p105", guest_session_id: "g", guest_name: "Clarisse Stuckert" }, [CLARISSE, { ...CLARISSE, id: "dup" }], "2026-11-11")).toBeNull();
    expect(pickConversationReservation({ property_id: "p105", guest_session_id: "g", guest_name: null }, [CLARISSE], "2026-11-11")).toBeNull();
  });
  it("não cruza imóvel: vínculo de outro imóvel é ignorado", () => {
    expect(pickConversationReservation({ reservation_id: "res-clarisse", property_id: "outro", guest_name: null }, [CLARISSE], "2026-11-11")).toBeNull();
  });
});

describe("cabeçalho com os dados da reserva", () => {
  const view = buildStayView({ detail: null, res: stayMatchFromReservation(CLARISSE), viewers: 0 });
  it("período, noites, hóspedes e código corretos; nunca 'Consulta'", () => {
    expect(view).toMatchObject({ kind: "reservation", checkin: "2026-11-19", checkout: "2026-11-23", nights: 4, guests: 4, code: "HMJBBHF9ZQ" });
    expect(view.tagLabel).not.toBe("Consulta");
  });
  it("cancelada continua cancelada; o código do guia (quando há) prevalece sobre o da reserva", () => {
    expect(stayMatchFromReservation({ ...CLARISSE, status: "cancelled" }).status).toBe("cancelled");
    const v = buildStayView({ detail: { name: null, phone: null, phoneCountry: null, checkinDate: null, checkoutDate: null, reservationCode: "GUIA1" }, res: stayMatchFromReservation(CLARISSE) });
    expect(v.code).toBe("GUIA1");
  });
  it("sem reserva de fato ('missing') segue sendo Consulta", () => {
    expect(buildStayView({ detail: null, res: { status: "missing", checkin: null, checkout: null } }).kind).toBe("consulta");
  });
});

describe("seleção da reserva do cabeçalho", () => {
  const missing = { status: "missing", checkin: null, checkout: null } as const;
  it("preserva a reserva encontrada pela lista quando a consulta individual não encontra o vínculo", () => {
    const listed = stayMatchFromReservation(CLARISSE);
    const selected = selectConversationStay(missing, listed);
    expect(selected).toEqual(listed);
    expect(buildStayView({ res: selected })).toMatchObject({ kind: "reservation", checkin: "2026-11-19", checkout: "2026-11-23", nights: 4, guests: 4 });
  });
  it("preserva o cruzamento parcial de datas da lista", () => {
    const listed = { status: "loose", checkin: "2026-11-19", checkout: "2026-11-23" } as const;
    expect(selectConversationStay(missing, listed)).toEqual(listed);
  });
  it("preserva as datas do guia quando o imóvel não tem reservas OTA", () => {
    const selected = selectConversationStay(missing, { status: "no_reservations", checkin: null, checkout: null });
    expect(buildStayView({ res: selected, detail: { name: null, phone: null, phoneCountry: null, reservationCode: null, checkinDate: "2026-11-19", checkoutDate: "2026-11-23" } })).toMatchObject({ kind: "reservation", checkin: "2026-11-19", checkout: "2026-11-23" });
  });
  it("cancelamento recém-consultado prevalece sobre reserva confirmada na lista", () => {
    const cancelled = stayMatchFromReservation({ ...CLARISSE, status: "cancelled" });
    expect(selectConversationStay(cancelled, stayMatchFromReservation(CLARISSE))).toEqual(cancelled);
  });
  it("sem reserva nas duas buscas continua consulta; sem dados permanece carregando", () => {
    expect(selectConversationStay(missing, missing)).toEqual(missing);
    expect(selectConversationStay(missing, null)).toEqual(missing);
    expect(selectConversationStay(null, null)).toBeNull();
    expect(selectConversationStay(null, stayMatchFromReservation(CLARISSE))).toEqual(stayMatchFromReservation(CLARISSE));
  });
});

describe("ligação: instantâneo e independente da lista", () => {
  const read = (f: string) => readFileSync(path.join(SRC, f), "utf8");
  it("a lista também usa o vínculo direto (reservation_id) antes do nome", () => {
    const fn = read("lib/handoff.functions.ts");
    expect(fn).toMatch(/guest_name, reservation_id, status, ai_paused/);
    expect(fn).toMatch(/VÍNCULO DIRETO[\s\S]*stayMatchFromReservation\(direct\)/);
  });
  it("o cabeçalho usa a consulta própria da conversa e não mostra 'Consulta' enquanto carrega", () => {
    for (const f of ["routes/_authenticated/admin.atendimento.tsx", "components/handoff/FloatingHandoffDock.tsx"]) {
      const t = read(f);
      expect(t, f).toMatch(/useConversationStay\(activeId/);
      expect(t, f).toMatch(/activeId && stayRes/);
    }
  });
  it("a consulta abre na hora, atualiza em poucos segundos e com a conversa (tempo real)", () => {
    const hook = read("components/handoff/useConversationStay.ts");
    expect(hook).toMatch(/refetchOnMount: "always"/);
    expect(hook).toMatch(/refetchInterval: 5000/);
    expect(read("components/handoff/ConversationView.tsx")).toMatch(/queryKey: \["handoff-stay", conversationId\]/);
  });
});
