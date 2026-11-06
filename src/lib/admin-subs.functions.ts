import { createServerFn } from "@tanstack/react-start";
import { untypedTable } from "@/lib/untyped-table";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(supabase: any, userId: string) {
  const { retryDbResult, isTemporaryDbError } = await import("@/lib/db-errors.server");
  const { data, error } = await retryDbResult<{ data: unknown; error: { code?: string; message?: string } | null }>(
    () => supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
  );
  if (error) {
    console.error("[assertAdmin]", error);
    throw new Error(
      isTemporaryDbError(error)
        ? "O sistema de dados está se reconectando. Aguarde alguns segundos e tente de novo."
        : "Erro ao verificar permissão",
    );
  }
  if (!data) throw new Error("Acesso negado: apenas administradores");
}

export const checkIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    return { isAdmin: !!data };
  });

export const adminListUserProperties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ userId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: props, error } = await supabaseAdmin
      .from("properties")
      .select("id, name, slug, city, published, updated_at, hero_image_url")
      .eq("owner_id", data.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error("Erro ao carregar guias");
    return { properties: props ?? [] };
  });


export type AdminCustomerRow = {
  userId: string;
  email: string | null;
  fullName: string | null;
  cpf: string | null;
  phone: string | null;
  phoneCountry: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  // Status do próprio usuário (independente da assinatura).
  // "active" = login confirmado e não banido; "blocked" = bloqueado; "pending" = nunca logou.
  userStatus: "active" | "blocked" | "pending";
  totalGuides: number;
  publishedGuides: number;
  avgCompletenessScore: number;
  lastEditedAt: string | null;
  guestAccesses30d: number;
  churnRisk: boolean;
  subscription: {
    id: string;
    /** Rótulo da condição: "Tabela oficial", "Condição negociada", "Cortesia" ou "Liberação manual". */
    planLabel: string;
    kind: "official" | "custom" | "courtesy" | "manual";
    status: string;
    environment: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    adminNotes: string | null;
    isManual: boolean;
    hasStripeBilling: boolean;
    listingQuantity: number | null;
    /** Valor mensal pela quantidade cobrada e pela condição da conta (centavos). */
    monthlyCents: number | null;
    maxGuidesOverride: number | null;
    billingPaused: boolean;
  } | null;
};


