/**
 * COPILOTO · VISÃO — fotos do hóspede como partes multimodais.
 *  - `image.ts`: formato pelos bytes, dimensões pelo cabeçalho, base64, limite superior de tokens;
 *  - `data/guest-images.server.ts`: só fotos do hóspede desta conversa até a mensagem atual, as 3 mais
 *    recentes, isolamento do caminho no storage, tetos e falha transparente;
 *  - `data/client.server.ts`: porta de storage só leitura, só `chat-attachments`, caminho saneado;
 *  - gerador: fotos na última mensagem do usuário, teto de custo do turno respeitado, aviso
 *    `[imagem não carregada]` quando a foto não vai ao modelo.
 */
import { describe, expect, it } from "vitest";
import {
  IMAGE_LIMITS,
  IMAGE_TOKEN_FLOOR,
  bytesToBase64,
  imageDimensions,
  imageTokenBound,
  prepareImage,
  sniffImageFormat,
} from "@/lib/guest-ai/image";
import { fetchGuestImages, GUEST_IMAGE_SCAN_ROWS } from "@/lib/guest-ai/data/guest-images.server";
import {
  GUEST_AI_ATTACHMENT_BUCKET,
  GuestAiAbortedError,
  attachmentStorageFrom,
  type GuestAiAttachmentStorage,
  type GuestAiDb,
} from "@/lib/guest-ai/data/client.server";
import { GUEST_IMAGE_MESSAGE_COLUMNS } from "@/lib/guest-ai/data/projections";
import { issue, GuestAiSecurityError } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import {
  IMAGE_NOT_LOADED,
  VISION_HEADER,
  attachVision,
  copilotInputTokenBound,
  createCopilotGenerator,
  type CopilotVisionInput,
} from "@/lib/guest-ai/copilot/generator.server";
import { estimateCostUsd, modelSpec } from "@/lib/guest-ai/llm/models";
import type { LlmContentPart, LlmMessage } from "@/lib/guest-ai/llm/contracts";
import type { ProviderRequest } from "@/lib/guest-ai/llm/providers/types";
import type { ComposedPrompt } from "@/lib/guest-ai/orchestrator/contracts";
import { REAL_COLUMNS } from "./helpers/real-columns";
import { okJson } from "./helpers/copilot-provider";

// ───────────────────────── imagens sintéticas (só cabeçalho) ─────────────────────────

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export function png(w: number, h: number, pad = 16): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    ...ascii("IHDR"),
    ...be32(w),
    ...be32(h),
    8,
    6,
    0,
    0,
    0,
    ...new Array(pad).fill(7),
  ]);
}
export function jpeg(w: number, h: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    ...be16(16),
    ...ascii("JFIF"),
    0,
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    0xff,
    0xc0,
    ...be16(17),
    8,
    ...be16(h),
    ...be16(w),
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
    0xff,
    0xd9,
  ]);
}
const webpVp8x = (w: number, h: number) =>
  new Uint8Array([
    ...ascii("RIFF"),
    0,
    0,
    0,
    0,
    ...ascii("WEBP"),
    ...ascii("VP8X"),
    10,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...le24(w - 1),
    ...le24(h - 1),
    0,
    0,
  ]);
const webpVp8 = (w: number, h: number) =>
  new Uint8Array([
    ...ascii("RIFF"),
    0,
    0,
    0,
    0,
    ...ascii("WEBP"),
    ...ascii("VP8 "),
    10,
    0,
    0,
    0,
    0,
    0,
    0,
    0x9d,
    0x01,
    0x2a,
    ...le16(w),
    ...le16(h),
    0,
    0,
  ]);
const webpVp8l = (w: number, h: number) => {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  return new Uint8Array([
    ...ascii("RIFF"),
    0,
    0,
    0,
    0,
    ...ascii("WEBP"),
    ...ascii("VP8L"),
    10,
    0,
    0,
    0,
    0x2f,
    bits & 255,
    (bits >>> 8) & 255,
    (bits >>> 16) & 255,
    (bits >>> 24) & 255,
    0,
    0,
    0,
    0,
    0,
  ]);
};

