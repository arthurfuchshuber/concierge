/**
 * F2-B · B2.2 — CARREGADOR SOB DEMANDA do Dossiê de UM imóvel autorizado.
 *
 * - Só aceita um `DossierTarget` emitido por `property-access.server.ts` (principal = imóvel do
 *   turno; candidato = mesmo tenant, validado individualmente). Alvo forjado ⇒ erro de segurança.
 * - Revalida no banco, no momento da leitura, a posse (tenant) e — para candidato — que o imóvel
 *   segue ativo (sem janela entre autorizar e ler).
 * - Todas as consultas filtradas pelo `propertyId` do alvo, com projeções explícitas (nada de `*`,
 *   nenhuma coluna de senha, nenhuma coluna financeira, nenhum minuto estimado).
 * - Normalização pura em `dossier/normalize.ts`; o dossiê sai emitido (congelado) no registro.
 * - Não carrega o portfólio: um imóvel por chamada. Nenhum chamador de produção nesta etapa.
 */
import { GuestAiSecurityError } from "@/lib/guest-ai/trust";
import { DossierError, type PropertyDossier } from "@/lib/guest-ai/dossier/contracts";
import { normalizePropertyDossier } from "@/lib/guest-ai/dossier/normalize";
import { isIssuedDossierTarget, issuePropertyDossier, type DossierTarget } from "@/lib/guest-ai/dossier/registry";
import type { BuildPlaybookFn } from "./dossier.server";
import { abortableDb, getGuestAiDb, throwIfAborted, type GuestAiDb } from "./client.server";
import {
  CHECKOUT_ITEM_COLUMNS,
  EMERGENCY_COLUMNS,
  ENTRY_COLUMNS,
  FAQ_COLUMNS,
  LISTING_COLUMNS,
  MANUAL_DOSSIER_COLUMNS,
  PROPERTY_ACCESS_COLUMNS,
  PROPERTY_DOSSIER_COLUMNS,
  RECOMMENDATION_PUBLIC_COLUMNS,
  cols,
} from "./projections";

type Row = Record<string, unknown>;

export interface PropertyDossierDeps {
  db?: GuestAiDb;
  signal?: AbortSignal;
  now?: () => Date;
  buildPlaybook?: BuildPlaybookFn;
}

export async function fetchPropertyDossier(target: DossierTarget, deps: PropertyDossierDeps = {}): Promise<Readonly<PropertyDossier>> {
  if (!isIssuedDossierTarget(target)) throw new GuestAiSecurityError("dossier_requires_authorized_target");
  throwIfAborted(deps.signal);
  const db = abortableDb(deps.db ?? (await getGuestAiDb()), deps.signal);
  const id = target.propertyId;

  const [access, prop, faqs, checkout, emergency, manuals, entries, listing, recs] = await Promise.all([
    db.from("properties").select(cols(PROPERTY_ACCESS_COLUMNS)).eq("id", id).maybeSingle(),
    db.from("properties").select(cols(PROPERTY_DOSSIER_COLUMNS)).eq("id", id).maybeSingle(),
    db.from("property_faqs").select(cols(FAQ_COLUMNS)).eq("property_id", id).order("position", { ascending: true }),
    db.from("property_checkout_items").select(cols(CHECKOUT_ITEM_COLUMNS)).eq("property_id", id).order("position", { ascending: true }),
    db.from("property_emergency_contacts").select(cols(EMERGENCY_COLUMNS)).eq("property_id", id).order("position", { ascending: true }),
    db.from("property_manual_items").select(cols(MANUAL_DOSSIER_COLUMNS)).eq("property_id", id).order("position", { ascending: true }),
    db.from("property_playbook_entries").select(cols(ENTRY_COLUMNS)).eq("property_id", id),
    db.from("property_listing_raw_data").select(cols(LISTING_COLUMNS)).eq("property_id", id).order("synced_at", { ascending: false }).limit(5),
    db.from("property_recommendations").select(cols(RECOMMENDATION_PUBLIC_COLUMNS)).eq("property_id", id).order("position", { ascending: true }),
  ]);
  throwIfAborted(deps.signal);
  for (const r of [access, prop, faqs, checkout, emergency, manuals, entries, listing, recs]) {
    if (r?.error) throw new Error("dossier_lookup_failed");
  }

  // Revalidação de posse no momento da leitura (nunca confia só no alvo).
  const a = (access.data as Row | null) ?? null;
  if (!a || a["id"] !== id) throw new DossierError("property_not_found");
  if (typeof a["owner_id"] !== "string" || a["owner_id"] !== target.tenantId) throw new GuestAiSecurityError("dossier_tenant_mismatch");
  if (target.role === "candidate" && a["archived_at"] != null) throw new DossierError("candidate_archived");

  const p = (prop.data as Row | null) ?? null;
  if (!p) throw new DossierError("property_not_found");

  const listingRows = ((listing.data ?? []) as Row[]).filter((r) => r["property_id"] === id);
  const build = deps.buildPlaybook ?? ((await import("@/lib/playbook-build")).buildPlaybook as unknown as BuildPlaybookFn);

  const dossier = normalizePropertyDossier({
    target: { propertyId: id, tenantId: target.tenantId, role: target.role, audiences: target.audiences },
    sources: {
      property: p,
      faqs: (faqs.data ?? []) as Array<{ id: string; question: string; answer: string }>,
      checkout: (checkout.data ?? []) as Array<{ id: string; label: string }>,
      emergency: (emergency.data ?? []) as Array<{ id: string; label: string; number: string }>,
      manuals: (manuals.data ?? []) as DossierManualRow[],
      entries: (entries.data ?? []) as Row[],
      listingNormalized: listingRows[0]?.["normalized"] ?? null,
      recommendations: (recs.data ?? []) as Row[],
    },
    retrievedAt: (deps.now ?? (() => new Date()))().toISOString(),
    buildPlaybook: build,
  });
  return issuePropertyDossier(dossier);
}

type DossierManualRow = { id: string; title: string | null; description: string | null; body: string | null; images: unknown };
