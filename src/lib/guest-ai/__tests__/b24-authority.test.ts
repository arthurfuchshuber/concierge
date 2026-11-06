/**
 * B2.4 · Resolução de conflitos por AUTORIDADE DE DOMÍNIO, com proveniência preservada.
 * Nenhuma informação não comprovada é promovida a fato confirmado.
 */
import { describe, expect, it } from "vitest";
import { buildPlaybook } from "@/lib/playbook-build";
import {
  AUTHORITY_MATRIX,
  FACT_DOMAINS,
  SOURCE_CATEGORY,
  SOURCE_CLASSES,
  resolveDomain,
  toKnown,
  type FactClaim,
} from "@/lib/guest-ai/dossier/authority";
import { primaryDossierTarget, authorizeCandidateProperty, ALTERNATIVE_PURPOSE } from "@/lib/guest-ai/data/property-access.server";
import { fetchPropertyDossier } from "@/lib/guest-ai/data/property-dossier.server";
import { composeTurnPrompt } from "@/lib/guest-ai/composer";
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
import { issue } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { P1, P2, T1, portfolioDb } from "./helpers/b22-portfolio";
import { CONV, MSG, conversationContext } from "./helpers/b21-fixtures";
import { history } from "./helpers/b23-chain";

const NOW = "2026-11-03T12:00:00Z";
const claim = (over: Partial<FactClaim>): FactClaim => ({
  domain: "checkout_time_standard",
  propertyId: "p1",
  value: "11:00",
  source: "official_property_record",
  sourceRef: "properties.checkout_time",
  observedAt: null,
  validUntil: null,
  temporal: "current",
  ...over,
});
const resolve = (claims: FactClaim[], domain: FactClaim["domain"] = "checkout_time_standard") => resolveDomain(domain, "p1", claims, NOW);

describe("B2.4 · matriz de autoridade (por domínio, não universal)", () => {
  it("todos os domínios declarados; exceções de horário e credenciais só com autorização formal", () => {
    expect(Object.keys(AUTHORITY_MATRIX).sort()).toEqual([...FACT_DOMAINS].sort());
    for (const d of ["early_checkin", "late_checkout", "credentials"] as const) expect(AUTHORITY_MATRIX[d].tiers).toEqual([["formal_authorization"]]);
    expect(AUTHORITY_MATRIX.reviews.tiers).toEqual([]);
    expect(AUTHORITY_MATRIX.precedents.tiers).toEqual([]);
    // mensagem de equipe/hóspede nunca decide domínio nenhum
    for (const d of FACT_DOMAINS) for (const t of AUTHORITY_MATRIX[d].tiers) expect(t).not.toContain("staff_message"), expect(t).not.toContain("guest_message");
    expect(Object.keys(SOURCE_CATEGORY).sort()).toEqual([...SOURCE_CLASSES].sort());
  });
});

