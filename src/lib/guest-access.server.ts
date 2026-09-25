/**
 * PROVA DE ACESSO DO HÓSPEDE — tudo que decide se um visitante anônimo pode
 * ver senhas/códigos do imóvel mora aqui (auditoria de segurança, 16/09/2026).
 *
 * O problema que isto fecha:
 *
 *  1. Nos guias "Check-In & Check-Out" o formulário exige o código da reserva
 *     do Airbnb — mas essa exigência existia SÓ na tela. `getPublicGuide`
 *     devolvia Wi-Fi, código do portão e da fechadura para qualquer chamada
 *     direta à função, e o `sitemap.xml` publica o endereço de todo guia
 *     público. Quem soubesse o link tinha a senha da porta, sem reserva.
 *  2. A IA do guia entregava os mesmos códigos pela ferramenta
 *     `get_property_facts` para qualquer pessoa que abrisse o chat — inclusive
 *     na vitrine da landing, que mostra um guia real.
 *  3. Os cookies de PIN (`sg-pin-<id>` / `sg-accesscodes-<id>`) tinham o valor
 *     fixo "ok": bastava criar o cookie no navegador para "acertar" o PIN.
 *
 * A regra agora: dado sensível só sai do servidor com prova verificável —
 * código de reserva ATIVO no iCal (guias com código), ou cookie ASSINADO
 * emitido depois de o PIN ser conferido no servidor.
 */
import { ETIQUETA_CHECKIN_CHECKOUT } from "@/lib/publish-requirements";

type PropLike = {
  tagline?: string | null;
  airbnb_ical_url?: string | null;
};

/**
 * Guia cujo acesso depende do código de reserva validado no iCal. É a MESMA
 * condição usada em `recordGuideAccess` para exigir o código — sem iCal não
 * há contra o que validar, e o guia segue a regra antiga (acesso pelo link).
 */
export function isReservationGated(prop: PropLike | null | undefined): boolean {
  if (!prop) return false;
  const hasIcal = !!(prop.airbnb_ical_url ?? "").trim();
  return hasIcal && (prop.tagline ?? "").trim() === ETIQUETA_CHECKIN_CHECKOUT;
}

export type ReservationLookup =
  | { ok: true; checkin_date: string; checkout_date: string }
  | { ok: false; reason: "not_found" | "no_ical" | "inactive" | "expired" | "no_show" };

/**
 * "NÃO COMPARECEU" TRAVA O GUIA (pedido explícito, 24/09/2026: "se um card
 * foi dado como 'não compareceu', então mesmo que o hóspede tente entrar
 * colocando o código da reserva, ele não vai conseguir").
 *
 * A marca vive em `guest_arrival_status` (kind `checkin`, status `no_show`),
 * gravada por `markNoShow` com o `log_id` e/ou o `reservation_id` da estadia.
 * Os dois lados nem sempre compartilham identificador, então a regra é a
 * mesma do quadro (`checkinNoShowStays` em arrival-board.server.ts): a
 * ESTADIA — imóvel + data de entrada — é o que decide. Desfazer o "não
 * compareceu" no sistema volta o status para `pending` e libera o guia de
 * novo, sem nada a fazer aqui.
 */
export async function isStayMarkedNoShow(
  propertyId: string,
  checkinDate: string | null | undefined,
): Promise<boolean> {
  if (!propertyId || !checkinDate) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as {
    from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const { data: marks } = await db
    .from("guest_arrival_status")
    .select("log_id, reservation_id")
    .eq("property_id", propertyId)
    .eq("kind", "checkin")
    .eq("status", "no_show")
    .limit(500);
  const rows = (marks ?? []) as Array<{ log_id: string | null; reservation_id: string | null }>;
  if (rows.length === 0) return false;
  const resIds = rows.map((r) => r.reservation_id).filter((v): v is string => !!v);
  const logIds = rows.map((r) => r.log_id).filter((v): v is string => !!v);
  const [byRes, byLog] = await Promise.all([
    resIds.length > 0
      ? db
          .from("property_reservations")
          .select("id")
          .in("id", resIds)
          .eq("checkin_date", checkinDate)
          .limit(1)
      : Promise.resolve({ data: [] }),
    logIds.length > 0
      ? db
          .from("guide_access_logs")
          .select("id")
          .in("id", logIds)
          .eq("checkin_date", checkinDate)
          .limit(1)
      : Promise.resolve({ data: [] }),
  ]);
  return (
    ((byRes.data ?? []) as unknown[]).length > 0 || ((byLog.data ?? []) as unknown[]).length > 0
  );
}

/**
 * Consulta a reserva pelo código (HM…) no espelho do iCal do imóvel. Movida de
 * `guide-access.functions.ts` sem mudança de regra, para ser usada também pelo
 * guia (liberação das senhas) e pelo chat do hóspede.
 */
export async function lookupReservationByCode(
  slug: string,
  propertyId: string | undefined,
  rawCode: string,
): Promise<ReservationLookup> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const propQuery = supabaseAdmin
    .from("properties")
    .select("id, airbnb_ical_url, airbnb_ical_last_sync_at")
    .eq("slug", slug)
    .eq("published", true);
  const { data: prop } = propertyId
    ? await propQuery.eq("id", propertyId).maybeSingle()
    : await propQuery.maybeSingle();
  if (!prop) return { ok: false, reason: "not_found" };
  const icalUrl = ((prop as { airbnb_ical_url?: string | null }).airbnb_ical_url ?? "").trim();
  if (!icalUrl) return { ok: false, reason: "no_ical" };

  const code = rawCode.trim().toUpperCase();
  // Código vazio/curto nunca vai ao banco (e `ilike` com curinga seria um
  // atalho para "qualquer reserva").
  if (code.length < 4 || /[%_\\]/.test(code)) return { ok: false, reason: "inactive" };

  const { ensurePropertyIcalFresh } = await import("@/lib/airbnb-ical.server");
  await ensurePropertyIcalFresh(
    prop.id,
    icalUrl,
    (prop as { airbnb_ical_last_sync_at?: string | null }).airbnb_ical_last_sync_at,
  );

  const { data: rows } = await supabaseAdmin
    .from("property_reservations")
    .select("checkin_date, checkout_date, raw_summary, status, guest_hint")
    .eq("property_id", prop.id)
    .eq("source", "airbnb")
    .ilike("guest_hint", code)
    .limit(20);

  const list = (rows ?? []) as Array<{
    checkin_date: string;
    checkout_date: string;
    raw_summary: string | null;
    status: string | null;
  }>;
  if (list.length === 0) return { ok: false, reason: "inactive" };

  const { isRealReservation, operationalTodayISO } = await import("@/lib/reservations.server");
  const active = list.filter((r) => isRealReservation(r));
  if (active.length === 0) return { ok: false, reason: "inactive" };

  const today = operationalTodayISO();
  const current = active.find((r) => r.checkout_date >= today);
  if (!current) return { ok: false, reason: "expired" };

  // Esta é a porta única de todo acesso por código (formulário, revalidação
  // periódica do guia, senhas, chat, "já fiz o check-in/out") — travar aqui
  // trava todos de uma vez.
  if (await isStayMarkedNoShow(prop.id as string, current.checkin_date)) {
    return { ok: false, reason: "no_show" };
  }

  return { ok: true, checkin_date: current.checkin_date, checkout_date: current.checkout_date };
}