export const adminListCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ customers: AdminCustomerRow[] }> => {
    await assertAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Todas as páginas de usuários (sem teto de 1000).
    const usersData = { users: await (await import("@/lib/admin-users.server")).listAllAuthUsers() };

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, trade_name, cpf, phone, phone_country");


    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select(
        "id, user_id, stripe_subscription_id, status, environment, current_period_start, current_period_end, cancel_at_period_end, trial_ends_at, admin_notes, is_manual, max_guides_override, billing_paused, listing_quantity, created_at",
      )
      .order("created_at", { ascending: false });
    const { data: termsRows } = await (supabaseAdmin as any)
      .from("billing_terms")
      .select("owner_id, unit_cents, min_units, courtesy, billing_starts_at");
    const termsMap = new Map<string, any>(((termsRows ?? []) as any[]).map((t) => [t.owner_id, t]));
    const L = await import("@/lib/billing/listing-billing");

    // Enrich: fetch all properties with completeness signals
    const { data: allProps } = await supabaseAdmin
      .from("properties")
      .select("id, owner_id, published, updated_at, name, wifi_ssid, wifi_password, checkin_instructions, house_rules, tagline, hero_image_url");

    // Guide access logs last 30 days — for guest activity per host
    const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { data: recentLogs } = await supabaseAdmin
      .from("guide_access_logs")
      .select("property_id, created_at")
      .gte("created_at", since30);

    // Map property_id → owner_id for guest count rollup
    const propOwnerMap = new Map<string, string>();
    const propsByOwner = new Map<string, typeof allProps>();
    for (const p of allProps ?? []) {
      propOwnerMap.set(p.id, p.owner_id);
      const arr = propsByOwner.get(p.owner_id) ?? [];
      arr.push(p);
      propsByOwner.set(p.owner_id, arr);
    }

    // Guest accesses per owner in last 30 days
    const guestAccessByOwner = new Map<string, number>();
    for (const l of recentLogs ?? []) {
      const ownerId = propOwnerMap.get(l.property_id);
      if (ownerId) guestAccessByOwner.set(ownerId, (guestAccessByOwner.get(ownerId) ?? 0) + 1);
    }

    // Guide completeness score (0–100) per property
    function guideScore(p: NonNullable<typeof allProps>[number]): number {
      let score = 0;
      if (p.published) score += 20;
      if (p.hero_image_url) score += 15;
      if (p.tagline) score += 10;
      if (p.wifi_ssid) score += 15;
      if (p.checkin_instructions) score += 20;
      if (p.house_rules) score += 10;
      if (p.wifi_password) score += 10;
      return Math.min(score, 100);
    }

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    // Latest sub per user
    const subMap = new Map<string, NonNullable<typeof subs>[number]>();
    for (const s of subs ?? []) {
      if (!subMap.has(s.user_id)) subMap.set(s.user_id, s);
    }

    const customers: AdminCustomerRow[] = usersData.users.map((u) => {
      const s = subMap.get(u.id);
      const props = propsByOwner.get(u.id) ?? [];
      const totalGuides = props.length;
      const publishedGuides = props.filter((p) => p.published).length;
      const avgScore = totalGuides > 0
        ? Math.round(props.reduce((sum, p) => sum + guideScore(p), 0) / totalGuides)
        : 0;
      const lastEditedAt = props.reduce<string | null>((acc, p) => {
        const t = p.updated_at as string | null;
        if (!t) return acc;
        return !acc || t > acc ? t : acc;
      }, null);
      const guestAccesses30d = guestAccessByOwner.get(u.id) ?? 0;
      // Churn risk: active sub + no login in 14d + no guest accesses in 30d
      const lastLogin = (u as { last_sign_in_at?: string }).last_sign_in_at ?? null;
      const bannedUntil = (u as { banned_until?: string | null }).banned_until ?? null;
      const isBlocked = !!bannedUntil && new Date(bannedUntil).getTime() > Date.now();
      const userStatus: "active" | "blocked" | "pending" = isBlocked
        ? "blocked"
        : lastLogin
          ? "active"
          : "pending";
      const daysSinceLogin = lastLogin
        ? Math.floor((Date.now() - new Date(lastLogin).getTime()) / 86400_000)
        : 999;
      const churnRisk =
        (s?.status === "active" || s?.status === "trialing") &&
        daysSinceLogin > 14 &&
        guestAccesses30d === 0;

      const prof = profileMap.get(u.id);
      return {
        userId: u.id,
        email: u.email ?? null,
        fullName: ((prof as { trade_name?: string | null } | undefined)?.trade_name) || (prof as { full_name?: string | null } | undefined)?.full_name || null,
        cpf: (prof as { cpf?: string | null } | undefined)?.cpf ?? null,
        phone: (prof as { phone?: string | null } | undefined)?.phone ?? null,
        phoneCountry: (prof as { phone_country?: string | null } | undefined)?.phone_country ?? null,
        createdAt: u.created_at ?? null,
        lastSignInAt: lastLogin,
        userStatus,

        totalGuides,
        publishedGuides,
        avgCompletenessScore: avgScore,
        lastEditedAt,
        guestAccesses30d,
        churnRisk,
        subscription: s
          ? (() => {
              const t = termsMap.get(u.id);
              const terms = t
                ? { unitCents: t.unit_cents ?? null, minUnits: t.min_units ?? null, courtesy: !!t.courtesy, billingStartsAt: t.billing_starts_at ?? null }
                : L.STANDARD_TERMS;
              const kind: "official" | "custom" | "courtesy" | "manual" = s.is_manual && !s.stripe_subscription_id
                ? "manual"
                : terms.courtesy
                  ? "courtesy"
                  : L.hasCustomPricing(terms)
                    ? "custom"
                    : "official";
              const qty = (s as { listing_quantity?: number | null }).listing_quantity ?? null;
              return {
                id: s.id,
                planLabel: { official: "Tabela oficial", custom: "Condição negociada", courtesy: "Cortesia", manual: "Liberação manual" }[kind],
                kind,
                status: s.status,
                environment: s.environment,
                currentPeriodStart: s.current_period_start,
                currentPeriodEnd: s.current_period_end,
                trialEndsAt: s.trial_ends_at,
                cancelAtPeriodEnd: !!s.cancel_at_period_end,
                adminNotes: s.admin_notes,
                isManual: !!s.is_manual,
                hasStripeBilling: !!s.stripe_subscription_id,
                listingQuantity: qty,
                monthlyCents: kind === "manual" ? null : L.monthlyTotalCents(s.billing_paused ? 0 : (qty ?? 0), terms),
                maxGuidesOverride: s.max_guides_override ?? null,
                billingPaused: !!s.billing_paused,
              };
            })()
          : null,
      };
    });

    // Sort: churn risk first, then active, then by created
    customers.sort((a, b) => {
      if (a.churnRisk && !b.churnRisk) return -1;
      if (!a.churnRisk && b.churnRisk) return 1;
      const sa = a.subscription?.status === "active" ? 0 : 1;
      const sb = b.subscription?.status === "active" ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    });

    return { customers };
  });

