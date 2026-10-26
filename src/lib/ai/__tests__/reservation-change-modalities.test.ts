import { describe, expect, it } from "vitest";
import { decideReservationRequest, detectReservationRequest, humanLineGuidance, reservationRequestGuidance } from "../reservation-change";

describe("remarcação: detecção e modalidades", () => {
  it("detecta 'remarcar essa reserva'", () => {
    expect(detectReservationRequest("Tive um imprevisto, eu consigo remarcar essa reserva?")).toBe("change_dates");
    expect(detectReservationRequest("dá pra mudar minhas datas?")).toBe("change_dates");
  });
  it("não reembolsável: recusa atribuindo à plataforma, com objeções, sem equipe", () => {
    const d = decideReservationRequest({ kind: "change_dates", window: { status: "expired", policy: "Não reembolsável", deadline: null } });
    expect(d.route).toBe("decline");
    const g = reservationRequestGuidance(d, true);
    expect(g).toContain("PLATAFORMA não permite");
    expect(g).toContain("OBJEÇÕES");
  });
  it("recusa proíbe repassar objeções à equipe e manda atenuantes ao suporte da plataforma", () => {
    const d = decideReservationRequest({ kind: "cancel", window: { status: "expired", policy: "Moderada", deadline: "01/10/2026 15:00" } });
    const g = reservationRequestGuidance(d, true);
    expect(g).toContain("É PROIBIDO acionar a equipe");
    expect(g).toContain("circunstâncias atenuantes");
  });
  it("moderada dentro do prazo vai para a equipe", () => {
    expect(decideReservationRequest({ kind: "change_dates", window: { status: "free", policy: "Moderada", deadline: "05/11/2026 15:00" } }).route).toBe("team");
  });
  it("modalidade desconhecida orienta menu da plataforma", () => {
    expect(decideReservationRequest({ kind: "cancel", window: null }).route).toBe("platform_menu");
  });
  it("continuidade só quando a equipe falou", () => {
    expect(humanLineGuidance([{ role: "assistant", content: "oi" }])).toBe("");
    expect(humanLineGuidance([{ role: "assistant", content: "[Mensagem da equipe humana do anfitrião]: não dá" }])).toContain("CONTINUIDADE");
  });
});
