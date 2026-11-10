/**
 * AUTO-APRENDIZADO SILENCIOSO · governança por exceção (10/11/2026) — servidor.
 *
 * - `learnFromTeamMessage`: depois que um atendente envia uma mensagem ao hóspede, extrai fatos duradouros
 *   (Gemini Flash, ≤ US$ 0,005), propõe pela RPC de sempre e APROVA NA HORA em nome do atendente quando ele pode
 *   aprovar (dono, admin ou permissão `ai_train`, a mesma regra da RPC de revisão). Sem permissão ⇒ fica
 *   pendente. Escopo cidade/conta ⇒ réplica aprovada nos imóveis do MESMO dono. Fato de estadia ⇒ não vira regra.
 * - `closeLearningForDeletedMessage`: mensagem da equipe apagada ⇒ os aprendizados que ela gerou (e as réplicas)
 *   saem do Documento Vivo na hora (aprovado ⇒ revogado; pendente ⇒ recusado).
 * - `setLearningScope` / `undoLearning`: ajustar escopo e desfazer (1 clique), com a mesma checagem de permissão.
 *
 * A gravação da decisão espelha a RPC `guest_ai_learning_review` (status, autor, instante, nota e evento no
 * histórico), feita pelo cliente de serviço porque a RPC exige a sessão do revisor e este caminho roda em
 * segundo plano. FAIL-CLOSED: só roda com `GUEST_AI_LEARNING_EXTRACTOR=on`. Nunca lança. Logs só com códigos.
 */
import { generateGuestLlm } from "@/lib/guest-ai/llm/gateway.server";
import type { LlmProvider } from "@/lib/guest-ai/llm/providers/types";
import { estimateCostUsd, modelSpec } from "@/lib/guest-ai/llm/models";
import { GUEST_AI_RESERVE_MODEL } from "@/lib/guest-ai/orchestrator/contracts";
import { proposeLearningCandidate, type ProposeResult } from "@/lib/guest-ai-learning.server";
import type { LearningCandidateInput } from "@/lib/guest-ai/learning/learning";
import {
  buildTeamLearningPrompt,
  parseTeamLearningOutput,
  TEAM_LEARNING_MAX_OUTPUT_TOKENS,
  type TeamContextMessage,
} from "./team-learning";
import { planQualification, type LearningScope, type PropertyRef } from "./qualify";

export const TEAM_LEARNING_MAX_ATTEMPT_COST_USD = 0.005;
export const AUTO_APPROVED_NOTE = "Aprendido automaticamente da mensagem da equipe";
export const SOURCE_DELETED_NOTE = "Mensagem de origem apagada";
export const UNDO_NOTE = "Desfeito pela equipe";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Admin = { from(table: string): any; rpc(fn: string, args: Record<string, unknown>): any };

export interface SilentDeps {
  env?: Record<string, string | undefined>;
  admin?: Admin;
  provider?: LlmProvider;
  propose?: (c: LearningCandidateInput) => Promise<ProposeResult>;
  now?: () => Date;
  log?: (e: Record<string, unknown>) => void;
}

