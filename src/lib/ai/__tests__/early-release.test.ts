import { describe, it, expect } from "vitest";
import {
  EARLY_CHECKIN_OPTIONS,
  earlyReleaseApproved,
  earlyReleaseSilent,
} from "../human-loop/decision-options";
import { parseAgreedTime } from "../stay-access.server";

describe("cartão de antecipação após limpeza", () => {
  it("oferece três escolhas à equipe", () => {
    expect(EARLY_CHECKIN_OPTIONS).toEqual(["Sim, a IA pode avisar", "Liberar, eu mesmo aviso", "Manter horário oficial"]);
  });
  it("só a IA fala quando a equipe autoriza que ela avise", () => {
    expect(earlyReleaseSilent("Sim, a IA pode avisar")).toBe(false);
    expect(earlyReleaseSilent("Liberar, eu mesmo aviso")).toBe(true);
    expect(earlyReleaseSilent("Manter horário oficial")).toBe(true);
  });
  it("manter horário oficial não libera a entrada", () => {
    expect(earlyReleaseApproved("Manter horário oficial")).toBe(false);
    expect(earlyReleaseApproved("Liberar, eu mesmo aviso")).toBe(true);
  });
});

describe("horário combinado pela equipe", () => {
  it("lê a liberação antecipada combinada no chat", () => {
    expect(parseAgreedTime("checkin", [{ texto: "Conseguiremos liberar às 13h00 para vocês" }], "15:00")).toBe("13:00");
  });
  it("ignora recusa da equipe", () => {
    expect(parseAgreedTime("checkin", [{ texto: "Não conseguimos liberar às 13h" }], "15:00")).toBeNull();
  });
});
