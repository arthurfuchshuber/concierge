// Server-only helpers for WhatsApp (criptografia de credenciais e telefone). Desde 10/11/2026 o canal está em
// STANDBY: a integração Sinch foi removida e o WhatsApp volta só pela Cloud API oficial da Meta, em etapa futura.
// Never import this file from client-reachable modules at module scope.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

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

export function normalizePhone(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}
