/**
 * COPILOTO · VISÃO — utilitários PUROS de imagem (sem banco, rede, relógio nem LLM).
 *
 * A imagem do hóspede só vai ao modelo como Data URL base64 de JPEG, PNG ou WebP. O formato é decidido
 * pelos BYTES (assinatura do arquivo), nunca pelo `attachment_mime` gravado, e as dimensões são lidas do
 * cabeçalho para calcular um LIMITE SUPERIOR de tokens de entrada (orçamento por turno).
 *
 * Não há redimensionamento: o servidor roda em Workers, sem biblioteca nativa de imagem, e decodificar
 * pixels em JavaScript puro consumiria a CPU do turno. Em vez disso: teto de bytes por imagem e por turno,
 * teto de lado (ver `IMAGE_LIMITS`) e o custo contado pelas dimensões reais (o provedor reduz a imagem
 * do lado dele; a conta usa o pior caso).
 */

export type ImageFormat = "jpeg" | "png" | "webp";

export const IMAGE_MIME: Readonly<Record<ImageFormat, string>> = Object.freeze({
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
});

export const IMAGE_LIMITS = Object.freeze({
  /** Teto por imagem (bytes do arquivo). */
  maxBytes: 5 * 1024 * 1024,
  /** Teto da soma das imagens de um turno (bytes); em base64 fica ≈ 9,3 MB, abaixo do teto do Gateway. */
  maxTotalBytes: 7 * 1024 * 1024,
  /** Lado máximo aceito (px). Acima disso a imagem não vai ao modelo. */
  maxSidePx: 12_000,
  /** Imagens mais recentes do hóspede por turno. */
  maxImagesPerTurn: 3,
});

/** Formato pela assinatura dos bytes. `null` = não é JPEG/PNG/WebP. */
export function sniffImageFormat(b: Uint8Array): ImageFormat | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
    return "png";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && // R
    b[1] === 0x49 && // I
    b[2] === 0x46 && // F
    b[3] === 0x46 && // F
    b[8] === 0x57 && // W
    b[9] === 0x45 && // E
    b[10] === 0x42 && // B
    b[11] === 0x50 // P
  )
    return "webp";
  return null;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) =>
  ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    let marker = b[i + 1];
    // bytes de preenchimento 0xFF
    while (marker === 0xff && i + 2 < b.length) {
      i += 1;
      marker = b[i + 1];
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // fim / início dos dados sem SOF
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 8 >= b.length) return null;
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

function pngSize(b: Uint8Array): { width: number; height: number } | null {
  // assinatura (8) + tamanho do bloco (4) + "IHDR" (4) + largura (4) + altura (4)
  if (b.length < 24 || b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52)
    return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (chunk === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  if (chunk === "VP8 ") {
    // quadro-chave: assinatura 9d 01 2a nos bytes 23–25; dimensões em 14 bits
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** Dimensões lidas do cabeçalho. `null` = cabeçalho ilegível ou dimensão inválida. */
export function imageDimensions(
  b: Uint8Array,
  format: ImageFormat,
): { width: number; height: number } | null {
  const d = format === "jpeg" ? jpegSize(b) : format === "png" ? pngSize(b) : webpSize(b);
  if (
    !d ||
    !Number.isInteger(d.width) ||
    !Number.isInteger(d.height) ||
    d.width < 1 ||
    d.height < 1
  )
    return null;
  return d;
}

/** Tokens por imagem: piso fixo usado como referência (imagem de alta resolução no Gemini 3). */
export const IMAGE_TOKEN_FLOOR = 1_120;

/**
 * LIMITE SUPERIOR de tokens de entrada de UMA imagem, cobrindo os modelos registrados:
 *  - Gemini: até 384 px nos dois lados = 258; acima, blocos de 768 × 768, 258 tokens cada;
 *  - modelos GPT (detalhe alto): encaixa em 2048 × 2048, lado menor a 768, blocos de 512 → 85 + 170 por bloco;
 *  - nunca menos que `IMAGE_TOKEN_FLOOR`.
 */
export function imageTokenBound(width: number, height: number): number {
  const gemini =
    width <= 384 && height <= 384 ? 258 : Math.ceil(width / 768) * Math.ceil(height / 768) * 258;
  let w = width;
  let h = height;
  const fit = Math.min(1, 2048 / Math.max(w, h));
  w *= fit;
  h *= fit;
  const shortScale = Math.min(1, 768 / Math.min(w, h));
  w *= shortScale;
  h *= shortScale;
  const gpt = 85 + 170 * Math.ceil(w / 512) * Math.ceil(h / 512);
  return Math.max(gemini, gpt, IMAGE_TOKEN_FLOOR);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 puro (sem `Buffer`/`btoa`: funciona igual em Node e Workers). */
export function bytesToBase64(b: Uint8Array): string {
  const out: string[] = [];
  let chunk = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    chunk +=
      B64[(n >>> 18) & 63] +
      B64[(n >>> 12) & 63] +
      (i + 1 < b.length ? B64[(n >>> 6) & 63] : "=") +
      (i + 2 < b.length ? B64[n & 63] : "=");
    if (chunk.length >= 8192) {
      out.push(chunk);
      chunk = "";
    }
  }
  out.push(chunk);
  return out.join("");
}

export type PreparedImage =
  | {
      ok: true;
      format: ImageFormat;
      width: number;
      height: number;
      bytes: number;
      dataUrl: string;
      tokenBound: number;
    }
  | {
      ok: false;
      reason: "empty" | "too_large" | "unsupported_format" | "unreadable" | "dimensions_too_large";
    };

/** Valida os bytes e monta a Data URL. Nada aqui lança. */
export function prepareImage(b: Uint8Array | null | undefined): PreparedImage {
  if (!b || b.byteLength === 0) return { ok: false, reason: "empty" };
  if (b.byteLength > IMAGE_LIMITS.maxBytes) return { ok: false, reason: "too_large" };
  const format = sniffImageFormat(b);
  if (!format) return { ok: false, reason: "unsupported_format" };
  const dims = imageDimensions(b, format);
  if (!dims) return { ok: false, reason: "unreadable" };
  if (dims.width > IMAGE_LIMITS.maxSidePx || dims.height > IMAGE_LIMITS.maxSidePx)
    return { ok: false, reason: "dimensions_too_large" };
  return {
    ok: true,
    format,
    width: dims.width,
    height: dims.height,
    bytes: b.byteLength,
    dataUrl: `data:${IMAGE_MIME[format]};base64,${bytesToBase64(b)}`,
    tokenBound: imageTokenBound(dims.width, dims.height),
  };
}
