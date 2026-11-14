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

/**
 * MÉTODO DE ACESSO (14/11/2026, caso Jayr) — o imóvel tem alguma credencial de acesso AUTÔNOMO cadastrada?
 *
 * Só EXISTÊNCIA, nunca valor: o filtro roda no banco (`or(and(col não nulo, col não vazio), …)`) e a consulta
 * seleciona apenas `id`, então nenhum segredo chega à memória do servidor, ao modelo ou a log. Isto não é uma
 * liberação de credencial (não depende da D9, não emite nem exige `CredentialGrant`): responde "como se entra neste
 * imóvel?" para que a IA não presuma portaria/fechadura onde a entrega é presencial.
 *  - `autonomous`: há código de fechadura/cofre/portão, PIN ou instruções de acesso cadastrados;
 *  - `in_person`: nenhum desses — o padrão é entrega presencial de chaves pelo anfitrião/equipe;
 *  - `unknown`: leitura falhou (a IA não presume nenhuma modalidade).
 */
export type AccessMethod = "autonomous" | "in_person" | "unknown";

const ACCESS_EXISTENCE_COLUMNS = ["lock_code", "gate_code", "pin_code", "lock_instructions", "gate_instructions"] as const;

export async function fetchAccessMethod(
  turn: { propertyId: string },
  deps?: { db?: GuestAiDb },
): Promise<AccessMethod> {
  try {
    const db = deps?.db ?? (await getGuestAiDb());
    const present = ACCESS_EXISTENCE_COLUMNS.map((c) => `and(${c}.not.is.null,${c}.neq.)`).join(",");
    const { data, error } = await db.from("properties").select("id").eq("id", turn.propertyId).or(present).limit(1);
    if (error || !Array.isArray(data)) return "unknown";
    return data.length > 0 ? "autonomous" : "in_person";
  } catch {
    return "unknown";
  }
}
