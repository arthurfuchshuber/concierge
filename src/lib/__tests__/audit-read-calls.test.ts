import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isReadCall } from "@/lib/audit-fn-middleware";

/**
 * Trilha de auditoria (02/11/2026): ações sempre registradas, leituras só em erro.
 * Uma função com nome de leitura que GRAVE algo por decisão de alguém sumiria da trilha —
 * este teste trava isso: toda função "de leitura" com gravação direta precisa estar na lista
 * abaixo, revisada (só efeitos automáticos: semear padrões, cache, encerrar conversa parada).
 */
const REVIEWED_READS_WITH_SIDE_EFFECTS = new Set([
  "checkIsAdmin",
  "countAccountGuides",
  "getAtendimentoAccess",
  "getClicksignDocumentUrl",
  "getDailyTip",
  "getMyProfile",
  "getPlaybook",
  "getTagItemsForProperty",
  "listCityReferences",
  "listConversationTransferTargets",
  "listHandoffConversations",
  "listPropertyTypes",
  "listProviderCategories",
  "searchPlacesForRec",
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "__tests__" ? [] : files(p);
    return /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("trilha de auditoria — leitura x ação", () => {
  it("classifica pelo nome", () => {
    for (const n of ["listTasks", "getMyAccessDecisions", "countPendingHandoffs", "checkIsAdmin", "adminListCustomers", "listDashboardArrivalsBatch"])
      expect(isReadCall(n), n).toBe(true);
    for (const n of ["advanceArrival", "upsertArrivalStatus", "issueGuestPass", "resolveHandoffConversation", "backfillPropertyCoords", "recordGuideAccess", "getawayX"])
      expect(isReadCall(n), n).toBe(false);
  });

  it("nenhuma função com nome de leitura grava sem revisão", () => {
    const W = /\.(insert|update|upsert|delete)\(|\.rpc\(|method:\s*"(POST|PUT|DELETE|PATCH)"/;
    const found: string[] = [];
    for (const p of files(join(process.cwd(), "src"))) {
      const s = readFileSync(p, "utf8");
      const ms = [...s.matchAll(/export const (\w+) = createServerFn\(\{ method: "(GET|POST)"/g)];
      ms.forEach((m, i) => {
        const name = m[1]!;
        if (!isReadCall(name)) return;
        let body = s.slice(m.index! + m[0].length, i + 1 < ms.length ? ms[i + 1]!.index : s.length);
        const cut = body.search(/\n(export |function |async function |const [A-Z])/);
        if (cut >= 0) body = body.slice(0, cut);
        if (W.test(body) && !REVIEWED_READS_WITH_SIDE_EFFECTS.has(name)) found.push(`${name} (${p})`);
      });
    }
    expect(found).toEqual([]);
  });
});
