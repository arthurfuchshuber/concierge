import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * DIRECIONAMENTO PONTUAL DE LIMPEZA (pedido explícito, 29/09/2026).
 * `guest_arrival_status.assigned_provider_id` vale só para aquela limpeza;
 * sem ele, o responsável é o prestador vinculado ao imóvel.
 */

export type CleaningProvider = { id: string; name: string; avatarUrl: string | null };

export const getCleaningProviderBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        propertyIds: z.array(z.string().uuid()).max(2000).optional(),
        ownerId: z.string().uuid().nullable().optional(),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    // ISOLAMENTO POR CONTA: tudo aqui fica restrito à conta ativa validada.
    const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
    const ownerId = await resolveAuthorizedAccountOwnerId(sb, context.userId, data.ownerId ?? null);
    const empty = {
      providers: [] as CleaningProvider[],
      defaults: {} as Record<string, string>,
      assigned: {} as Record<string, string>,
    };
    const q = sb.from("properties").select("id, owner_id").eq("owner_id", ownerId).limit(2000);
    const { data: props } = data.propertyIds ? await q.in("id", data.propertyIds) : await q;
    const propIds = (props ?? []).map((p) => p.id as string);
    if (propIds.length === 0) return empty;

    const [{ data: provs }, { data: links }, { data: rows }] = await Promise.all([
      sb
        .from("service_providers")
        .select("id, name, trade_name, member_user_id, status")
        .eq("account_owner_id", ownerId)
        .order("name"),
      sb.from("property_providers").select("property_id, provider_id").in("property_id", propIds),
      sb
        .from("guest_arrival_status")
        .select("log_id, reservation_id, assigned_provider_id")
        .in("property_id", propIds)
        .eq("kind", "checkout")
        .not("assigned_provider_id", "is", null)
        .limit(5000),
    ]);

    const provIds = new Set((provs ?? []).map((p) => p.id));
    const list = (provs ?? []).filter((p) => (p.status ?? "").toLowerCase() !== "cancelado" && (p.status ?? "") !== "canceled");
    const userIds = list.map((p) => p.member_user_id).filter(Boolean) as string[];
    const avatars = new Map<string, string | null>();
    if (userIds.length) {
      const { data: profs } = await sb.from("profiles").select("id, avatar_url").in("id", userIds);
      for (const p of profs ?? []) avatars.set(p.id, p.avatar_url);
    }
    const providers: CleaningProvider[] = list.map((p) => ({
      id: p.id,
      name: (p.trade_name || p.name || "Prestador").trim(),
      avatarUrl: p.member_user_id ? (avatars.get(p.member_user_id) ?? null) : null,
    }));
    const defaults: Record<string, string> = {};
    for (const l of links ?? [])
      if (!defaults[l.property_id] && provIds.has(l.provider_id)) defaults[l.property_id] = l.provider_id;
    const assigned: Record<string, string> = {};
    for (const r of rows ?? []) {
      if (r.reservation_id) assigned[`r:${r.reservation_id}`] = r.assigned_provider_id as string;
      if (r.log_id) assigned[`l:${r.log_id}`] = r.assigned_provider_id as string;
    }
    return { providers, defaults, assigned };
  });

export const setCleaningAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        propertyId: z.string().uuid(),
        logId: z.string().uuid().nullable().optional(),
        reservationId: z.string().uuid().nullable().optional(),
        providerId: z.string().uuid().nullable(),
      })
      .refine((v) => !!v.logId || !!v.reservationId)
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    // Prestador precisa ser da MESMA conta do imóvel — nunca cruza contas.
    if (data.providerId) {
      const [{ data: prop }, { data: prov }] = await Promise.all([
        sb.from("properties").select("owner_id").eq("id", data.propertyId).maybeSingle(),
        sb.from("service_providers").select("account_owner_id").eq("id", data.providerId).maybeSingle(),
      ]);
      if (!prop?.owner_id || !prov || prov.account_owner_id !== prop.owner_id) {
        throw new Error("Este prestador não pertence à conta deste imóvel.");
      }
    }
    let existingId: string | null = null;
    for (const [col, val] of [
      ["reservation_id", data.reservationId],
      ["log_id", data.logId],
    ] as const) {
      if (!val || existingId) continue;
      const { data: r } = await sb
        .from("guest_arrival_status")
        .select("id")
        .eq(col, val)
        .eq("kind", "checkout")
        .limit(1);
      existingId = r?.[0]?.id ?? null;
    }
    const patch = { assigned_provider_id: data.providerId } as never;
    const { error } = existingId
      ? await sb.from("guest_arrival_status").update(patch).eq("id", existingId)
      : await sb.from("guest_arrival_status").insert({
          property_id: data.propertyId,
          kind: "checkout",
          status: "pending",
          log_id: data.logId ?? null,
          reservation_id: data.reservationId ?? null,
          assigned_provider_id: data.providerId,
        } as never);
    if (error) throw new Error("Você não tem permissão para direcionar esta limpeza.");
    try {
      await sb.from("audit_logs").insert({
        user_id: context.userId,
        action: "cleaning_assign_provider",
        table_name: "guest_arrival_status",
        record_id: existingId,
        new_data: { providerId: data.providerId, reservationId: data.reservationId, logId: data.logId },
      } as never);
    } catch {
      /* best-effort */
    }
    return { ok: true };
  });
