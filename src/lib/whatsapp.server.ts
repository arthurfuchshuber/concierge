// Server-only helpers for WhatsApp Business via Sinch Conversations API.
// Never import this file from client-reachable modules at module scope.
import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual, createHmac } from "node:crypto";

function key(): Buffer {
  const raw = process.env.WHATSAPP_ENCRYPTION_KEY;
  if (!raw) throw new Error("WHATSAPP_ENCRYPTION_KEY não configurada");
  // Derive a 32-byte key from the arbitrary-length secret.
  return createHash("sha256").update(raw).digest();
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptToken(payload: string): string {
  const [v, ivB64, tagB64, encB64] = payload.split(":");
  if (v !== "v1" || !ivB64 || !tagB64 || !encB64) throw new Error("Token WhatsApp inválido");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([d.update(Buffer.from(encB64, "base64")), d.final()]);
  return dec.toString("utf8");
}

// ----- Sinch Conversations API -----
// Docs: https://developers.sinch.com/docs/conversation/
const SINCH_BASE = "https://us.conversation.api.sinch.com/v1";

export type SinchConfig = {
  projectId: string; // aka "project id" for Sinch
  appId: string;
  token: string;
  senderNumber: string; // E.164 without +
};

/**
 * Send an outbound WhatsApp text message via Sinch Conversations.
 * Returns the Sinch message id (used to correlate delivery receipts).
 */
export async function sinchSendText(cfg: SinchConfig, opts: {
  toE164: string; // digits only, no +
  text: string;
}): Promise<{ messageId: string }> {
  const url = `${SINCH_BASE}/projects/${cfg.projectId}/messages:send`;
  const body = {
    app_id: cfg.appId,
    recipient: { identified_by: { channel_identities: [{ channel: "WHATSAPP", identity: opts.toE164 }] } },
    message: { text_message: { text: opts.text } },
    channel_priority_order: ["WHATSAPP"],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Sinch ${res.status}: ${raw}`);
  let json: { message_id?: string } = {};
  try { json = JSON.parse(raw); } catch { /* ignore */ }
  return { messageId: json.message_id ?? "" };
}

/**
 * Verify Sinch webhook HMAC signature.
 * Sinch sends a `x-sinch-webhook-signature` header (HMAC-SHA256 base64 of raw body).
 */
export function verifySinchSignature(rawBody: string, signature: string | null, webhookSecret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Given a phone in international format ("+5511987654321" or "5511987654321"),
 * return only digits, no +.
 */
export function normalizePhone(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}
