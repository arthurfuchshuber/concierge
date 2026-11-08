/**
 * B2.2 · integração ISOLADA (sem Orchestrator real, sem Gateway, sem envio):
 * fontes → projeções → normalização multipropriedade → FreeTextGuard real → composição.
 */
import { describe, expect, it } from "vitest";
import { buildPlaybook } from "@/lib/playbook-build";
import { ALTERNATIVE_PURPOSE, authorizeCandidateProperty, primaryDossierTarget } from "@/lib/guest-ai/data/property-access.server";
import { fetchPropertyDossier } from "@/lib/guest-ai/data/property-dossier.server";
import { composeTurnPrompt, MAX_CANDIDATE_DOSSIERS, type FreeTextGuard } from "@/lib/guest-ai/composer";
import { normalizeHistory } from "@/lib/guest-ai/history";
import { SECRET_SCRUBBER, SECRET_MARKER } from "@/lib/guest-ai/secret-scrub";
import { DOSSIER_TAG, HISTORY_TAG, buildSystemPrompt } from "@/lib/guest-ai/system-prompt";
import { issuePropertyDossier, withAvailability } from "@/lib/guest-ai/dossier/registry";
import { issue } from "@/lib/guest-ai/trust";
import { DECISION_LIMITS } from "@/lib/guest-ai/orchestrator/decision";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { CONV, MSG, conversationContext, row } from "./helpers/b21-fixtures";
import { P1, P2, P3, PLANTED_SECRETS, PROTECTED_VALUES, PX, T1, T2, portfolioDb, portfolioTables } from "./helpers/b22-portfolio";

const turn = () =>
  issue("turn", { surface: "guide_chat", conversationId: CONV, messageId: MSG, propertyId: P1, tenantId: T1, guestSessionId: "s", conversationStatus: "ai", reservationId: "r1", messageCreatedAt: null }) as ValidatedTurn;
const NOW = () => new Date("2026-11-03T12:00:00Z");
const build = buildPlaybook as never;

const ctx = () =>
  conversationContext({
    property: { id: P1, tenantId: T1, name: "Flat Marcador1", timezone: "America/Sao_Paulo", listingFacts: null, dossierKnowledge: null },
  });

const history = () =>
  normalizeHistory(
    [
      row({ created_at: "2026-11-03T10:00:00Z", role: "assistant", sender_type: "human", content: "Olá! A senha da porta é 4821, qualquer coisa chame." }),
      row({ created_at: "2026-11-03T10:01:00Z", role: "assistant", sender_type: "ai", content: "A senha do Wi-Fi é Praia2024" }),
      row({ id: MSG, created_at: "2026-11-03T10:02:00Z", content: "Somos 6 pessoas, tem outro apartamento maior? A fechadura com a senha 4821 travou." }),
    ],
    { conversationId: CONV, currentMessageId: MSG },
  );

async function dossiers(candidates: string[] = [P2, P3]) {
  const { db } = portfolioDb();
  const primary = await fetchPropertyDossier(primaryDossierTarget(turn(), ["P", "G"]), { db, now: NOW, buildPlaybook: build });
  const cands = [];
  for (const id of candidates) {
    const d = await authorizeCandidateProperty(turn(), id, ALTERNATIVE_PURPOSE, { db });
    if (!d.ok) throw new Error(d.reason);
    cands.push(await fetchPropertyDossier(d.target, { db, now: NOW, buildPlaybook: build }));
  }
  return { primary, candidates: cands };
}
function blockOf(user: string, tag: string): string {
  const open = user.indexOf(`<${tag}`);
  return user.slice(user.indexOf("\n", open) + 1, user.indexOf(`</${tag}>`)).trim();
}

