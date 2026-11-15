import { describe, expect, it } from "vitest";
import { asksForKnownDates, checkReplyAgainstDecision } from "../validation/commitment-text";

// Caso Lauriete (15/11/2026): a consulta já traz período e hóspedes; a IA nunca pode mandar selecionar as datas.
const RUIM = [
  "Se já tiver as datas da sua viagem definidas, você pode selecioná-las aqui no anúncio para conferir os valores e concluir a reserva diretamente pela plataforma.",
  "Quais são as datas da viagem?",
  "Pode me passar as datas para eu conferir?",
  "Basta selecionar o período no aplicativo.",
];
const BOM = [
  "A casa fica a cerca de 11 km da fronteira com o Paraguai. Para concluir a reserva, é só aceitar a consulta que você fez pela plataforma.",
  "Há supermercados, padarias e farmácias no entorno da casa.",
];

describe("consulta: nunca pedir/mandar selecionar datas já escolhidas", () => {
  it.each(RUIM)("detecta: %s", (t) => expect(asksForKnownDates(t)).toBe(true));
  it.each(BOM)("não bloqueia: %s", (t) => expect(asksForKnownDates(t)).toBe(false));

  const d = (reply: string) => ({ reply, commitments: [], commitmentKinds: [], promisedTimes: [], handoff: { needed: false } }) as never;
  it("só bloqueia na fase de consulta", () => {
    const ctx = { officialCheckin: "15:00", officialCheckout: "11:00" };
    const ev = { credentialReleaseAllowed: false, lateCheckoutAuthorizedTime: null, humanOwnershipActive: false };
    expect(checkReplyAgainstDecision(d(RUIM[0]!), { ...ctx, inquiry: true }, ev).blocks).toContain("text_asks_known_dates");
    expect(checkReplyAgainstDecision(d(RUIM[0]!), { ...ctx, inquiry: false }, ev).blocks).not.toContain("text_asks_known_dates");
  });
});