describe("B2.4 · resolução de conflitos (§8.1)", () => {
  it("dossiê/cadastro concordantes ⇒ confirmado pela fonte oficial, sem divergência", () => {
    const r = resolve([claim({}), claim({ source: "listing_public", sourceRef: "listing.checkout_time" })]);
    expect(r).toMatchObject({ status: "confirmed", value: "11:00", authority: { source: "official_property_record", tier: 0 }, divergent: [] });
  });
  it("divergentes ⇒ vale o cadastro oficial; o anúncio fica registrado como divergente (não descartado)", () => {
    const r = resolve([claim({}), claim({ source: "listing_public", sourceRef: "listing.checkout_time", value: "10:00" })]);
    expect(r.status).toBe("confirmed");
    expect(r.value).toBe("11:00");
    expect(r.divergent).toEqual([{ value: "10:00", source: "listing_public", sourceRef: "listing.checkout_time" }]);
  });
  it("regra da casa oficial divergente do anúncio ⇒ oficial confirmada, anúncio divergente", () => {
    const r = resolve(
      [
        claim({ domain: "house_rules", value: "Sem festas.", sourceRef: "properties.house_rules" }),
        claim({ domain: "house_rules", value: "Festas permitidas até 22h.", source: "listing_public", sourceRef: "listing.public.house_rules" }),
      ],
      "house_rules",
    );
    expect(r).toMatchObject({ status: "confirmed", value: "Sem festas.", authority: { source: "official_property_record" } });
    expect(r.divergent).toHaveLength(1);
  });
  it("fonte mais RECENTE sem autoridade (mensagem da equipe) não vence o cadastro", () => {
    const r = resolve([claim({ observedAt: "2026-01-01T00:00:00Z" }), claim({ source: "staff_message", sourceRef: "hist:team:h3", value: "13:00", observedAt: "2026-11-03T11:59:00Z" })]);
    expect(r).toMatchObject({ status: "confirmed", value: "11:00" });
    expect(r.excluded).toContainEqual({ sourceRef: "hist:team:h3", reason: "non_authoritative" });
    expect(r.divergent).toContainEqual({ value: "13:00", source: "staff_message", sourceRef: "hist:team:h3" });
  });
  it("só fonte sem autoridade ⇒ desconhecido (nunca promovido)", () => {
    const r = resolve([claim({ source: "staff_message", sourceRef: "hist:team:h3", value: "13:00" })]);
    expect(r).toMatchObject({ status: "unknown", uncertainty: "only_non_authoritative_sources" });
    expect(r.value).toBeUndefined();
  });
  it("fonte antiga FORMALMENTE substituída sai; substituição sem registro substituto não vale", () => {
    const r = resolve([claim({ sourceRef: "properties.checkout_time@v1", value: "10:00", supersededBy: "properties.checkout_time@v2" }), claim({ sourceRef: "properties.checkout_time@v2", value: "11:00" })]);
    expect(r).toMatchObject({ status: "confirmed", value: "11:00" });
    expect(r.excluded).toContainEqual({ sourceRef: "properties.checkout_time@v1", reason: "superseded" });
    const orphan = resolve([claim({ sourceRef: "a", value: "10:00", supersededBy: "inexistente" }), claim({ sourceRef: "b", value: "11:00" })]);
    expect(orphan.status).toBe("conflict");
  });
  it("informação desconhecida (nenhuma fonte) ⇒ unknown/no_source", () => {
    expect(resolve([])).toMatchObject({ status: "unknown", uncertainty: "no_source" });
  });
  it("informação expirada ⇒ stale (não confirmada)", () => {
    const r = resolve([claim({ validUntil: "2026-10-01T00:00:00Z" })]);
    expect(r).toMatchObject({ status: "stale", uncertainty: "all_authoritative_expired" });
    // expirada no topo não deixa a camada inferior virar "oficial": a inferior decide como inferior
    const r2 = resolve([claim({ validUntil: "2026-10-01T00:00:00Z" }), claim({ source: "listing_public", sourceRef: "listing", value: "10:00" })]);
    expect(r2).toMatchObject({ status: "confirmed", value: "10:00", authority: { source: "listing_public", tier: 1 } });
  });
  it("proveniência incompleta ⇒ excluída", () => {
    const r = resolve([claim({ sourceRef: "" }), claim({ source: "fonte_x" as never, sourceRef: "x" }), claim({ value: "" as never, sourceRef: "y" })]);
    expect(r.status).toBe("unknown");
    expect(r.excluded.every((e) => e.reason === "incomplete_provenance")).toBe(true);
  });
  it("duas fontes de autoridade EQUIVALENTE divergentes ⇒ conflito preservado (capacidade só tem fontes do anúncio)", () => {
    const r = resolve(
      [claim({ domain: "max_guests", value: 4, source: "listing_sync_copy", sourceRef: "properties.airbnb_guest_count" }), claim({ domain: "max_guests", value: 6, source: "listing_public", sourceRef: "listing.public.guests" })],
      "max_guests",
    );
    expect(r).toMatchObject({ status: "conflict", uncertainty: "equivalent_authority_disagree" });
    expect(r.conflicting).toHaveLength(2);
    expect(toKnown(r)).toEqual({ status: "conflict", values: [{ value: 4, source: "properties.airbnb_guest_count" }, { value: 6, source: "listing.public.guests" }] });
  });
  it("informação histórica contradizendo o estado atual ⇒ histórico excluído", () => {
    const r = resolve([claim({}), claim({ source: "official_property_record", sourceRef: "historico", value: "12:00", temporal: "historical" })]);
    expect(r).toMatchObject({ status: "confirmed", value: "11:00" });
    expect(r.excluded).toContainEqual({ sourceRef: "historico", reason: "historical" });
  });
  it("conflito sem resolução possível no topo continua conflito (sem escolher o mais favorável)", () => {
    const r = resolve([claim({ sourceRef: "a", value: "11:00" }), claim({ sourceRef: "b", value: "14:00" }), claim({ source: "listing_public", sourceRef: "c", value: "14:00" })]);
    expect(r.status).toBe("conflict");
    expect(toKnown(r).status).toBe("conflict");
  });
  it("afirmação de OUTRO imóvel nunca entra", () => {
    const r = resolve([claim({ propertyId: "p9", value: "09:00" })]);
    expect(r).toMatchObject({ status: "unknown" });
    expect(r.excluded).toEqual([{ sourceRef: "properties.checkout_time", reason: "other_property" }]);
  });
  it("domínio sem autoridade (avaliações) nunca vira fato; não aplicável quando não há estadia", () => {
    expect(resolveDomain("reviews", "p1", [claim({ domain: "reviews", source: "guest_review", sourceRef: "r1", value: "ótimo" })], NOW)).toMatchObject({ status: "unknown", uncertainty: "domain_without_authority" });
    expect(resolveDomain("late_checkout", "p1", [], NOW, false).status).toBe("not_applicable");
    // saída tardia: mensagem da equipe não autoriza
    expect(resolveDomain("late_checkout", "p1", [claim({ domain: "late_checkout", source: "staff_message", sourceRef: "hist:team:h1", value: "14:00" })], NOW).status).toBe("unknown");
  });
});

