/**
 * Operational Memory Layer — memória específica da operação.
 *
 * Registra chamados reais: solicitação, categoria, imóvel, prestador,
 * solução aplicada, tempo de resolução, recorrência e satisfação. É a base
 * para respostas futuras fundamentadas em histórico real ("esse problema já
 * aconteceu neste imóvel e foi resolvido assim").
 *
 * Preparado para evoluir por prestador, proprietário e equipe operacional.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OperationalRecord } from "./types";

type Admin = SupabaseClient;

export type OperationalCategory =
  | "manutencao"
  | "limpeza"
  | "acesso"
  | "reserva"
  | "cidade"
  | "financeiro"
  | "outro";

function rowToOperational(row: Record<string, unknown>): OperationalRecord {
  return {
    id: String(row.id),
    category: String(row.category ?? "outro"),
    request: String(row.request ?? ""),
    providerName: (row.provider_name as string) ?? null,
    resolution: (row.resolution as string) ?? null,
    resolutionMinutes: row.resolution_minutes == null ? null : Number(row.resolution_minutes),
    recurrenceCount: Number(row.recurrence_count ?? 1),
    satisfaction: (row.satisfaction as string) ?? null,
    status: String(row.status ?? "open"),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    resolvedAt: (row.resolved_at as string) ?? null,
  };
}

/**
 * Abre (ou reforça) um chamado operacional. Se um chamado semelhante e ainda
 * aberto existir para o mesmo imóvel, incrementa a recorrência em vez de
 * duplicar o registro.
 */
export async function recordOperationalRequest(params: {
  supabase: Admin;
  ownerId: string;
  propertyId: string | null;
  conversationId?: string | null;
  guestKey?: string | null;
  guestName?: string | null;
  category: OperationalCategory | string;
  request: string;
  metadata?: Record<string, unknown>;
}): Promise<string | null> {
  const { supabase } = params;
  try {
    const since = new Date(Date.now() - 14 * 86400000).toISOString();
    const { data: existing } = await supabase
      .from("ai_operational_memory")
      .select("id, recurrence_count")
      .eq("owner_id", params.ownerId)
      .eq("category", params.category)
      .eq("property_id", params.propertyId as string)
      .in("status", ["open", "in_progress"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      await supabase
        .from("ai_operational_memory")
        .update({ recurrence_count: Number(existing.recurrence_count ?? 1) + 1 })
        .eq("id", existing.id);
      return String(existing.id);
    }

    const { data, error } = await supabase
      .from("ai_operational_memory")
      .insert({
        owner_id: params.ownerId,
        tenant_id: params.ownerId,
        property_id: params.propertyId,
        conversation_id: params.conversationId ?? null,
        guest_key: params.guestKey ?? null,
        guest_name: params.guestName ?? null,
        category: params.category,
        request: params.request.slice(0, 1000),
        status: "open",
        metadata: (params.metadata ?? {}) as never,
      })
      .select("id")
      .maybeSingle();
    if (error) throw error;
    return data?.id ? String(data.id) : null;
  } catch (err) {
    console.error("[operational-memory] registro falhou", err);
    return null;
  }
}

/** Fecha um chamado registrando a solução aplicada e o tempo de resolução. */
export async function resolveOperationalRequest(params: {
  supabase: Admin;
  id: string;
  resolution: string;
  providerId?: string | null;
  providerName?: string | null;
  satisfaction?: string | null;
  status?: "resolved" | "cancelled";
}): Promise<void> {
  try {
    const { data: current } = await params.supabase
      .from("ai_operational_memory")
      .select("created_at")
      .eq("id", params.id)
      .maybeSingle();
    const minutes = current?.created_at
      ? Math.max(1, Math.round((Date.now() - Date.parse(String(current.created_at))) / 60000))
      : null;

    await params.supabase
      .from("ai_operational_memory")
      .update({
        resolution: params.resolution.slice(0, 2000),
        provider_id: params.providerId ?? null,
        provider_name: params.providerName ?? null,
        satisfaction: params.satisfaction ?? null,
        status: params.status ?? "resolved",
        resolution_minutes: minutes,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", params.id);
  } catch (err) {
    console.error("[operational-memory] resolução falhou", err);
  }
}

/** Histórico operacional relevante do imóvel (e do hóspede, quando houver). */
export async function loadOperationalContext(params: {
  supabase: Admin;
  ownerId: string;
  propertyId: string | null;
  guestKey?: string | null;
  category?: string | null;
  limit?: number;
}): Promise<{ records: OperationalRecord[]; openCount: number; recurring: string[] }> {
  try {
    let query = params.supabase
      .from("ai_operational_memory")
      .select(
        "id, category, request, provider_name, resolution, resolution_minutes, recurrence_count, satisfaction, status, created_at, resolved_at",
      )
      .eq("owner_id", params.ownerId)
      .order("created_at", { ascending: false })
      .limit(params.limit ?? 8);
    if (params.propertyId) query = query.eq("property_id", params.propertyId);

    const { data } = await query;
    const records = ((data ?? []) as Array<Record<string, unknown>>).map(rowToOperational);
    const openCount = records.filter((r) => r.status === "open" || r.status === "in_progress").length;
    const recurring = Array.from(
      new Set(records.filter((r) => r.recurrenceCount > 1).map((r) => r.category)),
    );
    return { records, openCount, recurring };
  } catch (err) {
    console.error("[operational-memory] contexto falhou", err);
    return { records: [], openCount: 0, recurring: [] };
  }
}

export function renderOperational(records: OperationalRecord[]): string {
  if (!records.length) return "(sem histórico operacional registrado)";
  return records
    .slice(0, 6)
    .map((r) => {
      const when = new Date(r.createdAt).toLocaleDateString("pt-BR");
      const parts = [`${when} — [${r.category}] ${r.request}`];
      if (r.resolution) parts.push(`solução: ${r.resolution}`);
      if (r.providerName) parts.push(`prestador: ${r.providerName}`);
      if (r.resolutionMinutes) parts.push(`resolvido em ~${r.resolutionMinutes} min`);
      if (r.recurrenceCount > 1) parts.push(`recorrência: ${r.recurrenceCount}x`);
      parts.push(`status: ${r.status}`);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");
}
