/**
 * CREDENCIAIS — o único ponto que lê colunas de segredo de `properties`.
 *
 * Regras (D9, seção 6.6 do documento):
 *  - só aceita um `CredentialGrant` EMITIDO pela política (WeakSet em `trust.ts`) e ainda válido;
 *  - NÃO aceita `propertyId` de lugar nenhum: o imóvel vem do próprio grant, que nasce de um
 *    turno validado e da MESMA reserva avaliada;
 *  - nenhuma credencial vai para log, trace, métrica ou mensagem de erro: os erros daqui são
 *    códigos fixos, e o valor lido não é atribuído a nenhuma variável de diagnóstico;
 *  - falha na consulta = `null` (sem credenciais), nunca um valor parcial presumido.
 */
import type { GuestCredentials } from "@/lib/guest-ai/types";
import { assertGrantUsable, type CredentialGrant } from "@/lib/guest-ai/policy/grants";
import { getGuestAiDb, type GuestAiDb } from "./client.server";
import { PROPERTY_CREDENTIAL_COLUMNS, cols } from "./projections";

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function fetchSensitiveCredentials(
  grant: CredentialGrant,
  deps?: { db?: GuestAiDb; nowMs?: number },
): Promise<GuestCredentials | null> {
  assertGrantUsable(grant, deps?.nowMs ?? Date.now());
  const db = deps?.db ?? (await getGuestAiDb());

  let row: Record<string, unknown> | null = null;
  try {
    const { data, error } = await db
      .from("properties")
      .select(cols(PROPERTY_CREDENTIAL_COLUMNS))
      .eq("id", grant.propertyId)
      .maybeSingle();
    if (error) return null;
    row = (data as Record<string, unknown> | null) ?? null;
  } catch {
    return null;
  }
  if (!row) return null;

  const instructions = [s(row["gate_instructions"]), s(row["lock_instructions"])].filter(Boolean).join("\n\n");
  // `pin_code` é o PIN do GUIA: só tem sentido quando o imóvel é de acesso por PIN.
  const pin = row["access_mode"] === "pin" ? s(row["pin_code"]) : null;
  return {
    lockCode: s(row["lock_code"]),
    gateCode: s(row["gate_code"]),
    pinCode: pin,
    wifiPassword: s(row["wifi_password"]),
    accessInstructions: instructions || null,
  };
}
