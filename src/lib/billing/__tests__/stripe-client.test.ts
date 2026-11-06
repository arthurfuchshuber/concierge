import { describe, expect, it } from "vitest";
import { encodeForm, verifyStripeSignature } from "../stripe.server";

async function sign(secret: string, t: number, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("encodeForm", () => {
  it("codifica objetos e listas aninhados no formato da Stripe", () => {
    const s = encodeForm({
      items: [{ id: "si_1", quantity: 3 }],
      pause_collection: "",
      metadata: { zero_since: "" , a: "b c" },
      expand: ["default_payment_method"],
      skip: undefined,
    });
    expect(decodeURIComponent(s)).toBe(
      "items[0][id]=si_1&items[0][quantity]=3&pause_collection=&metadata[zero_since]=&metadata[a]=b c&expand[0]=default_payment_method",
    );
  });
});

describe("verifyStripeSignature", () => {
  const body = '{"id":"evt_1","type":"invoice.paid"}';
  const now = 1_800_000_000;

  it("aceita assinatura válida (inclusive com segredo anterior na lista)", async () => {
    const v1 = await sign("whsec_new", now, body);
    expect(await verifyStripeSignature(body, `t=${now},v1=${v1}`, ["whsec_old", "whsec_new"], now)).toBe(true);
  });

  it("recusa corpo alterado, segredo errado, cabeçalho ausente e evento velho", async () => {
    const v1 = await sign("whsec_new", now, body);
    expect(await verifyStripeSignature(body + " ", `t=${now},v1=${v1}`, ["whsec_new"], now)).toBe(false);
    expect(await verifyStripeSignature(body, `t=${now},v1=${v1}`, ["whsec_other"], now)).toBe(false);
    expect(await verifyStripeSignature(body, null, ["whsec_new"], now)).toBe(false);
    expect(await verifyStripeSignature(body, `t=${now},v1=${v1}`, ["whsec_new"], now + 301)).toBe(false);
  });
});