describe("Visão · image.ts (puro)", () => {
  it("formato pelos BYTES, não pelo nome ou mime; dimensões pelo cabeçalho", () => {
    const cases: Array<[Uint8Array, string, number, number]> = [
      [png(1200, 900), "png", 1200, 900],
      [jpeg(4032, 3024), "jpeg", 4032, 3024],
      [webpVp8x(2000, 1500), "webp", 2000, 1500],
      [webpVp8(640, 480), "webp", 640, 480],
      [webpVp8l(300, 200), "webp", 300, 200],
    ];
    for (const [b, fmt, w, h] of cases) {
      expect(sniffImageFormat(b)).toBe(fmt);
      expect(imageDimensions(b, fmt as never)).toEqual({ width: w, height: h });
    }
    expect(sniffImageFormat(new Uint8Array(ascii("GIF89a......")))).toBeNull();
    expect(sniffImageFormat(new Uint8Array(ascii("%PDF-1.7 ....")))).toBeNull();
    expect(sniffImageFormat(new Uint8Array([]))).toBeNull();
  });

  it("base64 puro igual ao do Node em todos os restos (0, 1, 2)", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 255, 10_000, 10_001, 10_002]) {
      const b = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 255);
      expect(bytesToBase64(b), String(n)).toBe(Buffer.from(b).toString("base64"));
    }
  });

  it("limite superior de tokens: piso de alta resolução; foto grande conta pelos blocos", () => {
    expect(imageTokenBound(200, 200)).toBe(IMAGE_TOKEN_FLOOR);
    expect(imageTokenBound(4032, 3024)).toBe(6 * 4 * 258);
    expect(imageTokenBound(800, 600)).toBeGreaterThanOrEqual(IMAGE_TOKEN_FLOOR);
  });

  it("prepareImage: Data URL com o mime REAL dos bytes; recusa vazio, grande, formato e cabeçalho inválidos", () => {
    const ok = prepareImage(png(64, 64));
    expect(ok.ok && ok.dataUrl.startsWith("data:image/png;base64,iVBORw0KGgo")).toBe(true);
    expect(ok.ok && ok.tokenBound).toBe(IMAGE_TOKEN_FLOOR);
    expect(prepareImage(null)).toEqual({ ok: false, reason: "empty" });
    expect(prepareImage(new Uint8Array(IMAGE_LIMITS.maxBytes + 1).fill(0xff))).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(prepareImage(new Uint8Array(ascii("GIF89a--------")))).toEqual({
      ok: false,
      reason: "unsupported_format",
    });
    expect(prepareImage(new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0]))).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(prepareImage(png(20_000, 100))).toEqual({ ok: false, reason: "dimensions_too_large" });
  });
});

// ───────────────────────── leitura das fotos (data/) ─────────────────────────

const CONV = "c0000000-0000-4000-8000-000000000001";
const MSG = "m0000000-0000-4000-8000-000000000009";
const PROP = "b1000000-0000-4000-8000-000000000001";
const TURN: ValidatedTurn = {
  surface: "airbnb",
  conversationId: CONV,
  messageId: MSG,
  propertyId: PROP,
  tenantId: "t1",
  guestSessionId: "airbnb:x",
  conversationStatus: "ai",
  reservationId: null,
  guestName: null,
  messageCreatedAt: null,
};
const turn = () => issue("turn", { ...TURN }) as ValidatedTurn;
const path = (name: string, prop = PROP, conv = CONV) => `${prop}/${conv}/${name}.jpg`;

