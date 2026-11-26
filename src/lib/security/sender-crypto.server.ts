/**
 * Cifra dos tokens da conta remetente do Airbnb (AES-256-GCM, só servidor).
 * Formato: `iv:authTag:payload` em base64 (iv de 12 bytes, tag de 16).
 *
 * Chave: `AIRBNB_TOKEN_SECRET` (32 bytes em base64, ou qualquer texto, derivado por SHA-256). Sem ela, deriva da
 * chave já usada para os conectores (`APP_USER_CONNECTION_KEY_SECRET`) com contexto próprio. Só em teste existe uma
 * chave fixa de desenvolvimento; em produção sem nenhuma das duas, cifrar/decifrar LANÇA (nunca grava em claro).
 */
import * as nodeCrypto from "node:crypto";

const { createCipheriv, createDecipheriv, createHash, randomBytes } = nodeCrypto;

const CONTEXT = "conciergeia:airbnb-sender-token:v1";

export function senderTokenKey(env: Record<string, string | undefined> = process.env): Buffer {
  const own = env["AIRBNB_TOKEN_SECRET"]?.trim();
  if (own) {
    const b = Buffer.from(own, "base64");
    return b.length === 32 ? b : createHash("sha256").update(own).digest();
  }
  const shared = env["APP_USER_CONNECTION_KEY_SECRET"]?.trim();
  if (shared) return createHash("sha256").update(`${CONTEXT}|${shared}`).digest();
  if (env["VITEST"] || env["NODE_ENV"] === "test") return createHash("sha256").update(`${CONTEXT}|dev-only`).digest();
  throw new Error("AIRBNB_TOKEN_SECRET não configurada");
}

export async function encryptToken(plain: string, env?: Record<string, string | undefined>): Promise<string> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", senderTokenKey(env), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

export async function decryptToken(stored: string, env?: Record<string, string | undefined>): Promise<string> {
  const [ivB, tagB, ctB] = stored.split(":");
  if (!ivB || !tagB || ctB === undefined) throw new Error("token cifrado mal formado");
  const decipher = createDecipheriv("aes-256-gcm", senderTokenKey(env), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64")), decipher.final()]).toString("utf8");
}
