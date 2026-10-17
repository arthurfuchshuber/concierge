import { describe, it, expect } from "vitest";
import { silentCloseText } from "../silent-close";

describe("encerramento por silêncio — pergunta e repertório", () => {
  it("check-in sempre pergunta se deu certo o acesso", () => {
    for (let s = 0; s < 6; s++) expect(silentCloseText("checkin", "Rafael", [], s)).toContain("?");
  });
  it("não repete emoji já usado com o hóspede", () => {
    const t = silentCloseText("checkin", "Rafael", ["Excelente estadia! 💜"], 0);
    expect(t).not.toContain("💜");
  });
  it("não repete a abertura já usada com o hóspede", () => {
    const first = silentCloseText("checkin", "Rafael", [], 0);
    const second = silentCloseText("checkin", "Rafael", [first], 0);
    expect(second.slice(0, 20)).not.toBe(first.slice(0, 20));
  });
});
