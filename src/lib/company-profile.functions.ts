import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  RECEITA_FIELDS,
  missingCompanyFields,
  type CompanyData,
  type CompanyFieldKey,
  type CompanyLookupResult,
  type TaxRegime,
} from "@/lib/company-profile.shared";

/**
 * Perfil · quadrante Empresa. Toda consulta e toda gravação passam pelo SERVIDOR: o cliente nunca grava dado vindo
 * da Receita por conta própria (o servidor consulta de novo e sobrescreve os campos bloqueados).
 */

const digits = (v: unknown) => String(v ?? "").replace(/\D+/g, "");

async function authorizeOwner(context: { supabase: any; userId: string }, ownerIdInput?: string | null) {
  const { supabase, userId } = context;
  const { resolveProfileOwnerId } = await import("@/lib/account-scope.server");
  const ownerId: string = await resolveProfileOwnerId(supabase, userId, ownerIdInput ?? null);
  if (ownerId !== userId) {
    const { data: isAdmin, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (error || !isAdmin) throw new Error("Apenas o titular ou um administrador pode alterar os dados da empresa.");
  }
  return ownerId;
}

/** Consulta o CNPJ na Receita (BrasilAPI) e monta os campos + quais ficam bloqueados. */
async function lookupForOwner(admin: any, ownerId: string, cnpjRaw: string): Promise<CompanyLookupResult> {
  const { isValidCNPJ } = await import("@/lib/masks");
  const cnpj = digits(cnpjRaw);
  if (!isValidCNPJ(cnpj)) return { ok: false, code: "invalid" };

  const { lookupCompanyByCnpj } = await import("@/lib/fiscal/company-prefill");
  const r = await lookupCompanyByCnpj(cnpj);
  if (!r.ok) return { ok: false, code: r.code === "not_found" ? "not_found" : "unavailable" };
  if (!r.situation.toUpperCase().includes("ATIV")) return { ok: false, code: "inactive", situation: r.situation };

  // Um CNPJ pertence a uma única conta.
  const { data: other } = await admin.from("account_companies").select("owner_id").eq("cnpj", cnpj).neq("owner_id", ownerId).maybeSingle();
  if (other) return { ok: false, code: "in_use" };

  const taxRegime: TaxRegime | "" = r.simples === "mei" ? "mei" : r.simples === "me_epp" ? "simples_nacional" : "";
  const data: CompanyData = {
    cnpj,
    situation: r.situation,
    legalName: r.legalName,
    tradeName: r.tradeName,
    email: r.email,
    phone: r.phone,
    cep: r.address.cep,
    street: r.address.street,
    number: r.address.number,
    city: r.address.city,
    state: r.address.state,
    taxRegime,
    municipalRegistration: "",
  };
  const locked = RECEITA_FIELDS.filter((k) => String(data[k] ?? "").trim() !== "");
  return { ok: true, data, locked, checkedAt: new Date().toISOString() };
}

export const lookupMyCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ cnpj: z.string().max(30), ownerId: z.string().uuid().nullable().optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<CompanyLookupResult> => {
    const ownerId = await authorizeOwner(context, data.ownerId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return lookupForOwner(supabaseAdmin as any, ownerId, data.cnpj);
  });

type Row = Record<string, any>;

function rowToData(r: Row): CompanyData {
  return {
    cnpj: r.cnpj ?? "",
    situation: r.situation ?? "",
    legalName: r.legal_name ?? "",
    tradeName: r.trade_name ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    cep: r.cep ?? "",
    street: r.street ?? "",
    number: r.number ?? "",
    city: r.city ?? "",
    state: r.state ?? "",
    taxRegime: (r.tax_regime ?? "") as TaxRegime | "",
    municipalRegistration: r.municipal_registration ?? "",
  };
}

export const getMyCompany = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ ownerId: z.string().uuid().nullable().optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { resolveProfileOwnerId } = await import("@/lib/account-scope.server");
    const ownerId: string = await resolveProfileOwnerId(supabase, userId, data.ownerId ?? null);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await (supabaseAdmin as any).from("account_companies").select("*").eq("owner_id", ownerId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return { isCompany: null as boolean | null, company: null as CompanyData | null, locked: [] as CompanyFieldKey[], checkedAt: null as string | null, complete: false };
    const company = row.cnpj ? rowToData(row) : null;
    return {
      isCompany: (row.is_company ?? null) as boolean | null,
      company,
      locked: ((row.locked_fields ?? []) as CompanyFieldKey[]),
      checkedAt: (row.receita_checked_at ?? null) as string | null,
      complete: !!company && missingCompanyFields(company).length === 0,
    };
  });

