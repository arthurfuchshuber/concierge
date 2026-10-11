/**
 * Bloqueios manuais de calendário feitos no ConciergeIA (100% API, sem iCal).
 *
 * Um bloqueio é uma linha em `property_reservations` com `source = 'manual'`
 * e `status = 'blocked'`. Ao criar/remover, recalculamos a disponibilidade
 * real de TODOS os anúncios ligados ao imóvel (inclusive gêmeos) e enviamos
 * via outbox ARI da Channex — Airbnb e PriceLabs fecham/reabrem juntos.
 * Imóveis ainda não conectados à Channex só guardam o bloqueio localmente.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

/** Reenvia a disponibilidade dos anúncios (e gêmeos) do imóvel. */
export async function pushPropertyAvailability(propertyId: string, userId: string | null) {
  const { allSyncTargets, syncRealAvailability } = await import("@/lib/channex-mapping.server");
  const { flushAriOutbox } = await import("@/lib/channex-ari.server");
  const all = await allSyncTargets();
  const primaries = all.filter((t) => t.propertyId === propertyId);
  if (!primaries.length) return { connected: false, ok: true };
  const siblingRts = new Set(primaries.map((t) => t.sibling?.roomTypeId).filter(Boolean) as string[]);
  const targets = all.filter((t) => t.propertyId === propertyId || siblingRts.has(t.roomTypeId));
  for (const t of targets) await syncRealAvailability(t, userId, 270, false);
  const flushed = await flushAriOutbox();
  return { connected: true, ok: flushed.batches.every((b) => b.ok) };
}

export async function createManualBlock(input: { propertyId: string; from: string; to: string; note?: string | null; userId: string | null }) {
  if (!(input.to > input.from)) throw new Error("A data final precisa ser depois da inicial.");
  const db = await admin();
  const { data, error } = await db
    .from("property_reservations")
    .insert({
      property_id: input.propertyId,
      source: "manual",
      external_uid: `manual-${crypto.randomUUID()}`,
      checkin_date: input.from,
      checkout_date: input.to,
      status: "blocked",
      raw_summary: input.note?.trim() || "Bloqueio manual",
      synced_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const push = await pushPropertyAvailability(input.propertyId, input.userId);
  return { id: data.id as string, ...push };
}

export async function removeManualBlock(input: { id: string; propertyId: string; userId: string | null }) {
  const db = await admin();
  const { error } = await db
    .from("property_reservations")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("property_id", input.propertyId)
    .eq("source", "manual");
  if (error) throw new Error(error.message);
  return pushPropertyAvailability(input.propertyId, input.userId);
}
