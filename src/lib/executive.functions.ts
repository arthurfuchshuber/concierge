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

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Desloca uma data yyyy-mm-dd em meses, prendendo o dia ao fim do mês. */
function shiftMonths(iso: string, months: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

function eachDay(start: string, end: string) {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  while (d <= e && out.length < 1200) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const round = (v: number) => Math.round(v * 100) / 100;

export const getExecutiveDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        start: ISO,
        end: ISO,
        compare: z.enum(["none", "prev", "yoy"]).default("prev"),
        bank: z.enum(["all", "btg", "nubank"]).default("all"),
        /** Tamanho da visão em meses (1 mês, 2 bimestre, 3 trimestre…): "anterior" recua isso. */
        span: z.number().int().min(1).max(12).default(1),
      })
      .refine((v) => v.start <= v.end, "Período inválido")
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    if (!isExecutive(context.userId)) throw new Error("Acesso restrito à diretoria.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const [{ data: accounts }, { data: items }] = await Promise.all([
      db
        .from("malvo_accounts")
        .select("malvo_account_id, malvo_item_id, type, name, number, balance, credit_data")
        .eq("account_owner_id", COMPANY_OWNER_ID),
      db
        .from("malvo_items")
        .select("malvo_item_id, connector_name")
        .eq("account_owner_id", COMPANY_OWNER_ID)
        .is("deleted_at", null),
    ]);
    const itemName = new Map<string, string>((items ?? []).map((i: any) => [i.malvo_item_id, String(i.connector_name ?? "Banco")]));
    const bankOf = (a: any) => itemName.get(a.malvo_item_id) ?? "Banco";
    const bankMatch = (a: any) =>
      data.bank === "all" || new RegExp(data.bank === "btg" ? "btg" : "nu", "i").test(bankOf(a));
    const accs = (accounts ?? []).filter((a: any) => itemName.has(a.malvo_item_id) && bankMatch(a));
    const accIds = accs.map((a: any) => a.malvo_account_id);
    const cardIds = new Set(accs.filter((a: any) => a.type === "CREDIT").map((a: any) => a.malvo_account_id));

    const back = data.compare === "prev" ? -data.span : -12;
    const cmpStart = data.compare === "none" ? null : shiftMonths(data.start, back);
    const cmpEnd = data.compare === "none" ? null : shiftMonths(data.end, back);
    const fetchFrom = cmpStart && cmpStart < data.start ? cmpStart : data.start;

    const txs: any[] = [];
    if (accIds.length) {
      for (let from = 0; ; from += 1000) {
        const { data: page, error } = await db
          .from("malvo_transactions")
          .select("malvo_account_id, date, amount, type, description, merchant, payment_data, category_id")
          .eq("account_owner_id", COMPANY_OWNER_ID)
          .in("malvo_account_id", accIds)
          .is("deleted_at", null)
          .gte("date", `${fetchFrom}T00:00:00`)
          .lte("date", `${data.end}T23:59:59.999`)
          .order("date")
          .range(from, from + 999);
        if (error) throw new Error(error.message);
        txs.push(...(page ?? []));
        if (!page || page.length < 1000) break;
      }
    }

    // Movimentos entre contas da própria empresa não são receita nem despesa.
    // Pix entre Nubank PJ e BTG PJ: entrada cujo PAGADOR é o CNPJ da empresa,
    // ou saída cujo RECEBEDOR é o CNPJ da empresa. Pix com sócios conta normal.
    const COMPANY_CNPJ = "57851613000150";
    const doc = (v: unknown) => String(v ?? "").replace(/\D/g, "");
    const isInternal = (t: any) => {
      if (
        /aplica[cç][aã]o rdb|resgate rdb|conta remunerada|fatura|caixinha|transfer[eê]ncia entre contas|cr[eé]dito na conta corrente|d[eé]bito na conta corrente|rendimento remunera|nu pagamentos/i.test(
          String(t.description ?? ""),
        )
      )
        return true;
      if (t.category_id === "04000000") return true; // mesma titularidade
      const payer = doc(t.payment_data?.payer?.documentNumber?.value);
      const receiver = doc(t.payment_data?.receiver?.documentNumber?.value);
      if (t.type === "CREDIT" && payer === COMPANY_CNPJ) return true;
      if (t.type === "DEBIT" && receiver === COMPANY_CNPJ) return true;
      return false;
    };

    type Flow = { day: string; amt: number; out: boolean; payee: string };
    const flows: Flow[] = [];
    for (const t of txs) {
      if (isInternal(t)) continue;
      const amt = Math.abs(Number(t.amount) || 0);
      if (!amt) continue;
      const isCard = cardIds.has(t.malvo_account_id);
      const out = isCard ? t.type === "DEBIT" || Number(t.amount) > 0 : t.type === "DEBIT";
      if (isCard && !out) continue; // estornos/pagamentos do cartão
      flows.push({
        day: String(t.date).slice(0, 10),
        amt,
        out,
        payee: String(t.merchant?.name ?? t.payment_data?.receiver?.name ?? t.description ?? "Outros")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60),
      });
    }

    const sum = (start: string, end: string) => {
      let entradas = 0;
      let saidas = 0;
      for (const f of flows) {
        if (f.day < start || f.day > end) continue;
        if (f.out) saidas += f.amt;
        else entradas += f.amt;
      }
      return { entradas: round(entradas), saidas: round(saidas), resultado: round(entradas - saidas) };
    };

    // Série: por dia até ~2 meses; acima disso, por mês (legível no celular).
    const days = eachDay(data.start, data.end);
    const monthly = days.length > 62;
    const buckets = new Map<string, { entradas: number; saidas: number }>();
    for (const d of days) {
      const k = monthly ? d.slice(0, 7) : d;
      if (!buckets.has(k)) buckets.set(k, { entradas: 0, saidas: 0 });
    }
    const payees = new Map<string, number>();
    for (const f of flows) {
      if (f.day < data.start || f.day > data.end) continue;
      const b = buckets.get(monthly ? f.day.slice(0, 7) : f.day);
      if (!b) continue;
      if (f.out) {
        b.saidas += f.amt;
        payees.set(f.payee, (payees.get(f.payee) ?? 0) + f.amt);
      } else b.entradas += f.amt;
    }

    // Reservas com entrada no período (imóveis ativos da empresa).
    const { data: props } = await db.from("properties").select("id").eq("owner_id", COMPANY_OWNER_ID).is("archived_at", null);
    const propIds = (props ?? []).map((p: any) => p.id);
    let reservas = 0;
    let noites = 0;
    if (propIds.length) {
      const { data: res } = await db
        .from("property_reservations")
        .select("checkin_date, checkout_date, status")
        .in("property_id", propIds)
        .gte("checkin_date", data.start)
        .lte("checkin_date", data.end)
        .neq("status", "cancelled");
      for (const r of res ?? []) {
        if (r.status === "blocked") continue;
        reservas++;
        const n = (new Date(r.checkout_date).getTime() - new Date(r.checkin_date).getTime()) / 86400000;
        if (n > 0 && n < 120) noites += n;
      }
    }

    const bankAccounts = accs.filter((a: any) => a.type === "BANK");
    const card = accs.find((a: any) => a.type === "CREDIT") ?? null;

    return {
      periodo: { start: data.start, end: data.end, granularidade: monthly ? ("mes" as const) : ("dia" as const) },
      comparacao: cmpStart && cmpEnd ? { start: cmpStart, end: cmpEnd, ...sum(cmpStart, cmpEnd) } : null,
      atual: sum(data.start, data.end),
      serie: [...buckets.entries()].map(([key, v]) => ({ key, entradas: round(v.entradas), saidas: round(v.saidas) })),
      saldoDisponivel: round(bankAccounts.reduce((s: number, a: any) => s + (Number(a.balance) || 0), 0)),
      contas: bankAccounts.map((a: any) => ({
        banco: bankOf(a),
        numero: String(a.number ?? ""),
        saldo: Number(a.balance) || 0,
      })),
      cartao: card
        ? {
            fatura: Number(card.balance) || 0,
            limite: Number(card.credit_data?.creditLimit ?? 0) || null,
            disponivel: Number(card.credit_data?.availableCreditLimit ?? 0) || null,
          }
        : null,
      topSaidas: [...payees.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([nome, valor]) => ({ nome, valor: round(valor) })),
      operacao: { propriedades: propIds.length, reservas, noites: Math.round(noites) },
    };
  });
