import { describe, expect, it, vi } from "vitest";
import { postViaChannexProxy } from "@/lib/airbnb-direct-sender.server";

process.env["CHANNEX_API_KEY"] = "test-key";

describe("envio pelo proxy da Channex (conta do seletor Assinar como)", () => {
  it("usa o canal escolhido na rota e o contrato messages/post", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: { id: "33774558133", ids: ["33774558133"] } }), { status: 200 }));
    const id = await postViaChannexProxy("chan-sigma", "123", "Olá", f as unknown as typeof fetch);
    expect(id).toBe("33774558133");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://app.channex.io/api/v1/channels/chan-sigma/action/api_proxy");
    expect(JSON.parse(String(init.body))).toEqual({
      request: { endpoint: "messages", method: "post", payload: { thread_id: 123, message: "Olá" } },
    });
  });
  it("mantém o texto recebido sem criar uma saudação de teste", async () => {
    const text = "Boa tarde, Juan! Sim, ao retornar você precisa desativar o alarme.";
    const f = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.request.payload.message).toBe(text);
      return new Response(JSON.stringify({ data: { id: "78" } }), { status: 200 });
    });
    expect(await postViaChannexProxy("chan-sigma", "123", text, f)).toBe("78");
  });
  it("aceita o formato alternativo de resposta com message.id", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: { message: { id: 77 } } }), { status: 200 }));
    expect(await postViaChannexProxy("c", "1", "Olá", f)).toBe("77");
  });
  it("resposta sem ID não fabrica confirmação de envio", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await postViaChannexProxy("c", "1", "Olá", f)).toBeNull();
  });
  it("recusa do proxy não conta como enviado", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 422 }));
    expect(await postViaChannexProxy("c", "1", "x", f as unknown as typeof fetch)).toBeNull();
  });
  it("erro no corpo não conta como enviado", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ errors: { code: "x" } }), { status: 200 }));
    expect(await postViaChannexProxy("c", "1", "x", f as unknown as typeof fetch)).toBeNull();
  });
});
