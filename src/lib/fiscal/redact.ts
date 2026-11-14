import { createHash } from "node:crypto";

const SECRET_KEY = /token|senha|password|secret|certificado|authorization|api[_-]?key/i;
const TAX_ID_KEY = /cpf|cnpj/i;

function maskDigits(v: string): string {
  const d = v.replace(/\D/g, "");
  return d.length >= 8 ? `${d.slice(0, 3)}***${d.slice(-2)}` : "***";
}

/** Cópia profunda sem segredos e com CPF/CNPJ mascarados. Usada em evidências e logs. */
export function redactBody(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redactBody(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : TAX_ID_KEY.test(k) && typeof v === "string" ? maskDigits(v) : redactBody(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 2000) return `${value.slice(0, 2000)}…[truncated]`;
  return value;
}

export function hashBody(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value ?? null)).digest("hex");
}
