/**
 * Modo de operação da integração Airbnb (por conta inteira, nunca por imóvel).
 * - light: ConciergeIA só lê (reservas, financeiro, mensagens); calendário e preços na plataforma.
 * - full: ConciergeIA controla SOMENTE a disponibilidade; preços vêm da ferramenta de pricing.
 * Fase piloto: disponível apenas para as contas em MODE_PILOT_OWNERS.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const MODE_PILOT_OWNERS = new Set<string>(["25239e5b-1a66-46f1-b9a2-829c499cc366"]);
export type OperationMode = "light" | "full";

const CHANNEX_BASE = "https://app.channex.io/api/v1";

async function db(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function cx<T>(path: string): Promise<T> {
  const key = process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"];
  if (!key) throw new Error("Integração não configurada.");
  const res = await fetch(`${CHANNEX_BASE}${path}`, { headers: { "user-api-key": key, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Falha na integração (${res.status}).`);
  return (await res.json()) as T;
}

export function assertPilot(ownerId: string) {
  if (!MODE_PILOT_OWNERS.has(ownerId)) throw new Error("Recurso ainda não liberado para esta conta.");
}

export async function getAccountMode(ownerId: string) {
  const { data } = await (await db()).from("channex_account_settings").select("*").eq("owner_id", ownerId).maybeSingle();
  return {
    mode: (data?.operation_mode ?? "light") as OperationMode,
    pricingValidatedAt: (data?.pricing_validated_at ?? null) as string | null,
    twinPromptAnsweredAt: (data?.twin_prompt_answered_at ?? null) as string | null,
  };
}

/** Normaliza título → tokens relevantes (sem palavras genéricas) e número da unidade. */
const STOP = new Set(["de", "da", "do", "das", "dos", "com", "e", "a", "o", "em", "no", "na", "prox", "proximo", "completo", "completa", "studio", "apartamento", "apto", "casa", "flat", "suite", "centro"]);
function signature(title: string) {
  const t = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const num = t.match(/\b(\d{2,4})\b/)?.[1] ?? null;
  const tokens = new Set(t.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)));
  return { num, tokens };
}

export type TwinSuggestion = { channelId: string; a: { listingId: string; title: string }; b: { listingId: string; title: string }; reason: string };

/** Sugere pares prováveis de anúncios gêmeos (mesmo canal) ainda não unidos. Apenas leitura. */
export async function detectTwinCandidates(): Promise<TwinSuggestion[]> {
  const { listTwinLinks } = await import("@/lib/channex-twins.server");
  const links = await listTwinLinks().catch(() => [] as any[]);
  const { LISTING_ALIASES } = await import("@/lib/channex-listing.server");
  const linked = new Set<string>([...links.flatMap((l: any) => [String(l.primary_listing_id), String(l.twin_listing_id)]), ...Object.keys(LISTING_ALIASES), ...Object.values(LISTING_ALIASES)]);

  const chans = await cx<{ data: any[] }>("/channels?pagination[limit]=100");
  const out: TwinSuggestion[] = [];
  for (const c of chans.data ?? []) {
    if (c.attributes?.channel !== "AirBNB") continue;
    const res = await cx<{ data: any }>(`/channels/${c.id}/action/listings`).catch(() => null);
    const items = ((res?.data?.listing_id_dictionary?.values ?? []) as any[])
      .map((l) => ({ listingId: String(l.id), title: String(l.title ?? l.id) }))
      .filter((l) => !linked.has(l.listingId));
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const A = signature(items[i]!.title);
        const B = signature(items[j]!.title);
        const shared = [...A.tokens].filter((w) => B.tokens.has(w));
        if (A.num && A.num === B.num) out.push({ channelId: c.id, a: items[i]!, b: items[j]!, reason: `Mesmo número de unidade (${A.num})` });
        else if (!A.num && !B.num && shared.length >= 3) out.push({ channelId: c.id, a: items[i]!, b: items[j]!, reason: "Títulos muito parecidos" });
      }
    }
  }
  return out;
}

/** Confere se a ferramenta de pricing já enviou diárias para todos os anúncios mapeados (próximos 30 dias). */
export async function validatePricing() {
  const { allSyncTargets } = await import("@/lib/channex-mapping.server");
  const targets = await allSyncTargets();
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 29 * 86_400_000).toISOString().slice(0, 10);
  const missing: string[] = [];
  const byProperty = new Map<string, string[]>();
  for (const t of targets) byProperty.set(t.channexPropertyId, [...(byProperty.get(t.channexPropertyId) ?? []), t.ratePlanId]);
  for (const [pid, plans] of byProperty) {
    const r = await cx<{ data: Record<string, Record<string, { rate?: string | number }>> }>(
      `/restrictions?filter[property_id]=${pid}&filter[date][gte]=${start}&filter[date][lte]=${end}&filter[restrictions]=rate`,
    ).catch(() => ({ data: {} as Record<string, Record<string, { rate?: string | number }>> }));
    for (const rp of plans) {
      const days = r.data?.[rp] ?? {};
      const priced = Object.values(days).filter((d) => Number(d?.rate ?? 0) > 0).length;
      if (priced < 30) missing.push(rp);
    }
  }
  return { ok: missing.length === 0, checked: targets.length, missing: missing.length };
}

export async function saveAccountMode(ownerId: string, patch: Record<string, unknown>, userId: string) {
  const { error } = await (await db())
    .from("channex_account_settings")
    .upsert({ owner_id: ownerId, ...patch, changed_by: userId }, { onConflict: "owner_id" });
  if (error) throw new Error(error.message);
}
