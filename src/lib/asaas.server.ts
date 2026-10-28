/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Conta PJ do Asaas (somente leitura, API própria do Asaas — não está no Open Finance).
 * O extrato (`/v3/financialTransactions`) é gravado nas mesmas tabelas dos bancos
 * (item `asaas`, conta `asaas-pj`) para o Gerencial somar sem caminho especial.
 * Re-sincronizar é idempotente (upsert pelo id `ftn_...`).
 */
const BASE = "https://api.asaas.com";
export const ASAAS_ITEM_ID = "asaas";
export const ASAAS_ACCOUNT_ID = "asaas-pj";
const COMPANY_OWNER_ID = "25239e5b-1a66-46f1-b9a2-829c499cc366";

async function asaas(path: string): Promise<any> {
  const key = process.env["ASAAS_API_KEY"];
  if (!key) throw new Error("Chave do Asaas não configurada.");
  const res = await fetch(`${BASE}${path}`, { headers: { access_token: key, "User-Agent": "ConciergeIA" } });
  if (!res.ok) throw new Error(`Asaas ${path.split("?")[0]} → ${res.status}`);
  return res.json();
}

export async function syncAsaas(opts: { full?: boolean } = {}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const owner = COMPANY_OWNER_ID;
  const now = new Date().toISOString();

  const [info, bal] = await Promise.all([asaas("/v3/myAccount/commercialInfo"), asaas("/v3/finance/balance")]);

  await db.from("malvo_items").upsert(
    {
      account_owner_id: owner,
      malvo_item_id: ASAAS_ITEM_ID,
      connector_name: "Asaas",
      institution_type: "BUSINESS_BANK",
      status: "UPDATED",
      environment: "asaas_api",
      payload: { source: "asaas", commercialInfo: info },
      last_synced_at: now,
      deleted_at: null,
    },
    { onConflict: "malvo_item_id" },
  );

  const { data: acc } = await db
    .from("malvo_accounts")
    .select("last_tx_sync_at")
    .eq("malvo_account_id", ASAAS_ACCOUNT_ID)
    .maybeSingle();

  await db.from("malvo_accounts").upsert(
    {
      account_owner_id: owner,
      malvo_account_id: ASAAS_ACCOUNT_ID,
      malvo_item_id: ASAAS_ITEM_ID,
      type: "BANK",
      subtype: "CHECKING_ACCOUNT",
      name: "Conta Asaas PJ",
      owner_name: info?.companyName ?? info?.name ?? null,
      tax_number: info?.cpfCnpj ?? null,
      currency_code: "BRL",
      balance: Number(bal?.balance ?? 0),
      balance_updated_at: now,
      balance_payload: bal,
      payload: { source: "asaas" },
      last_synced_at: now,
    },
    { onConflict: "malvo_account_id" },
  );

  // Incremental: recua 10 dias da última sincronização (lançamentos retroativos); 1ª vez = tudo.
  let startDate: string | null = null;
  if (!opts.full && acc?.last_tx_sync_at) {
    const d = new Date(acc.last_tx_sync_at);
    d.setDate(d.getDate() - 10);
    startDate = d.toISOString().slice(0, 10);
  }

  let saved = 0;
  for (let offset = 0; ; offset += 100) {
    const q = `limit=100&offset=${offset}${startDate ? `&startDate=${startDate}` : ""}`;
    const page = await asaas(`/v3/financialTransactions?${q}`);
    const list: any[] = page?.data ?? [];
    if (list.length) {
      const rows = list.map((t) => {
        const v = Number(t.value ?? 0);
        return {
          account_owner_id: owner,
          malvo_transaction_id: `asaas_${t.id}`,
          malvo_account_id: ASAAS_ACCOUNT_ID,
          malvo_item_id: ASAAS_ITEM_ID,
          date: `${t.date}T12:00:00-03:00`,
          amount: v,
          type: v >= 0 ? "CREDIT" : "DEBIT",
          status: "POSTED",
          description: t.description ?? t.type,
          description_raw: t.description ?? null,
          currency_code: "BRL",
          balance_after: t.balance ?? null,
          category: t.type ?? null,
          provider_id: t.id,
          payload: { source: "asaas", ...t },
          deleted_at: null,
        };
      });
      const { error } = await db.from("malvo_transactions").upsert(rows, { onConflict: "malvo_transaction_id" });
      if (error) throw new Error(error.message);
      saved += rows.length;
    }
    if (!page?.hasMore) break;
  }

  await db.from("malvo_accounts").update({ last_tx_sync_at: now }).eq("malvo_account_id", ASAAS_ACCOUNT_ID);
  return { saved, balance: Number(bal?.balance ?? 0) };
}
