/**
 * Modo de operação da integração Airbnb (por conta inteira, nunca por imóvel).
 * - light: ConciergeIA só lê (reservas, financeiro, mensagens); calendário e preços na plataforma.
 * - full: ConciergeIA controla SOMENTE a disponibilidade; preços vêm da ferramenta de pricing.
 * Liberado para toda conta conectada (acesso já exigido por requireAdmin + conta autorizada).
 * O Full continua só com preços validados (`validatePricing`: checked > 0 e missing === 0).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

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

export async function getAccountMode(ownerId: string) {
  const { data } = await (await db()).from("channex_account_settings").select("*").eq("owner_id", ownerId).maybeSingle();
  return {
    mode: (data?.operation_mode ?? "light") as OperationMode,
    pricingValidatedAt: (data?.pricing_validated_at ?? null) as string | null,
    twinPromptAnsweredAt: (data?.twin_prompt_answered_at ?? null) as string | null,
    modeChangedAt: (data?.mode_changed_at ?? null) as string | null,
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
export async function detectTwinCandidates(ownerId: string): Promise<TwinSuggestion[]> {
  const { listTwinLinks } = await import("@/lib/channex-twins.server");
  const links = await listTwinLinks().catch(() => [] as any[]);
  const { LISTING_ALIASES } = await import("@/lib/channex-listing.server");
  const linked = new Set<string>([...links.flatMap((l: any) => [String(l.primary_listing_id), String(l.twin_listing_id)]), ...Object.keys(LISTING_ALIASES), ...Object.values(LISTING_ALIASES)]);

  const chans = await cx<{ data: any[] }>("/channels?pagination[limit]=100");
  // Só os canais desta conta: a chave da Channex enxerga os de todos os clientes.
  const { accountChannelScope } = await import("@/lib/airbnb-accounts.server");
  const scope = await accountChannelScope(ownerId);
  const out: TwinSuggestion[] = [];
  for (const c of chans.data ?? []) {
    if (c.attributes?.channel !== "AirBNB") continue;
    if (scope && !scope.has(String(c.id))) continue;
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

/**
 * Confere se a ferramenta de pricing já enviou diárias para os anúncios ATIVOS da conta
 * (próximos 30 dias). Só leitura. O Full só pode ser liberado com `checked > 0` e `missing === 0`:
 * conta sem nenhum anúncio para conferir NÃO libera o Full. Anúncio sem tarifa na Channex
 * (sem rate plan) conta como faltando.
 */
export async function validatePricing(ownerId: string) {
  const d = await db();
  const [{ data: rows }, { data: twins }] = await Promise.all([
    d
      .from("property_listing_raw_data")
      .select("channex_property_id, channex_rate_plan_id")
      .eq("owner_id", ownerId)
      .is("sync_paused_at", null)
      .not("airbnb_listing_id", "is", null),
    d
      .from("channex_twin_links")
      .select("twin_channex_property_id, twin_rate_plan_id")
      .eq("owner_id", ownerId)
      .eq("status", "active"),
  ]);
  const targets: Array<{ propertyId: string | null; ratePlanId: string | null }> = [
    ...((rows ?? []) as any[]).map((r) => ({ propertyId: r.channex_property_id, ratePlanId: r.channex_rate_plan_id })),
    ...((twins ?? []) as any[]).map((t) => ({ propertyId: t.twin_channex_property_id, ratePlanId: t.twin_rate_plan_id })),
  ];
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 29 * 86_400_000).toISOString().slice(0, 10);
  let missing = 0;
  const cache = new Map<string, Record<string, Record<string, { rate?: string | number }>>>();
  for (const t of targets) {
    if (!t.propertyId || !t.ratePlanId) {
      missing += 1;
      continue;
    }
    if (!cache.has(t.propertyId)) {
      const r = await cx<{ data: Record<string, Record<string, { rate?: string | number }>> }>(
        `/restrictions?filter[property_id]=${t.propertyId}&filter[date][gte]=${start}&filter[date][lte]=${end}&filter[restrictions]=rate`,
      ).catch(() => ({ data: {} as Record<string, Record<string, { rate?: string | number }>> }));
      cache.set(t.propertyId, r.data ?? {});
    }
    const days = cache.get(t.propertyId)?.[t.ratePlanId] ?? {};
    const priced = Object.values(days).filter((x) => Number(x?.rate ?? 0) > 0).length;
    if (priced < 30) missing += 1;
  }
  const checked = targets.length;
  return { ok: checked > 0 && missing === 0, checked, missing };
}

export async function saveAccountMode(ownerId: string, patch: Record<string, unknown>, userId: string) {
  const { error } = await (await db())
    .from("channex_account_settings")
    .upsert({ owner_id: ownerId, ...patch, changed_by: userId }, { onConflict: "owner_id" });
  if (error) throw new Error(error.message);
}
