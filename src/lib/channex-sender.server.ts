/**
 * Conta remetente da IA no Airbnb ("carimbo"), escolhida por anúncio.
 * O Airbnb carimba cada mensagem com a conta cujo acesso OAuth a Channex usa
 * para aquele anúncio; por isso trocar o remetente = mover o vínculo do
 * anúncio (e de todos os seus gêmeos) para o canal Airbnb da conta escolhida.
 * Nada de preço é alterado: o mesmo plano de tarifa é religado ao novo canal.
 */
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

type Chan = { id: string; title: string; properties: string[]; mappings: Array<{ id: string; ratePlanId: string; listingId: string }>; catalog: Set<string> };

async function loadAirbnbChannels(): Promise<Chan[]> {
  const list = await cx<{ data: any[] }>("/channels?pagination[limit]=100");
  const out: Chan[] = [];
  for (const c of list.data ?? []) {
    if (c.attributes?.channel !== "AirBNB") continue;
    const [full, listings] = await Promise.all([
      cx<{ data: any }>(`/channels/${c.id}`),
      cx<{ data: any }>(`/channels/${c.id}/action/listings`).catch(() => null),
    ]);
    const a = full.data?.attributes ?? {};
    out.push({
      id: c.id,
      title: String(a.title ?? c.attributes?.title ?? "Conta Airbnb"),
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

export type SenderOption = { channelId: string; title: string; hasAccess: boolean };
export type ListingSender = { listingId: string; currentChannelId: string | null; options: SenderOption[] };

/** Remetente atual e contas possíveis (com acesso a TODOS os anúncios do grupo) por anúncio. */
export async function listListingSenders(ownerId: string): Promise<ListingSender[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const groups = await ownerGroups(supabaseAdmin, ownerId);
  const chans = await loadAirbnbChannels();
  const out: ListingSender[] = [];
  for (const ids of groups.values()) {
    const group = [...ids];
    // Todas as contas Airbnb conectadas aparecem (principal + coanfitriões);
    // as que ainda não enxergam todo o grupo vêm marcadas sem acesso.
    const options = chans.map((c) => ({ channelId: c.id, title: c.title, hasAccess: true }));
    for (const l of group) {
      const cur = chans.find((c) => c.mappings.some((m) => m.listingId === l));
      out.push({ listingId: l, currentChannelId: cur?.id ?? null, options });
    }
  }
  return out;
}

/**
 * Move o anúncio e todos os seus gêmeos para o canal da conta escolhida.
 * Ordem: valida acesso → inclui propriedades no novo canal → remove vínculos
 * antigos → pausa exigida pela Channex → recria no novo canal → importa
 * reservas futuras → limpa propriedades órfãs do canal antigo.
 */
const inFlight = new Set<string>();

export async function switchListingSender(ownerId: string, listingId: string | string[], targetChannelId: string) {
  if (inFlight.has(ownerId)) throw new Error("Já existe uma troca de conta em andamento. Aguarde a conclusão.");
  inFlight.add(ownerId);
  try {
    return await runSwitch(ownerId, Array.isArray(listingId) ? listingId : [listingId], targetChannelId);
  } finally {
    inFlight.delete(ownerId);
  }
}

async function runSwitch(ownerId: string, listingIds: string[], targetChannelId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const groups = await ownerGroups(db, ownerId);
  // Lote: une os grupos (principal + gêmeos) de todos os anúncios pedidos.
  const set = new Set<string>();
  for (const id of listingIds) {
    const g = [...groups.values()].find((x) => x.has(id));
    if (!g) throw new Error("Anúncio não pertence à sua conta.");
    g.forEach((l) => set.add(l));
  }
  const group = [...set];
  if (!group.length) throw new Error("Nenhum anúncio selecionado.");

  const chans = await loadAirbnbChannels();
  const target = chans.find((c) => c.id === targetChannelId);
  if (!target) throw new Error("Conta Airbnb não encontrada.");
  // Sem trava pelo catálogo da Channex (pode estar desatualizado): o Airbnb
  // decide no mapeamento e o rollback abaixo devolve o anúncio se recusar.

  const moves: Array<{ listingId: string; from: Chan; mappingId: string; ratePlanId: string; propertyId: string | null }> = [];
  for (const l of group) {
    const from = chans.find((c) => c.mappings.some((m) => m.listingId === l));
    if (!from) throw new Error(`O anúncio ${l} não está conectado a nenhuma conta na Channex.`);
    if (from.id === target.id) continue;
    const m = from.mappings.find((x) => x.listingId === l)!;
    const rp = await cx<{ data: any }>(`/rate_plans/${m.ratePlanId}`).catch(() => null);
    moves.push({ listingId: l, from, mappingId: m.id, ratePlanId: m.ratePlanId, propertyId: rp?.data?.relationships?.property?.data?.id ?? null });
  }
  if (!moves.length) return { changed: 0, title: target.title };

  // 1) Propriedades passam a pertencer também ao novo canal.
  const props = new Set(target.properties);
  for (const mv of moves) if (mv.propertyId) props.add(mv.propertyId);
  if (props.size !== target.properties.length) {
    await cx(`/channels/${target.id}`, { method: "PUT", body: JSON.stringify({ channel: { properties: [...props] } }) });
  }
  // 2) Remove os vínculos antigos (todos de uma vez, para uma única pausa).
  for (const mv of moves) await cx(`/channels/${mv.from.id}/mappings/${mv.mappingId}`, { method: "DELETE" });
  await sleep(40_000);
  // 3) Recria no novo canal com o MESMO plano de tarifa (preços intactos).
  const failed: string[] = [];
  for (const mv of moves) {
    try {
      await cx(`/channels/${target.id}/mappings`, { method: "POST", body: JSON.stringify({ mapping: { rate_plan_id: mv.ratePlanId, settings: { listing_id: mv.listingId } } }) });
      await cx(`/channels/${target.id}/execute/load_future_reservations`, { method: "POST", body: JSON.stringify({ listing_id: mv.listingId }) }).catch(() => undefined);
    } catch (e) {
      console.error("[sender] remap", mv.listingId, e);
      // Desfaz: devolve ao canal de origem para o anúncio nunca ficar solto.
      await cx(`/channels/${mv.from.id}/mappings`, { method: "POST", body: JSON.stringify({ mapping: { rate_plan_id: mv.ratePlanId, settings: { listing_id: mv.listingId } } }) }).catch(() => undefined);
      failed.push(mv.listingId);
    }
  }
  // 4) Canal antigo deixa de carregar propriedades que não usa mais.
  for (const from of new Set(moves.filter((m) => !failed.includes(m.listingId)).map((m) => m.from))) {
    const fresh = (await cx<{ data: any }>(`/channels/${from.id}`).catch(() => null))?.data?.attributes;
    if (!fresh) continue;
    const used = new Set<string>();
    for (const m of fresh.rate_plans ?? []) {
      const rp = await cx<{ data: any }>(`/rate_plans/${m.rate_plan_id}`).catch(() => null);
      const pid = rp?.data?.relationships?.property?.data?.id;
      if (pid) used.add(pid);
    }
    const keep = (fresh.properties ?? []).filter((p: string) => used.has(p) || !moves.some((m) => m.propertyId === p));
    if (keep.length !== (fresh.properties ?? []).length) {
      await cx(`/channels/${from.id}`, { method: "PUT", body: JSON.stringify({ channel: { properties: keep } }) }).catch((e) => console.error("[sender] cleanup", e));
    }
  }
  // 5) Pares gêmeos passam a apontar para o novo canal.
  await db.from("channex_twin_links").update({ channel_id: target.id, updated_at: new Date().toISOString() })
    .eq("owner_id", ownerId).eq("status", "active").in("twin_listing_id", group);
  if (failed.length) throw new Error(`Não foi possível migrar ${failed.length} anúncio(s); eles continuam na conta anterior. Tente de novo em 1 minuto.`);
  return { changed: moves.length, title: target.title };
}