describe("B2.2 · pipeline completo isolado: fontes → projeções → normalização → guard → composição", () => {
  it("compõe com principal + 2 alternativos; nenhum segredo (plantado ou protegido) chega ao prompt", async () => {
    const r = composeTurnPrompt({ context: ctx(), history: history(), dossiers: await dossiers() }, { guard: SECRET_SCRUBBER });
    expect(r.kind).toBe("prompt");
    if (r.kind !== "prompt") return;
    const all = r.prompt.system + r.prompt.messages.map((m) => m.content).join("");
    for (const s of [...PLANTED_SECRETS, ...PROTECTED_VALUES]) expect(all, s).not.toContain(s);
    expect(all).toContain(SECRET_MARKER);
    expect(r.prompt.messages).toHaveLength(1);
    expect(r.prompt.system).toBe(buildSystemPrompt("guide_chat"));
  });

  it("conteúdo legítimo preservado ao lado do segredo removido (relato da fechadura, descrição, entorno)", async () => {
    const r = composeTurnPrompt({ context: ctx(), history: history(), dossiers: await dossiers() }, { guard: SECRET_SCRUBBER });
    if (r.kind !== "prompt") throw new Error(r.kind);
    const user = r.prompt.messages[0]!.content;
    const hist = JSON.parse(blockOf(user, HISTORY_TAG));
    expect(hist.at(-1).texto).toBe(`Somos 6 pessoas, tem outro apartamento maior? A fechadura com a senha ${SECRET_MARKER} travou.`);
    const dos = JSON.parse(blockOf(user, DOSSIER_TAG));
    expect(JSON.stringify(dos[1])).toContain("Vista para o mar MARCADOR-2");
    // o Explorar do anfitrião não entra no prompt (07/11/2026): nem no Dossiê nem em bloco próprio
    expect(JSON.stringify(dos)).not.toContain("Mercado P3");
    expect(user).not.toContain("Mercado P3");
    expect(user).not.toContain("recomendacoes_google_maps");
  });

  it("principal e alternativos inequivocamente separados, cada um só com os próprios dados e ids", async () => {
    const r = composeTurnPrompt({ context: ctx(), history: history(), dossiers: await dossiers() }, { guard: SECRET_SCRUBBER });
    if (r.kind !== "prompt") throw new Error(r.kind);
    const dos = JSON.parse(blockOf(r.prompt.messages[0]!.content, DOSSIER_TAG));
    expect(dos.map((d: { ref: string; papel: string }) => [d.ref, d.papel])).toEqual([["principal", "principal"], ["alt1", "alternativo"], ["alt2", "alternativo"]]);
    expect(r.dossierRefs).toEqual([
      { ref: "principal", propertyId: P1, role: "primary" },
      { ref: "alt1", propertyId: P2, role: "candidate" },
      { ref: "alt2", propertyId: P3, role: "candidate" },
    ]);
    dos.forEach((d: Record<string, unknown>, i: number) => {
      const t = JSON.stringify(d);
      expect(t).toMatch(new RegExp(`REGRA-LISTING-P${i + 1}`));
      for (let n = 1; n <= 3; n++) if (n !== i + 1) expect(t).not.toMatch(new RegExp(`REGRA-LISTING-P${n}|AMENIDADE-P${n}`));
      for (const e of d["entradas"] as Array<{ id: string }>) expect(e.id.startsWith(`dos:${d["ref"]}:`)).toBe(true);
    });
    // disponibilidade nunca inferida
    for (const d of dos) expect(d.disponibilidade).toEqual({ status: "nao_consultada" });
    // candidatos sem endereço nem manuais; principal com manual (texto sanitizado)
    expect(JSON.stringify(dos[1])).not.toContain("Rua Privada");
    expect(dos[1].manuais).toEqual([]);
    expect(dos[0].manuais[0].conteudo).toBe(`Ligue no botão vermelho. A senha da TV: ${SECRET_MARKER}`);
    // capacidade com procedência e conflito preservado no alternativo
    expect(dos[1].capacidade.hospedes.status).toBe("conflito");
    // ids citáveis válidos e presentes nos sourceIds
    const ids = [...r.prompt.sourceIds!].filter((x) => x.startsWith("dos:"));
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) expect(DECISION_LIMITS.sourceIdPattern.test(id), id).toBe(true);
    // Explorar fora do prompt ⇒ nenhum id de lugar do guia é citável
    expect([...r.prompt.sourceIds!].filter((x) => x.startsWith("gm:"))).toEqual([]);
  });

  it("seções do anúncio/dossiê deixam de ser indisponíveis quando o dossiê é carregado", async () => {
    const r = composeTurnPrompt({ context: ctx(), history: history(), dossiers: await dossiers([]) }, { guard: SECRET_SCRUBBER });
    if (r.kind !== "prompt") throw new Error(r.kind);
    expect(r.manifest.unavailableSections).toEqual(["orientacoes_do_anfitriao", "precedentes"]);
    const without = composeTurnPrompt({ context: ctx(), history: history() }, { guard: SECRET_SCRUBBER });
    if (without.kind !== "prompt") throw new Error(without.kind);
    expect(without.manifest.unavailableSections).toEqual(["fatos_do_anuncio", "dossie_do_imovel", "orientacoes_do_anfitriao", "precedentes"]);
    expect(without.prompt.messages[0]!.content).not.toContain(`<${DOSSIER_TAG}`);
  });

  it("métricas do guard: contagens e categorias por fonte técnica — nenhum conteúdo", async () => {
    const r = composeTurnPrompt({ context: ctx(), history: history(), dossiers: await dossiers() }, { guard: SECRET_SCRUBBER });
    if (r.kind !== "prompt") throw new Error(r.kind);
    const m = r.guardMetrics;
    expect(m.guard).toEqual({ id: "secret-scrub", version: expect.any(String) });
    expect(m.examined).toBeGreaterThan(20);
    expect(m.byStatus.sanitized).toBeGreaterThanOrEqual(5);
    expect(Object.keys(m.bySource)).toEqual(expect.arrayContaining(["history.team", "history.legacy_ai", "history.guest", "dossier.principal", "dossier.alt1", "dossier.alt2"]));
    // o Explorar não entra no prompt (07/11/2026): nada dele passa pelo guard da composição
    expect(Object.keys(m.bySource).some((k) => k.startsWith("places."))).toBe(false);
    const json = JSON.stringify(m);
    for (const s of [...PLANTED_SECRETS, "MARCADOR", "Padaria"]) expect(json).not.toContain(s);
  });

  // B2.3 (§6.1): a detecção continua (o guard marca `ambiguous`), mas a POLÍTICA mudou de
  // "compõe com o texto saneado" para "recusa a composição". Nada é composto e nada vaza.
  it("valor dividido entre mensagens no histórico é detectado (hint) e, sendo ambíguo, RECUSA a composição", async () => {
    const h = normalizeHistory(
      [
        row({ created_at: "2026-11-03T10:00:00Z", role: "assistant", sender_type: "human", content: "A senha do cofre é" }),
        row({ created_at: "2026-11-03T10:00:30Z", role: "assistant", sender_type: "human", content: "7351" }),
        row({ id: MSG, created_at: "2026-11-03T10:01:00Z", content: "obrigado" }),
      ],
      { conversationId: CONV, currentMessageId: MSG },
    );
    expect(SECRET_SCRUBBER.scan("7351", { previous: "A senha do cofre é" }).status).toBe("ambiguous");
    const r = composeTurnPrompt({ context: ctx(), history: h }, { guard: SECRET_SCRUBBER });
    expect(r).toEqual({ kind: "unavailable", reason: "guard_ambiguous" });
    expect(JSON.stringify(r)).not.toContain("7351");
  });
});

