import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Stakeholders = Proprietários (property_owners) + Prestadores (service_providers).
// Ambas as entidades compartilham ficha, linha do tempo (stakeholder_events) e
// quadro de atividades (stakeholder_activities).
// ---------------------------------------------------------------------------

const Kind = z.enum(["owner", "provider"]);
type KindT = z.infer<typeof Kind>;

const TABLE: Record<KindT, "property_owners" | "service_providers"> = {
  owner: "property_owners",
  provider: "service_providers",
};

// A conta ativa: a própria (se o usuário tem guias) ou a única conta da qual
// ele é membro ativo. Mantém a Fase 1 simples e previsível.
async function resolveAccountOwnerId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const [{ data: own }, { data: memberships }] = await Promise.all([
    supabase.from("properties").select("id").eq("owner_id", userId).limit(1),
    supabase
      .from("account_members")
      .select("owner_id")
      .eq("member_user_id", userId)
      .eq("status", "active"),
  ]);
  if ((own ?? []).length > 0) return userId;
  const ids = Array.from(new Set((memberships ?? []).map((m) => m.owner_id as string)));
  if (ids.length === 1) return ids[0];
  return userId;
}

const ListInput = z.object({ kind: Kind });

export const listStakeholders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const accountId = await resolveAccountOwnerId(supabase, userId);
    const { data: rows, error } = await supabase
      .from(TABLE[data.kind])
      .select("*")
      .eq("account_owner_id", accountId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: acts } = await supabase
      .from("stakeholder_activities")
      .select("id, stakeholder_id, status, title, due_date, priority")
      .eq("account_owner_id", accountId)
      .eq("stakeholder_type", data.kind);

    const { data: props } =
      data.kind === "owner"
        ? await supabase.from("properties").select("id, name, owner_contact_id").eq("owner_id", accountId)
        : { data: [] as Array<{ id: string; name: string; owner_contact_id: string | null }> };

    return {
      accountId,
      rows: rows ?? [],
      activities: acts ?? [],
      properties: props ?? [],
    };
  });

const SaveInput = z.object({
  kind: Kind,
  id: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(160),
  trade_name: z.string().trim().max(160).optional().nullable(),
  category: z.string().trim().max(60).optional().nullable(),
  person_type: z.enum(["pf", "pj"]).default("pf"),
  doc_type: z.enum(["cpf", "cnpj"]).default("cpf"),
  doc: z.string().trim().max(40).optional().nullable(),
  birth_date: z.string().trim().max(20).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  phone_country: z.string().trim().max(4).optional().nullable(),
  cep: z.string().trim().max(12).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  district: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  state: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  status: z.enum(["active", "inactive"]).default("active"),
});

function onlyDigits(v?: string | null) {
  return (v ?? "").replace(/\D+/g, "");
}

function isValidCPFDigits(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (base: string, factor: number) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += Number(base[i]) * (factor - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(d.slice(0, 9), 10) === Number(d[9]) && calc(d.slice(0, 10), 11) === Number(d[10]);
}

function isValidCNPJDigits(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base: string) => {
    const weights =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += Number(base[i]) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(d.slice(0, 12)) === Number(d[12]) && calc(d.slice(0, 13)) === Number(d[13]);
}

export const saveStakeholder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SaveInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const accountId = await resolveAccountOwnerId(supabase, userId);
    const { kind, id, category, ...rest } = data;

    // Validação real do documento no servidor (dígitos verificadores oficiais).
    const doc = onlyDigits(rest.doc);
    if (doc) {
      if (rest.doc_type === "cnpj" && !isValidCNPJDigits(doc)) throw new Error("CNPJ inválido.");
      if (rest.doc_type === "cpf" && !isValidCPFDigits(doc)) throw new Error("CPF inválido.");
    }

    const payload: Record<string, unknown> = {
      ...rest,
      doc: doc || null,
      phone: onlyDigits(rest.phone) || null,
      cep: onlyDigits(rest.cep) || null,
      account_owner_id: accountId,
    };
    if (kind === "provider") payload.category = category || "outros";


    if (id) {
      const { error } = await supabase
        .from(TABLE[kind])
        .update(payload as never)
        .eq("id", id)
        .eq("account_owner_id", accountId);
      if (error) throw new Error(error.message);
      await supabase.from("stakeholder_events").insert({
        account_owner_id: accountId,
        stakeholder_type: kind,
        stakeholder_id: id,
        kind: "update",
        message: "Cadastro atualizado.",
        created_by: userId,
      });
      return { ok: true, id };
    }

    const { data: inserted, error } = await supabase
      .from(TABLE[kind])
      .insert({ ...payload, created_by: userId } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await supabase.from("stakeholder_events").insert({
      account_owner_id: accountId,
      stakeholder_type: kind,
      stakeholder_id: inserted.id as string,
      kind: "create",
      message: "Cadastro criado.",
      created_by: userId,
    });
    return { ok: true, id: inserted.id as string };
  });

const IdInput = z.object({ kind: Kind, id: z.string().uuid() });

