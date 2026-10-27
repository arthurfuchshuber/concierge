/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Integração Open Finance via Malvo (somente leitura).
 *
 * - Credenciais (`MALVO_CLIENT_ID`/`MALVO_CLIENT_SECRET`) ficam só no servidor;
 *   o navegador recebe apenas o `connectToken` (30 min) para abrir o widget.
 * - Tudo que o Malvo devolve é guardado sem filtro em `malvo_raw_records`
 *   (upsert por entity_type+malvo_id); tabelas normalizadas são derivadas.
 * - Webhooks são a fonte da verdade: o recebedor só valida/enfileira e a fila
 *   (`malvo_webhook_events`) é drenada aqui, sem polling em intervalo fixo.
 */
const BASE = "https://api.malvo.io";

let cachedKey: { key: string; exp: number } | null = null;

async function getApiKey(force = false): Promise<string> {
  if (!force && cachedKey && Date.now() < cachedKey.exp) return cachedKey.key;
  const clientId = process.env["MALVO_CLIENT_ID"];
  const clientSecret = process.env["MALVO_CLIENT_SECRET"];
  if (!clientId || !clientSecret) throw new Error("Integração bancária ainda não configurada.");
  const res = await fetch(`${BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!res.ok) throw new Error(`Malvo /auth falhou (${res.status})`);
  const j: any = await res.json();
  // apiKey vale 2h; renovamos com folga de 10 min.
  cachedKey = { key: j.apiKey, exp: Date.now() + 110 * 60_000 };
  return j.apiKey;
}

export async function malvoFetch(path: string, init: RequestInit = {}, retry = true): Promise<any> {
  const key = await getApiKey();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-API-KEY": key, ...(init.headers ?? {}) },
  });
  // /connect_token responde 403 (não 401) quando a apiKey venceu.
  if ((res.status === 401 || res.status === 403) && retry) {
    await getApiKey(true);
    return malvoFetch(path, init, false);
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Malvo ${path.split("?")[0]} → ${res.status} ${body.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function createConnectToken(accountOwnerId: string, itemId?: string) {
  const webhookUrl = process.env["MALVO_WEBHOOK_URL"] ?? "https://conciergeia.app/api/public/webhooks/malvo";
  const body: any = { clientUserId: accountOwnerId, webhookUrl, avoidDuplicates: true };
  if (itemId) body.itemId = itemId;
  const j = await malvoFetch("/connect_token", { method: "POST", body: JSON.stringify(body) });
  return j?.accessToken as string;
}

// ------------------------------------------------------------------ armazenamento

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function saveRaw(
  owner: string | null,
  entity_type: string,
  rows: any[],
  opts: { idKey?: string; parent?: string | null; itemId?: string | null; source?: string } = {},
) {
  const list = rows.filter((r) => r && (r[opts.idKey ?? "id"] ?? opts.parent));
  if (!list.length) return;
  const db = await admin();
  const now = new Date().toISOString();
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200).map((r) => ({
      account_owner_id: owner,
      entity_type,
      malvo_id: String(r[opts.idKey ?? "id"] ?? opts.parent),
      parent_id: opts.parent ?? null,
      malvo_item_id: opts.itemId ?? null,
      payload: r,
      source: opts.source ?? "sync",
      last_synced_at: now,
    }));
    const { error } = await db.from("malvo_raw_records").upsert(chunk as never, { onConflict: "entity_type,malvo_id" });
    if (error) console.error("[malvo-raw]", entity_type, error.message);
  }
}

const num = (v: any) => (v === null || v === undefined || v === "" ? null : Number(v));

async function pageAll(path: string): Promise<any[]> {
  const out: any[] = [];
  let page = 1;
  let totalPages = 1;
  const sep = path.includes("?") ? "&" : "?";
  do {
    const j = await malvoFetch(`${path}${sep}page=${page}&pageSize=500`);
    if (!j) break;
    if (Array.isArray(j)) return j;
    out.push(...(j.results ?? []));
    totalPages = j.totalPages ?? 1;
    page++;
  } while (page <= totalPages && page < 200);
  return out;
}

// ------------------------------------------------------------------ sincronização

async function upsertItem(owner: string, item: any) {
  const db = await admin();
  await db.from("malvo_items").upsert(
    {
      account_owner_id: owner,
      malvo_item_id: item.id,
      connector_id: item.connector?.id != null ? String(item.connector.id) : null,
      connector_name: item.connector?.name ?? null,
      institution_type: item.connector?.type ?? null,
      status: item.status ?? null,
      execution_status: item.executionStatus ?? null,
      status_detail: item.statusDetail ?? null,
      consent_expires_at: item.consentExpiresAt ?? null,
      last_updated_at: item.lastUpdatedAt ?? null,
      next_auto_sync_at: item.nextAutoSyncAt ?? null,
      environment: item.connector?.isSandbox ? "SANDBOX" : "PRODUCTION",
      payload: item,
      deleted_at: null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "malvo_item_id" },
  );
}

async function syncTransactions(owner: string, itemId: string, acc: any, lastSync: string | null) {
  const db = await admin();
  const passes: string[] = [];
  if (!lastSync) passes.push("");
  else {
    passes.push(`&createdAtFrom=${encodeURIComponent(new Date(lastSync).toISOString())}`);
    // Atualizações (PENDING → POSTED) acontecem nos dias recentes.
    const from = new Date(Date.now() - 20 * 86400_000).toISOString().slice(0, 10);
    passes.push(`&dateFrom=${from}`);
  }
  const startedAt = new Date().toISOString();
  let count = 0;
  for (const filter of passes) {
    let after: string | null = null;
    for (let guard = 0; guard < 500; guard++) {
      const q: string = `/v2/transactions?accountId=${encodeURIComponent(acc.id)}${filter}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
      const j = await malvoFetch(q);
      const results: any[] = j?.results ?? [];
      if (results.length) {
        await saveRaw(owner, "transaction", results, { parent: null, itemId });
        const rows = results.map((t) => ({
          account_owner_id: owner,
          malvo_transaction_id: t.id,
          malvo_account_id: t.accountId ?? acc.id,
          malvo_item_id: itemId,
          date: t.date ?? null,
          amount: num(t.amount),
          type: t.type ?? null,
          status: t.status ?? null,
          description: t.description ?? null,
          description_raw: t.descriptionRaw ?? null,
          currency_code: t.currencyCode ?? null,
          balance_after: num(t.balance),
          category: t.category ?? null,
          category_id: t.categoryId != null ? String(t.categoryId) : null,
          provider_code: t.providerCode ?? null,
          provider_id: t.providerId ?? null,
          payment_data: t.paymentData ?? null,
          credit_card_metadata: t.creditCardMetadata ?? null,
          merchant: t.merchant ?? null,
          payload: t,
          malvo_created_at: t.createdAt ?? null,
          malvo_updated_at: t.updatedAt ?? null,
          deleted_at: null,
          updated_at: new Date().toISOString(),
        }));
        const { error } = await db.from("malvo_transactions").upsert(rows as never, { onConflict: "malvo_transaction_id" });
        if (error) throw new Error(`malvo_transactions: ${error.message}`);
        count += rows.length;
      }
      const next: string | null = j?.next ?? null;
      if (!next) break;
      after = new URLSearchParams(next.replace(/^\?/, "")).get("after");
      if (!after) break;
    }
  }
  await db.from("malvo_accounts").update({ last_tx_sync_at: startedAt } as never).eq("malvo_account_id", acc.id);
  return count;
}

