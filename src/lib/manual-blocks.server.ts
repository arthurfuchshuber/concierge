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

const todayUTC = () => new Date().toISOString().slice(0, 10);

/** Reserva ativa dentro de [from, to) no banco OU na Channex (gêmeos inclusos). Devolve a mensagem de erro, ou null. */
async function findActiveConflict(db: any, propertyId: string, from: string, to: string): Promise<string | null> {
  const { activeStays, firstBlockConflict, conflictMessage, firstNightIn, ddmmISO } = await import("@/lib/manual-block-conflict");
  const { data, error } = await db
    .from("property_reservations")
    .select("checkin_date, checkout_date, status, source")
    .eq("property_id", propertyId)
    .lt("checkin_date", to)
    .gt("checkout_date", from);
  if (error) throw new Error(error.message);
  const hit = firstBlockConflict(activeStays((data ?? []) as any[]), from, to);
  if (hit) return `Não é possível bloquear — ${conflictMessage(hit, from)}`;
  // Reservas que ainda só existem na Channex (ex.: do anúncio gêmeo) também travam.
  try {
    const { channexBookedNights } = await import("@/lib/channex-mapping.server");
    const night = firstNightIn(await channexBookedNights(propertyId), from, to);
    if (night) return `Não é possível bloquear — O dia ${ddmmISO(night)} já tem reserva ativa.`;
  } catch (e) {
    console.error("[manual-block] Channex indisponível na checagem de conflito; vale a checagem do banco", e);
  }
  return null;
}

export async function createManualBlock(input: { propertyId: string; from: string; to: string; note?: string | null; userId: string | null }) {
  const { validateBlockDates, planBlockMerge } = await import("@/lib/manual-block-conflict");
  const invalid = validateBlockDates(input.from, input.to, todayUTC());
  if (invalid) throw new Error(invalid);
  const db = await admin();
  const clash = await findActiveConflict(db, input.propertyId, input.from, input.to);
  if (clash) throw new Error(clash);

  // Bloqueios que já existem: cobre tudo → não duplica; encosta/sobrepõe → vira um só.
  const { data: existingRows, error: exErr } = await db
    .from("property_reservations")
    .select("id, checkin_date, checkout_date")
    .eq("property_id", input.propertyId)
    .eq("source", "manual")
    .eq("status", "blocked")
    .lte("checkin_date", input.to)
    .gte("checkout_date", input.from);
  if (exErr) throw new Error(exErr.message);
  const plan = planBlockMerge(
    ((existingRows ?? []) as any[]).map((r) => ({ id: r.id as string, from: r.checkin_date as string, to: r.checkout_date as string })),
    input.from,
    input.to,
  );
  if (plan.coveringId) return { id: plan.coveringId, merged: true, ...(await safePush(input.propertyId, input.userId)) };

  const { data, error } = await db
    .from("property_reservations")
    .insert({
      property_id: input.propertyId,
      source: "manual",
      external_uid: `manual-${crypto.randomUUID()}`,
      checkin_date: plan.from,
      checkout_date: plan.to,
      status: "blocked",
      raw_summary: input.note?.trim() || "Bloqueio manual",
      synced_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const newId = data.id as string;

  // Reconferência depois de gravar: se uma reserva entrou no meio-tempo (duas pessoas ao mesmo
  // tempo), desfaz este bloqueio em vez de fechar a data por cima de hóspede.
  const late = await findActiveConflict(db, input.propertyId, plan.from, plan.to).catch(() => null);
  if (late) {
    await db.from("property_reservations").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", newId);
    throw new Error(late);
  }
  if (plan.absorbIds.length) {
    await db
      .from("property_reservations")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .in("id", plan.absorbIds)
      .eq("property_id", input.propertyId)
      .eq("source", "manual");
  }
  return { id: newId, merged: plan.absorbIds.length > 0, ...(await safePush(input.propertyId, input.userId)) };
}

/** O bloqueio já está salvo: falha ao avisar os anúncios vira `ok: false` (a tela avisa), nunca erro. */
async function safePush(propertyId: string, userId: string | null) {
  try {
    return await pushPropertyAvailability(propertyId, userId);
  } catch (e) {
    console.error("[manual-block] envio aos anúncios falhou", e);
    return { connected: true, ok: false };
  }
}

export async function removeManualBlock(input: { id: string; propertyId: string; userId: string | null }) {
  const db = await admin();
  const { error } = await db
    .from("property_reservations")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("property_id", input.propertyId)
    .eq("source", "manual")
    .eq("status", "blocked");
  if (error) throw new Error(error.message);
  return safePush(input.propertyId, input.userId);
}
