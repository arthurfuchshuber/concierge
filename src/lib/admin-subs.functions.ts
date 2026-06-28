import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { PLANS, planFromProductId, type PlanKey } from "@/lib/payments.functions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error("Erro ao verificar permissão");
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
    plan: PlanKey | null;
    productId: string | null;
    priceId: string | null;
    status: string;
    environment: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    customPriceCents: number | null;
    customCurrency: string | null;
    adminNotes: string | null;
    isManual: boolean;
    maxGuidesOverride: number | null;
    paddleSubscriptionId: string;
    billingPaused: boolean;
  } | null;
};

export const adminListCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ customers: AdminCustomerRow[] }> => {
    await assertAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Auth users (paginated). For now, take first 1000.
    const { data: usersData, error: usersErr } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (usersErr) throw new Error("Erro ao listar usuários");

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name");

    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select(
        "id, user_id, paddle_subscription_id, product_id, price_id, status, environment, current_period_start, current_period_end, cancel_at_period_end, trial_ends_at, custom_price_cents, custom_currency, admin_notes, is_manual, max_guides_override, billing_paused, created_at",
      )
      .order("created_at", { ascending: false });

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

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
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

      return {
        userId: u.id,
        email: u.email ?? null,
        fullName: profileMap.get(u.id) ?? null,
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
          ? {
              id: s.id,
              plan: planFromProductId(s.product_id),
              productId: s.product_id,
              priceId: s.price_id,
              status: s.status,
              environment: s.environment,
              currentPeriodStart: s.current_period_start,
              currentPeriodEnd: s.current_period_end,
              trialEndsAt: s.trial_ends_at,
              cancelAtPeriodEnd: !!s.cancel_at_period_end,
              customPriceCents: s.custom_price_cents,
              customCurrency: s.custom_currency,
              adminNotes: s.admin_notes,
              isManual: !!s.is_manual,
              maxGuidesOverride: s.max_guides_override ?? null,
              paddleSubscriptionId: s.paddle_subscription_id,
              billingPaused: !!(s as { billing_paused?: boolean }).billing_paused,
            }
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

const PlanKeySchema = z.enum(["starter", "pro", "business", "enterprise"]);

export const adminUpdateSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    userId: string;
    plan: PlanKey;
    status: string;
    environment: "sandbox" | "live";
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    customPriceCents: number | null;
    customCurrency: string | null;
    cancelAtPeriodEnd: boolean;
    adminNotes: string | null;
    maxGuidesOverride: number | null;
    billingPaused: boolean;
  }) =>
    z
      .object({
        userId: z.string().uuid(),
        plan: PlanKeySchema,
        status: z.enum(["trialing", "active", "past_due", "paused", "canceled"]),
        environment: z.enum(["sandbox", "live"]),
        trialEndsAt: z.string().nullable(),
        currentPeriodEnd: z.string().nullable(),
        customPriceCents: z.number().int().min(0).max(100_000_00).nullable(),
        customCurrency: z.string().length(3).nullable(),
        cancelAtPeriodEnd: z.boolean(),
        adminNotes: z.string().max(2000).nullable(),
        maxGuidesOverride: z.number().int().min(1).max(100000).nullable(),
        billingPaused: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const planConfig = PLANS[data.plan];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Find latest existing sub in this environment for the user
    const { data: existing } = await supabaseAdmin
      .from("subscriptions")
      .select("id, paddle_subscription_id, paddle_customer_id")
      .eq("user_id", data.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const patch = {
      product_id: planConfig.id,
      price_id: planConfig.priceId,
      status: data.status,
      environment: data.environment,
      trial_ends_at: data.trialEndsAt,
      current_period_end: data.currentPeriodEnd,
      custom_price_cents: data.customPriceCents,
      custom_currency: data.customCurrency,
      cancel_at_period_end: data.cancelAtPeriodEnd,
      admin_notes: data.adminNotes,
      max_guides_override: data.maxGuidesOverride,
      billing_paused: data.billingPaused,
    } as const;

    if (existing) {
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update(patch)
        .eq("id", existing.id);
      if (error) throw new Error("Erro ao atualizar assinatura");
    } else {
      const suffix = data.userId.slice(0, 8);
      const { error } = await supabaseAdmin.from("subscriptions").insert({
        user_id: data.userId,
        paddle_subscription_id: `manual_${data.environment}_${suffix}_${Date.now()}`,
        paddle_customer_id: `manual_cus_${suffix}`,
        is_manual: true,
        current_period_start: new Date().toISOString(),
        ...patch,
      });
      if (error) throw new Error("Erro ao criar assinatura manual");
    }

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
      .select("id, full_name")
      .in("id", ids);
    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabaseAdmin.from("audit_logs" as never) as any).insert({
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inviteTable = supabaseAdmin.from("admin_invites" as never) as any;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin.from("audit_logs" as never) as any).insert({
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabaseAdmin.from("admin_invites" as never) as any)
      .select("id, email, status, created_at, invited_by")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw new Error("Erro ao listar convites");

    const rows = (data ?? []) as Array<{ id: string; email: string; status: string; created_at: string | null; invited_by: string | null }>;
    const inviterIds = Array.from(new Set(rows.map((r) => r.invited_by).filter(Boolean) as string[]));
    const emailMap = new Map<string, string>();
    if (inviterIds.length) {
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabaseAdmin.from("admin_invites" as never) as any)
      .update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("id", data.inviteId);
    if (error) throw new Error("Não foi possível cancelar o convite.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin.from("audit_logs" as never) as any).insert({
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
    let q: any = (supabaseAdmin.from("audit_logs" as never) as any)
      .select("id, user_id, user_email, action, entity_type, entity_id, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 500);
    const s = data.search?.trim();
    if (s) {
      q = q.or(`user_email.ilike.%${s}%,action.ilike.%${s}%,entity_type.ilike.%${s}%,entity_id.ilike.%${s}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error("Erro ao carregar registros de atividade");
    const rowList = (rows ?? []) as Array<{ id: string; user_id: string | null; user_email: string | null; action: string; entity_type: string | null; entity_id: string | null; metadata: unknown; created_at: string }>;

    const missing = Array.from(new Set(rowList.filter((r) => r.user_id && !r.user_email).map((r) => r.user_id as string)));
    const emailMap = new Map<string, string>();
    if (missing.length) {
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
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
        "id, slug, name, tagline, hero_image_url, gallery_images, access_mode, pin_expires_at, published, city, country, address, lat, lng, updated_at, wifi_ssid, checkin_time, checkout_time",
      )
      .eq("owner_id", data.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error("Não foi possível carregar os guias deste cliente.");
    const { signPropertyImages } = await import("@/lib/storage.server");
    return await signPropertyImages(supabaseAdmin, rows ?? []);
  });

export const adminGetUserSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      userId: z.string().uuid(),
      environment: z.enum(["sandbox", "live"]),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("subscriptions")
      .select(
        "id, paddle_subscription_id, paddle_customer_id, product_id, price_id, status, current_period_start, current_period_end, cancel_at_period_end, environment, is_manual, custom_price_cents, custom_currency, trial_ends_at, max_guides_override, admin_notes, created_at",
      )
      .eq("user_id", data.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("Não foi possível carregar a assinatura deste cliente.");
    const list = rows ?? [];
    const match =
      list.find((r) => r.environment === data.environment) ??
      list.find((r) => r.is_manual) ??
      null;
    if (!match) return { subscription: null, plan: null as PlanKey | null };
    return { subscription: match, plan: planFromProductId(match.product_id) };
  });