describe("B2.4 · dossiê real: fatos resolvidos com proveniência e renderizados no prompt", () => {
  const turn = () => issue("turn", { surface: "guide_chat", conversationId: CONV, messageId: MSG, propertyId: P1, tenantId: T1, guestSessionId: "s", conversationStatus: "ai", reservationId: "r1", messageCreatedAt: null }) as ValidatedTurn;
  it("P1: checkout oficial 11:00 confirmado, anúncio 10:00 divergente; P2: capacidade em conflito entre fontes do anúncio", async () => {
    const { db } = portfolioDb();
    const d1 = await fetchPropertyDossier(primaryDossierTarget(turn(), ["P", "G"]), { db, now: () => new Date(NOW), buildPlaybook: buildPlaybook as never });
    const co = d1.resolved.find((r) => r.domain === "checkout_time_standard")!;
    expect(co).toMatchObject({ status: "confirmed", value: "11:00", authority: { source: "official_property_record" } });
    expect(co.divergent).toEqual([{ value: "10:00", source: "listing_public", sourceRef: "listing.checkout_time" }]);
    expect(Object.isFrozen(d1.resolved)).toBe(true);
    const a = await authorizeCandidateProperty(turn(), P2, ALTERNATIVE_PURPOSE, { db });
    if (!a.ok) throw new Error(a.reason);
    const d2 = await fetchPropertyDossier(a.target, { db, now: () => new Date(NOW), buildPlaybook: buildPlaybook as never });
    expect(d2.resolved.find((r) => r.domain === "max_guests")!.status).toBe("conflict");

    const ctx = conversationContext({ property: { id: P1, tenantId: T1, name: "Flat", timezone: "America/Sao_Paulo", listingFacts: null, dossierKnowledge: null } });
    const r = composeTurnPrompt({ context: ctx, history: history(), dossiers: { primary: d1, candidates: [d2] } }, { guard: SECRET_SCRUBBER });
    if (r.kind !== "prompt") throw new Error(r.kind);
    const user = r.prompt.messages[0]!.content;
    expect(user).toContain('"dominio":"checkout_time_standard","estado":"confirmado","valor":"11:00","autoridade":"official_property_record"');
    expect(user).toContain('"fontes_divergentes_sem_autoridade":[{"valor":"10:00","fonte":"listing_public"}]');
    expect(user).toContain('"dominio":"max_guests","estado":"conflito"');
    expect(r.prompt.sourceIds!.has("dos:principal:resolved:checkout_time_standard")).toBe(true);
  });
});
