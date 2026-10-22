import { describe, it, expect } from "vitest";
import { sanitizeProposal } from "../human-loop/proactive-decisions.server";
import { actionFor, readDecisionSpec, learningScopeOf } from "../human-loop/decision-options";

const st = { hasReservation: true, checkinDone: false, checkoutDone: false };

describe("copiloto proativo", () => {
  it("chaves entregues viram pergunta com ação de check-in", () => {
    const r = sanitizeProposal(
      {
        shouldAsk: true,
        question: "As chaves foram entregues. Dar check-in?",
        options: [
          { label: "Sim, dar check-in", action: "checkin_done" },
          { label: "Não, só as malas", action: "none" },
        ],
      },
      st,
    );
    expect(r?.decision.actions?.["Sim, dar check-in"]).toBe("checkin_done");
    expect(r?.decision.kind).toBe("operational");
  });

  it("não propõe check-in já registrado nem ação sem reserva", () => {
    const done = sanitizeProposal(
      { shouldAsk: true, question: "x?", options: [{ label: "A", action: "checkin_done" }, { label: "B", action: "none" }] },
      { ...st, checkinDone: true },
    );
    expect(done).toBeNull();
    const noRes = sanitizeProposal(
      { shouldAsk: true, question: "x?", options: [{ label: "A", action: "checkin_done" }, { label: "B", action: "none" }] },
      { ...st, hasReservation: false },
    );
    expect(noRes?.decision.actions?.A).toBe("none");
  });

  it("ação inventada pelo modelo vira 'none'", () => {
    const r = sanitizeProposal(
      { shouldAsk: true, question: "x?", options: [{ label: "A", action: "delete_all" }, { label: "B", action: "none" }] },
      st,
    );
    expect(r?.decision.actions?.A).toBe("none");
  });

  it("lê ações gravadas e escopo global vale para todos os imóveis", () => {
    const spec = readDecisionSpec({ decision: { kind: "operational", options: ["A", "B"], actions: { A: "checkout_done" } } });
    expect(actionFor(spec, "A")).toBe("checkout_done");
    expect(actionFor(spec, "B")).toBe("none");
    expect(learningScopeOf("global")).toBe("owner_portfolio");
    expect(learningScopeOf("property")).toBe("property");
  });
});
