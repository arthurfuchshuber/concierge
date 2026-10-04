/**
 * Fim da vida da LIXEIRA OCULTA dos registros (04/10/2026): o que passou de
 * 30 dias (`purge_at`) é apagado de vez — a linha da lixeira e os arquivos do
 * storage. Um arquivo só sai se nenhum registro vivo aponta para ele.
 */
type AnyAdmin = { from: (table: string) => any; storage: any };

const BUCKET = "reservation-records";

export async function purgeExpiredRecordTrash(admin: AnyAdmin, batch = 200) {
  const { data: due, error } = await admin
    .from("reservation_records_trash")
    .select("id, storage_paths")
    .lte("purge_at", new Date().toISOString())
    .order("purge_at", { ascending: true })
    .limit(batch);
  if (error) throw new Error(error.message);

  let purged = 0;
  let files = 0;
  for (const row of (due ?? []) as Array<{ id: string; storage_paths: string[] | null }>) {
    const paths = (row.storage_paths ?? []).filter(Boolean);
    if (paths.length > 0) {
      const { data: alive } = await admin
        .from("reservation_records")
        .select("storage_path")
        .in("storage_path", paths);
      const stillUsed = new Set(
        ((alive ?? []) as Array<{ storage_path: string | null }>).map((r) => r.storage_path),
      );
      const toRemove = paths.filter((p) => !stillUsed.has(p));
      if (toRemove.length > 0) {
        const { error: rmErr } = await admin.storage.from(BUCKET).remove(toRemove);
        // Falhou no storage: mantém a linha da lixeira para tentar amanhã.
        if (rmErr) continue;
        files += toRemove.length;
      }
    }
    const { error: delErr } = await admin.from("reservation_records_trash").delete().eq("id", row.id);
    if (!delErr) purged += 1;
  }
  return { purged, files };
}
