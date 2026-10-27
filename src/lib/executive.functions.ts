/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Painel Gerencial (alta diretoria). Acesso por lista fechada de usuários,
 * checada no servidor; os dados são da conta da empresa (titular abaixo).
 */
const COMPANY_OWNER_ID = "25239e5b-1a66-46f1-b9a2-829c499cc366"; // Anfitrião Sigma
const EXECUTIVE_USER_IDS = new Set([
  COMPANY_OWNER_ID,
  "ad2c848e-7395-4cba-ab9e-db697ccd94d3", // Josieli
]);

export function isExecutive(userId: string) {
  return EXECUTIVE_USER_IDS.has(userId);
}

export const getExecutiveAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => ({ allowed: isExecutive(context.userId) }));

export const getExecutiveDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ months: z.number().int().min(1).max(36).default(12) }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    if (!isExecutive(context.userId)) throw new Error("Acesso restrito à diretoria.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const { data: accounts } = await db
      .from("malvo_accounts")
      .select("malvo_account_id, type, subtype, name, number, balance, credit_data, bank_data")
      .eq("account_owner_id", COMPANY_OWNER_ID);
    const { data: items } = await db
      .from("malvo_items")
      .select("malvo_item_id, connector_name")
      .eq("account_owner_id", COMPANY_OWNER_ID)
      .is("deleted_at", null);
    const { data: accItems } = await db
      .from("malvo_accounts")
      .select("malvo_account_id, malvo_item_id")
      .eq("account_owner_id", COMPANY_OWNER_ID);
    const bankOf = new Map<string, string>();
    const itemName = new Map((items ?? []).map((i: any) => [i.malvo_item_id, i.connector_name ?? "Banco"]));
    for (const a of accItems ?? []) bankOf.set(a.malvo_account_id, String(itemName.get(a.malvo_item_id) ?? "Banco"));

    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth() - (data.months - 1), 1);
    const txs: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error } = await db
        .from("malvo_transactions")
        .select("malvo_account_id, date, amount, type, description, merchant, payment_data")
        .eq("account_owner_id", COMPANY_OWNER_ID)
        .is("deleted_at", null)
        .gte("date", since.toISOString())
        .lte("date", now.toISOString())
        .order("date")
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      txs.push(...(page ?? []));
      if (!page || page.length < 1000) break;
    }

    const cardIds = new Set((accounts ?? []).filter((a: any) => a.type === "CREDIT").map((a: any) => a.malvo_account_id));
    // Movimentos entre contas da própria empresa não são receita nem despesa.
    const isInternal = (t: any) =>
      /aplica[cç][aã]o rdb|resgate rdb|pagamento de fatura|caixinha|transfer[eê]ncia entre contas/i.test(t.description ?? "");

    const monthly = new Map<string, { in: number; out: number }>();
    for (let i = 0; i < data.months; i++) {
      const d = new Date(since.getFullYear(), since.getMonth() + i, 1);
      monthly.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, { in: 0, out: 0 });
    }
    const payees = new Map<string, number>();
    let cardSpend = 0;
    for (const t of txs) {
      if (isInternal(t)) continue;
      const key = String(t.date).slice(0, 7);
      const m = monthly.get(key);
      if (!m) continue;
      const amt = Math.abs(Number(t.amount) || 0);
      const isCard = cardIds.has(t.malvo_account_id);
      const outflow = isCard ? t.type === "DEBIT" || Number(t.amount) > 0 : t.type === "DEBIT";
      if (isCard && !outflow) continue; // estornos/pagamentos do cartão
      if (outflow) {
        m.out += amt;
        if (isCard) cardSpend += amt;
        const name = String(t.merchant?.name ?? t.payment_data?.receiver?.name ?? t.description ?? "Outros")
          .replace(/\s+/g, " ").trim().slice(0, 60);
        payees.set(name, (payees.get(name) ?? 0) + amt);
      } else m.in += amt;
    }

    const months = [...monthly.entries()].map(([month, v]) => ({
      month,
      entradas: Math.round(v.in * 100) / 100,
      saidas: Math.round(v.out * 100) / 100,
      resultado: Math.round((v.in - v.out) * 100) / 100,
    }));
    const cur = months[months.length - 1];
    const prev = months[months.length - 2] ?? null;

    const bankAccounts = (accounts ?? []).filter((a: any) => a.type === "BANK");
    const card = (accounts ?? []).find((a: any) => a.type === "CREDIT") ?? null;

    // Ritmo de reservas (mês atual) a partir das reservas oficiais.
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    const { data: props } = await db.from("properties").select("id").eq("owner_id", COMPANY_OWNER_ID).is("archived_at", null);
    let reservas = 0;
    let noites = 0;
    const propIds = (props ?? []).map((p: any) => p.id);
    if (propIds.length) {
      const { data: res } = await db
        .from("property_reservations")
        .select("check_in, check_out, status")
        .in("property_id", propIds)
        .gte("check_in", monthStart)
        .lte("check_in", monthEnd)
        .neq("status", "cancelled");
      for (const r of res ?? []) {
        if (r.status === "blocked") continue;
        reservas++;
        const n = (new Date(r.check_out).getTime() - new Date(r.check_in).getTime()) / 86400000;
        if (n > 0 && n < 120) noites += n;
      }
    }

    return {
      saldoDisponivel: bankAccounts.reduce((s: number, a: any) => s + (Number(a.balance) || 0), 0),
      contas: bankAccounts.map((a: any) => ({
        banco: bankOf.get(a.malvo_account_id) ?? "Banco",
        nome: a.name,
        numero: a.number,
        saldo: Number(a.balance) || 0,
      })),
      cartao: card
        ? {
            fatura: Number(card.balance) || 0,
            limite: Number(card.credit_data?.creditLimit ?? 0) || null,
            disponivel: Number(card.credit_data?.availableCreditLimit ?? 0) || null,
            gastoPeriodo: Math.round(cardSpend * 100) / 100,
          }
        : null,
      meses: months,
      mesAtual: cur,
      mesAnterior: prev,
      topSaidas: [...payees.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([nome, valor]) => ({ nome, valor: Math.round(valor * 100) / 100 })),
      operacao: { propriedades: propIds.length, reservas, noites: Math.round(noites) },
      geradoEm: now.toISOString(),
    };
  });
