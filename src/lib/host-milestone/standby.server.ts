/**
 * Check-in em ESPERA (14/11/2026): o anfitrião confirmou o check-in, mas o imóvel ainda tem limpeza (ou saída)
 * da estadia anterior em aberto. A esteira é sequencial, então o card NÃO é concluído: fica pendente com a nota
 * `HOST_CHECKIN_STANDBY_NOTE`. Quando a limpeza do imóvel termina, `releaseStandbyCheckins` conclui sozinho
 * pela mesma rotina do painel (`runAdvanceArrival`). Nunca lança.
 */
export const HOST_CHECKIN_STANDBY_NOTE = "Check-in confirmado pelo anfitrião — aguardando a limpeza do imóvel";

export async function markCheckinStandby(propertyId: string, reservationId: string): Promise<boolean> {
  try {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { error } = await admin
      .from("guest_arrival_status")
      .upsert(
        { property_id: propertyId, reservation_id: reservationId, kind: "checkin", status: "pending", note: HOST_CHECKIN_STANDBY_NOTE },
        { onConflict: "reservation_id,kind" },
      );
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    console.error("[checkin-standby] falha ao marcar", e instanceof Error ? e.message : "erro");
    return false;
  }
}

export async function releaseStandbyCheckins(propertyId: string): Promise<number> {
  try {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data } = await admin
      .from("guest_arrival_status")
      .select("reservation_id, status, done_at")
      .eq("property_id", propertyId)
      .eq("kind", "checkin")
      .eq("note", HOST_CHECKIN_STANDBY_NOTE);
    const rows = ((data ?? []) as Array<{ reservation_id: string | null; status: string | null; done_at: string | null }>)
      .filter((r) => r.reservation_id && r.status !== "done" && !r.done_at);
    if (!rows.length) return 0;
    const { runAdvanceArrival } = await import("@/lib/dashboard.functions");
    let n = 0;
    for (const r of rows) {
      try {
        await runAdvanceArrival(admin as never, { reservationId: r.reservation_id!, from: "checkin" } as never, { origin: "ai" });
        n++;
      } catch {
        // outra trava ainda segura o imóvel: continua em espera até a próxima liberação
      }
    }
    return n;
  } catch (e) {
    console.error("[checkin-standby] falha ao liberar", e instanceof Error ? e.message : "erro");
    return 0;
  }
}
