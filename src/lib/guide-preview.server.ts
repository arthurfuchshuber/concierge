// Token curto e assinado que permite ao anfitrião pré-visualizar um guia
// mesmo quando ele ainda está como rascunho (published = false).
// O token vale por 1 hora, é preso ao slug e nunca é emitido sem autenticação.

const encoder = new TextEncoder();

function secret(): string {
  const s = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!s) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return s;
}

function base64url(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  let str = "";
  for (const byte of b) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return base64url(sig);
}

const TTL_MS = 60 * 60 * 1000;

export async function createGuidePreviewTokenFor(slug: string): Promise<string> {
  const exp = Date.now() + TTL_MS;
  const sig = await sign(`${slug}.${exp}`);
  return `${exp}.${sig}`;
}

export async function verifyGuidePreviewToken(slug: string, token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const idx = token.indexOf(".");
  if (idx <= 0) return false;
  const expRaw = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await sign(`${slug}.${exp}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