let seq = 0;
const imgRow = (over: Record<string, unknown> = {}) => {
  seq += 1;
  return {
    id: `i0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    conversation_id: CONV,
    role: "user",
    sender_type: "guest",
    is_internal_note: false,
    created_at: `2026-11-06T10:00:${String(seq).padStart(2, "0")}.000000+00:00`,
    attachment_type: "image",
    attachment_path: path(`foto-${seq}`),
    attachment_size_bytes: 1000,
    ...over,
  };
};

type Q = {
  table: string;
  select?: string;
  eq: Array<[string, unknown]>;
  order: Array<[string, unknown]>;
  limit?: number;
};
function fakeDb(opts: {
  current?: { data?: unknown; error?: unknown };
  images?: { data?: unknown; error?: unknown } | (() => never);
}) {
  const calls: Q[] = [];
  const db: GuestAiDb = {
    from(table: string) {
      const c: Q = { table, eq: [], order: [] };
      calls.push(c);
      const q: Record<string, unknown> = {
        select(s: string) {
          c.select = s;
          return q;
        },
        eq(k: string, v: unknown) {
          c.eq.push([k, v]);
          return q;
        },
        order(k: string, o: unknown) {
          c.order.push([k, o]);
          return q;
        },
        maybeSingle() {
          return Promise.resolve(
            opts.current ?? {
              data: {
                id: MSG,
                conversation_id: CONV,
                created_at: "2026-11-06T10:00:30.000000+00:00",
              },
              error: null,
            },
          );
        },
        limit(n: number) {
          c.limit = n;
          if (typeof opts.images === "function") return opts.images();
          return Promise.resolve({
            data: opts.images?.data ?? [],
            error: opts.images?.error ?? null,
          });
        },
      };
      return q;
    },
  };
  return { db, calls };
}
function fakeStorage(files: Record<string, Uint8Array | null | Error>) {
  const downloads: string[] = [];
  const storage: GuestAiAttachmentStorage = {
    async download(p) {
      downloads.push(p);
      const f = files[p];
      if (f instanceof Error) throw f;
      return f ?? null;
    },
  };
  return { storage, downloads };
}

describe("Visão · fetchGuestImages (data/guest-images.server.ts)", () => {
  it("projeção própria com colunas reais; consulta filtrada pela conversa do turno, só hóspede, só imagem, sem nota interna", async () => {
    const real = new Set(REAL_COLUMNS["property_chat_messages"]);
    expect(GUEST_IMAGE_MESSAGE_COLUMNS.filter((c) => !real.has(c))).toEqual([]);
    for (const c of [
      "content",
      "attachment_transcript",
      "sender_user_id",
      "sent_via_number",
      "external_id",
    ])
      expect(GUEST_IMAGE_MESSAGE_COLUMNS as readonly string[]).not.toContain(c);
    const { db, calls } = fakeDb({ images: { data: [] } });
    expect(await fetchGuestImages(turn(), { db, storage: fakeStorage({}).storage })).toEqual([]);
    expect(calls[1]).toMatchObject({
      table: "property_chat_messages",
      select: GUEST_IMAGE_MESSAGE_COLUMNS.join(", "),
      limit: GUEST_IMAGE_SCAN_ROWS,
    });
    expect(calls[1]!.eq).toEqual([
      ["conversation_id", CONV],
      ["attachment_type", "image"],
      ["is_internal_note", false],
      ["role", "user"],
      ["sender_type", "guest"],
    ]);
    expect(calls[0]!.eq).toEqual([
      ["id", MSG],
      ["conversation_id", CONV],
    ]);
  });

  it("exige turno emitido por validateTurnScope", async () => {
    const { db } = fakeDb({});
    await expect(
      fetchGuestImages({ ...TURN } as ValidatedTurn, { db, storage: fakeStorage({}).storage }),
    ).rejects.toBeInstanceOf(GuestAiSecurityError);
  });

  it("as 3 MAIS RECENTES até a mensagem atual; posteriores, de outro falante, nota interna e outra conversa ficam fora", async () => {
    const rows = [
      imgRow({ created_at: "2026-11-06T10:00:01.000000+00:00" }),
      imgRow({ created_at: "2026-11-06T10:00:02.000000+00:00" }),
      imgRow({ created_at: "2026-11-06T10:00:03.000000+00:00" }),
      imgRow({ created_at: "2026-11-06T10:00:04.000000+00:00" }),
      imgRow({ created_at: "2026-11-06T10:00:40.000000+00:00" }), // depois da atual (10:00:30)
      imgRow({
        created_at: "2026-11-06T10:00:05.000000+00:00",
        sender_type: "human",
        role: "assistant",
      }),
      imgRow({ created_at: "2026-11-06T10:00:06.000000+00:00", is_internal_note: true }),
      imgRow({ created_at: "2026-11-06T10:00:07.000000+00:00", conversation_id: "outra" }),
    ];
    const files = Object.fromEntries(rows.map((r) => [r.attachment_path, png(100, 100)]));
    const { db } = fakeDb({ images: { data: rows } });
    const { storage, downloads } = fakeStorage(files);
    const out = await fetchGuestImages(turn(), { db, storage });
    expect(out.map((o) => o.messageId)).toEqual([rows[3]!.id, rows[2]!.id, rows[1]!.id]);
    expect(out.every((o) => o.status === "loaded")).toBe(true);
    expect(downloads).toEqual([
      rows[3]!.attachment_path,
      rows[2]!.attachment_path,
      rows[1]!.attachment_path,
    ]);
    const first = out[0]!;
    expect(first.status === "loaded" && first.dataUrl.startsWith("data:image/png;base64,")).toBe(
      true,
    );
    expect(JSON.stringify(out)).not.toContain(PROP + "/"); // o caminho não sai do módulo
  });

  it("isolamento no storage: caminho de outro imóvel ou conversa é recusado SEM download", async () => {
    const rows = [
      imgRow({ attachment_path: path("x", "outro-imovel") }),
      imgRow({ attachment_path: path("y", PROP, "outra-conversa") }),
      imgRow({ attachment_path: null }),
    ];
    const { db } = fakeDb({ images: { data: rows } });
    const { storage, downloads } = fakeStorage({});
    const out = await fetchGuestImages(turn(), { db, storage });
    expect(out.map((o) => o.status === "failed" && o.reason)).toEqual([
      "path_out_of_scope",
      "path_out_of_scope",
      "path_out_of_scope",
    ]);
    expect(downloads).toEqual([]);
  });

  it("falha do storage, download que lança, formato inválido e arquivo grande viram `failed` (nunca lança)", async () => {
    const r = [imgRow(), imgRow(), imgRow()];
    const { db } = fakeDb({
      images: { data: [...r, imgRow({ attachment_size_bytes: IMAGE_LIMITS.maxBytes + 1 })] },
    });
    const { storage } = fakeStorage({
      [r[0]!.attachment_path]: null,
      [r[1]!.attachment_path]: new Error("storage fora"),
      [r[2]!.attachment_path]: new Uint8Array(ascii("GIF89a------")),
    });
    const out = await fetchGuestImages(turn(), { db, storage });
    const reasons = Object.fromEntries(
      out.map((o) => [o.messageId, o.status === "failed" ? o.reason : "loaded"]),
    );
    expect(reasons[r[2]!.id]).toBe("unsupported_format");
    expect(reasons[r[1]!.id]).toBe("download_failed");
    expect(out.length).toBe(3);
  });

  it("teto da soma do turno: a foto que estoura fica de fora (`turn_budget_exceeded`)", async () => {
    const big = Math.floor(IMAGE_LIMITS.maxTotalBytes / 2) + 10;
    const rows = [
      imgRow({ attachment_size_bytes: big }),
      imgRow({ attachment_size_bytes: big }),
      imgRow({ attachment_size_bytes: big }),
    ];
    const { db } = fakeDb({ images: { data: rows } });
    const filler = (n: number) => png(10, 10, n - 29);
    const { storage } = fakeStorage(
      Object.fromEntries(rows.map((r) => [r.attachment_path, filler(big)])),
    );
    const out = await fetchGuestImages(turn(), { db, storage });
    expect(out.map((o) => o.status)).toEqual(["loaded", "failed", "failed"]);
    expect(out[1]!.status === "failed" && out[1]!.reason).toBe("turn_budget_exceeded");
  });

  it("erro do banco ⇒ um único `failed` (lookup_failed); cancelamento interrompe", async () => {
    expect(
      await fetchGuestImages(turn(), {
        db: fakeDb({ images: { error: { code: "x" } } }).db,
        storage: fakeStorage({}).storage,
      }),
    ).toEqual([{ status: "failed", messageId: null, at: null, reason: "lookup_failed" }]);
    expect(
      await fetchGuestImages(turn(), {
        db: fakeDb({ current: { data: null, error: null } }).db,
        storage: fakeStorage({}).storage,
      }),
    ).toEqual([{ status: "failed", messageId: null, at: null, reason: "lookup_failed" }]);
    const ac = new AbortController();
    ac.abort();
    await expect(
      fetchGuestImages(turn(), {
        db: fakeDb({}).db,
        storage: fakeStorage({}).storage,
        signal: ac.signal,
      }),
    ).rejects.toBeInstanceOf(GuestAiAbortedError);
  });
});

describe("Visão · porta de storage (client.server.ts)", () => {
  it("só o bucket chat-attachments, só download; caminho saneado; erro ⇒ null", async () => {
    const buckets: string[] = [];
    const paths: string[] = [];
    const client = {
      storage: {
        from(b: string) {
          buckets.push(b);
          return {
            async download(p: string) {
              paths.push(p);
              if (p.includes("erro")) return { data: null, error: { message: "x" } };
              if (p.includes("lanca")) throw new Error("rede");
              return { data: new Blob([new Uint8Array([1, 2, 3])]), error: null };
            },
          };
        },
      },
    };
    const s = attachmentStorageFrom(client);
    expect(await s.download("p1/c1/a.jpg")).toEqual(new Uint8Array([1, 2, 3]));
    for (const bad of ["../segredo", "/abs/x.jpg", "p1//x.jpg", "p1/../x", "", "a".repeat(600)])
      expect(await s.download(bad), bad).toBeNull();
    expect(await s.download("p1/c1/erro.jpg")).toBeNull();
    expect(await s.download("p1/c1/lanca.jpg")).toBeNull();
    expect(new Set(buckets)).toEqual(new Set([GUEST_AI_ATTACHMENT_BUCKET]));
    expect(paths).toEqual(["p1/c1/a.jpg", "p1/c1/erro.jpg", "p1/c1/lanca.jpg"]);
    expect(GUEST_AI_ATTACHMENT_BUCKET).toBe("chat-attachments");
  });
});

// ───────────────────────── gerador ─────────────────────────

const MODEL = "google/gemini-3.8-flash";
const SPEC = modelSpec(MODEL)!;
const prompt = (): ComposedPrompt => ({
  system: "Você é o concierge.",
  messages: [
    { role: "user", content: "contexto e histórico do turno" },
    { role: "assistant", content: "ok" },
    { role: "user", content: "mensagem atual: a porta não abre, mandei foto" },
  ],
  sourceIds: null,
  promptVersion: "t",
});
const IMG_A = {
  ref: "hist:guest:h5",
  at: "2026-11-06T10:00:05Z",
  dataUrl: "data:image/jpeg;base64,/9j/AAAA",
  tokenBound: 1_120,
};
const IMG_B = {
  ref: "hist:guest:h3",
  at: "2026-11-06T10:00:03Z",
  dataUrl: "data:image/png;base64,iVBORw0KGgo=",
  tokenBound: 6_192,
};

function capturing() {
  const seen: ProviderRequest[] = [];
  return {
    seen,
    provider: {
      id: "fake",
      async complete(req: ProviderRequest) {
        seen.push(req);
        return okJson({ ok: true });
      },
    },
  };
}
const gen = (over: Partial<Parameters<typeof createCopilotGenerator>[0]> = {}) => {
  const cap = capturing();
  const g = createCopilotGenerator({
    modelId: MODEL,
    maxOutputTokens: 1_536,
    reasoningEffort: "low",
    remainingMs: () => 20_000,
    beforeNetwork: async () => true,
    traceId: "s-1",
    provider: cap.provider,
    log: () => {},
    ...over,
  });
  return { g, cap };
};
const lastUserParts = (req: ProviderRequest): LlmContentPart[] => {
  const last = [...req.messages].reverse().find((m) => m.role === "user")!;
  return typeof last.content === "string"
    ? [{ type: "text", text: last.content }]
    : [...last.content];
};

describe("Visão · gerador do Copiloto", () => {
  it("sem fotos: mensagens em texto puro, idênticas às de antes", async () => {
    const { g, cap } = gen({ loadVision: async () => ({ images: [], failed: [] }) });
    await g.generate(prompt(), new AbortController().signal);
    expect(cap.seen[0]!.messages).toEqual([
      { role: "system", content: "Você é o concierge." },
      ...prompt().messages,
    ]);
    expect(g.telemetry()).toMatchObject({ imagesSent: 0, imagesNotLoaded: 0 });
  });

  it("fotos vão na ÚLTIMA mensagem do usuário, com cabeçalho e legenda citável; texto original preservado", async () => {
    const { g, cap } = gen({ loadVision: async () => ({ images: [IMG_A, IMG_B], failed: [] }) });
    await g.generate(prompt(), new AbortController().signal);
    const msgs = cap.seen[0]!.messages;
    expect(msgs.slice(0, 3)).toEqual([
      { role: "system", content: "Você é o concierge." },
      prompt().messages[0],
      prompt().messages[1],
    ]);
    expect(lastUserParts(cap.seen[0]!)).toEqual([
      { type: "text", text: "mensagem atual: a porta não abre, mandei foto" },
      { type: "text", text: VISION_HEADER },
      { type: "text", text: "Foto 1 — mensagem hist:guest:h5 (2026-11-06T10:00:05Z)" },
      { type: "image_url", image_url: { url: IMG_A.dataUrl } },
      { type: "text", text: "Foto 2 — mensagem hist:guest:h3 (2026-11-06T10:00:03Z)" },
      { type: "image_url", image_url: { url: IMG_B.dataUrl } },
    ]);
    expect(g.telemetry()).toMatchObject({ imagesSent: 2, imagesNotLoaded: 0, status: "called" });
    expect(g.telemetry().estimatedInputTokens!).toBeGreaterThan(
      copilotInputTokenBound(prompt()) + IMG_A.tokenBound + IMG_B.tokenBound,
    );
  });

  it("falha ao carregar (loader lança ou foto com falha) ⇒ geração segue só com texto + `[imagem não carregada]`", async () => {
    const throwing = gen({
      loadVision: async () => {
        throw new Error("storage fora");
      },
    });
    await throwing.g.generate(prompt(), new AbortController().signal);
    expect(lastUserParts(throwing.cap.seen[0]!).filter((p) => p.type === "image_url")).toEqual([]);
    expect(lastUserParts(throwing.cap.seen[0]!)).toContainEqual({
      type: "text",
      text: `${IMAGE_NOT_LOADED} — mensagem sem referência`,
    });
    expect(throwing.g.telemetry()).toMatchObject({
      status: "called",
      imagesSent: 0,
      imagesNotLoaded: 1,
    });

    const partial = gen({
      loadVision: async () => ({ images: [IMG_A], failed: [{ ref: "hist:guest:h2", at: null }] }),
    });
    await partial.g.generate(prompt(), new AbortController().signal);
    const parts = lastUserParts(partial.cap.seen[0]!);
    expect(parts.filter((p) => p.type === "image_url")).toHaveLength(1);
    expect(parts).toContainEqual({
      type: "text",
      text: `${IMAGE_NOT_LOADED} — mensagem hist:guest:h2`,
    });
  });

  it("teto de custo do turno: foto que não cabe fica fora (aviso), a chamada segue e o pior caso cabe no teto", async () => {
    const textBound = copilotInputTokenBound(prompt());
    // teto que cabe o texto + a foto pequena (1.120), mas não a grande (6.192)
    const ceiling = estimateCostUsd(SPEC, textBound + 2_500, 1_536);
    const { g, cap } = gen({
      maxTurnCostUsd: ceiling,
      loadVision: async () => ({ images: [IMG_B, IMG_A], failed: [] }),
    });
    await g.generate(prompt(), new AbortController().signal);
    const parts = lastUserParts(cap.seen[0]!);
    expect(parts.filter((p) => p.type === "image_url")).toEqual([
      { type: "image_url", image_url: { url: IMG_A.dataUrl } },
    ]);
    expect(parts).toContainEqual({
      type: "text",
      text: `${IMAGE_NOT_LOADED} — mensagem hist:guest:h3 (2026-11-06T10:00:03Z)`,
    });
    const t = g.telemetry();
    expect(t).toMatchObject({ imagesSent: 1, imagesNotLoaded: 1 });
    expect(estimateCostUsd(SPEC, t.estimatedInputTokens!, 1_536)).toBeLessThanOrEqual(ceiling);
  });

  it("teto que nem o texto cabe ⇒ bloqueia antes de carregar fotos e antes da rede", async () => {
    let loaded = 0;
    const { g, cap } = gen({
      maxTurnCostUsd: 0.000001,
      loadVision: async () => {
        loaded += 1;
        return { images: [IMG_A], failed: [] };
      },
    });
    await expect(g.generate(prompt(), new AbortController().signal)).rejects.toMatchObject({
      code: "budget_turn_exceeded",
    });
    expect(loaded).toBe(0);
    expect(cap.seen).toHaveLength(0);
  });

  it("attachVision: sem mensagem de usuário, as fotos vão numa mensagem nova do usuário", () => {
    const vision: CopilotVisionInput = { images: [IMG_A], failed: [] };
    const out = attachVision(
      [{ role: "system", content: "s" }] as LlmMessage[],
      vision,
      100,
      () => true,
    );
    expect(out.messages[1]!.role).toBe("user");
    expect(out.sent).toBe(1);
  });
});
