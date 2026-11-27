import { describe, expect, it, vi } from "vitest";
import { postViaChannexProxy } from "@/lib/airbnb-direct-sender.server";

process.env["CHANNEX_API_KEY"] = "test-key";

describe("envio pelo proxy da Channex (conta do seletor Assinar como)", () => {
  it("usa o canal escolhido na rota e o contrato messages/post", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: { message: { id: 77 } } }), { status: 200 }));
    const id = await postViaChannexProxy("chan-sigma", "123", "Olá", f as unknown as typeof fetch);
    expect(id).toBe("77");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://app.channex.io/api/v1/channels/chan-sigma/action/api_proxy");
    expect(JSON.parse(String(init.body))).toEqual({
      request: { endpoint: "messages", method: "post", params: { thread_id: 123, message: "Olá" } },
    });
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
