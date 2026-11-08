/**
 * APRENDIZADO CONTÍNUO — porta de PROPOSTA (Etapa 4, 08/11/2026), fora do módulo `guest-ai/` (que é
 * somente leitura).
 *
 * Única via para criar um candidato: passa pelas travas puras de `evaluateCandidate` (fato ENCERRADO,
 * mesmo imóvel da evidência, categoria fechada, nunca pontual, nunca segredo) e só então chama o RPC
 * `guest_ai_learning_propose` (EXECUTE só `service_role`; dono derivado do imóvel no banco; duplicata
 * ignorada pelo índice de dedupe). O candidato nasce `pending`: NADA entra no prompt até a revisão
 * humana aprovar (`reviewLearningEntry`, em `guest-ai-learning.functions.ts`).
 */
import { evaluateCandidate, type CandidateRefusal, type LearningCandidateInput } from "@/lib/guest-ai/learning/learning";

export type ProposeResult =
  | { ok: true; id: string | null; duplicate: boolean }
  | { ok: false; code: CandidateRefusal | "propose_failed" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: unknown }> };

export async function proposeLearningCandidate(input: LearningCandidateInput, deps: { db?: Rpc } = {}): Promise<ProposeResult> {
  const verdict = evaluateCandidate(input);
  if (!verdict.ok) return { ok: false, code: verdict.code };
  const c = verdict.candidate;
  const db: Rpc = deps.db ?? ((await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as Rpc);
  try {
    const { data, error } = await db.rpc("guest_ai_learning_propose", {
      p_property_id: c.propertyId,
      p_category: c.category,
      p_statement: c.statement,
      p_source: c.evidence.source,
      p_evidence_refs: [...c.evidence.refs],
    });
    if (error) return { ok: false, code: "propose_failed" };
    const id = typeof data === "string" ? data : null;
    return { ok: true, id, duplicate: id === null };
  } catch {
    return { ok: false, code: "propose_failed" };
  }
}
