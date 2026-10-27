import { describe, it, expect } from "vitest";
import { verifyMalvoSignature } from "../malvo.server";

const body = '{"event":"item/created","eventId":"evt_1","link":"https://a.test/?x=1&y=2"}';
const header = "t=1700000000,v1=dcaf77c8756a00f70a8dd760e8c84b6d7f165f6ab0b697bfa3b13c240634e6f2";

describe("assinatura dos avisos do Malvo", () => {
  it("aceita o vetor oficial da documentação", async () => {
    expect(await verifyMalvoSignature(body, header, ["whsec_testsecret"], 1700000000)).toBe(true);
  });
  it("recusa corpo alterado", async () => {
    expect(await verifyMalvoSignature(body + " ", header, ["whsec_testsecret"], 1700000000)).toBe(false);
  });
  it("recusa aviso com mais de 5 minutos", async () => {
    expect(await verifyMalvoSignature(body, header, ["whsec_testsecret"], 1700000301)).toBe(false);
  });
  it("aceita o segredo anterior durante a troca", async () => {
    expect(await verifyMalvoSignature(body, header, ["whsec_novo", "whsec_testsecret"], 1700000000)).toBe(true);
  });
});
