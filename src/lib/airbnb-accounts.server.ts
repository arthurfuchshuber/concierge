/**
 * CONTAS DO AIRBNB (Channex) — uma conta do sistema pode ter VÁRIAS contas do
 * Airbnb conectadas; cada uma é um canal da Channex e traz os próprios anúncios.
 *
 * - O registro (`airbnb_accounts`) diz a qual conta do sistema cada canal pertence.
 * - Canais que já têm anúncios importados (`property_listing_raw_data`) são
 *   registrados sozinhos na primeira consulta, para as contas que já existiam.
 * - Conectar uma conta nova usa o IFrame oficial da Channex (token de uso único).
 *
 * - Desconectar NUNCA desativa o canal na Channex (o anfitrião e outros serviços podem usá-lo):
 *   desliga o app Messages (anúncios e gêmeos), pausa a sincronização e arquiva os imóveis.
 * - Reconectar retoma só o que a desconexão pausou; o que foi desativado à mão continua inativo.
 *
 * Somente servidor. Nunca envia calendário, preço ou disponibilidade.
 */
const BASE = "https://app.channex.io/api/v1";
const APP_BASE = "https://app.channex.io";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];
// Tabela nova ainda não está nos tipos gerados.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (admin: Admin) => admin as unknown as { from: (t: string) => any };