/* ------------------------------------------------------------------ *
 * Cookies assinados de PIN
 * ------------------------------------------------------------------ */

const encoder = new TextEncoder();

function cookieSecret(): string {
  // Mesmo segredo de servidor já usado pelo token de pré-visualização
  // (`guide-preview.server.ts`); o prefixo separa os dois usos.
  const s = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!s) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return `guide-access-cookie:v1:${s}`;
}

function base64url(bytes: ArrayBuffer): string {
  let str = "";
  for (const byte of new Uint8Array(bytes)) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(cookieSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Comparação em tempo constante para strings curtas (PIN, assinatura). */
export function safeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/* ------------------------------------------------------------------ *
 * Ficha assinada genérica (ex.: "Desfazer" do hóspede)
 * ------------------------------------------------------------------ */

/**
 * `<corpo base64url>.<assinatura>`. O corpo é JSON legível — NÃO guarde nada
 * secreto aqui; a assinatura só garante que o servidor emitiu exatamente
 * aquilo e que ninguém alterou. `purpose` separa usos diferentes do mesmo
 * segredo (uma ficha de um uso não vale para outro).
 */
export async function signGuestToken(purpose: string, payload: unknown): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify(payload)).buffer as ArrayBuffer);
  const sig = await hmac(`token:${purpose}|${body}`);
  return `${body}.${sig}`;
}

export async function verifyGuestToken<T>(
  purpose: string,
  token: string | null | undefined,
): Promise<T | null> {
  if (!token) return null;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const body = token.slice(0, idx);
  const expected = await hmac(`token:${purpose}|${body}`);
  if (!safeEqual(expected, token.slice(idx + 1))) return null;
  try {
    const b64 = body.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

export type PinCookieKind = "pin" | "accesscodes";

/**
 * Valor do cookie: `<exp>.<assinatura>`. A assinatura amarra o tipo, o imóvel,
 * a validade e o PIN vigente — trocar o PIN no painel invalida na hora todos
 * os cookies emitidos com o PIN anterior.
 */
export async function signPinCookie(
  kind: PinCookieKind,
  propertyId: string,
  currentPin: string,
  maxAgeSeconds: number,
): Promise<string> {
  const exp = Date.now() + maxAgeSeconds * 1000;
  const sig = await hmac(`${kind}|${propertyId}|${exp}|${currentPin}`);
  return `${exp}.${sig}`;
}

export async function verifyPinCookie(
  kind: PinCookieKind,
  propertyId: string,
  currentPin: string | null | undefined,
  value: string | null | undefined,
): Promise<boolean> {
  const pin = (currentPin ?? "").toString().trim();
  if (!value || !pin) return false;
  const idx = value.indexOf(".");
  if (idx <= 0) return false;
  const exp = Number(value.slice(0, idx));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmac(`${kind}|${propertyId}|${exp}|${pin}`);
  return safeEqual(expected, value.slice(idx + 1));
}

/** Nome do cookie — o mesmo de antes, para não mudar nada no navegador. */
export function pinCookieName(kind: PinCookieKind, propertyId: string): string {
  return kind === "pin" ? `sg-pin-${propertyId}` : `sg-accesscodes-${propertyId}`;
}

/* ------------------------------------------------------------------ *
 * Máscara para a IA quando o visitante não provou a reserva
 * ------------------------------------------------------------------ */

/** Mesma máscara já usada em `tools.server.ts`/`indexing.server.ts`. */
export function maskDigitSequences(text: string): string {
  return text.replace(/\d[\d\s.-]{2,}/g, "[BLOQUEADO — liberar no guia]");
}