/**
 * Admin › Editar Assinatura (Stripe). Status, período e valores vêm da Stripe e não são editados
 * aqui; a condição comercial fica em `adminSaveBillingTerms`. Aqui: notas internas, limite de
 * guias e cancelamento no fim do ciclo (aplicado na Stripe).
 */
export const adminUpdateSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; adminNotes: string | null; maxGuidesOverride: number | null; cancelAtPeriodEnd: boolean }) =>
    z
      .object({
        userId: z.string().uuid(),
        adminNotes: z.string().max(2000).nullable(),
        maxGuidesOverride: z.number().int().min(1).max(100000).nullable(),
        cancelAtPeriodEnd: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await (supabaseAdmin as any)
      .from("subscriptions")
      .select("id, stripe_subscription_id, cancel_at_period_end")
      .eq("user_id", data.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!existing) throw new Error("Este cliente ainda não assinou. Defina a condição comercial e envie o link de cadastro.");

    if (existing.stripe_subscription_id && !!existing.cancel_at_period_end !== data.cancelAtPeriodEnd) {
      const { stripeRequest } = await import("@/lib/billing/stripe.server");
      const { upsertSubscriptionFromStripe } = await import("@/lib/billing/billing-sync.server");
      const sub = await stripeRequest<any>("POST", `/subscriptions/${encodeURIComponent(existing.stripe_subscription_id)}`, {
        cancel_at_period_end: data.cancelAtPeriodEnd,
      });
      await upsertSubscriptionFromStripe(sub);
    }

    const { error } = await (supabaseAdmin as any)
      .from("subscriptions")
      .update({ admin_notes: data.adminNotes, max_guides_override: data.maxGuidesOverride })
      .eq("id", existing.id);
    if (error) throw new Error("Erro ao atualizar assinatura");
    const { invalidateOwnerPlanCache } = await import("@/lib/plan-guard.server");
    invalidateOwnerPlanCache(data.userId);

    await untypedTable(supabaseAdmin, "audit_logs").insert({
      user_id: context.userId,
      user_email: (context as { claims?: { email?: string } }).claims?.email ?? null,
      action: "subscription.updated",
      entity_type: "subscriptions",
      entity_id: data.userId,
      metadata: {
        adminNotes: data.adminNotes,
        maxGuidesOverride: data.maxGuidesOverride,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd,
      },
    });
    return { ok: true };
  });

