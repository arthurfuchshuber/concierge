/**
 * Assinatura das URLs do proxy de fotos (/api/public/place-photo).
 * Só o servidor gera a assinatura (usa GUEST_PASS_SECRET), então ninguém de
 * fora consegue pedir fotos arbitrárias e gastar a cota paga do Google.
 * Implementação em JS puro para poder ser importada por qualquer módulo.
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

function secret(): string | null {
  try {
    return (typeof process !== "undefined" && process.env?.["GUEST_PASS_SECRET"]) || null;
  } catch {
    return null;
  }
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function placePhotoSig(name: string): string | null {
  const k = secret();
  if (!k) return null;
  const enc = new TextEncoder();
  return b64url(hmac(sha256, enc.encode(k), enc.encode(`place-photo:${name}`))).slice(0, 32);
}

export function placePhotoUrl(name: string, w: number): string {
  const sig = placePhotoSig(name);
  return `/api/public/place-photo?name=${encodeURIComponent(name)}&w=${w}${sig ? `&sig=${sig}` : ""}`;
}

export function isValidPlacePhotoSig(name: string, sig: string | null): boolean {
  if (!sig) return false;
  const expected = placePhotoSig(name);
  if (!expected || expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
