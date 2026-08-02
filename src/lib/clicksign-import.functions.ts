import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { ImportCandidate } from "@/lib/clicksign-import.server";

export type { ImportCandidate, DuplicateMatch } from "@/lib/clicksign-import.server";

/** Lista os cadastros que a integração consegue criar a partir dos contratos. */
export const previewClicksignStakeholders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ candidates: ImportCandidate[] }> => {
    const { supabase, userId } = context;
    const [{ data: docs }, { data: owners }, { data: providers }] = await Promise.all([
      supabase
        .from("clicksign_documents")
        .select("name, signers")
        .eq("account_owner_id", userId)
        .limit(2000),
      supabase.from("property_owners").select("id, name, trade_name, email, doc").eq("account_owner_id", userId),
      supabase.from("service_providers").select("id, name, trade_name, email, doc").eq("account_owner_id", userId),
    ]);
    const { buildCandidates } = await import("@/lib/clicksign-import.server");
    const candidates = buildCandidates(
      (docs ?? []) as never,
      (owners ?? []) as never,
      (providers ?? []) as never,
    );
    candidates.sort((a, b) => b.documents - a.documents || a.name.localeCompare(b.name));
    return { candidates };
  });

const DECISION = z.object({
  key: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  doc: z.string().trim().max(20).default(""),
  email: z.string().trim().max(200).default(""),
  phone: z.string().trim().max(40).default(""),
  action: z.enum(["create", "link", "skip"]),
  /** Para "create": onde criar. */
  type: z.enum(["owner", "provider"]).default("owner"),
  /** Para "link": cadastro existente. */
  targetType: z.enum(["owner", "provider"]).optional(),
  targetId: z.string().uuid().optional(),
});

export const importClicksignStakeholders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ decisions: z.array(DECISION).max(500) }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let created = 0;
    let linked = 0;

    for (const d of data.decisions) {
      if (d.action === "skip") continue;

      let type: "owner" | "provider";
      let id: string;

      if (d.action === "link") {
        if (!d.targetId || !d.targetType) continue;
        type = d.targetType;
        id = d.targetId;
        linked++;
      } else {
        const digits = d.doc.replace(/\D/g, "");
        const isCnpj = digits.length === 14;
        const table = d.type === "provider" ? "service_providers" : "property_owners";
        const base = {
          account_owner_id: userId,
          created_by: userId,
          name: d.name,
          person_type: isCnpj ? "pj" : "pf",
          doc_type: isCnpj ? "cnpj" : "cpf",
          doc: digits || null,
          email: d.email || null,
          phone: d.phone || null,
          status: "active",
          created_via: "clicksign",
          notes: "Cadastro criado automaticamente pela importação do ClickSign.",
        };
        const payload = table === "service_providers" ? { ...base, category: "outros" } : base;
        const { data: row, error } = await supabase
          .from(table)
          .insert(payload as never)
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        type = d.type;
        id = (row as { id: string }).id;
        created++;
      }

      // Aprende o vínculo para as próximas sincronizações.
      const aliases: Array<{ kind: string; value: string }> = [];
      const digits = d.doc.replace(/\D/g, "");
      if (digits.length === 11 || digits.length === 14) aliases.push({ kind: "doc", value: digits });
      if (d.email.includes("@")) aliases.push({ kind: "email", value: d.email.toLowerCase() });
      for (const a of aliases) {
        await supabase.from("stakeholder_link_aliases").upsert(
          {
            account_owner_id: userId,
            alias_kind: a.kind,
            alias_value: a.value,
            stakeholder_type: type,
            stakeholder_id: id,
            created_by: userId,
          } as never,
          { onConflict: "account_owner_id,alias_kind,alias_value" },
        );
      }

      // Vincula os contratos desse signatário imediatamente.
      const { data: docs } = await supabase
        .from("clicksign_documents")
        .select("id, signers")
        .eq("account_owner_id", userId)
        .is("stakeholder_id", null)
        .limit(2000);
      const norm = (s: unknown) => String(s ?? "").toLowerCase().trim();
      const targets = (docs ?? []).filter((row) => {
        const signers = (Array.isArray(row.signers) ? row.signers : []) as Array<Record<string, unknown>>;
        return signers.some((s) => {
          const sDoc = String(s["documentation"] ?? s["cpf"] ?? s["cnpj"] ?? "").replace(/\D/g, "");
          return (digits && sDoc === digits) || (d.email && norm(s["email"]) === norm(d.email));
        });
      });
      if (targets.length) {
        await supabase
          .from("clicksign_documents")
          .update({ stakeholder_type: type, stakeholder_id: id })
          .in("id", targets.map((t) => t.id));
      }

      // Linha do tempo do cadastro: registra a origem e o que foi vinculado.
      await supabase.from("stakeholder_events").insert({
        account_owner_id: userId,
        stakeholder_type: type,
        stakeholder_id: id,
        kind: "clicksign",
        message:
          d.action === "create"
            ? `Cadastro criado pela importação do ClickSign${targets.length ? ` · ${targets.length} contrato(s) vinculado(s)` : ""}.`
            : `Signatário do ClickSign vinculado a este cadastro${targets.length ? ` · ${targets.length} contrato(s) vinculado(s)` : ""}.`,
        metadata: {
          source: "clicksign",
          action: d.action,
          signer_name: d.name,
          signer_email: d.email || null,
          signer_doc: digits || null,
          documents_linked: targets.length,
          at: new Date().toISOString(),
        } as never,
        created_by: userId,
      });
    }


    return { created, linked };
  });

/** Quantos registros seriam apagados se a integração for desativada. */
export const getClicksignPurgePreview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [docs, owners, providers] = await Promise.all([
      supabase.from("clicksign_documents").select("id", { count: "exact", head: true }).eq("account_owner_id", userId),
      supabase.from("property_owners").select("id", { count: "exact", head: true })
        .eq("account_owner_id", userId).eq("created_via", "clicksign"),
      supabase.from("service_providers").select("id", { count: "exact", head: true })
        .eq("account_owner_id", userId).eq("created_via", "clicksign"),
    ]);
    return {
      documents: docs.count ?? 0,
      owners: owners.count ?? 0,
      providers: providers.count ?? 0,
    };
  });