async function cx<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const key = process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"];
  if (!key) throw new Error("Chave Channex ausente.");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "user-api-key": key,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Channex ${res.status}`);
  return (await res.json()) as T;
}

export type AirbnbAccount = {
  channelId: string;
  title: string;
  /** active = ok · expired = precisa autorizar de novo · disconnected = desconectada no ConciergeIA */
  status: "active" | "expired" | "disconnected";
  listings: number | null;
  imported: number;
};

type Row = { channex_channel_id: string; title: string | null; status: string };

/** Canais registrados da conta (ativos), completando com os que já têm anúncios importados. */
export async function registry(
  admin: Admin,
  accountId: string,
  withDisconnected = false,
): Promise<Row[]> {
  const { data: regs } = await db(admin)
    .from("airbnb_accounts")
    .select("channex_channel_id, title, status")
    .eq("owner_id", accountId);
  const known = new Map<string, Row>(((regs ?? []) as Row[]).map((r) => [r.channex_channel_id, r]));
  const { data: raw } = await admin
    .from("property_listing_raw_data")
    .select("channex_channel_id")
    .eq("owner_id", accountId);
  const legacy = [
    ...new Set((raw ?? []).map((r) => r.channex_channel_id).filter(Boolean) as string[]),
  ].filter((id) => !known.has(id));
  for (const id of legacy) {
    const title = await cx<{ data: { attributes?: { title?: string } } }>("GET", `/channels/${id}`)
      .then((r) => r.data?.attributes?.title ?? null)
      .catch(() => null);
    await db(admin)
      .from("airbnb_accounts")
      .upsert(
        { owner_id: accountId, channex_channel_id: id, title, status: "active" },
        { onConflict: "owner_id,channex_channel_id" },
      );
    known.set(id, { channex_channel_id: id, title, status: "active" });
  }
  return [...known.values()].filter((r) => withDisconnected || r.status === "active");
}

export async function activeChannelIds(admin: Admin, accountId: string): Promise<string[]> {
  return (await registry(admin, accountId)).map((r) => r.channex_channel_id);
}

export async function listAccounts(admin: Admin, accountId: string): Promise<AirbnbAccount[]> {
  const regs = await registry(admin, accountId, true);
  const { data: raw } = await admin
    .from("property_listing_raw_data")
    .select("channex_channel_id, airbnb_listing_id")
    .eq("owner_id", accountId);
  const importedBy = new Map<string, number>();
  for (const r of raw ?? []) {
    if (!r.channex_channel_id || !r.airbnb_listing_id) continue;
    importedBy.set(r.channex_channel_id, (importedBy.get(r.channex_channel_id) ?? 0) + 1);
  }
  const out: AirbnbAccount[] = [];
  for (const r of regs) {
    const id = r.channex_channel_id;
    const imported = importedBy.get(id) ?? 0;
    if (r.status !== "active") {
      out.push({
        channelId: id,
        title: r.title ?? "Conta do Airbnb",
        status: "disconnected",
        listings: null,
        imported,
      });
      continue;
    }
    const ch = await cx<{ data: { attributes?: { title?: string } } }>(
      "GET",
      `/channels/${id}`,
    ).catch(() => null);
    const listings = await cx<{ data: { listing_id_dictionary: { values: unknown[] } } }>(
      "GET",
      `/channels/${id}/action/listings`,
    )
      .then((x) => x.data?.listing_id_dictionary?.values?.length ?? 0)
      .catch(() => null);
    const title = ch?.data?.attributes?.title ?? r.title ?? "Conta do Airbnb";
    out.push({
      channelId: id,
      title,
      status: listings === null ? "expired" : "active",
      listings,
      imported,
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
}

/** A autorização da conta está válida agora? (lê o catálogo do canal) */
export async function accountAuthorized(channelId: string): Promise<boolean> {
  return cx("GET", `/channels/${channelId}/action/listings`)
    .then(() => true)
    .catch(() => false);
}

async function airbnbChannels(): Promise<Array<{ id: string; title: string }>> {
  const res = await cx<{
    data: Array<{ id: string; attributes?: { channel?: string; title?: string } }>;
  }>("GET", "/channels?pagination[limit]=100");
  return (res.data ?? [])
    .filter((c) => c.attributes?.channel === "AirBNB")
    .map((c) => ({ id: c.id, title: String(c.attributes?.title ?? "Conta do Airbnb") }));
}

/**
 * Passo 1 de "Conectar conta": token de uso único + endereço do IFrame da Channex.
 * `baseline` = canais que já existiam; o que aparecer depois é a conta nova.
 * Com `reauthChannelId`, abre a edição do canal existente (renova a autorização sem criar canal duplicado).
 */
export async function startConnect(username: string, reauthChannelId?: string) {
  const baseline = reauthChannelId ? [] : (await airbnbChannels()).map((c) => c.id);
  let propertyId = process.env["CHANNEX_CONNECT_PROPERTY_ID"] ?? "";
  if (!propertyId && reauthChannelId) {
    const ch = await cx<{ data: { attributes?: { properties?: string[] } } }>(
      "GET",
      `/channels/${reauthChannelId}`,
    ).catch(() => null);
    propertyId = ch?.data?.attributes?.properties?.[0] ?? "";
  }
  if (!propertyId) {
    const first = await cx<{ data: Array<{ id: string }> }>(
      "GET",
      "/properties?pagination[limit]=1",
    );
    propertyId = first.data?.[0]?.id ?? "";
  }
  if (!propertyId)
    throw new Error("Nenhuma propriedade da Channex disponível para receber a conta.");
  const groupId = process.env["CHANNEX_CONNECT_GROUP_ID"];
  const tok = await cx<{ data: { token: string } }>("POST", "/auth/one_time_token", {
    one_time_token: {
      property_id: propertyId,
      ...(groupId ? { group_id: groupId } : {}),
      username,
    },
  });
  const redirect = reauthChannelId
    ? `/channels/${encodeURIComponent(reauthChannelId)}/edit`
    : "/channels";
  const url =
    `${APP_BASE}/auth/exchange?oauth_session_key=${encodeURIComponent(tok.data.token)}` +
    `&app_mode=headless&redirect_to=${redirect}&property_id=${encodeURIComponent(propertyId)}` +
    (reauthChannelId ? "" : "&channels=ABB");
  return { url, baseline };
}

/** Passo 2: procura a conta que acabou de ser autorizada e a registra nesta conta do sistema. */
export async function detectNew(admin: Admin, accountId: string, baseline: string[]) {
  const now = await airbnbChannels();
  const seen = new Set(baseline);
  const fresh = now.filter((c) => !seen.has(c.id));
  if (fresh.length === 0)
    return { found: null as null | { channelId: string; title: string; duplicate: boolean } };
  const { data: taken } = await db(admin)
    .from("airbnb_accounts")
    .select("channex_channel_id")
    .in(
      "channex_channel_id",
      fresh.map((c) => c.id),
    )
    .eq("status", "active");
  const takenIds = new Set(
    ((taken ?? []) as Array<{ channex_channel_id: string }>).map((t) => t.channex_channel_id),
  );
  const pick = fresh.find((c) => !takenIds.has(c.id));
  if (!pick) return { found: null };
  const existing = await registry(admin, accountId);
  const dup = existing.find(
    (r) => (r.title ?? "").trim().toLowerCase() === pick.title.trim().toLowerCase(),
  );
  if (dup)
    return { found: { channelId: dup.channex_channel_id, title: pick.title, duplicate: true } };
  await db(admin).from("airbnb_accounts").upsert(
    {
      owner_id: accountId,
      channex_channel_id: pick.id,
      title: pick.title,
      status: "active",
      disconnected_at: null,
    },
    { onConflict: "owner_id,channex_channel_id" },
  );
  return { found: { channelId: pick.id, title: pick.title, duplicate: false } };
}

/** Liga o app Messages do anúncio (e dos gêmeos). Falhou → "pendente de ativação do chat", sem esconder o erro. */
export async function enableChat(
  admin: Admin,
  propertyId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { syncMessagesApp, channexPropertiesFor } =
    await import("@/lib/channex-messages-app.server");
  try {
    // Primeiro a Channex; só depois o banco muda de estado.
    await syncMessagesApp(await channexPropertiesFor(admin, propertyId), true);
    await db(admin)
      .from("property_listing_raw_data")
      .update({ chat_pending_at: null, chat_pending_error: null })
      .eq("property_id", propertyId);
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db(admin)
      .from("property_listing_raw_data")
      .update({
        chat_pending_at: new Date().toISOString(),
        chat_pending_error: error.slice(0, 300),
      })
      .eq("property_id", propertyId);
    return { ok: false, error };
  }
}

/** Desliga o app Messages do anúncio (e dos gêmeos). */
export async function disableChat(admin: Admin, propertyId: string) {
  const { syncMessagesApp, channexPropertiesFor } =
    await import("@/lib/channex-messages-app.server");
  await syncMessagesApp(await channexPropertiesFor(admin, propertyId), false);
  await db(admin)
    .from("property_listing_raw_data")
    .update({ chat_pending_at: null, chat_pending_error: null })
    .eq("property_id", propertyId);
}

/**
 * Desconectar: desliga o Messages (anúncios e gêmeos), pausa a sincronização e arquiva os imóveis.
 * NUNCA mexe no canal da Channex. Os dados já importados ficam guardados.
 */
export async function disconnect(admin: Admin, accountId: string, channelId: string) {
  const ids = await activeChannelIds(admin, accountId);
  if (!ids.includes(channelId)) throw new Error("Conta do Airbnb não encontrada.");
  const { data: raw } = await admin
    .from("property_listing_raw_data")
    .select("property_id")
    .eq("owner_id", accountId)
    .eq("channex_channel_id", channelId);
  const propertyIds = [...new Set((raw ?? []).map((r) => r.property_id as string))];
  const now = new Date().toISOString();
  let chatFailures = 0;
  for (const pid of propertyIds) {
    try {
      await disableChat(admin, pid);
    } catch {
      chatFailures += 1;
    }
  }
  if (propertyIds.length > 0) {
    // Só marca "pausado pela desconexão" o que ainda estava ativo; o desativado à mão continua assim.
    await admin
      .from("property_listing_raw_data")
      .update({ sync_paused_at: now, paused_reason: "account_disconnected" } as never)
      .eq("owner_id", accountId)
      .eq("channex_channel_id", channelId)
      .is("sync_paused_at", null);
    await admin
      .from("properties")
      .update({ archived_at: now } as never)
      .in("id", propertyIds)
      .eq("owner_id", accountId);
  }
  await db(admin)
    .from("airbnb_accounts")
    .update({ status: "disconnected", disconnected_at: now })
    .eq("owner_id", accountId)
    .eq("channex_channel_id", channelId);
  return { archived: propertyIds.length, chatFailures };
}

/**
 * Reconectar: a conta volta a ser ativa e retoma a sincronização dos anúncios que a DESCONEXÃO
 * pausou (reativa o Messages deles). Anúncios desativados à mão continuam inativos.
 */
export async function reactivate(admin: Admin, accountId: string, channelId: string) {
  const { data: raw } = await admin
    .from("property_listing_raw_data")
    .select("property_id, paused_reason, sync_paused_at")
    .eq("owner_id", accountId)
    .eq("channex_channel_id", channelId);
  const rows = (raw ?? []) as Array<{
    property_id: string;
    paused_reason: string | null;
    sync_paused_at: string | null;
  }>;
  const resume = rows.filter((r) => r.paused_reason === "account_disconnected");
  if (rows.length > 0) {
    await admin
      .from("properties")
      .update({ archived_at: null } as never)
      .in(
        "id",
        rows.map((r) => r.property_id),
      )
      .eq("owner_id", accountId);
  }
  if (resume.length > 0) {
    await admin
      .from("property_listing_raw_data")
      .update({ sync_paused_at: null, paused_reason: null } as never)
      .in(
        "property_id",
        resume.map((r) => r.property_id),
      );
  }
  let chatPending = 0;
  for (const r of resume) if (!(await enableChat(admin, r.property_id)).ok) chatPending += 1;
  await db(admin)
    .from("airbnb_accounts")
    .update({ status: "active", disconnected_at: null })
    .eq("owner_id", accountId)
    .eq("channex_channel_id", channelId);
  return { resumed: resume.length, chatPending };
}

/**
 * Canais Airbnb (Channex) que pertencem a esta conta do sistema. A chave da Channex enxerga os
 * canais de TODOS os clientes: qualquer leitura/ação que lista canais precisa passar por aqui
 * para um cliente nunca ver nem usar a conta Airbnb de outro.
 * `null` = sem restrição (só a conta fundadora, que já operava com todos os canais antes do
 * cadastro por conta existir).
 */
export const UNSCOPED_CHANNEL_OWNERS = new Set<string>(["25239e5b-1a66-46f1-b9a2-829c499cc366"]);
export async function accountChannelScope(accountId: string): Promise<Set<string> | null> {
  if (UNSCOPED_CHANNEL_OWNERS.has(accountId)) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rows = await registry(supabaseAdmin as never, accountId, false);
  return new Set(rows.map((r) => r.channex_channel_id));
}