// Atualiza o nome do cliente (profiles.full_name) — usado dentro do diálogo
// "Editar assinatura" para permitir corrigir o nome exibido.
export const adminUpdateCustomerProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    userId: string;
    fullName: string | null;
    cpf?: string | null;
    phone?: string | null;
    phoneCountry?: string | null;
  }) =>
    z.object({
      userId: z.string().uuid(),
      fullName: z.string().trim().max(120).nullable(),
      cpf: z.string().trim().regex(/^[0-9]{11}$/, "CPF inválido").nullable().optional(),
      phone: z.string().trim().max(40).nullable().optional(),
      phoneCountry: z.string().trim().max(4).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: {
      id: string;
      full_name: string | null;
      cpf?: string | null;
      phone?: string | null;
      phone_country?: string | null;
    } = {
      id: data.userId,
      full_name: data.fullName ?? null,
    };
    if (data.cpf !== undefined) patch.cpf = data.cpf ?? null;
    if (data.phone !== undefined) patch.phone = data.phone ?? null;
    if (data.phoneCountry !== undefined) patch.phone_country = data.phoneCountry ?? null;
    const { error } = await supabaseAdmin
      .from("profiles")
      .upsert(patch, { onConflict: "id" });

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        const msg = String(error.message ?? "");
        if (msg.includes("profiles_cpf_unique_digits")) {
          const digits = (data.cpf ?? "").replace(/\D+/g, "");
          const label = digits.length === 14 ? "CNPJ" : "CPF";
          throw new Error(`Este ${label} já está cadastrado em outra conta.`);
        }
        if (msg.includes("profiles_phone_unique_digits")) {
          throw new Error("Este telefone já está cadastrado em outra conta.");
        }
        throw new Error("Este dado já está cadastrado em outra conta.");
      }
      throw new Error("Não foi possível atualizar os dados do cliente.");
    }

    await untypedTable(supabaseAdmin, "audit_logs").insert({
      user_id: context.userId,
      user_email: (context as { claims?: { email?: string } }).claims?.email ?? null,
      action: "customer.profile_updated",
      entity_type: "profiles",
      entity_id: data.userId,
      metadata: {
        fullNameChanged: data.fullName !== undefined,
        cpfChanged: data.cpf !== undefined,
        phoneChanged: data.phone !== undefined,
      },
    });

    return { ok: true };
  });




// ───────────────── SaaS Admins (user_roles management) ─────────────────

export type SaasAdminRow = {
  userId: string;
  email: string | null;
  fullName: string | null;
  createdAt: string | null;
};

export const adminListSaasAdmins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ admins: SaasAdminRow[]; selfUserId: string }> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roleRows, error: rolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    if (rolesErr) throw new Error("Erro ao listar admins");

    const ids = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)));
    if (ids.length === 0) return { admins: [], selfUserId: context.userId };

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, trade_name")
      .in("id", ids);
    const profileMap = new Map((profiles ?? []).map((p) => [p.id, ((p as { trade_name?: string | null }).trade_name) || p.full_name]));

    const usersData = { users: await (await import("@/lib/admin-users.server")).listAllAuthUsers() };
    const userMap = new Map((usersData?.users ?? []).map((u) => [u.id, u]));

    const admins: SaasAdminRow[] = ids.map((id) => {
      const u = userMap.get(id);
      return {
        userId: id,
        email: u?.email ?? null,
        fullName: profileMap.get(id) ?? null,
        createdAt: u?.created_at ?? null,
      };
    });
    admins.sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
    return { admins, selfUserId: context.userId };
  });

export const adminGrantSaasAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string }) =>
    z.object({ email: z.string().email() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const target = data.email.trim().toLowerCase();
    let found: { id: string; email?: string | null } | null = null;
    for (let page = 1; page <= 10; page++) {
      const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error("Erro ao buscar usuário");
      const match = list.users.find((u) => (u.email ?? "").toLowerCase() === target);
      if (match) { found = match; break; }
      if (list.users.length < 1000) break;
    }

    async function audit(action: string, entity_id: string | null, metadata: Record<string, unknown>) {
      await untypedTable(supabaseAdmin, "audit_logs").insert({
        user_id: context.userId,
        user_email: (context as { claims?: { email?: string } }).claims?.email ?? null,
        action,
        entity_type: "admin",
        entity_id,
        metadata,
      });
    }

    if (found) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: found.id, role: "admin" });
      if (error && !String(error.message).toLowerCase().includes("duplicate")) {
        throw new Error("Erro ao conceder admin");
      }
      await audit("admin.granted", found.id, { email: target });
      return { ok: true, userId: found.id, invited: false };
    }

    try {
      await supabaseAdmin.auth.admin.inviteUserByEmail(target);
    } catch (e) {
      console.warn("[admin-invite] inviteUserByEmail failed:", e);
    }

    const inviteTable = untypedTable(supabaseAdmin, "admin_invites");
    const { data: inv, error: invErr } = await inviteTable
      .upsert(
        { email: target, invited_by: context.userId, status: "pending" },
        { onConflict: "email" },
      )
      .select("id")
      .maybeSingle();
    if (invErr) throw new Error("Não foi possível registrar o convite. Tente novamente.");

    await audit("admin.invited", inv?.id ?? null, { email: target });
    return { ok: true, userId: null, invited: true };
  });