/** "Somos uma Empresa (CNPJ)": opcional. Depois que o CNPJ foi gravado, só o suporte desliga. */
export const setMyCompanyChoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ isCompany: z.boolean(), ownerId: z.string().uuid().nullable().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ownerId = await authorizeOwner(context, data.ownerId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { data: row } = await admin.from("account_companies").select("cnpj").eq("owner_id", ownerId).maybeSingle();
    if (row?.cnpj && !data.isCompany) throw new Error("O CNPJ já foi validado: a alteração é apenas via suporte.");
    const { error } = await admin
      .from("account_companies")
      .upsert({ owner_id: ownerId, is_company: data.isCompany, answered_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "owner_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveMyCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ownerId: z.string().uuid().nullable().optional(),
        cnpj: z.string().max(30),
        tradeName: z.string().trim().max(120).default(""),
        email: z.string().trim().max(160).default(""),
        phone: z.string().trim().max(20).default(""),
        cep: z.string().trim().max(12).default(""),
        street: z.string().trim().max(160).default(""),
        number: z.string().trim().max(20).default(""),
        city: z.string().trim().max(80).default(""),
        state: z.string().trim().max(2).default(""),
        taxRegime: z.enum(["simples_nacional", "mei", "lucro_presumido", "lucro_real"]).nullable().optional(),
        municipalRegistration: z.string().trim().max(30).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ownerId = await authorizeOwner(context, data.ownerId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const { data: prev } = await admin.from("account_companies").select("cnpj, locked_fields, legal_name").eq("owner_id", ownerId).maybeSingle();
    const cnpj = digits(data.cnpj);
    if (prev?.cnpj && prev.cnpj !== cnpj) throw new Error("O CNPJ já foi validado: a alteração é apenas via suporte.");

    // O servidor consulta a Receita de novo: nada vindo da Receita é aceito do cliente.
    const look = await lookupForOwner(admin, ownerId, cnpj);
    if (!look.ok) {
      const msg: Record<string, string> = {
        invalid: "CNPJ inválido.",
        not_found: "CNPJ não encontrado na Receita Federal.",
        inactive: "Este CNPJ não está ativo na Receita Federal. Informe um CNPJ ativo.",
        unavailable: "Não foi possível consultar a Receita Federal agora. Tente de novo em instantes.",
        in_use: "Este CNPJ já está em uso em outra conta.",
      };
      throw new Error(msg[look.code] ?? "Não foi possível validar o CNPJ.");
    }

    const lockedNow = look.locked;
    const pick = <K extends CompanyFieldKey>(k: K, typed: string) => (lockedNow.includes(k) ? String(look.data[k] ?? "") : typed.trim());
    const merged: CompanyData = {
      ...look.data,
      tradeName: pick("tradeName", data.tradeName),
      email: pick("email", data.email).toLowerCase(),
      phone: pick("phone", data.phone ? digits(data.phone) : ""),
      cep: pick("cep", digits(data.cep)),
      street: pick("street", data.street),
      number: pick("number", data.number),
      city: pick("city", data.city),
      state: pick("state", data.state).toUpperCase(),
      taxRegime: lockedNow.includes("taxRegime") ? look.data.taxRegime : ((data.taxRegime ?? "") as TaxRegime | ""),
      municipalRegistration: digits(data.municipalRegistration),
    };
    const missing = missingCompanyFields(merged);
    if (missing.length) throw new Error("Preencha todos os campos da empresa.");

    const now = new Date().toISOString();
    const { error } = await admin.from("account_companies").upsert(
      {
        owner_id: ownerId,
        is_company: true,
        answered_at: now,
        cnpj,
        situation: merged.situation,
        legal_name: merged.legalName,
        trade_name: merged.tradeName,
        email: merged.email,
        phone: merged.phone,
        phone_country: "BR",
        cep: merged.cep,
        street: merged.street,
        number: merged.number,
        city: merged.city,
        state: merged.state,
        tax_regime: merged.taxRegime || null,
        municipal_registration: merged.municipalRegistration,
        locked_fields: lockedNow,
        receita_checked_at: look.checkedAt,
        updated_at: now,
      },
      { onConflict: "owner_id" },
    );
    if (error) {
      if (String(error.message).includes("account_companies_cnpj_uidx")) throw new Error("Este CNPJ já está em uso em outra conta.");
      throw new Error(error.message);
    }
    // O nome fantasia da empresa é o que o cabeçalho do sistema usa no lugar do nome completo.
    await admin.from("profiles").update({ trade_name: merged.tradeName }).eq("id", ownerId);
    return { ok: true, company: merged, locked: lockedNow, checkedAt: look.checkedAt };
  });
