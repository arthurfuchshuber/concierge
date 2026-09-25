import { beforeAll, describe, expect, it } from "vitest";

// Ficha assinada do "Desfazer" do hóspede (barras "Já acessei"/"Já saí").
describe("signGuestToken / verifyGuestToken", () => {
  beforeAll(() => {
    process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test-secret";
  });

  it("devolve o mesmo conteúdo que foi assinado (inclusive acentos)", async () => {
    const { signGuestToken, verifyGuestToken } = await import("@/lib/guest-access.server");
    const payload = { l: "abc", k: "checkin", note: "Saída às 11h", n: [1, 2] };
    const t = await signGuestToken("guide-stay-undo", payload);
    expect(await verifyGuestToken("guide-stay-undo", t)).toEqual(payload);
  });

  it("recusa ficha alterada, de outro uso ou vazia", async () => {
    const { signGuestToken, verifyGuestToken } = await import("@/lib/guest-access.server");
    const t = await signGuestToken("guide-stay-undo", { k: "checkin" });
    const [body, sig] = t.split(".");
    const forged = `${btoa(JSON.stringify({ k: "checkout" })).replace(/=+$/, "")}.${sig}`;
    expect(await verifyGuestToken("guide-stay-undo", forged)).toBeNull();
    expect(await verifyGuestToken("outro-uso", t)).toBeNull();
    expect(await verifyGuestToken("guide-stay-undo", `${body}.x`)).toBeNull();
    expect(await verifyGuestToken("guide-stay-undo", "")).toBeNull();
  });
});
