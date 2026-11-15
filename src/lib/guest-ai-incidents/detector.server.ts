/**
 * DETECTOR DE OCORRÊNCIA (15/11/2026): depois de cada fala do hóspede (ou da equipe, quando há chamado aberto), um
 * modelo barato lê a conversa CENTRAL (WhatsApp + plataforma + guia) e decide abrir, reabrir ou fechar o chamado.
 * Roda em segundo plano: nunca atrasa nem derruba a resposta. Texto passa pela varredura de segredos antes do modelo.
 * Abrir um chamado também encaminha a conversa à equipe (status `needs_human`, urgência alta) e envia o push.
 */
import { generateGuestLlm } from "@/lib/guest-ai/llm/gateway.server";
import type { LlmMessage, LlmResult } from "@/lib/guest-ai/llm/contracts";
import { GUEST_AI_RESERVE_MODEL } from "@/lib/guest-ai/orchestrator/contracts";
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
import { getGuestAiDb, type GuestAiDb } from "@/lib/guest-ai/data/client.server";
import {
  buildDetectorMessages,
  incidentGate,
  parseDetectorOutput,
  type DetectorAction,
  type DetectorTrigger,
} from "./contracts";
import {
  insertIncident,
  loadCentralMessages,
  loadOpenIncidents,
  loadRecentlyResolved,
  loadScope,
  markReopened,
  markResolved,
  siblingConversationIds,
} from "./store.server";

export interface DetectorDeps {
  db?: GuestAiDb;
  llm?: (messages: LlmMessage[]) => Promise<LlmResult>;
  now?: () => number;
  /** Encaminha a conversa à equipe e envia o push ao abrir (padrão: handoff real). */
  notifyOpened?: (p: { conversationId: string; propertyId: string; guestName: string | null; summary: string; severity: string }) => Promise<void>;
  enabled?: boolean;
}

export type DetectorOutcome =
  | { status: "skipped"; reason: string }
  | { status: "none" }
  | { status: "applied"; action: DetectorAction["action"]; incidentId: string | null }
  | { status: "blocked"; reason: string }
  | { status: "error" };

export function incidentsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env["GUEST_AI_INCIDENTS"] !== "off";
}

async function defaultNotify(db: GuestAiDb, p: { conversationId: string; propertyId: string; guestName: string | null; summary: string; severity: string }) {
  const reason = `Ocorrência: ${p.summary}`.slice(0, 300);
  await db
    .from("property_chat_conversations")
    .update({ status: "needs_human", handoff_reason: reason, handoff_urgency: "high", handoff_at: new Date().toISOString() })
    .eq("id", p.conversationId)
    .neq("status", "assigned");
  const { getPropertyNotifiableUsers, sendHandoffPush } = await import("@/lib/handoff.server");
  const userIds = await getPropertyNotifiableUsers(db as never, p.propertyId);
  await sendHandoffPush(db as never, {
    userIds, conversationId: p.conversationId, propertyName: null, guestName: p.guestName, guestMessage: null,
    checkinDate: null, reason, urgency: "high",
  } as never);
}

export async function runIncidentDetector(
  input: { conversationId: string; trigger: DetectorTrigger; messageId?: string | null },
  deps: DetectorDeps = {},
): Promise<DetectorOutcome> {
  try {
    if (!(deps.enabled ?? incidentsEnabled())) return { status: "skipped", reason: "off" };
    const db = deps.db ?? (await getGuestAiDb());
    const nowMs = (deps.now ?? Date.now)();
    const scope = await loadScope(db, input.conversationId);
    if (!scope || !scope.tenantId) return { status: "skipped", reason: "scope" };

    const [open, resolved] = await Promise.all([loadOpenIncidents(db, scope), loadRecentlyResolved(db, scope, nowMs)]);
    // a equipe só pode FECHAR: sem chamado aberto não há o que avaliar (poupa custo)
    if (input.trigger === "team" && open.length === 0) return { status: "skipped", reason: "no_open_incident" };

    const ids = await siblingConversationIds(db, scope);
    const raw = await loadCentralMessages(db, ids, 30);
    if (raw.length === 0) return { status: "skipped", reason: "no_messages" };
    const last = raw[raw.length - 1]!;
    if (last.speaker === "ai") return { status: "skipped", reason: "last_is_ai" };
    const messages = raw.map((m) => ({ ...m, text: SECRET_SCRUBBER.apply(m.text) }));

    const prompt = buildDetectorMessages({ trigger: input.trigger, messages, open, recentlyResolved: resolved });
    const r = deps.llm
      ? await deps.llm(prompt)
      : await generateGuestLlm({
          purpose: "guest_classification",
          model: GUEST_AI_RESERVE_MODEL,
          messages: prompt,
          maxOutputTokens: 400,
          reasoningEffort: "low",
          responseFormat: "json",
          timeoutMs: 12_000,
          traceId: "guest-incident-detector",
        });
    if (!r.ok || r.finishReason !== "stop") return { status: "error" };

    const action = parseDetectorOutput(r.text, { open: open.map((x) => x.id), resolved: resolved.map((x) => x.id) });
    if (action.action === "none") return { status: "none" };
    const gate = incidentGate(action, { trigger: input.trigger, open });
    if (!gate.allowed) return { status: "blocked", reason: gate.reason ?? "gate" };

    const nowIso = new Date(nowMs).toISOString();
    if (action.action === "open") {
      const id = await insertIncident(db, { tenantId: scope.tenantId, scope, summary: action.summary, severity: action.severity, category: action.category, messageId: input.messageId ?? null });
      if (!id) return { status: "error" };
      try {
        await (deps.notifyOpened
          ? deps.notifyOpened({ conversationId: scope.id, propertyId: scope.propertyId, guestName: scope.guestName, summary: action.summary, severity: action.severity })
          : defaultNotify(db, { conversationId: scope.id, propertyId: scope.propertyId, guestName: scope.guestName, summary: action.summary, severity: action.severity }));
      } catch {
        /* o chamado existe; o vigia de handoff cobra a equipe */
      }
      return { status: "applied", action: "open", incidentId: id };
    }
    if (action.action === "resolve") {
      const ok = await markResolved(db, action.incidentId, gate.resolvedBy ?? "ai", action.reason, nowIso);
      return ok ? { status: "applied", action: "resolve", incidentId: action.incidentId } : { status: "error" };
    }
    const ok = await markReopened(db, action.incidentId, nowIso);
    if (ok) {
      try {
        const inc = resolved.find((x) => x.id === action.incidentId);
        await (deps.notifyOpened
          ? deps.notifyOpened({ conversationId: scope.id, propertyId: scope.propertyId, guestName: scope.guestName, summary: inc?.summary ?? "Ocorrência reaberta", severity: inc?.severity ?? "normal" })
          : defaultNotify(db, { conversationId: scope.id, propertyId: scope.propertyId, guestName: scope.guestName, summary: `Reaberta: ${inc?.summary ?? ""}`, severity: inc?.severity ?? "normal" }));
      } catch {
        /* idem */
      }
    }
    return ok ? { status: "applied", action: "reopen", incidentId: action.incidentId } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/** Dispara em segundo plano (nunca lança, nunca atrasa quem chama). */
export async function triggerIncidentDetector(input: { conversationId: string; trigger: DetectorTrigger; messageId?: string | null }): Promise<void> {
  try {
    const { runInBackground } = await import("@/lib/background.server");
    await runInBackground(async () => {
      await runIncidentDetector(input);
    });
  } catch {
    /* melhor esforço */
  }
}