export const adminRevokeSaasAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) =>
    z.object({ userId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.userId === context.userId) {
      throw new Error("Você não pode remover seu próprio acesso admin.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", "admin");
    if (error) throw new Error("Erro ao revogar admin");
    await untypedTable(supabaseAdmin, "audit_logs").insert({
      user_id: context.userId,
      user_email: (context as { claims?: { email?: string } }).claims?.email ?? null,
      action: "admin.revoked",
      entity_type: "admin",
      entity_id: data.userId,
      metadata: {},
    });
    return { ok: true };
  });

// ───────────────── Pending invites & audit logs ─────────────────

export type AdminInviteRow = {
  id: string;
  email: string;
  status: string;
  createdAt: string | null;
  invitedByEmail: string | null;
};

export const adminListInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ invites: AdminInviteRow[] }> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await untypedTable(supabaseAdmin, "admin_invites")
      .select("id, email, status, created_at, invited_by")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw new Error("Erro ao listar convites");

    const rows = (data ?? []) as Array<{ id: string; email: string; status: string; created_at: string | null; invited_by: string | null }>;
    const inviterIds = Array.from(new Set(rows.map((r) => r.invited_by).filter(Boolean) as string[]));
    const emailMap = new Map<string, string>();
    if (inviterIds.length) {
      const usersData = { users: await (await import("@/lib/admin-users.server")).listAllAuthUsers() };
      for (const u of usersData?.users ?? []) {
        if (u.email) emailMap.set(u.id, u.email);
      }
    }

    return {
      invites: rows.map((r) => ({
        id: r.id,
        email: r.email,
        status: r.status,
        createdAt: r.created_at,
        invitedByEmail: r.invited_by ? emailMap.get(r.invited_by) ?? null : null,
      })),
    };
  });

