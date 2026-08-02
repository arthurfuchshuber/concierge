import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type StakeholderOption = {
  type: "owner" | "provider";
  id: string;
  label: string;
  email: string | null;
  doc: string | null;
};

/** Lista proprietários e prestadores da conta para o seletor de vínculo manual. */
export const listStakeholderOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StakeholderOption[]> => {
    const { supabase, userId } = context;
    const [{ data: owners }, { data: providers }] = await Promise.all([
      supabase.from("property_owners").select("id, name, trade_name, email, doc").eq("account_owner_id", userId),
      supabase.from("service_providers").select("id, name, trade_name, email, doc").eq("account_owner_id", userId),
    ]);
    const map = (rows: typeof owners, type: "owner" | "provider"): StakeholderOption[] =>
      (rows ?? []).map((r) => ({
        type,
        id: r.id as string,
        label: ((r.trade_name as string) || (r.name as string) || "Sem nome"),
        email: (r.email as string) ?? null,
        doc: (r.doc as string) ?? null,
      }));
    return [...map(owners, "owner"), ...map(providers, "provider")].sort((a, b) =>
      a.label.localeCompare(b.label, "pt-BR"),
    );
  });

const ALIAS_INPUT = z.object({
  aliasKind: z.enum(["email", "domain", "doc", "name", "event", "title", "keyword"]),
  aliasValue: z.string().trim().min(2).max(200),
  stakeholderType: z.enum(["owner", "provider"]),
  stakeholderId: z.string().uuid(),
});

/**
 * Grava (ou atualiza) um vínculo aprendido: da próxima importação em diante,
 * todo evento/documento com esse e-mail, domínio, documento ou nome cai
 * automaticamente na timeline do proprietário/prestador escolhido.
 */
export const saveStakeholderAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => ALIAS_INPUT.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const value = data.aliasValue.toLowerCase().trim();
    const { error } = await supabase.from("stakeholder_link_aliases").upsert(
      {
        account_owner_id: userId,
        alias_kind: data.aliasKind,
        alias_value: value,
        stakeholder_type: data.stakeholderType,
        stakeholder_id: data.stakeholderId,
        created_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_owner_id,alias_kind,alias_value" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Remove um vínculo aprendido. */
export const deleteStakeholderAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ aliasKind: z.string(), aliasValue: z.string() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase
      .from("stakeholder_link_aliases")
      .delete()
      .eq("account_owner_id", userId)
      .eq("alias_kind", data.aliasKind)
      .eq("alias_value", data.aliasValue.toLowerCase().trim());
    return { ok: true };
  });