const enabled = (env: Record<string, string | undefined>) => env["GUEST_AI_LEARNING_EXTRACTOR"] === "on";
const getAdmin = async (d: SilentDeps): Promise<Admin> =>
  d.admin ?? ((await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as Admin);

/** Mesma regra da RPC de revisão: dono da conta, admin do SaaS ou membro com `ai_train`. */
export async function canApprove(admin: Admin, userId: string, ownerId: string | null): Promise<boolean> {
  if (!userId || !ownerId) return false;
  if (userId === ownerId) return true;
  try {
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (isAdmin === true) return true;
    const { data: perm } = await admin.rpc("has_member_permission", { _user_id: userId, _owner_id: ownerId, _permission: "ai_train" });
    return perm === true;
  } catch {
    return false;
  }
}

/** Grava a decisão como a RPC faria (só a partir do status esperado; corrida ⇒ nada muda). */
export async function decideAs(
  admin: Admin,
  entryId: string,
  from: "pending" | "approved",
  to: "approved" | "rejected" | "revoked",
  userId: string,
  note: string,
  now: Date,
): Promise<boolean> {
  const at = now.toISOString();
  const { data, error } = await admin
    .from("guest_ai_learning_entries")
    .update({ status: to, decided_by: userId, decided_at: at, decision_note: note.slice(0, 300) })
    .eq("id", entryId)
    .eq("status", from)
    .select("id");
  if (error || !Array.isArray(data) || data.length === 0) return false;
  await admin.from("guest_ai_learning_events").insert({ entry_id: entryId, status: to, actor: userId, note: note.slice(0, 300) });
  return true;
}

/** Fecha uma entrada no estado em que estiver: aprovada ⇒ revogada; pendente ⇒ recusada. */
async function closeEntry(admin: Admin, e: { id: string; status: string }, userId: string, note: string, now: Date) {
  if (e.status === "approved") return decideAs(admin, e.id, "approved", "revoked", userId, note, now);
  if (e.status === "pending") return decideAs(admin, e.id, "pending", "rejected", userId, note, now);
  return false;
}

const propRef = (p: Record<string, unknown>): PropertyRef => ({
  id: String(p["id"]),
  ownerId: (p["owner_id"] as string | null) ?? null,
  city: (p["city"] as string | null) ?? null,
  archived: !!p["archived_at"],
});

/** Réplicas de uma entrada nos imóveis do escopo (mesmo dono). Devolve quantas ficaram aprovadas. */
async function replicate(
  admin: Admin,
  entry: { id: string; property_id: string; category: string; statement: string; source: string },
  scope: LearningScope,
  userId: string,
  approve: boolean,
  deps: SilentDeps,
): Promise<number> {
  if (scope === "property") return 0;
  const { data: origin } = await admin.from("properties").select("id, owner_id, city, archived_at").eq("id", entry.property_id).maybeSingle();
  if (!origin?.owner_id) return 0;
  const { data: rows } = await admin.from("properties").select("id, owner_id, city, archived_at").eq("owner_id", origin.owner_id).limit(500);
  const plan = planQualification({ temporality: "permanent", scope, origin: propRef(origin) }, ((rows ?? []) as Array<Record<string, unknown>>).map(propRef));
  const propose = deps.propose ?? ((c: LearningCandidateInput) => proposeLearningCandidate(c, { db: admin }));
  let n = 0;
  for (const pid of plan.replicateTo) {
    const r = await propose({
      propertyId: pid,
      category: entry.category,
      statement: entry.statement,
      evidence: { source: entry.source as LearningCandidateInput["evidence"]["source"], propertyId: pid, refs: [`replica:${entry.id}`], closed: true },
    });
    if (r.ok && r.id && approve && (await decideAs(admin, r.id, "pending", "approved", userId, `Replicado de ${entry.id}`, (deps.now ?? (() => new Date()))()))) n += 1;
  }
  return n;
}

export interface TeamLearningResult {
  status: "off" | "skipped" | "failed" | "done";
  reason: string | null;
  approved: number;
  pending: number;
  replicated: number;
  ephemeral: number;
  refused: number;
  costUsd: number;
}

/** Após uma mensagem da equipe ao hóspede (não nota interna). Nunca lança. */
export async function learnFromTeamMessage(
  input: { conversationId: string; userId: string; content: string },
  deps: SilentDeps = {},
): Promise<TeamLearningResult> {
  const res: TeamLearningResult = { status: "done", reason: null, approved: 0, pending: 0, replicated: 0, ephemeral: 0, refused: 0, costUsd: 0 };
  const log = deps.log ?? ((e) => console.info("[guest-ai-learning:team]", JSON.stringify(e)));
  const end = (status: TeamLearningResult["status"], reason: string | null) => {
    res.status = status;
    res.reason = reason;
    log({ conv: input.conversationId, status, reason, approved: res.approved, pending: res.pending, replicated: res.replicated, ephemeral: res.ephemeral, refused: res.refused, costUsd: res.costUsd });
    return res;
  };
  try {
    if (!enabled(deps.env ?? process.env)) return { ...res, status: "off" };
    const admin = await getAdmin(deps);
    const { data: conv } = await admin.from("property_chat_conversations").select("id, property_id").eq("id", input.conversationId).maybeSingle();
    if (!conv?.property_id) return end("skipped", "no_property");
    const { data: prop } = await admin.from("properties").select("id, owner_id").eq("id", conv.property_id).maybeSingle();
    if (!prop) return end("skipped", "no_property");

    // a mensagem que acabou de ser gravada (evidência) e a conversa recente (contexto)
    const { data: rows } = await admin
      .from("property_chat_messages")
      .select("id, role, sender_type, sender_user_id, content, is_internal_note, created_at")
      .eq("conversation_id", input.conversationId)
      .order("created_at", { ascending: false })
      .limit(12);
    const list = ((rows ?? []) as Array<Record<string, unknown>>).filter((r) => !r["is_internal_note"]);
    const mine = list.find((r) => r["sender_type"] === "human" && r["sender_user_id"] === input.userId && r["content"] === input.content);
    if (!mine) return end("skipped", "message_not_found");
    const context: TeamContextMessage[] = list
      .filter((r) => r !== mine && typeof r["content"] === "string")
      .reverse()
      .map((r) => ({
        speaker: r["sender_type"] === "guest" ? "guest" : r["sender_type"] === "human" ? "team" : "ai",
        text: String(r["content"]),
      }));
    const messages = buildTeamLearningPrompt(input.content, context);
    if (!messages) return end("skipped", "too_short");

    const spec = modelSpec(GUEST_AI_RESERVE_MODEL);
    const bound = messages.reduce((n, m) => n + new TextEncoder().encode(String(m.content)).length, 16);
    if (!spec || estimateCostUsd(spec, bound, TEAM_LEARNING_MAX_OUTPUT_TOKENS) > TEAM_LEARNING_MAX_ATTEMPT_COST_USD) return end("skipped", "budget_call_exceeded");
    const llm = await generateGuestLlm(
      {
        purpose: "evaluation",
        model: GUEST_AI_RESERVE_MODEL,
        messages,
        maxOutputTokens: TEAM_LEARNING_MAX_OUTPUT_TOKENS,
        reasoningEffort: "low",
        responseFormat: "json",
        traceId: `gt-${input.conversationId}`.slice(0, 80),
      },
      { provider: deps.provider },
    );
    res.costUsd = llm.telemetry.costUsd;
    if (!llm.ok) return end("failed", `llm_${llm.error.code}`);
    const parsed = parseTeamLearningOutput(llm.json);
    res.ephemeral = parsed.ephemeral;
    res.refused = parsed.dropped;
    if (parsed.facts.length === 0) return end("done", null);

    const may = await canApprove(admin, input.userId, (prop.owner_id as string | null) ?? null);
    const propose = deps.propose ?? ((c: LearningCandidateInput) => proposeLearningCandidate(c, { db: admin }));
    const now = (deps.now ?? (() => new Date()))();
    for (const f of parsed.facts) {
      // o imóvel vem da conversa (banco), nunca do modelo; evidência = a mensagem da equipe
      const r = await propose({
        propertyId: String(conv.property_id),
        category: f.category,
        statement: f.statement,
        evidence: { source: "incident_resolved", propertyId: String(conv.property_id), refs: [String(mine["id"])], closed: true },
      });
      if (!r.ok) {
        res.refused += 1;
        continue;
      }
      if (!r.id) continue; // duplicata (já existe pendente/aprovado igual)
      if (may && (await decideAs(admin, r.id, "pending", "approved", input.userId, AUTO_APPROVED_NOTE, now))) {
        res.approved += 1;
        res.replicated += await replicate(
          admin,
          { id: r.id, property_id: String(conv.property_id), category: f.category, statement: f.statement, source: "incident_resolved" },
          f.scope,
          input.userId,
          true,
          deps,
        );
      } else res.pending += 1;
    }
    return end("done", null);
  } catch {
    return end("failed", "internal_error");
  }
}

/** Entradas geradas por uma mensagem e as réplicas delas. */
async function entriesFromMessage(admin: Admin, messageId: string): Promise<Array<{ id: string; status: string }>> {
  const { data: own } = await admin
    .from("guest_ai_learning_entries")
    .select("id, status")
    .contains("evidence_refs", [messageId])
    .in("status", ["pending", "approved"]);
  const direct = ((own ?? []) as Array<{ id: string; status: string }>).filter((e) => e && e.id);
  const out = [...direct];
  for (const e of direct) {
    const { data: reps } = await admin
      .from("guest_ai_learning_entries")
      .select("id, status")
      .contains("evidence_refs", [`replica:${e.id}`])
      .in("status", ["pending", "approved"]);
    out.push(...((reps ?? []) as Array<{ id: string; status: string }>));
  }
  return out;
}

/** Mensagem da EQUIPE apagada ⇒ o que ela ensinou sai do Documento Vivo na hora. Nunca lança. */
export async function closeLearningForDeletedMessage(
  input: { messageId: string; userId: string },
  deps: SilentDeps = {},
): Promise<number> {
  try {
    const admin = await getAdmin(deps);
    const now = (deps.now ?? (() => new Date()))();
    let n = 0;
    for (const e of await entriesFromMessage(admin, input.messageId)) if (await closeEntry(admin, e, input.userId, SOURCE_DELETED_NOTE, now)) n += 1;
    return n;
  } catch {
    return 0;
  }
}

/** Desfazer (1 clique): a entrada e as réplicas dela saem do Documento Vivo. Exige poder aprovar. */
export async function undoLearning(input: { entryId: string; userId: string }, deps: SilentDeps = {}): Promise<number> {
  const admin = await getAdmin(deps);
  const { data: e } = await admin.from("guest_ai_learning_entries").select("id, status, owner_id").eq("id", input.entryId).maybeSingle();
  if (!e) throw new Error("not_found");
  if (!(await canApprove(admin, input.userId, e.owner_id ?? null))) throw new Error("not_authorized");
  const now = (deps.now ?? (() => new Date()))();
  const { data: reps } = await admin
    .from("guest_ai_learning_entries")
    .select("id, status")
    .contains("evidence_refs", [`replica:${e.id}`])
    .in("status", ["pending", "approved"]);
  let n = 0;
  for (const x of [e, ...((reps ?? []) as Array<{ id: string; status: string }>)]) if (await closeEntry(admin, x, input.userId, UNDO_NOTE, now)) n += 1;
  return n;
}

/** Ajustar escopo: imóvel ⇒ remove as réplicas; cidade/conta ⇒ réplica aprovada nos imóveis do escopo. */
export async function setLearningScope(
  input: { entryId: string; userId: string; scope: LearningScope },
  deps: SilentDeps = {},
): Promise<{ removed: number; replicated: number }> {
  const admin = await getAdmin(deps);
  const { data: e } = await admin
    .from("guest_ai_learning_entries")
    .select("id, status, owner_id, property_id, category, statement, source")
    .eq("id", input.entryId)
    .maybeSingle();
  if (!e) throw new Error("not_found");
  if (e.status !== "approved") throw new Error("invalid_transition");
  if (!(await canApprove(admin, input.userId, e.owner_id ?? null))) throw new Error("not_authorized");
  const now = (deps.now ?? (() => new Date()))();
  const { data: reps } = await admin
    .from("guest_ai_learning_entries")
    .select("id, status")
    .contains("evidence_refs", [`replica:${e.id}`])
    .in("status", ["pending", "approved"]);
  let removed = 0;
  for (const r of (reps ?? []) as Array<{ id: string; status: string }>) if (await closeEntry(admin, r, input.userId, `Escopo ajustado: ${input.scope}`, now)) removed += 1;
  const replicated = await replicate(admin, e, input.scope, input.userId, true, deps);
  return { removed, replicated };
}