/** Puxa 100% dos dados de uma conexão: item, contas, saldos, transações, faturas, investimentos, empréstimos e identidade. */
export async function syncMalvoItem(itemId: string, ownerHint?: string | null) {
  const db = await admin();
  const item = await malvoFetch(`/items/${encodeURIComponent(itemId)}`);
  if (!item) {
    await db.from("malvo_items").update({ deleted_at: new Date().toISOString() } as never).eq("malvo_item_id", itemId);
    return { deleted: true };
  }
  const { data: existing } = await db.from("malvo_items").select("account_owner_id").eq("malvo_item_id", itemId).maybeSingle();
  const owner = existing?.account_owner_id ?? ownerHint ?? item.clientUserId ?? null;
  if (!owner || !/^[0-9a-f-]{36}$/i.test(owner)) throw new Error("Conexão sem empresa vinculada.");

  await upsertItem(owner, item);
  await saveRaw(owner, "item", [item], { itemId });

  const accounts = await pageAll(`/accounts?itemId=${encodeURIComponent(itemId)}`);
  await saveRaw(owner, "account", accounts, { itemId });
  let txCount = 0;
  for (const acc of accounts) {
    const balance = await malvoFetch(`/accounts/${encodeURIComponent(acc.id)}/balance`).catch(() => null);
    if (balance) await saveRaw(owner, "account_balance", [balance], { parent: acc.id, idKey: "__none", itemId });
    const { data: prev } = await db.from("malvo_accounts").select("last_tx_sync_at").eq("malvo_account_id", acc.id).maybeSingle();
    await db.from("malvo_accounts").upsert(
      {
        account_owner_id: owner,
        malvo_account_id: acc.id,
        malvo_item_id: itemId,
        type: acc.type ?? null,
        subtype: acc.subtype ?? null,
        name: acc.name ?? null,
        marketing_name: acc.marketingName ?? null,
        number: acc.number ?? null,
        owner_name: acc.owner ?? null,
        tax_number: acc.taxNumber ?? null,
        currency_code: acc.currencyCode ?? null,
        balance: num(balance?.balance ?? acc.balance),
        balance_updated_at: balance?.updateDateTime ?? acc.balanceUpdatedAt ?? null,
        balance_payload: balance ?? null,
        credit_data: acc.creditData ?? null,
        bank_data: acc.bankData ?? null,
        payload: acc,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "malvo_account_id" },
    );
    txCount += await syncTransactions(owner, itemId, acc, prev?.last_tx_sync_at ?? null);

    if (acc.type === "CREDIT" || acc.subtype === "CREDIT_CARD") {
      const bills = await pageAll(`/bills?accountId=${encodeURIComponent(acc.id)}`).catch(() => []);
      await saveRaw(owner, "bill", bills, { itemId });
    }
  }

  const investments = await pageAll(`/investments?itemId=${encodeURIComponent(itemId)}`).catch(() => []);
  await saveRaw(owner, "investment", investments, { itemId });
  for (const inv of investments) {
    const movs = await pageAll(`/investments/${encodeURIComponent(inv.id)}/transactions`).catch(() => []);
    await saveRaw(owner, "investment_transaction", movs, { parent: inv.id, itemId });
  }
  const loans = await pageAll(`/loans?itemId=${encodeURIComponent(itemId)}`).catch(() => []);
  await saveRaw(owner, "loan", loans, { itemId });
  const identity = await malvoFetch(`/identity?itemId=${encodeURIComponent(itemId)}`).catch(() => null);
  if (identity) {
    await saveRaw(owner, "identity", [identity], { parent: itemId, idKey: "__none", itemId });
    await db.from("malvo_items").update({ identity } as never).eq("malvo_item_id", itemId);
  }
  const consents = await pageAll(`/consents?itemId=${encodeURIComponent(itemId)}`).catch(() => []);
  await saveRaw(owner, "consent", consents, { itemId });

  return { accounts: accounts.length, transactions: txCount, investments: investments.length, loans: loans.length };
}

