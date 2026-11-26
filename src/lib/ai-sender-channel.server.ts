/**
 * Conta remetente da IA no Airbnb na hora da ENTREGA (26/11/2026, caso Carlos / "Casa Completa Próx. a
 * Avenida Turística"): a mensagem saiu como "Regina · Coanfitrião" com o seletor "Assina como" em
 * "Anfitrião Sigma", porque a entrega autônoma não pedia remetente estrito e a falha do envio direto caía
 * na Channex, que envia pela conta mapeada da thread.
 *
 * Resolve a conta esperada pela MESMA política do turno (`resolveSenderIdentity`: preferência do anfitrião
 * para o grupo do anúncio, senão a conta mapeada do anúncio). Qualquer coisa diferente de `resolved` ⇒
 * `unresolved`: a entrega não envia por conta nenhuma e a equipe é avisada.
 */
import { resolveSenderIdentity, type SenderIdentitySource } from "@/lib/guest-ai/policy/sender-identity";
import { readSenderIdentitySourceForThread } from "@/lib/sender-identity-source.server";

export type AiSenderResolution = { expectedChannelId: string } | { unresolved: string };

export async function resolveAiSenderChannel(
  admin: any,
  p: { threadId: string; propertyId: string },
  deps: { readSource?: (db: any, thread: string) => Promise<SenderIdentitySource>; now?: () => Date } = {},
): Promise<AiSenderResolution> {
  try {
    const { data: prop } = await admin.from("properties").select("owner_id").eq("id", p.propertyId).maybeSingle();
    const tenantId = (prop as { owner_id?: string | null } | null)?.owner_id ?? null;
    if (!tenantId) return { unresolved: "tenant_unknown" };
    const source = await (deps.readSource ?? readSenderIdentitySourceForThread)(admin, p.threadId);
    const id = resolveSenderIdentity({
      tenantId,
      propertyId: p.propertyId,
      surface: "airbnb",
      source,
      now: (deps.now?.() ?? new Date()).toISOString(),
    });
    if (id.status === "resolved" && id.senderChannelId) return { expectedChannelId: id.senderChannelId };
    return { unresolved: id.reason ?? id.status };
  } catch (e) {
    console.error("[ai-sender] conta remetente não resolvida", e instanceof Error ? e.message : e);
    return { unresolved: "lookup_failed" };
  }
}
