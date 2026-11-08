/**
 * Etapa 4 (08/11/2026) — aprendizado contínuo: candidato → revisão humana → Documento Vivo.
 * Só fatos ENCERRADOS, duradouros, isolados por imóvel, nunca pontuais nem com segredo.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateCandidate,
  isOneOff,
  renderLivingDocument,
  reviewCandidate,
  type LearningCandidateInput,
  type LearningEntry,
} from "../learning";

const P = "b1000000-0000-4000-8000-000000000001";
const P2 = "b1000000-0000-4000-8000-000000000002";
const base: LearningCandidateInput = {
  propertyId: P,
  category: "equipamentos",
  statement: "O portão da garagem emperra no frio: é preciso puxar a folha para si antes de girar a chave.",
  evidence: { source: "incident_resolved", propertyId: P, refs: ["msg-1", "msg-2"], closed: true },
};

describe("candidatura", () => {
  it("fato encerrado, duradouro, do mesmo imóvel ⇒ candidato", () => {
    expect(evaluateCandidate(base).ok).toBe(true);
    for (const source of ["checkout_done", "guest_confirmation"] as const)
      expect(evaluateCandidate({ ...base, evidence: { ...base.evidence, source } }).ok).toBe(true);
  });

  it("fato em aberto, sem evidência ou de outro imóvel ⇒ recusa", () => {
    expect(evaluateCandidate({ ...base, evidence: { ...base.evidence, closed: false } })).toEqual({ ok: false, code: "fact_not_closed" });
    expect(evaluateCandidate({ ...base, evidence: { ...base.evidence, refs: [] } })).toEqual({ ok: false, code: "no_evidence" });
    expect(evaluateCandidate({ ...base, evidence: { ...base.evidence, propertyId: P2 } })).toEqual({ ok: false, code: "cross_property" });
    expect(evaluateCandidate({ ...base, evidence: { ...base.evidence, source: "guest_request" as never } })).toEqual({ ok: false, code: "source_not_allowed" });
    expect(evaluateCandidate({ ...base, category: "fofoca" })).toEqual({ ok: false, code: "category_invalid" });
  });

  it.each([
    "O hóspede chegou às 14h e reclamou do barulho.",
    "Hoje a água acabou por causa da obra da rua.",
    "A reserva HMRDNHH22 pediu berço extra.",
    "Em 08/11 o ar-condicionado parou.",
    "Cobrar R$ 50 pela limpeza extra.",
    "A Sra. Patrícia prefere toalhas extras.",
    "Ligar para +55 41 98417 1017 se faltar luz.",
  ])("pontual ⇒ recusa: %s", (statement) => {
    expect(isOneOff(statement)).toBe(true);
    expect(evaluateCandidate({ ...base, statement })).toEqual({ ok: false, code: "one_off_fact" });
  });

  it("segredo nunca vira aprendizado (D9)", () => {
    const r = evaluateCandidate({ ...base, statement: "A senha do wifi da casa é praia2024 e a do cofre é 4471." });
    expect(r).toEqual({ ok: false, code: "contains_secret" });
  });
});

describe("revisão humana", () => {
  const entry: LearningEntry = {
    id: "l1",
    propertyId: P,
    category: "equipamentos",
    statement: base.statement,
    source: "incident_resolved",
    evidenceRefs: ["msg-1"],
    status: "pending",
    createdAt: "2026-11-08T10:00:00Z",
    decidedBy: null,
    decidedAt: null,
    history: [{ status: "pending", by: null, at: "2026-11-08T10:00:00Z", note: null }],
  };
  const boss = { userId: "u-owner", canTrain: true };

  it("só quem tem ai_train aprova; o histórico guarda autor e instante", () => {
    expect(reviewCandidate(entry, "approve", { userId: "u-member", canTrain: false }, "t")).toEqual({ ok: false, code: "not_authorized" });
    expect(reviewCandidate(entry, "approve", { userId: null, canTrain: true }, "t")).toEqual({ ok: false, code: "no_reviewer" });
    const r = reviewCandidate(entry, "approve", boss, "2026-11-08T11:00:00Z", "ok");
    expect(r.ok && r.entry).toMatchObject({ status: "approved", decidedBy: "u-owner" });
    expect(r.ok && r.entry.history.at(-1)).toEqual({ status: "approved", by: "u-owner", at: "2026-11-08T11:00:00Z", note: "ok" });
  });

  it("transições fechadas: recusado não volta; aprovado só pode ser revogado", () => {
    const rej = reviewCandidate(entry, "reject", boss, "t");
    expect(rej.ok && reviewCandidate(rej.entry, "approve", boss, "t2")).toEqual({ ok: false, code: "invalid_transition" });
    const ap = reviewCandidate(entry, "approve", boss, "t");
    const rev = ap.ok ? reviewCandidate(ap.entry, "revoke", boss, "t3") : null;
    expect(rev?.ok && rev.entry.status).toBe("revoked");
  });

  it("Documento Vivo: só aprovados e ativos DO imóvel, com origem e data", () => {
    const ap = reviewCandidate(entry, "approve", boss, "2026-11-08T11:00:00Z");
    const approved = ap.ok ? ap.entry : entry;
    const other: LearningEntry = { ...approved, id: "l2", propertyId: P2, statement: "Outro imóvel: não aparece." };
    const pending: LearningEntry = { ...entry, id: "l3", statement: "Pendente: não aparece." };
    const doc = renderLivingDocument(P, [approved, other, pending]);
    expect(doc).toContain("## Equipamentos");
    expect(doc).toContain("O portão da garagem emperra no frio");
    expect(doc).toContain("origem: incidente resolvido; aprovado em 2026-11-08");
    expect(doc).not.toContain("Outro imóvel");
    expect(doc).not.toContain("Pendente");
    expect(renderLivingDocument(P, [pending])).toBe("");
  });
});

describe("fronteiras (até a aprovação do SQL)", () => {
  it("o módulo é puro e ninguém o usa ainda: sem banco, rede, prompt, slot ou cron", () => {
    const root = path.resolve(__dirname, "../..");
    const src = readFileSync(path.join(root, "learning/learning.ts"), "utf8");
    expect(src).not.toMatch(/supabase|client\.server|\bfetch\(|\.from\(\s*["'`]|\.rpc\(|generateGuestLlm/);
    for (const f of ["system-prompt.ts", "composer.ts", "slot.server.ts", "copilot/generate.server.ts"])
      expect(readFileSync(path.join(root, f), "utf8"), f).not.toMatch(/learning\/learning|renderLivingDocument/);
  });
});
