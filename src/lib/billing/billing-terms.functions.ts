/**
 * Admin SaaS › Condição Comercial de uma conta: tabela oficial ou condição negociada
 * (valor por anúncio, piso, cortesia total) e carência até um dia 25.
 *
 * Toda gravação exige admin do SaaS, fica em `audit_logs` e coloca a conta na fila de cobrança,
 * que aplica a condição na assinatura da Stripe (se a conta já assinou).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdminBillingTerms = {
  mode: "official" | "custom";
  unitCents: number | null;
  minUnits: number | null;
  courtesy: boolean;
  /** Mês em que a cobrança começa (dia 25), `AAAA-MM`; null = sem carência. */
  billingStartsMonth: string | null;
  notes: string | null;
  updatedAt: string | null;
};

async function assertSaasAdmin(supabase: any, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error("Erro ao verificar permissão.");
  if (!data) throw new Error("Apenas o admin do SaaS pode alterar condições comerciais.");
}

function monthOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(Date.parse(iso) - 3 * 3600_000); // em Brasília
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const adminGetBillingTerms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ownerId: string }) => z.object({ ownerId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<AdminBillingTerms> => {
    await assertSaasAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await (supabaseAdmin as any)
      .from("billing_terms")
      .select("unit_cents, min_units, courtesy, billing_starts_at, notes, updated_at")
      .eq("owner_id", data.ownerId)
      .maybeSingle();
    if (error) throw new Error("Não foi possível carregar a condição comercial.");
    if (!row) return { mode: "official", unitCents: null, minUnits: null, courtesy: false, billingStartsMonth: null, notes: null, updatedAt: null };
    const custom = row.unit_cents != null || (row.min_units != null && row.min_units !== 3) || !!row.courtesy;
    return {
      mode: custom ? "custom" : "official",
      unitCents: row.unit_cents ?? null,
      minUnits: row.min_units ?? null,
      courtesy: !!row.courtesy,
      billingStartsMonth: monthOf(row.billing_starts_at ?? null),
      notes: row.notes ?? null,
      updatedAt: row.updated_at ?? null,
    };
  });

const SaveInput = z
  .object({
    ownerId: z.string().uuid(),
    mode: z.enum(["official", "custom"]),
    unitCents: z.number().int().min(100).max(1_000_000).nullable(),
    minUnits: z.number().int().min(1).max(999).nullable(),
    courtesy: z.boolean(),
    billingStartsMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable(),
    notes: z.string().max(2000).nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "official" && (v.unitCents != null || v.minUnits != null || v.courtesy)) {
      ctx.addIssue({ code: "custom", message: "Na tabela oficial não há valor, piso nem cortesia personalizados." });
    }
    if (v.mode === "custom" && !v.courtesy && v.unitCents == null && v.minUnits == null) {
      ctx.addIssue({ code: "custom", message: "Informe o valor por anúncio, o piso ou marque cortesia total." });
    }
    if (v.mode === "custom" && (v.unitCents != null || v.minUnits != null || v.courtesy) && !v.notes?.trim()) {
      ctx.addIssue({ code: "custom", message: "Registre a justificativa comercial do acordo." });
    }
  });

export const adminSaveBillingTerms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof SaveInput>) => SaveInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertSaasAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    let billingStartsAt: string | null = null;
    if (data.billingStartsMonth) {
      const [y, m] = data.billingStartsMonth.split("-").map(Number);
      const at = Date.UTC(y, m - 1, 25, 3); // dia 25, 00:00 de Brasília
      if (at <= Date.now()) throw new Error("O início da cobrança precisa ser um dia 25 no futuro.");
      billingStartsAt = new Date(at).toISOString();
    }

    const { data: before } = await db.from("billing_terms").select("*").eq("owner_id", data.ownerId).maybeSingle();
    const isOfficialPlain = data.mode === "official" && !billingStartsAt;
    if (isOfficialPlain) {
      const { error } = await db.from("billing_terms").delete().eq("owner_id", data.ownerId);
      if (error) throw new Error("Não foi possível salvar a condição comercial.");
    } else {
      const { error } = await db.from("billing_terms").upsert(
        {
          owner_id: data.ownerId,
          unit_cents: data.mode === "custom" ? data.unitCents : null,
          min_units: data.mode === "custom" ? data.minUnits : null,
          courtesy: data.mode === "custom" ? data.courtesy : false,
          billing_starts_at: billingStartsAt,
          notes: data.notes?.trim() || null,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id" },
      );
      if (error) throw new Error("Não foi possível salvar a condição comercial.");
    }

    const { untypedTable } = await import("@/lib/untyped-table");
    await untypedTable(db, "audit_logs").insert({
      user_id: context.userId,
      user_email: (context as { claims?: { email?: string } }).claims?.email ?? null,
      action: "billing_terms.updated",
      entity_type: "billing_terms",
      entity_id: data.ownerId,
      metadata: { before: before ?? null, after: isOfficialPlain ? null : { ...data, billingStartsAt } },
    });

    // A fila aplica preço/cortesia/carência na Stripe e acerta a quantidade.
    const { enqueueBillingSync } = await import("@/lib/billing/billing-sync.server");
    await enqueueBillingSync(data.ownerId);
    const { invalidateOwnerPlanCache } = await import("@/lib/plan-guard.server");
    invalidateOwnerPlanCache(data.ownerId);
    return { ok: true };
  });
