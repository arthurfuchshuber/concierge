import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Ficha do proprietário: lançamentos financeiros (a receber / a pagar) e
// documentos avulsos (PDF anexado direto, sem passar pelo ClickSign).
// ---------------------------------------------------------------------------

const Scope = z.object({
  ownerId: z.string().uuid(),
  accountOwnerId: z.string().uuid().optional().nullable(),
});

async function scope(
  supabase: Parameters<
    typeof import("@/lib/account-scope.server").resolveAuthorizedAccountOwnerId
  >[0],
  userId: string,
  data: z.infer<typeof Scope>,
) {
  const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
  const accountId = await resolveAuthorizedAccountOwnerId(supabase, userId, data.accountOwnerId);
  // O proprietário precisa pertencer à conta.
  const { data: owner } = await supabase
    .from("property_owners")
    .select("id")
    .eq("id", data.ownerId)
    .eq("account_owner_id", accountId)
    .maybeSingle();
  if (!owner) throw new Error("Proprietário não encontrado.");
  return accountId;
}

export type LedgerEntry = {
  id: string;
  direction: "receivable" | "payable";
  description: string;
  amount: number;
  due_date: string;
  paid_at: string | null;
  property_id: string | null;
  created_at: string;
};

export const listOwnerLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Scope.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const accountId = await scope(supabase, userId, data);
    const { data: rows, error } = await supabase
      .from("owner_ledger_entries")
      .select("id, direction, description, amount, due_date, paid_at, property_id, created_at")
      .eq("account_owner_id", accountId)
      .eq("stakeholder_id", data.ownerId)
      .order("due_date", { ascending: false });
    if (error) throw new Error(error.message);
    return {
      entries: (rows ?? []).map((r) => ({ ...r, amount: Number(r.amount) })) as LedgerEntry[],
    };
  });

const EntryInput = Scope.extend({
  id: z.string().uuid().optional(),
  direction: z.enum(["receivable", "payable"]),
  description: z.string().trim().min(1, "Informe a descrição.").max(160),
  amount: z.number().finite().min(0).max(999_999_999),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  propertyId: z.string().uuid().optional().nullable(),
  paid: z.boolean(),
});

export const saveOwnerLedgerEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => EntryInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const accountId = await scope(supabase, userId, data);
    if (data.propertyId) {
      const { data: p } = await supabase
        .from("properties")
        .select("id")
        .eq("id", data.propertyId)
        .eq("owner_id", accountId)
        .maybeSingle();
      if (!p) throw new Error("Imóvel não encontrado.");
    }
    const base = {
      direction: data.direction,
      description: data.description,
      amount: data.amount,
      due_date: data.dueDate,
      property_id: data.propertyId ?? null,
    };
    if (data.id) {
      // Preserva a data de pagamento original se já estava pago e continua pago.
      const { data: cur } = await supabase
        .from("owner_ledger_entries")
        .select("paid_at")
        .eq("id", data.id)
        .eq("account_owner_id", accountId)
        .maybeSingle();
      const paid_at = data.paid ? (cur?.paid_at ?? new Date().toISOString()) : null;
      const { error } = await supabase
        .from("owner_ledger_entries")
        .update({ ...base, paid_at })
        .eq("id", data.id)
        .eq("account_owner_id", accountId)
        .eq("stakeholder_id", data.ownerId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: ins, error } = await supabase
      .from("owner_ledger_entries")
      .insert({
        ...base,
        account_owner_id: accountId,
        stakeholder_id: data.ownerId,
        paid_at: data.paid ? new Date().toISOString() : null,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: ins.id as string };
  });

export const setOwnerLedgerPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    Scope.extend({ id: z.string().uuid(), paid: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const accountId = await scope(supabase, userId, data);
    const { error } = await supabase
      .from("owner_ledger_entries")
      .update({ paid_at: data.paid ? new Date().toISOString() : null })
      .eq("id", data.id)
      .eq("account_owner_id", accountId)
      .eq("stakeholder_id", data.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteOwnerLedgerEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Scope.extend({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const accountId = await scope(supabase, userId, data);
    const { error } = await supabase
      .from("owner_ledger_entries")
      .delete()
      .eq("id", data.id)
      .eq("account_owner_id", accountId)
      .eq("stakeholder_id", data.ownerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ------------------------- documentos avulsos -------------------------

export type LooseDoc = { id: string; name: string; size_bytes: number | null; created_at: string };

const BUCKET = "owner-documents";
const MAX_BYTES = 15 * 1024 * 1024;

export const listOwnerLooseDocs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Scope.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const accountId = await scope(supabase, userId, data);
    const { data: rows, error } = await supabase
      .from("owner_loose_documents")
      .select("id, name, size_bytes, created_at")
      .eq("account_owner_id", accountId)
      .eq("stakeholder_id", data.ownerId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { docs: (rows ?? []) as LooseDoc[] };
  });

export const uploadOwnerLooseDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    Scope.extend({
      name: z.string().trim().min(1).max(200),
      base64: z.string().min(8),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const accountId = await scope(supabase, userId, data);
    const buf = Buffer.from(data.base64, "base64");
    if (buf.length === 0 || buf.length > MAX_BYTES) {
      throw new Error("O PDF precisa ter até 15 MB.");
    }
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new Error("O arquivo precisa ser um PDF.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = `${accountId}/${data.ownerId}/${crypto.randomUUID()}.pdf`;
    const up = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buf, { contentType: "application/pdf", upsert: false });
    if (up.error) throw new Error(up.error.message);
    const { data: ins, error } = await supabase
      .from("owner_loose_documents")
      .insert({
        account_owner_id: accountId,
        stakeholder_id: data.ownerId,
        name: data.name.replace(/\.pdf$/i, ""),
        storage_path: path,
        size_bytes: buf.length,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) {
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
      throw new Error(error.message);
    }
    return { id: ins.id as string };
  });

export const getOwnerLooseDocFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // RLS garante que só a conta (ou membro) enxerga o registro.
    const { data: doc } = await supabase
      .from("owner_loose_documents")
      .select("storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (!doc) throw new Error("Documento não encontrado.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const dl = await supabaseAdmin.storage.from(BUCKET).download(doc.storage_path as string);
    if (dl.error || !dl.data) throw new Error("Arquivo indisponível.");
    const base64 = Buffer.from(await dl.data.arrayBuffer()).toString("base64");
    return { base64 };
  });

export const deleteOwnerLooseDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: doc } = await supabase
      .from("owner_loose_documents")
      .select("storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (!doc) throw new Error("Documento não encontrado.");
    const { error } = await supabase.from("owner_loose_documents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.storage.from(BUCKET).remove([doc.storage_path as string]);
    return { ok: true };
  });