export const adminRevokeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { inviteId: string }) => z.object({ inviteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Só o administrador que enviou o convite pode cancelá-lo (ou convites
    // antigos sem autor registrado). Antes, qualquer admin derrubava o convite
    // de qualquer outro pelo id (22/09/2026).
    const { data: invite } = await untypedTable(supabaseAdmin, "admin_invites")
      .select("id, invited_by, status")
      .eq("id", data.inviteId)
      .maybeSingle();
    const row = invite as { invited_by: string | null; status: string } | null;
    if (!row) throw new Error("Convite não encontrado.");
    if (row.invited_by && row.invited_by !== context.userId) {
      throw new Error("Apenas quem enviou este convite pode cancelá-lo.");
    }
    const { error } = await untypedTable(supabaseAdmin, "admin_invites")
      .update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("id", data.inviteId);
    if (error) throw new Error("Não foi possível cancelar o convite.");

    await untypedTable(supabaseAdmin, "audit_logs").insert({
      user_id: context.userId,
      user_email: (context as { claims?: { email?: string } }).claims?.email ?? null,
      action: "admin_invite.revoked",
      entity_type: "admin_invites",
      entity_id: data.inviteId,
      metadata: {},
    });
    return { ok: true };
  });

export type AuditLogRow = {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  actionLabel: string;
  entityType: string | null;
  entityId: string | null;
  itemLabel: string;
  metadataJson: string;
  createdAt: string;
};

// Dicionário de tabelas (PT-BR, sem termos técnicos).
const ENTITY_LABELS: Record<string, string> = {
  sigma_city_recommendations: "Ponto/estabelecimento do Guia Sigma",
  sigma_city_marketplace: "Link de reservas do Guia Sigma",
  sigma_city_faqs: "Pergunta do Guia Sigma",
  sigma_city_packs: "Cidade do Guia Sigma",
  properties: "Guia",
  property_recommendations: "Ponto/estabelecimento do guia",
  property_faqs: "Pergunta do guia",
  property_house_rules: "Regra da casa",
  city_references: "Referência da cidade",
  poi_categories: "Categoria de pontos",
  poi_tags: "Etiqueta de pontos",
  admin_invites: "Convite de administrador",
  admin: "Acesso de administrador",
  user_roles: "Permissão de usuário",
};
const ACTION_VERBS: Record<string, string> = {
  create: "adicionado",
  insert: "adicionado",
  update: "atualizado",
  delete: "excluído",
  granted: "concedido",
  revoked: "removido",
  invited: "convidado",
};

function humanizeAction(action: string, entityType: string | null, ctx: { cityLabel?: string | null; itemName?: string | null }): string {
  // action vem como "<tabela>.<verbo>" ou "admin.granted" etc.
  const [, verbRaw] = action.split(".");
  const verb = ACTION_VERBS[verbRaw] ?? verbRaw ?? "alterado";
  const entityLabel = (entityType && ENTITY_LABELS[entityType]) ?? ENTITY_LABELS[action.split(".")[0]] ?? "Item";
  const where = ctx.cityLabel ? ` em ${ctx.cityLabel}` : "";
  return `${entityLabel} ${verb}${where}`.trim();
}

export const adminListAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { search?: string; limit?: number } | undefined) =>
    z
      .object({
        search: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(2000).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ logs: AuditLogRow[] }> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = untypedTable(supabaseAdmin, "audit_logs")
      .select("id, user_id, user_email, action, entity_type, entity_id, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 500);
    // Vírgula, parênteses e curingas mudariam a estrutura do filtro `or` do
    // PostgREST — ficam fora da busca (16/09/2026).
    const s = data.search
      ?.trim()
      .replace(/[%,()*\\]/g, " ")
      .trim();
    if (s) {
      q = q.or(`user_email.ilike.%${s}%,action.ilike.%${s}%,entity_type.ilike.%${s}%,entity_id.ilike.%${s}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error("Erro ao carregar registros de atividade");
    const rowList = (rows ?? []) as Array<{ id: string; user_id: string | null; user_email: string | null; action: string; entity_type: string | null; entity_id: string | null; metadata: unknown; created_at: string }>;

    const missing = Array.from(new Set(rowList.filter((r) => r.user_id && !r.user_email).map((r) => r.user_id as string)));
    const emailMap = new Map<string, string>();
    if (missing.length) {
      const usersData = { users: await (await import("@/lib/admin-users.server")).listAllAuthUsers() };
      for (const u of usersData?.users ?? []) {
        if (u.email) emailMap.set(u.id, u.email);
      }
    }

    // Cache de rótulos de cidades Sigma (city_key → city_label).
    const { data: cityRows } = await supabaseAdmin
      .from("sigma_city_packs")
      .select("city_key, city_label");
    const cityLabelByKey = new Map<string, string>(
      (cityRows ?? []).map((r) => [(r as { city_key: string }).city_key, (r as { city_label: string }).city_label]),
    );

    function deriveContext(r: typeof rowList[number]): { cityLabel: string | null; itemName: string | null } {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const newRow = (meta.new ?? null) as Record<string, unknown> | null;
      const oldRow = (meta.old ?? null) as Record<string, unknown> | null;
      const pick = (k: string) => (newRow?.[k] ?? oldRow?.[k] ?? meta[k]) as unknown;
      const cityKey = pick("city_key") as string | undefined;
      const cityLabel = cityKey ? cityLabelByKey.get(cityKey) ?? null : null;
      const itemName =
        (pick("name") as string | undefined) ??
        (pick("city_label") as string | undefined) ??
        (pick("question") as string | undefined) ??
        (pick("label") as string | undefined) ??
        (pick("email") as string | undefined) ??
        null;
      return { cityLabel, itemName };
    }

    return {
      logs: rowList.map((r) => {
        const ctx = deriveContext(r);
        const actionLabel = humanizeAction(r.action, r.entity_type, ctx);
        const itemLabel = ctx.itemName ?? (r.entity_id ? `#${r.entity_id.slice(0, 8)}` : "—");
        return {
          id: r.id,
          userId: r.user_id,
          userEmail: r.user_email ?? (r.user_id ? emailMap.get(r.user_id) ?? null : null),
          action: r.action,
          actionLabel,
          entityType: r.entity_type,
          entityId: r.entity_id,
          itemLabel,
          metadataJson: r.metadata ? JSON.stringify(r.metadata) : "{}",
          createdAt: r.created_at,
        };
      }),
    };
  });

// ───────── Impersonação somente-leitura: dados completos de um cliente ─────────

