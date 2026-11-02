/**
 * Atalhos de auditoria para o SaaS INTEIRO (não só IA).
 *
 * Qualquer módulo server-side pode registrar um evento sem se preocupar com
 * cliente Supabase ou com o formato da tabela. Auditoria nunca derruba a
 * operação principal — todos os helpers engolem erros.
 */
import type { EventCategory, Severity, SystemEventInput } from "./events.server";

async function write(event: SystemEventInput): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logSystemEvent } = await import("./events.server");
    await logSystemEvent(supabaseAdmin, event);
  } catch (err) {
    console.error("[audit] falha ao registrar evento de plataforma", event.eventType, err);
  }
}

type BaseArgs = {
  tenantId?: string | null;
  userId?: string | null;
  actorName?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  description?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  severity?: Severity;
  result?: "success" | "failure" | "pending" | null;
};

function base(args: BaseArgs) {
  return {
    tenantId: args.tenantId ?? args.userId ?? null,
    userId: args.userId ?? null,
    actorId: args.userId ?? null,
    actorName: args.actorName ?? null,
    entityType: args.entityType ?? null,
    entityId: args.entityId ?? null,
    description: args.description ?? null,
    reason: args.reason ?? null,
    metadata: args.metadata ?? null,
    severity: args.severity ?? "info",
    result: args.result ?? "success",
  };
}

/** Autenticação e sessão (login, logout, troca de senha, OAuth). */
export function auditAuth(eventType: string, args: BaseArgs) {
  return write({ ...base(args), actorType: "USER", eventType, eventCategory: "AUTHENTICATION", source: "app" });
}

/** Integrações externas (Google Agenda, ClickSign, WhatsApp, Airbnb, Paddle). */
export function auditIntegration(eventType: string, args: BaseArgs & { integration: string }) {
  return write({
    ...base(args),
    actorType: "USER",
    eventType,
    eventCategory: "INTEGRATIONS",
    source: args.integration,
    entityType: args.entityType ?? "integration",
    entityId: args.entityId ?? args.integration,
    metadata: { integration: args.integration, ...(args.metadata ?? {}) },
  });
}

/** Assinaturas, planos, cobrança e limites comerciais. */
export function auditBilling(eventType: string, args: BaseArgs) {
  return write({
    ...base(args),
    actorType: "USER",
    eventType,
    eventCategory: "USER_MANAGEMENT",
    source: "billing",
    entityType: args.entityType ?? "subscription",
  });
}

/** Dados operacionais do SaaS (guias, imóveis, hóspedes, stakeholders). */
export function auditData(eventType: string, args: BaseArgs) {
  return write({
    ...base(args),
    actorType: "USER",
    eventType,
    eventCategory: "USER_MANAGEMENT",
    source: "app",
  });
}

/** Rotinas automáticas (crons, sincronizações, varreduras). */
export function auditCron(
  eventType: string,
  args: BaseArgs & { job: string; category?: EventCategory },
) {
  return write({
    ...base(args),
    actorType: "CRON_JOB",
    actorName: args.job,
    eventType,
    eventCategory: args.category ?? "INTEGRATIONS",
    source: "cron",
    entityType: args.entityType ?? "cron_job",
    entityId: args.entityId ?? args.job,
    metadata: { job: args.job, ...(args.metadata ?? {}) },
  });
}

/** Segurança: tentativas negadas, webhooks inválidos, atividade suspeita. */
export function auditSecurity(eventType: string, args: BaseArgs) {
  return write({
    ...base(args),
    actorType: args.userId ? "USER" : "SYSTEM",
    eventType,
    eventCategory: "SECURITY",
    source: "security",
    severity: args.severity ?? "warning",
    result: args.result ?? "failure",
  });
}
