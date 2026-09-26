import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isReservationGated,
  maskDigitSequences,
  pinCookieName,
  safeEqual,
  signPinCookie,
  verifyPinCookie,
} from "@/lib/guest-access.server";
import { ETIQUETA_CHECKIN_CHECKOUT } from "@/lib/publish-requirements";

// Auditoria de segurança (16/09/2026): as travas que decidem quando o
// visitante anônimo vê as senhas do imóvel.

const PROP = "11111111-1111-1111-1111-111111111111";
let previous: string | undefined;

beforeAll(() => {
  previous = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-secret";
});
afterAll(() => {
  if (previous === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previous;
});

describe("isReservationGated", () => {
  it("todo guia exige código de reserva, com ou sem calendário", () => {
    expect(
      isReservationGated({ tagline: ETIQUETA_CHECKIN_CHECKOUT, airbnb_ical_url: "https://x" }),
    ).toBe(true);
    expect(isReservationGated({ tagline: ETIQUETA_CHECKIN_CHECKOUT, airbnb_ical_url: "" })).toBe(
      true,
    );
    expect(isReservationGated({ tagline: "Outra", airbnb_ical_url: "https://x" })).toBe(true);
    expect(isReservationGated(null)).toBe(false);
  });
});

describe("cookies assinados de PIN", () => {
  it("o valor antigo 'ok' não vale mais", async () => {
    expect(await verifyPinCookie("pin", PROP, "1234", "ok")).toBe(false);
  });

  it("aceita o cookie emitido para o mesmo imóvel e PIN", async () => {
    const v = await signPinCookie("accesscodes", PROP, "1234", 60);
    expect(await verifyPinCookie("accesscodes", PROP, "1234", v)).toBe(true);
  });

  it("recusa outro tipo, outro imóvel, PIN trocado ou assinatura alterada", async () => {
    const v = await signPinCookie("accesscodes", PROP, "1234", 60);
    expect(await verifyPinCookie("pin", PROP, "1234", v)).toBe(false);
    expect(
      await verifyPinCookie("accesscodes", "22222222-2222-2222-2222-222222222222", "1234", v),
    ).toBe(false);
    expect(await verifyPinCookie("accesscodes", PROP, "9999", v)).toBe(false);
    expect(await verifyPinCookie("accesscodes", PROP, "1234", `${v}x`)).toBe(false);
    const [exp, sig] = v.split(".");
    expect(await verifyPinCookie("accesscodes", PROP, "1234", `${Number(exp) + 1000}.${sig}`)).toBe(
      false,
    );
  });

  it("recusa cookie vencido e PIN vazio", async () => {
    const v = await signPinCookie("pin", PROP, "1234", -10);
    expect(await verifyPinCookie("pin", PROP, "1234", v)).toBe(false);
    const ok = await signPinCookie("pin", PROP, "1234", 60);
    expect(await verifyPinCookie("pin", PROP, "", ok)).toBe(false);
  });

  it("mantém os nomes de cookie de antes", () => {
    expect(pinCookieName("pin", PROP)).toBe(`sg-pin-${PROP}`);
    expect(pinCookieName("accesscodes", PROP)).toBe(`sg-accesscodes-${PROP}`);
  });
});

describe("utilitários", () => {
  it("safeEqual compara conteúdo e tamanho", () => {
    expect(safeEqual("1234", "1234")).toBe(true);
    expect(safeEqual("1234", "12345")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });

  it("maskDigitSequences esconde códigos no meio do texto", () => {
    expect(maskDigitSequences("Portão: digite 4821 e #")).not.toContain("4821");
    expect(maskDigitSequences("Chegada às 15h")).toBe("Chegada às 15h");
  });
});
