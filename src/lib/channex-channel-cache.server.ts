/**
 * Leitura de detalhes de canal da Channex (`GET /channels/:id`) com cache.
 *
 * 24/10/2026: a Channex reclamou de ~28,6 mil `Channels.FindScenario` em 1 hora — telas e rotinas
 * liam o canal ao vivo a cada atualização. Agora a ordem é: espelho no banco (`channex_raw_records`,
 * atualizado pelo sync de entidades a cada 5 min) → cache em memória → API (com pedidos simultâneos
 * unificados), e a resposta da API volta para o espelho. Escritas (PUT/mapeamento) chamam
 * `refreshChannel` para que a leitura seguinte já veja o estado novo.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const B = "https://app.channex.io/api/v1";
export const CHANNEL_CACHE_MAX_AGE_MS = 10 * 60_000;

const mem = new Map<string, { at: number; data: any }>();
const inflight = new Map<string, Promise<any>>();

async function fetchChannel(id: string): Promise<any> {
  const key = process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"];
  if (!key) throw new Error("Chave Channex ausente.");
  const res = await fetch(`${B}/channels/${encodeURIComponent(id)}`, {
    headers: { "user-api-key": key, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Channex ${res.status}: ${text.slice(0, 200)}`);
  const data = (text ? JSON.parse(text) : null)?.data ?? null;
  mem.set(id, { at: Date.now(), data });
  if (data) {
    const { saveRawRecords } = await import("@/lib/channex-raw.server");
    await saveRawRecords([{ entity_type: "channel", channex_id: id, payload: data, source: "api" } as any]).catch(() => 0);
  }
  return data;
}

/** Busca na API agora (unificando pedidos simultâneos) e atualiza espelho + memória. */
export function refreshChannel(id: string): Promise<any> {
  const cur = inflight.get(id);
  if (cur) return cur;
  const p = fetchChannel(id).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

/** Devolve `{ data }` no mesmo formato de `GET /channels/:id`. */
export async function getChannelCached(id: string, maxAgeMs = CHANNEL_CACHE_MAX_AGE_MS): Promise<{ data: any }> {
  const m = mem.get(id);
  if (m && Date.now() - m.at < maxAgeMs) return { data: m.data };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await (supabaseAdmin as any)
      .from("channex_raw_records")
      .select("payload, last_synced_at")
      .eq("entity_type", "channel")
      .eq("channex_id", id)
      .maybeSingle();
    const at = row?.last_synced_at ? new Date(row.last_synced_at).getTime() : 0;
    if (row?.payload && Date.now() - at < maxAgeMs) {
      mem.set(id, { at, data: row.payload });
      return { data: row.payload };
    }
  } catch {
    /* espelho indisponível → API */
  }
  return { data: await refreshChannel(id) };
}
