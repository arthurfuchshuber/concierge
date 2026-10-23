import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildGuestPhotoMessage, extFromMime, persistGuestPhotoAttachment } from "@/lib/channex-messages.server";

const PROP = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const URL_ = "https://app.channex.io/api/v1/attachments/t/m/a.jpeg";
const BYTES = new Uint8Array([1, 2, 3, 4, 5]);

function fakeAdmin(uploadResult: () => unknown) {
  const uploads: Array<{ bucket: string; path: string; body: Uint8Array; opts: any }> = [];
  return {
    uploads,
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: Uint8Array, opts: any) => {
          uploads.push({ bucket, path, body, opts });
          return uploadResult();
        },
      }),
    },
  };
}

function stubFetch(opts: { vision?: string; imageOk?: boolean } = {}) {
  const calls: Array<{ url: string; init?: any }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: any) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("ai.gateway.lovable.dev")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: opts.vision ?? "Painel do ar-condicionado com erro E4." } }] }), { status: 200 });
      }
      if (opts.imageOk === false) return new Response("nope", { status: 404 });
      return new Response(BYTES, { status: 200, headers: { "content-type": "image/jpeg" } });
    }),
  );
  return calls;
}

beforeEach(() => {
  process.env["CHANNEX_API_KEY"] = "ch-key";
  process.env["LOVABLE_API_KEY"] = "lv-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["CHANNEX_API_KEY"];
  delete process.env["LOVABLE_API_KEY"];
});

describe("persistência da foto do Airbnb no storage", () => {
  it("extFromMime", () => {
    expect(extFromMime("image/jpeg")).toBe("jpeg");
    expect(extFromMime("image/jpg")).toBe("jpeg");
    expect(extFromMime("image/png")).toBe("png");
    expect(extFromMime("image/webp")).toBe("webp");
    expect(extFromMime("image/svg+xml")).toBe("svg");
  });

  it("webhook: baixa com a chave, a IA descreve e o buffer vai para chat-attachments com todas as colunas", async () => {
    const calls = stubFetch();
    const admin = fakeAdmin(() => ({ error: null }));
    const r = await buildGuestPhotoMessage(admin, { text: "", urls: [URL_], haveAttachment: true, propertyId: PROP, conversationId: CONV });

    // download autenticado
    expect(calls[0]!.init.headers["user-api-key"]).toBe("ch-key");
    // upload
    expect(admin.uploads).toHaveLength(1);
    const up = admin.uploads[0]!;
    expect(up.bucket).toBe("chat-attachments");
    expect(up.path).toMatch(new RegExp(`^${PROP}/${CONV}/[0-9a-f-]{36}\\.jpeg$`));
    expect(up.opts).toEqual({ contentType: "image/jpeg", upsert: false });
    expect(Array.from(up.body)).toEqual(Array.from(BYTES));
    // colunas
    expect(r.attachmentFields).toMatchObject({
      attachment_path: up.path,
      attachment_type: "image",
      attachment_mime: "image/jpeg",
      attachment_size_bytes: BYTES.byteLength,
      attachment_transcript: "Painel do ar-condicionado com erro E4.",
    });
    expect(String(r.attachmentFields["attachment_name"])).toMatch(/\.jpeg$/);
    // a IA continua enxergando
    expect(r.content).toContain("Foto enviada pelo hóspede — conteúdo: Painel do ar-condicionado com erro E4.");
  });

  it("falha no upload: não lança, mantém texto e transcrição, sem attachment_path", async () => {
    stubFetch();
    const admin = fakeAdmin(() => ({ error: { message: "timeout" } }));
    const r = await buildGuestPhotoMessage(admin, { text: "olha isso", urls: [URL_], haveAttachment: true, propertyId: PROP, conversationId: CONV });
    expect(r.attachmentFields["attachment_path"]).toBeUndefined();
    expect(r.attachmentFields).toMatchObject({ attachment_type: "image", attachment_transcript: "Painel do ar-condicionado com erro E4." });
    expect(r.content).toContain("olha isso");
    expect(r.content).toContain("conteúdo: Painel do ar-condicionado");
  });

  it("storage que lança exceção também não derruba nada", async () => {
    stubFetch();
    const admin = { storage: { from: () => ({ upload: async () => { throw new Error("rede caiu"); } }) } };
    await expect(persistGuestPhotoAttachment(admin, { propertyId: PROP, conversationId: CONV, file: { url: URL_, mime: "image/png", bytes: BYTES } })).resolves.toBeNull();
    const r = await buildGuestPhotoMessage(admin, { text: "", urls: [URL_], haveAttachment: true, propertyId: PROP, conversationId: CONV });
    expect(r.content).toMatch(/Foto enviada/);
    expect(r.attachmentFields["attachment_path"]).toBeUndefined();
  });

  it("download falhou: mensagem segue com aviso e nada é enviado ao storage", async () => {
    stubFetch({ imageOk: false });
    const admin = fakeAdmin(() => ({ error: null }));
    const r = await buildGuestPhotoMessage(admin, { text: "", urls: [URL_], haveAttachment: true, propertyId: PROP, conversationId: CONV });
    expect(admin.uploads).toHaveLength(0);
    expect(r.content).toMatch(/não foi possível visualizar/);
  });

  it("have_attachment sem caminho: não some em silêncio", async () => {
    const admin = fakeAdmin(() => ({ error: null }));
    const r = await buildGuestPhotoMessage(admin, { text: "", urls: [], haveAttachment: true, propertyId: PROP, conversationId: CONV });
    expect(r.content).toMatch(/Foto enviada/);
    expect(r.attachmentFields).toEqual({});
  });
});
