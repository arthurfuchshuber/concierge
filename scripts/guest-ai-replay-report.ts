/**
 * Relatório de qualidade da IA a partir de uma EXPORTAÇÃO (JSON), sem tocar em produção:
 *   npx tsx scripts/guest-ai-replay-report.ts caminho/export.json
 * Formato: [{ "id": "...", "aiReply": "...", "aiHandoff": true, "aiHandoffReason": "...", "humanReply": "..." }, ...]
 * `aiReply` pode ser a resposta JÁ enviada no passado (auditoria do histórico) ou a de um replay. Só lê o arquivo.
 */
import { readFileSync } from "node:fs";
import { summarizeReplay, type ReplayCase } from "../src/lib/guest-ai/quality/reply-quality";

const file = process.argv[2];
if (!file) {
  console.error("uso: tsx scripts/guest-ai-replay-report.ts export.json");
  process.exit(2);
}
const cases = JSON.parse(readFileSync(file, "utf8")) as ReplayCase[];
const s = summarizeReplay(cases);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`Casos: ${s.total} | IA falou: ${s.spoke} | silêncio: ${s.silent} (${pct(s.silentRate)}) | encaminhou: ${s.handoffs} (${pct(s.handoffRate)})`);
console.log(`Respostas com vício de voz: ${s.withIssues}`, s.issueCounts);
console.log("Encaminhamentos por categoria:", s.handoffByCategory);
console.log(`Possíveis encaminhamentos evitáveis (${s.possiblyAvoidableHandoffs.length}):`, s.possiblyAvoidableHandoffs.slice(0, 30));
console.log(`Silêncios em que a equipe respondeu depois (${s.silentButHumanAnswered.length}):`, s.silentButHumanAnswered.slice(0, 30));
