/**
 * Conhecimento do Dossiê (`property_playbook_entries`, FAQs, manuais, listas do
 * imóvel e dados normalizados do anúncio), SEM RAG e SEM embeddings nesta fase.
 *
 * O Dossiê é montado pelo MESMO construtor da tela aprovada (`buildPlaybook`),
 * alimentado com uma projeção de `properties` SEM credenciais: as linhas de
 * senha ficam vazias por construção (nada é carregado para depois ser apagado).
 * Em seguida, `projectDossier` retém o que a audiência concedida não cobre.
 *
 * Medição (02/11/2026, produção; chars/4 ≈ tokens, estimativa): típico ≈ 6 mil tokens
 * (24 mil caracteres: anúncio ≈ 16 mil + cadastro ≈ 8 mil), pior caso ≈ 14 mil tokens
 * (56 mil caracteres; o imóvel com avaliações no anúncio). Ver relatório.
 */
import type { DossierKnowledge, GuestAudience, ValidatedTurn } from "@/lib/guest-ai/types";
import { assertIssued } from "@/lib/guest-ai/trust";
import { getGuestAiDb, type GuestAiDb } from "./client.server";
import {
  CHECKOUT_ITEM_COLUMNS,
  EMERGENCY_COLUMNS,
  ENTRY_COLUMNS,
  FAQ_COLUMNS,
  MANUAL_COLUMNS,
  PROPERTY_DOSSIER_COLUMNS,
  cols,
} from "./projections";
import { projectDossier, type DossierRowLike } from "./dossier-projection";
import { pickNormalized } from "./listing.server";

type Row = Record<string, unknown>;

/** Forma mínima que usamos de `buildPlaybook` (permite injetar um construtor falso nos testes). */
export type BuildPlaybookFn = (src: {
  property: Record<string, unknown>;
  faqs: Array<{ id: string; question: string; answer: string }>;
  checkout: Array<{ id: string; label: string }>;
  emergency: Array<{ id: string; label: string; number: string }>;
  manuals: Array<{ id: string; title: string }>;
  providers: [];
  entries: Array<{
    id: string;
    field_key: string;
    value: string | null;
    note: string | null;
    custom_label: string | null;
    custom_audience: GuestAudience | null;
    section_num: number | null;
  }>;
  listingTitle?: string | null;
  listingFacts?: Array<{ key: string; title: string; content: string }>;
}) => Array<{ rows: DossierRowLike[] }>;

export async function fetchDossierKnowledge(
  turn: ValidatedTurn,
  audiences: ReadonlySet<GuestAudience>,
  deps?: { db?: GuestAiDb; buildPlaybook?: BuildPlaybookFn },
): Promise<DossierKnowledge> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  const db = deps?.db ?? (await getGuestAiDb());
  const id = turn.propertyId;

  const [prop, faqs, checkout, emergency, manuals, entries, listing] = await Promise.all([
    db.from("properties").select(cols(PROPERTY_DOSSIER_COLUMNS)).eq("id", id).maybeSingle(),
    db.from("property_faqs").select(cols(FAQ_COLUMNS)).eq("property_id", id).order("position", { ascending: true }),
    db.from("property_checkout_items").select(cols(CHECKOUT_ITEM_COLUMNS)).eq("property_id", id).order("position", { ascending: true }),
    db.from("property_emergency_contacts").select(cols(EMERGENCY_COLUMNS)).eq("property_id", id).order("position", { ascending: true }),
    db.from("property_manual_items").select(cols(MANUAL_COLUMNS)).eq("property_id", id).order("position", { ascending: true }),
    db.from("property_playbook_entries").select(cols(ENTRY_COLUMNS)).eq("property_id", id),
    db.from("property_listing_raw_data").select("normalized").eq("property_id", id).order("synced_at", { ascending: false }).limit(1),
  ]);
  for (const r of [prop, faqs, checkout, emergency, manuals, entries, listing]) {
    if (r.error) throw new Error("dossier_lookup_failed");
  }
  const property = (prop.data as Row | null) ?? null;
  if (!property) return { items: [], manuals: [], withheldByPolicy: 0 };

  const manualRows = ((manuals.data ?? []) as Row[]).map((m) => ({
    id: String(m["id"]),
    title: String(m["title"] ?? ""),
    body: String(m["body"] ?? ""),
  }));
  const normalized = pickNormalized(((listing.data ?? []) as Row[])[0]?.["normalized"], typeof property["name"] === "string" ? property["name"] : null);

  const build: BuildPlaybookFn = deps?.buildPlaybook ?? (await loadBuildPlaybook());
  const sections = build({
    property,
    faqs: (faqs.data ?? []) as Array<{ id: string; question: string; answer: string }>,
    checkout: (checkout.data ?? []) as Array<{ id: string; label: string }>,
    emergency: (emergency.data ?? []) as Array<{ id: string; label: string; number: string }>,
    manuals: manualRows.map((m) => ({ id: m.id, title: m.title })),
    providers: [],
    entries: (entries.data ?? []) as Row[] as never,
    listingFacts: normalized?.facts ?? [],
  });
  const rows = sections.flatMap((s) => s.rows);
  return projectDossier(rows, audiences, manualRows.map((m) => ({ title: m.title, body: m.body })));
}

async function loadBuildPlaybook(): Promise<BuildPlaybookFn> {
  const mod = await import("@/lib/playbook-build");
  return mod.buildPlaybook as unknown as BuildPlaybookFn;
}