export const adminListUserPropertiesFull = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ userId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("properties")
      .select(
        "id, slug, name, tagline, hero_image_url, gallery_images, access_mode, pin_expires_at, published, city, country, address, lat, lng, updated_at, wifi_ssid, checkin_time, checkout_time, owner_contact_id, guide_created",
      )
      .eq("owner_id", data.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error("Não foi possível carregar os guias deste cliente.");
    const { signPropertyImages } = await import("@/lib/storage.server");
    const signed = await signPropertyImages(supabaseAdmin, rows ?? []);
    const { attachOwnerNames } = await import("@/lib/property-owner-names.server");
    return await attachOwnerNames(supabaseAdmin as never, signed);
  });

// ───────────────── Exclusão total de cliente ─────────────────

/** Tabelas com vínculo direto ao dono/tenant. Limpas antes de remover o usuário. */
const OWNER_SCOPED_TABLES: Array<[table: string, column: string]> = [
  ["host_integration_credentials", "owner_id"], ["host_whatsapp_config", "owner_id"],
  ["ops_push_log", "owner_id"], ["whatsapp_templates", "owner_id"],
  ["account_member_invites", "owner_id"], ["account_member_permissions", "owner_id"],
  ["account_members", "owner_id"],
  ["ai_alerts", "tenant_id"], ["ai_system_events", "tenant_id"],
  ["permission_assignments", "tenant_id"], ["permission_audit", "tenant_id"],
  ["permission_migration_status", "tenant_id"], ["property_assignments", "tenant_id"],
  ["subscriptions", "user_id"], ["push_subscriptions", "user_id"],
  ["app_user_connections", "user_id"], ["user_roles", "user_id"],
  ["audit_logs", "user_id"], ["permission_assignments", "user_id"],
  ["property_assignments", "user_id"], ["service_providers", "created_by"],
  ["stakeholder_activities", "created_by"], ["stakeholder_events", "created_by"],
  ["stakeholder_link_aliases", "created_by"], ["property_owners", "created_by"],
];

export const adminDeleteCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ userId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.userId === context.userId) {
      throw new Error("Você não pode excluir a própria conta.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) Guias (propriedades) do dono — as tabelas filhas caem por cascade.
    const { data: props } = await supabaseAdmin
      .from("properties").select("id").eq("owner_id", data.userId);
    const propertyIds = (props ?? []).map((p: { id: string }) => p.id);

    // Registro de auditoria ANTES de qualquer exclusão: esta é a operação
    // administrativa mais destrutiva do painel (apaga a conta inteira e
    // todos os dados vinculados, de forma irreversível) e não deixava
    // nenhum rastro de quem a executou. Pior: a limpeza logo abaixo remove
    // os audit_logs do PRÓPRIO cliente excluído (entrada "audit_logs"/
    // "user_id" em OWNER_SCOPED_TABLES) — então, sem gravar isto antes,
    // nem esse rastro restava. Gravado com user_id = admin que executou a
    // ação (não o cliente excluído), por isso sobrevive à limpeza a seguir.
    let targetEmail: string | null = null;
    try {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(data.userId);
      targetEmail = authUser?.user?.email ?? null;
    } catch (e) {
      console.warn("[adminDeleteCustomer] getUserById falhou:", e);
    }
    await untypedTable(supabaseAdmin, "audit_logs").insert({
      user_id: context.userId,
      user_email: (context as { claims?: { email?: string } }).claims?.email ?? null,
      action: "customer.deleted",
      entity_type: "profiles",
      entity_id: data.userId,
      metadata: { targetEmail, propertiesDeleted: propertyIds.length },
    });

    // 2) Registros vinculados ao dono/tenant.
    for (const [table, column] of OWNER_SCOPED_TABLES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabaseAdmin as any).from(table).delete().eq(column, data.userId);
      if (error) console.error("[adminDeleteCustomer]", table, column, error.message);
    }

    if (propertyIds.length) {
      const { error: propErr } = await supabaseAdmin
        .from("properties").delete().in("id", propertyIds);
      if (propErr) throw new Error("Não foi possível excluir os guias deste cliente.");
    }

    await supabaseAdmin.from("profiles").delete().eq("id", data.userId);

    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (authErr) throw new Error("Dados removidos, mas falhou ao excluir o login do usuário.");

    return { ok: true, deletedProperties: propertyIds.length };
  });
