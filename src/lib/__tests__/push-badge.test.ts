import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

/**
 * Ícone pequeno das notificações no Android (`badge`): o sistema usa só o canal alfa e pinta numa cor.
 * Precisa ser uma silhueta com fundo TRANSPARENTE; uma imagem opaca (como o favicon) vira um borrão sólido.
 */
function decodePngAlpha(buf: Buffer) {
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  const idat: Buffer[] = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("ascii");
    if (type === "IDAT") idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c),
          pb = Math.abs(a - c),
          pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = (v + p) & 0xff;
    }
  }
  const alpha: number[] = [];
  for (let i = 3; i < out.length; i += 4) alpha.push(out[i]!);
  return { width, height, bitDepth, colorType, alpha };
}

describe("ícone pequeno das notificações (badge)", () => {
  const png = decodePngAlpha(readFileSync("public/notification-badge.png"));

  it("é RGBA 8 bits, 96×96 (tamanho recomendado para badge)", () => {
    expect(png.colorType).toBe(6);
    expect(png.bitDepth).toBe(8);
    expect([png.width, png.height]).toEqual([96, 96]);
  });

  it("tem fundo transparente e desenho opaco (silhueta de verdade)", () => {
    const transparent = png.alpha.filter((a) => a === 0).length;
    const opaque = png.alpha.filter((a) => a === 255).length;
    const total = png.alpha.length;
    expect(transparent / total).toBeGreaterThan(0.4);
    expect(opaque / total).toBeGreaterThan(0.15);
    // cantos sempre transparentes
    for (const i of [0, 95, 96 * 95, 96 * 96 - 1]) expect(png.alpha[i]).toBe(0);
  });

  it("os dois service workers de push usam este badge (e não o favicon opaco)", () => {
    for (const f of ["public/sw-push.js", "public/sw-guest-push.js"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(/badge:\s*"\/notification-badge\.png"/);
      expect(src, f).not.toMatch(/badge:\s*"\/favicon\.png"/);
    }
  });
});