// ------------------------------------------------------------------ webhooks

function hex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** HMAC-SHA256 de `{t}.{corpo cru}` com o signing secret (incluindo `whsec_`), janela de 5 min. */
export async function verifyMalvoSignature(rawBody: string, header: string | null, secrets: string[], nowSec = Math.floor(Date.now() / 1000)) {
  if (!header || !secrets.length) return false;
  const parts = header.split(",").map((p) => p.trim());
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const sigs = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3).toLowerCase());
  if (!t || !sigs.length || !/^\d+$/.test(t)) return false;
  if (Math.abs(nowSec - Number(t)) > 300) return false;
  const enc = new TextEncoder();
  for (const secret of secrets) {
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const expected = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`)));
    if (sigs.some((s) => safeEqual(s, expected))) return true;
  }
  return false;
}

export async function enqueueMalvoEvent(evt: any) {
  const db = await admin();
  const { error } = await db.from("malvo_webhook_events").insert({
    event_id: String(evt.eventId),
    event: String(evt.event),
    malvo_item_id: evt.itemId ?? null,
    client_user_id: evt.clientUserId ?? null,
    payload: evt,
  } as never);
  // 23505 = já recebido (reentrega): no-op.
  if (error && error.code !== "23505") throw error;
}

async function handleEvent(evt: any) {
  const db = await admin();
  const name: string = evt.event;
  if (name === "transactions/deleted") {
    const ids: string[] = evt.transactionIds ?? [];
    if (ids.length)
      await db.from("malvo_transactions").update({ deleted_at: new Date().toISOString() } as never).in("malvo_transaction_id", ids);
    return;
  }
  if (name === "item/deleted") {
    if (evt.itemId) await db.from("malvo_items").update({ deleted_at: new Date().toISOString() } as never).eq("malvo_item_id", evt.itemId);
    return;
  }
  if (evt.itemId) await syncMalvoItem(evt.itemId, evt.clientUserId ?? null);
}

/** Drena a fila de avisos (até ~40 s), com retentativa exponencial. */
export async function processMalvoQueue(budgetMs = 40_000) {
  const db = await admin();
  const start = Date.now();
  const { data: rows } = await db
    .from("malvo_webhook_events")
    .select("id, payload, attempts, malvo_item_id")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(20);
  let done = 0;
  const syncedItems = new Set<string>();
  for (const r of rows ?? []) {
    if (Date.now() - start > budgetMs) break;
    const evt: any = r.payload;
    try {
      // Vários avisos do mesmo banco na mesma rodada → uma sincronização só.
      const key = evt.itemId && evt.event !== "transactions/deleted" ? String(evt.itemId) : null;
      if (!key || !syncedItems.has(key)) await handleEvent(evt);
      if (key) syncedItems.add(key);
      await db.from("malvo_webhook_events").update({ status: "done", processed_at: new Date().toISOString(), last_error: null } as never).eq("id", r.id);
      done++;
    } catch (err: any) {
      const attempts = (r.attempts ?? 0) + 1;
      await db
        .from("malvo_webhook_events")
        .update({
          attempts,
          status: attempts >= 8 ? "failed" : "pending",
          last_error: String(err?.message ?? err).slice(0, 500),
          next_attempt_at: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000).toISOString(),
        } as never)
        .eq("id", r.id);
    }
  }
  return { processed: done };
}
