/**
 * Conta remetente da IA no Airbnb ("carimbo"), escolhida por anúncio.
 * A escolha é só uma preferência gravada por anúncio (e gêmeos): o envio sai
 * direto no Airbnb com o acesso da conta escolhida (`airbnb-direct-sender`).
 * O anúncio continua mapeado na Channex como está — preços, calendário e
 * PriceLabs nunca são tocados.
 */
import { getChannelCached } from "@/lib/channex-channel-cache.server";
const B = "https://app.channex.io/api/v1";

function headers() {
  const key = process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"];
  if (!key) throw new Error("Chave Channex ausente.");
  return { "user-api-key": key, "Content-Type": "application/json", Accept: "application/json" };
}
async function cx<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${B}${path}`, { ...init, headers: headers() });
  const text = await res.text();
  if (!res.ok) throw new Error(`Channex ${res.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Chan = { id: string; title: string; email?: string | null; properties: string[]; mappings: Array<{ id: string; ratePlanId: string; listingId: string }>; catalog: Set<string> };

/**
 * E-mail da conta Airbnb (só para distinguir contas de mesmo nome no seletor "Assina como").
 * Lido ao vivo com o token do canal (`settings.tokens`) e guardado SÓ em memória, com validade: o token
 * nunca é gravado nem sai do servidor — o front recebe apenas o e-mail. Falha da API do Airbnb → `null`
 * (o seletor continua mostrando só o título), e a falha também é lembrada por pouco tempo para não
 * insistir a cada leitura.
 */
const EMAIL_OK_TTL_MS = 6 * 60 * 60 * 1000;
const EMAIL_FAIL_TTL_MS = 5 * 60 * 1000;
const emailCache = new Map<string, { email: string | null; at: number }>();

async function airbnbAccountEmail(channelId: string, settings: any): Promise<string | null> {
  const userId = settings?.tokens?.user_id ? String(settings.tokens.user_id) : "";
  const token = settings?.tokens?.access_token ? String(settings.tokens.access_token) : "";
  if (!userId || !token || settings?.token_invalid) return null;
  const key = `${channelId}:${userId}`;
  const hit = emailCache.get(key);
  if (hit && Date.now() - hit.at < (hit.email ? EMAIL_OK_TTL_MS : EMAIL_FAIL_TTL_MS)) return hit.email;
  let email: string | null = null;
  try {
    const res = await fetch(`https://api.airbnb.com/v2/users/${encodeURIComponent(userId)}?_format=v1_legacy_for_p3`, {
      headers: { "X-Airbnb-OAuth-Token": token, Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const body = (await res.json()) as { user?: { email?: unknown } };
      const e = body?.user?.email;
      email = typeof e === "string" && e.includes("@") ? e.trim() : null;
    }
  } catch {
    email = null;
  }
  emailCache.set(key, { email, at: Date.now() });
  return email;
}

async function loadAirbnbChannels(ownerId: string, withEmail = false): Promise<Chan[]> {
  const list = await cx<{ data: any[] }>("/channels?pagination[limit]=100");
  // Só os canais da conta: a chave da Channex enxerga os de todos os clientes.
  const { accountChannelScope } = await import("@/lib/airbnb-accounts.server");
  const scope = await accountChannelScope(ownerId);
  const out: Chan[] = [];
  for (const c of list.data ?? []) {
    if (c.attributes?.channel !== "AirBNB") continue;
    if (scope && !scope.has(String(c.id))) continue;
    const [full, listings] = await Promise.all([
      getChannelCached(String(c.id)),
      cx<{ data: any }>(`/channels/${c.id}/action/listings`).catch(() => null),
    ]);
    const a = full.data?.attributes ?? {};
    out.push({
      id: c.id,
      title: String(a.title ?? c.attributes?.title ?? "Conta Airbnb"),
      email: withEmail ? await airbnbAccountEmail(String(c.id), a.settings) : null,
      properties: a.properties ?? [],
      mappings: (a.rate_plans ?? []).map((m: any) => ({ id: m.id, ratePlanId: m.rate_plan_id, listingId: String(m.settings?.listing_id ?? "") })),
      catalog: new Set(((listings?.data?.listing_id_dictionary?.values ?? []) as any[]).map((l) => String(l.id))),
    });
  }
  return out;
}

/** Anúncios do dono agrupados por imóvel (principal + gêmeos). */
async function ownerGroups(db: any, ownerId: string) {
  const [{ data: raws }, { data: twins }] = await Promise.all([
    db.from("property_listing_raw_data").select("property_id, airbnb_listing_id, properties!inner(owner_id)").eq("properties.owner_id", ownerId),
    db.from("channex_twin_links").select("property_id, twin_listing_id, primary_listing_id").eq("owner_id", ownerId).eq("status", "active"),
  ]);
  const groups = new Map<string, Set<string>>();
  const add = (pid: string, id: unknown) => {
    if (!pid || !id) return;
    if (!groups.has(pid)) groups.set(pid, new Set());
    groups.get(pid)!.add(String(id));
  };
  for (const r of raws ?? []) add(r.property_id, r.airbnb_listing_id);
  for (const t of twins ?? []) { add(t.property_id, t.primary_listing_id); add(t.property_id, t.twin_listing_id); }
  return groups;
}

type SenderOption = { channelId: string; title: string; email?: string | null; hasAccess: boolean };
export type ListingSender = { listingId: string; currentChannelId: string | null; options: SenderOption[] };

/** Remetente atual e contas possíveis (com acesso a TODOS os anúncios do grupo) por anúncio. */
export async function listListingSenders(ownerId: string): Promise<ListingSender[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const groups = await ownerGroups(supabaseAdmin, ownerId);
  const chans = await loadAirbnbChannels(ownerId, true);
  const { readSenderPrefs } = await import("@/lib/airbnb-direct-sender.server");
  const prefs = await readSenderPrefs(supabaseAdmin, [...groups.values()].flatMap((g) => [...g]));
  const out: ListingSender[] = [];
  for (const ids of groups.values()) {
    const group = [...ids];
    // Todas as contas Airbnb conectadas aparecem (principal + coanfitriões);
    // as que ainda não enxergam todo o grupo vêm marcadas sem acesso.
    const options = chans.map((c) => ({ channelId: c.id, title: c.title, email: c.email ?? null, hasAccess: true }));
    for (const l of group) {
      const cur = chans.find((c) => c.mappings.some((m) => m.listingId === l));
      out.push({ listingId: l, currentChannelId: prefs.get(l) ?? cur?.id ?? null, options });
    }
  }
  return out;
}

/**
 * Define a conta que assina as respostas do anúncio e de todos os seus gêmeos.
 * Instantâneo: só grava a preferência; nada é remapeado na Channex.
 */
export async function switchListingSender(ownerId: string, listingId: string | string[], targetChannelId: string, userId = ownerId) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const groups = await ownerGroups(db, ownerId);
  const set = new Set<string>();
  for (const id of Array.isArray(listingId) ? listingId : [listingId]) {
    const g = [...groups.values()].find((x) => x.has(id));
    if (!g) throw new Error("Anúncio não pertence à sua conta.");
    g.forEach((l) => set.add(l));
  }
  if (!set.size) throw new Error("Nenhum anúncio selecionado.");
  const target = (await loadAirbnbChannels(ownerId)).find((c) => c.id === targetChannelId);
  if (!target) throw new Error("Conta Airbnb não encontrada.");
  const { writeSenderPrefs } = await import("@/lib/airbnb-direct-sender.server");
  await writeSenderPrefs(db, ownerId, userId, [...set], target.id);
  return { changed: set.size, title: target.title };
}