describe("B2.2 · composição recusada: guard ausente/inválido/falho e dossiês fora do escopo", () => {
  it("sem guard, guard sem scan ou guard que não se confirma ⇒ recusa (nunca usa o original)", async () => {
    const d = await dossiers();
    const base = { context: ctx(), history: history(), dossiers: d };
    expect(composeTurnPrompt(base)).toEqual({ kind: "unavailable", reason: "free_text_guard_missing" });
    expect(composeTurnPrompt(base, { guard: { id: "x", version: "1", apply: (t: string) => t } as never })).toEqual({ kind: "unavailable", reason: "free_text_guard_missing" });
    // guard "identidade" (diz safe e devolve o texto intacto): reprovado na prova de eficácia (canário)
    const liar: FreeTextGuard = { id: "liar", version: "1", scan: (t) => ({ status: "safe", text: t, findings: [] }) };
    expect(composeTurnPrompt(base, { guard: liar })).toEqual({ kind: "unavailable", reason: "guard_failed" });
    const fakeStatus: FreeTextGuard = { id: "fs", version: "1", scan: (t) => ({ status: "sanitized", text: t, findings: [] }) };
    expect(composeTurnPrompt(base, { guard: fakeStatus })).toEqual({ kind: "unavailable", reason: "guard_failed" });
    const unstable: FreeTextGuard = { id: "u", version: "1", scan: (t) => ({ status: "safe", text: `${t}!`, findings: [] }) };
    expect(composeTurnPrompt(base, { guard: unstable })).toEqual({ kind: "unavailable", reason: "guard_failed" });
    const badStatus: FreeTextGuard = { id: "b", version: "1", scan: (t) => ({ status: "clean" as never, text: t, findings: [] }) };
    expect(composeTurnPrompt(base, { guard: badStatus })).toEqual({ kind: "unavailable", reason: "guard_failed" });
    let calls = 0;
    const partial: FreeTextGuard = { id: "p", version: "1", scan: (t) => { calls++; if (calls > 7) throw new Error("falha parcial"); return SECRET_SCRUBBER.scan(t); } };
    expect(composeTurnPrompt(base, { guard: partial })).toEqual({ kind: "unavailable", reason: "guard_failed" });
    const noFindings: FreeTextGuard = { id: "n", version: "1", scan: (t) => ({ status: "safe", text: t }) as never };
    expect(composeTurnPrompt(base, { guard: noFindings })).toEqual({ kind: "unavailable", reason: "guard_failed" });
  });

  it("guard que passa no canário mas não confirma o próprio resultado na re-varredura ⇒ recusa", async () => {
    const base = { context: ctx(), history: history(), dossiers: await dossiers() };
    // reconhece o próprio marcador como "ainda suspeito": a 2ª varredura não volta como safe
    const notIdempotent: FreeTextGuard = { id: "ni", version: "1", scan: (t) => {
      const r = SECRET_SCRUBBER.scan(t);
      return t.includes(SECRET_MARKER) ? { ...r, status: "sanitized" } : r;
    } };
    expect(composeTurnPrompt(base, { guard: notIdempotent })).toEqual({ kind: "unavailable", reason: "guard_failed" });
    // 2ª varredura diz safe, mas altera o texto já saneado
    const drifting: FreeTextGuard = { id: "dr", version: "1", scan: (t) => {
      const r = SECRET_SCRUBBER.scan(t);
      return t.includes(SECRET_MARKER) ? { status: "safe", text: `${r.text} `, findings: [] } : r;
    } };
    expect(composeTurnPrompt(base, { guard: drifting })).toEqual({ kind: "unavailable", reason: "guard_failed" });
    // controle positivo: o scrubber real é idempotente e a composição sai
    expect(composeTurnPrompt(base, { guard: SECRET_SCRUBBER }).kind).toBe("prompt");
  });

  it("dossiê forjado (não emitido pelo loader) ⇒ dossier_scope_mismatch", async () => {
    const d = await dossiers([]);
    const forged = JSON.parse(JSON.stringify(d.primary));
    expect(composeTurnPrompt({ context: ctx(), history: history(), dossiers: { primary: forged } }, { guard: SECRET_SCRUBBER })).toEqual({ kind: "unavailable", reason: "dossier_scope_mismatch" });
  });

  it("principal de outro imóvel ou de outro tenant ⇒ recusa", async () => {
    const d = await dossiers([]);
    const c = ctx();
    c.guest.property.id = P2;
    expect(composeTurnPrompt({ context: c, history: history(), dossiers: { primary: d.primary } }, { guard: SECRET_SCRUBBER })).toMatchObject({ reason: "dossier_scope_mismatch" });
    const c2 = ctx();
    c2.guest.property.tenantId = T2;
    expect(composeTurnPrompt({ context: c2, history: history(), dossiers: { primary: d.primary } }, { guard: SECRET_SCRUBBER })).toMatchObject({ reason: "dossier_scope_mismatch" });
  });

  it("candidato de outro tenant nem chega a ser carregado; se emitido à força, o composer recusa", async () => {
    const { db } = portfolioDb();
    expect(await authorizeCandidateProperty(turn(), PX, ALTERNATIVE_PURPOSE, { db })).toEqual({ ok: false, reason: "tenant_mismatch" });
    const d = await dossiers([P2]);
    const foreign = issuePropertyDossier({ ...structuredClone(d.candidates[0]!), propertyId: PX, tenantId: T2 });
    expect(composeTurnPrompt({ context: ctx(), history: history(), dossiers: { primary: d.primary, candidates: [foreign] } }, { guard: SECRET_SCRUBBER })).toMatchObject({ reason: "dossier_scope_mismatch" });
  });

  it("candidato repetido, igual ao principal, com audiência de reserva ou papel errado ⇒ recusa", async () => {
    const d = await dossiers([P2]);
    const c = d.candidates[0]!;
    const cases = [
      [c, c],
      [issuePropertyDossier({ ...structuredClone(c), propertyId: P1 })],
      [issuePropertyDossier({ ...structuredClone(c), audiences: ["G", "P"] })],
      [issuePropertyDossier({ ...structuredClone(c), role: "primary" })],
    ];
    for (const cands of cases) {
      expect(composeTurnPrompt({ context: ctx(), history: history(), dossiers: { primary: d.primary, candidates: cands } }, { guard: SECRET_SCRUBBER })).toMatchObject({ reason: "dossier_scope_mismatch" });
    }
  });

  it("disponibilidade de outro imóvel não se liga; mais candidatos que o teto ⇒ recusa", async () => {
    const d = await dossiers([P2]);
    expect(() => withAvailability(d.candidates[0]!, { status: "confirmed_available", propertyId: P3, checkIn: "2026-12-01", checkOut: "2026-12-03", source: "x", consultedAt: "y" })).toThrow("availability_property_mismatch");
    const forged = issuePropertyDossier({ ...structuredClone(d.candidates[0]!), availability: { status: "confirmed_available", propertyId: P3, checkIn: "2026-12-01", checkOut: "2026-12-03", source: "x", consultedAt: "y" } });
    expect(composeTurnPrompt({ context: ctx(), history: history(), dossiers: { primary: d.primary, candidates: [forged] } }, { guard: SECRET_SCRUBBER })).toMatchObject({ reason: "dossier_scope_mismatch" });
    const many = Array.from({ length: MAX_CANDIDATE_DOSSIERS + 1 }, (_, i) => issuePropertyDossier({ ...structuredClone(d.candidates[0]!), propertyId: `cccccccc-0000-4000-8000-00000000000${i}` }));
    expect(composeTurnPrompt({ context: ctx(), history: history(), dossiers: { primary: d.primary, candidates: many } }, { guard: SECRET_SCRUBBER })).toMatchObject({ reason: "dossier_scope_mismatch" });
  });

  it("disponibilidade confirmada do PRÓPRIO imóvel aparece só no bloco dele", async () => {
    const d = await dossiers([P2, P3]);
    const p2 = withAvailability(d.candidates[0]!, { status: "confirmed_available", propertyId: P2, checkIn: "2026-12-01", checkOut: "2026-12-05", source: "fonte-futura", consultedAt: "2026-11-03T12:00:00Z" });
    const r = composeTurnPrompt({ context: ctx(), history: history(), dossiers: { primary: d.primary, candidates: [p2, d.candidates[1]!] } }, { guard: SECRET_SCRUBBER });
    if (r.kind !== "prompt") throw new Error(r.kind);
    const dos = JSON.parse(blockOf(r.prompt.messages[0]!.content, DOSSIER_TAG));
    expect(dos[1].disponibilidade.status).toBe("disponivel_confirmada");
    expect(dos[0].disponibilidade.status).toBe("nao_consultada");
    expect(dos[2].disponibilidade.status).toBe("nao_consultada");
  });

  it("System Prompt orienta separação, disponibilidade não inferida e nada de troca de imóvel prometida", () => {
    const sys = buildSystemPrompt("guide_chat");
    expect(sys).toContain(`<${DOSSIER_TAG}>`);
    expect(sys).toMatch(/nunca atribua a um imóvel uma característica, regra, localização ou disponibilidade de outro/);
    expect(sys).toMatch(/nao_consultada significa desconhecida/);
    expect(sys).toMatch(/nunca prometa troca de imóvel, transferência ou nova reserva/);
    expect(sys).toMatch(/Tempo de deslocamento: não ofereça por iniciativa própria/);
  });
});