export const deleteStakeholder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => IdInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const accountId = await resolveAccountOwnerId(supabase, userId);
    const { error } = await supabase
      .from(TABLE[data.kind])
      .delete()
      .eq("id", data.id)
      .eq("account_owner_id", accountId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getStakeholderDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => IdInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const accountId = await resolveAccountOwnerId(supabase, userId);
    const [{ data: row }, { data: events }, { data: activities }] = await Promise.all([
      supabase.from(TABLE[data.kind]).select("*").eq("id", data.id).eq("account_owner_id", accountId).maybeSingle(),
      supabase
        .from("stakeholder_events")
        .select("*")
        .eq("account_owner_id", accountId)
        .eq("stakeholder_type", data.kind)
        .eq("stakeholder_id", data.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("stakeholder_activities")
        .select("*")
        .eq("account_owner_id", accountId)
        .eq("stakeholder_type", data.kind)
        .eq("stakeholder_id", data.id)
        .order("created_at", { ascending: false }),
    ]);
    type PropRow = {
      id: string;
      name: string;
      slug: string;
      published: boolean;
      city: string | null;
      state: string | null;
      owner_contact_id: string | null;
    };
    let properties: PropRow[] = [];
    let availableProperties: PropRow[] = [];

    if (data.kind === "owner") {
      const { data: all } = await supabase
        .from("properties")
        .select("id, name, slug, published, city, state, owner_contact_id")
        .eq("owner_id", accountId)
        .order("name");
      properties = (all ?? []).filter((p) => p.owner_contact_id === data.id);
      availableProperties = (all ?? []).filter((p) => !p.owner_contact_id);
    }
    return {
      row: row ?? null,
      events: events ?? [],
      activities: activities ?? [],
      properties,
      availableProperties,
    };
  });

const LinkInput = z.object({
  ownerId: z.string().uuid(),
  propertyId: z.string().uuid(),
  link: z.boolean(),
});

// Vincula (ou desvincula) uma residência ao proprietário.
export const linkPropertyToOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => LinkInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const accountId = await resolveAccountOwnerId(supabase, userId);
    const { data: owner } = await supabase
      .from("property_owners")
      .select("id, name")
      .eq("id", data.ownerId)
      .eq("account_owner_id", accountId)
      .maybeSingle();
    if (!owner) throw new Error("Proprietário não encontrado");

    const { error } = await supabase
      .from("properties")
      .update({ owner_contact_id: data.link ? data.ownerId : null })
      .eq("id", data.propertyId)
      .eq("owner_id", accountId);
    if (error) throw new Error(error.message);

    await supabase.from("stakeholder_events").insert({
      account_owner_id: accountId,
      stakeholder_type: "owner",
      stakeholder_id: data.ownerId,
      kind: "property",
      message: data.link ? "Residência vinculada ao proprietário" : "Residência desvinculada",
      created_by: userId,
    });
    return { ok: true };
  });


const NoteInput = z.object({
  kind: Kind,
  id: z.string().uuid(),
  message: z.string().trim().min(1).max(2000),
});

export const addStakeholderNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => NoteInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const accountId = await resolveAccountOwnerId(supabase, userId);
    const { error } = await supabase.from("stakeholder_events").insert({
      account_owner_id: accountId,
      stakeholder_type: data.kind,
      stakeholder_id: data.id,
      kind: "note",
      message: data.message,
      created_by: userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ActivityInput = z.object({
  kind: Kind,
  stakeholderId: z.string().uuid(),
  id: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(["todo", "doing", "done"]).default("todo"),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  due_date: z.string().trim().max(20).optional().nullable(),
});

export const saveStakeholderActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ActivityInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const accountId = await resolveAccountOwnerId(supabase, userId);
    const payload = {
      account_owner_id: accountId,
      stakeholder_type: data.kind,
      stakeholder_id: data.stakeholderId,
      title: data.title,
      description: data.description || null,
      status: data.status,
      priority: data.priority,
      due_date: data.due_date || null,
    };
    if (data.id) {
      const { error } = await supabase
        .from("stakeholder_activities")
        .update(payload)
        .eq("id", data.id)
        .eq("account_owner_id", accountId);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: ins, error } = await supabase
      .from("stakeholder_activities")
      .insert({ ...payload, created_by: userId } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await supabase.from("stakeholder_events").insert({
      account_owner_id: accountId,
      stakeholder_type: data.kind,
      stakeholder_id: data.stakeholderId,
      kind: "activity",
      message: `Atividade criada: ${data.title}`,
      created_by: userId,
    });
    return { ok: true, id: ins.id as string };
  });

const ActivityStatusInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["todo", "doing", "done"]),
});

export const setStakeholderActivityStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ActivityStatusInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const accountId = await resolveAccountOwnerId(supabase, userId);
    const { error } = await supabase
      .from("stakeholder_activities")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("account_owner_id", accountId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteStakeholderActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const accountId = await resolveAccountOwnerId(supabase, userId);
    const { error } = await supabase
      .from("stakeholder_activities")
      .delete()
      .eq("id", data.id)
      .eq("account_owner_id", accountId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Usado pela página de Guias: bloqueia a criação de guia sem proprietário.
export const countPropertyOwners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const accountId = await resolveAccountOwnerId(supabase, userId);
    const { count } = await supabase
      .from("property_owners")
      .select("id", { count: "exact", head: true })
      .eq("account_owner_id", accountId)
      .eq("status", "active");
    return { count: count ?? 0 };
  });
