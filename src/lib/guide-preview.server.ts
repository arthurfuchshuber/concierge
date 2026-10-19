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

export async function createGuidePreviewTokenFor(slug: string, userId: string): Promise<string> {
  const exp = Date.now() + TTL_MS;
  const sig = await sign(`${slug}.${exp}.${userId}`);
  return `${exp}.${userId}.${sig}`;
}

/** Revalida, a cada uso, se quem emitiu o token ainda tem acesso ao imóvel
 *  (dono, membro ativo ou admin do SaaS). Acesso revogado invalida o token na hora. */
async function stillHasAccess(slug: string, userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: prop } = await supabaseAdmin
    .from("properties")
    .select("id,owner_id")
    .eq("slug", slug)
    .maybeSingle();
  if (!prop) return false;
  if (prop.owner_id === userId) return true;
  const { data: member } = await supabaseAdmin.rpc("member_can_see_property" as never, {
    _user_id: userId,
    _owner_id: prop.owner_id,
    _property_id: prop.id,
  } as never);
  if (member === true) return true;
  const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" });
  return isAdmin === true;
}

export async function verifyGuidePreviewToken(slug: string, token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expRaw, userId, sig] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await sign(`${slug}.${exp}.${userId}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return false;
  try {
    return await stillHasAccess(slug, userId);
  } catch {
    return false;
  }
}
