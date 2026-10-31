import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { COLUMN_FIELDS, ENTRY_FIELDS, LIST_FIELDS, type PlaybookSource } from "@/lib/playbook-build";
import { PLAYBOOK_FIELDS } from "@/lib/playbook-catalog";

/**
 * PLAYBOOK DO IMÓVEL — leitura e gravação (21/10/2026).
 *
 * O Playbook é o cadastro do imóvel editado direto na tela: o valor dos campos
 * manuais é gravado nas MESMAS colunas/listas que o guia e a IA já leem — nada
 * é copiado para outro lugar. Só o que não tinha coluna (voltagem, lixo…), a
 * "Nota do anfitrião" e as linhas criadas à mão vão para
 * `property_playbook_entries`. O acesso é o do imóvel (`user_can_access_property`).
 */

const PropertyIdInput = z.object({ propertyId: z.string().uuid() });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySb = any;

async function assertAccess(supabase: AnySb, userId: string, propertyId: string) {
  const { safeDbError } = await import("@/lib/db-errors.server");
  const { data, error } = await dbq(() =>
    supabase.rpc("user_can_access_property", { _user_id: userId, _property_id: propertyId }),
  );
  if (error) throw safeDbError("playbook_access", error);
  if (!data) throw new Error("Você não tem acesso a este imóvel.");
}

/** `retryDbResult` tipa o retorno só com `error`; aqui devolvemos `data` também. */
async function dbq<T = unknown>(
  op: () => PromiseLike<{ data: T | null; error: { message?: string; code?: string } | null }>,
): Promise<{ data: T | null; error: { message?: string; code?: string } | null }> {
  const { retryDbResult } = await import("@/lib/db-errors.server");
  return (await retryDbResult(op as never)) as never;
}

async function reindex(propertyId: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { reindexProperty } = await import("@/lib/ai/indexing.server");
    await reindexProperty(supabaseAdmin, propertyId);
  } catch (e) {
    console.error("[playbook] reindex falhou", e);
  }
}

const PROPERTY_COLUMNS =
  "id, name, short_description, address, city, state, country, maps_url, in_condominium, apartment_number, apartment_floor, parking_spots, vehicles_max, " +
  "airbnb_guest_count, airbnb_bedroom_count, airbnb_bed_count, airbnb_bathroom_count, airbnb_rooms_beds, airbnb_amenities, airbnb_house_rules, airbnb_safety_info, " +
  "access_mode, gate_label, gate_code, gate_instructions, checkin_time, checkin_time_max, checkin_instructions, checkin_note, checkout_time, checkout_instructions, checkout_note, " +
  "wifi_ssid, wifi_password, house_rules, host_phone, owner_contact_id, airbnb_description_full, airbnb_cancellation_policy, airbnb_cancellation_category, lat, lng, " +
  "address_note, garage_maps_url, has_elevator, airbnb_listing_url, airbnb_rating, airbnb_instant_booking, cleaning_price_normal_cents, cleaning_price_full_cents, " +
  "cleaning_duration_normal_minutes, cleaning_duration_full_minutes, lock_label, lock_instructions, lock_code";

/** Consulta ao Google Places: endereço + cidade + estado + país (sem repetir o que já está no endereço). */
export function geoQuery(property: Record<string, unknown>): string {
  return [property.address, property.city, property.state, property.country]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .join(", ");
}

const plain = (t: unknown) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/**
 * Candidato só vale se for da MESMA cidade do imóvel. Com cidade cadastrada, candidato sem cidade ou de outra
 * cidade é recusado; as coordenadas (quando as duas pontas têm) ainda precisam bater. Sem cidade cadastrada,
 * só aceita candidato perto das coordenadas do imóvel — nunca "o primeiro da lista" às cegas.
 */
export function geoCandidateMatches(property: Record<string, unknown>) {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
  const lat = num(property.lat);
  const lng = num(property.lng);
  const city = plain(property.city);
  return (c: { city?: string | null; lat: number | null; lng: number | null }) => {
    const haveCoords = lat !== null && lng !== null && c.lat !== null && c.lng !== null;
    const coordsOk = haveCoords && Math.abs((c.lat as number) - (lat as number)) < 0.05 && Math.abs((c.lng as number) - (lng as number)) < 0.05;
    if (city) return plain(c.city) === city && (!haveCoords || coordsOk);
    return coordsOk;
  };
}

export type PlaybookData = {
  propertyId: string;
  propertyName: string;
  owner: { name: string | null; phone: string | null; country: string | null } | null;
  source: PlaybookSource;
};

export const getPlaybook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => PropertyIdInput.parse(i))
  .handler(async ({ data, context }): Promise<PlaybookData> => {
    const sb = context.supabase as AnySb;
    await assertAccess(sb, context.userId, data.propertyId);
    const { safeDbError } = await import("@/lib/db-errors.server");
    const id = data.propertyId;

    const propRes = await dbq(() => sb.from("properties").select(PROPERTY_COLUMNS).eq("id", id).maybeSingle());
    if (propRes.error) throw safeDbError("playbook_property", propRes.error);
    if (!propRes.data) throw new Error("Imóvel não encontrado.");
    const property = propRes.data as Record<string, unknown>;

    const [faqs, checkout, emergency, manuals, links, entries, ownerRes] = await Promise.all([
      dbq(() => sb.from("property_faqs").select("id, question, answer, position").eq("property_id", id).order("position")),
      dbq(() => sb.from("property_checkout_items").select("id, label, position").eq("property_id", id).order("position")),
      dbq(() => sb.from("property_emergency_contacts").select("id, label, number, position").eq("property_id", id).order("position")),
      dbq(() => sb.from("property_manual_items").select("id, title, position").eq("property_id", id).order("position")),
      dbq(() => sb.from("property_providers").select("id, provider_id").eq("property_id", id)),
      dbq(() =>
        sb
          .from("property_playbook_entries")
          .select("id, field_key, value, note, custom_label, custom_audience, section_num")
          .eq("property_id", id),
      ),
      property.owner_contact_id
        ? dbq(() =>
            sb.from("property_owners").select("name, trade_name, phone, phone_country").eq("id", property.owner_contact_id as string).maybeSingle(),
          )
        : Promise.resolve({ data: null, error: null }),
    ]);
    // Falha de leitura NUNCA vira "vazio": a tela mantém o último dado bom.
    for (const [scope, r] of [
      ["faqs", faqs],
      ["checkout", checkout],
      ["emergency", emergency],
      ["manuals", manuals],
      ["links", links],
      ["entries", entries],
    ] as const) {
      if (r.error) throw safeDbError(`playbook_${scope}`, r.error);
    }

    const linkRows = (links.data ?? []) as Array<{ id: string; provider_id: string }>;
    const providers: PlaybookSource["providers"] = [];
    if (linkRows.length > 0) {
      const { data: pr, error } = await dbq(() =>
        sb
          .from("service_providers")
          .select("id, name, trade_name, categories, category, phone, email")
          .in(
            "id",
            linkRows.map((l) => l.provider_id),
          ),
      );
      if (error) throw safeDbError("playbook_providers", error);
      const byId = new Map(((pr ?? []) as Array<Record<string, unknown>>).map((p) => [String(p.id), p] as const));
      for (const l of linkRows) {
        const p = byId.get(l.provider_id);
        if (!p) continue;
        const cats = Array.isArray(p.categories) && p.categories.length ? (p.categories as string[]).join(" e ") : ((p.category as string | null) ?? null);
        providers.push({
          linkId: l.id,
          name: String(p.trade_name || p.name || "Prestador").trim(),
          category: cats,
          phone: (p.phone as string | null) ?? null,
          email: (p.email as string | null) ?? null,
        });
      }
    }

    // Título bruto do anúncio (Channex): dele saem o nome interno e o título público.
    const listingRes = await dbq<{ listing_meta: { title?: string } | null; normalized: { facts?: PlaybookSource["listingFacts"] } | null }>(() =>
      sb.from("property_listing_raw_data").select("listing_meta, normalized").eq("property_id", id).maybeSingle(),
    );
    const listingTitle = listingRes.error ? null : (listingRes.data?.listing_meta?.title ?? null);
    const listingFacts = listingRes.error ? [] : (listingRes.data?.normalized?.facts ?? []);

    // BAIRRO e CEP: a Channex só entrega a cidade do anúncio. O endereço do
    // imóvel vem do Google Places (busca estruturada), então bairro e CEP são
    // buscados UMA vez nele e guardados — depois disso são cadastro editável.
    const entryRows = (entries.data ?? []) as PlaybookSource["entries"];
    const haveGeo = (k: string) => entryRows.some((e) => e.field_key === k && (e.value ?? "").trim());
    const geoChecked = entryRows.some((e) => e.field_key === "f:_geo");
    if (!geoChecked && String(property.address ?? "").trim() && (!haveGeo("f:bairro") || !haveGeo("f:cep"))) {
      try {
        const { searchAddressCandidatesGoogle } = await import("@/lib/maps.functions");
        // Rua e número sozinhos fazem o Google preferir a capital (Foz do Iguaçu virava Belo Horizonte):
        // a consulta leva cidade, estado e país, e o candidato precisa ser da cidade do imóvel.
        const cands = await searchAddressCandidatesGoogle(geoQuery(property));
        const best = cands.find(geoCandidateMatches(property));
        if (best) {
          const add = [
            !haveGeo("f:bairro") && best.district ? { field_key: "f:bairro", value: best.district } : null,
            !haveGeo("f:cep") && best.cep ? { field_key: "f:cep", value: best.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2") } : null,
            { field_key: "f:_geo", value: "1" },
          ].filter(Boolean) as Array<{ field_key: string; value: string }>;
          for (const a of add) {
            await sb
              .from("property_playbook_entries")
              .upsert({ property_id: id, created_by: context.userId, ...a }, { onConflict: "property_id,field_key" });
            const i = entryRows.findIndex((e) => e.field_key === a.field_key);
            const row = { id: `geo-${a.field_key}`, note: null, custom_label: null, custom_audience: null, section_num: null, ...a };
            if (i >= 0) entryRows[i] = { ...entryRows[i], value: a.value };
            else entryRows.push(row as PlaybookSource["entries"][number]);
          }
        }
      } catch (e) {
        console.error("[playbook] geocode falhou", e);
      }
    }

    // Telefone do anfitrião: NUNCA preenchido a partir do proprietário. Se o anfitrião não informou no imóvel, fica vazio.

    const o = ownerRes.data as { name: string | null; trade_name: string | null; phone: string | null; phone_country: string | null } | null;
    return {
      propertyId: id,
      propertyName: String(property.name ?? ""),
      owner: o ? { name: (o.trade_name || o.name || null) as string | null, phone: o.phone, country: o.phone_country } : null,
      source: {
        property,
        faqs: ((faqs.data ?? []) as Array<{ id: string; question: string | null; answer: string | null }>).map((f) => ({
          id: f.id,
          question: f.question ?? "",
          answer: f.answer ?? "",
        })),
        checkout: ((checkout.data ?? []) as Array<{ id: string; label: string | null }>).map((c) => ({ id: c.id, label: c.label ?? "" })),
        emergency: ((emergency.data ?? []) as Array<{ id: string; label: string | null; number: string | null }>).map((c) => ({
          id: c.id,
          label: c.label ?? "",
          number: c.number ?? "",
        })),
        manuals: ((manuals.data ?? []) as Array<{ id: string; title: string | null }>).map((m) => ({ id: m.id, title: m.title ?? "" })),
        providers,
        entries: entryRows,
        listingTitle,
        listingFacts,
      },
    };
  });

const RowInput = z.object({ propertyId: z.string().uuid(), rowId: z.string().min(3).max(80) });

async function upsertEntry(sb: AnySb, userId: string, propertyId: string, fieldKey: string, patch: Record<string, unknown>) {
  const { error } = await sb
    .from("property_playbook_entries")
    .upsert({ property_id: propertyId, field_key: fieldKey, created_by: userId, ...patch }, { onConflict: "property_id,field_key" });
  if (error) throw new Error(error.message);
}

function cleanLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
}

/**
 * Troca a lista inteira SEM deixar o imóvel desprotegido: primeiro grava as
 * linhas novas, só então apaga as antigas (por id). Se a gravação falhar, nada
 * foi apagado; se a limpeza das antigas falhar, as novas são desfeitas.
 * Texto vazio = "limpar a lista" (único caso em que só há exclusão).
 */
async function replaceList(sb: AnySb, table: "property_checkout_items" | "property_emergency_contacts", propertyId: string, text: string) {
  const lines = cleanLines(text);
  const old = await sb.from(table).select("id").eq("property_id", propertyId);
  if (old.error) throw new Error(old.error.message);
  const oldIds = ((old.data ?? []) as Array<{ id: string }>).map((r) => r.id);
  let newIds: string[] = [];
  if (lines.length > 0) {
    const rows =
      table === "property_checkout_items"
        ? lines.map((label, position) => ({ property_id: propertyId, label, position }))
        : lines.map((l, position) => {
            const i = l.lastIndexOf(":");
            return i > 0
              ? { property_id: propertyId, label: l.slice(0, i).trim(), number: l.slice(i + 1).trim(), position }
              : { property_id: propertyId, label: l, number: "", position };
          });
    const ins = await sb.from(table).insert(rows).select("id");
    if (ins.error) throw new Error(ins.error.message);
    newIds = ((ins.data ?? []) as Array<{ id: string }>).map((r) => r.id);
  }
  if (oldIds.length === 0) return;
  const del = await sb.from(table).delete().eq("property_id", propertyId).in("id", oldIds);
  if (del.error) {
    if (newIds.length > 0) await sb.from(table).delete().eq("property_id", propertyId).in("id", newIds);
    throw new Error(del.error.message);
  }
}

function coerce(kind: string, value: string): string | number | boolean | null {
  const v = value.trim();
  if (kind === "bool") return v === "true";
  if (kind === "int") {
    if (!v) return null;
    const num = Number.parseInt(v, 10);
    if (!Number.isFinite(num) || num < 0 || num > 999) throw new Error("Informe um número válido.");
    return num;
  }
  if (kind === "access") {
    if (v !== "public" && v !== "pin") throw new Error("Escolha Público ou Senha por reserva — este campo não pode ficar vazio.");
    return v;
  }
  return v || null;
}

export const savePlaybookRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    RowInput.extend({ value: z.string().max(20000), audience: z.enum(["G", "P", "I"]).optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as AnySb;
    await assertAccess(sb, context.userId, data.propertyId);
    const [kind, ...rest] = data.rowId.split(":");
    const key = rest.join(":");
    // Visibilidade escolhida pelo usuário (nunca para campos secretos: códigos ficam só na reserva ativa).
    if (data.audience && (kind === "f" || kind === "custom")) {
      const meta = kind === "f" ? PLAYBOOK_FIELDS.find((f) => f.key === key) : null;
      if (!meta?.secret) await upsertEntry(sb, context.userId, data.propertyId, data.rowId, { custom_audience: data.audience });
    }
    if (kind === "f" && COLUMN_FIELDS[key]) {
      const { column, kind: type } = COLUMN_FIELDS[key];
      const { error } = await sb
        .from("properties")
        .update({ [column]: coerce(type, data.value) })
        .eq("id", data.propertyId);
      if (error) throw new Error(error.message);
    } else if (kind === "f" && key === "checklist_de_saida") {
      await replaceList(sb, "property_checkout_items", data.propertyId, data.value);
    } else if (kind === "f" && key === "contatos_de_emergencia") {
      await replaceList(sb, "property_emergency_contacts", data.propertyId, data.value);
    } else if (kind === "f" && ENTRY_FIELDS.has(key)) {
      await upsertEntry(sb, context.userId, data.propertyId, data.rowId, { value: data.value.trim() || null });
    } else if (kind === "faq") {
      const { error } = await sb
        .from("property_faqs")
        .update({ answer: data.value.trim() })
        .eq("id", key)
        .eq("property_id", data.propertyId);
      if (error) throw new Error(error.message);
    } else if (kind === "custom") {
      await upsertEntry(sb, context.userId, data.propertyId, data.rowId, { value: data.value.trim() || null });
    } else {
      throw new Error("Este campo não é editável aqui.");
    }
    await reindex(data.propertyId);
    return { ok: true };
  });

export const deletePlaybookRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RowInput.parse(i))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as AnySb;
    await assertAccess(sb, context.userId, data.propertyId);
    const [kind, ...rest] = data.rowId.split(":");
    const key = rest.join(":");
    // Só se exclui o que é cadastro MANUAL — nunca o que vem do anúncio.
    if (kind === "f" && (key === "telefone_do_anfitriao" || key === "regras_adicionais_da_casa")) {
      const column = COLUMN_FIELDS[key].column;
      const { error } = await sb.from("properties").update({ [column]: null }).eq("id", data.propertyId);
      if (error) throw new Error(error.message);
    } else if (kind === "f" && LIST_FIELDS.has(key)) {
      await replaceList(sb, key === "checklist_de_saida" ? "property_checkout_items" : "property_emergency_contacts", data.propertyId, "");
    } else if (kind === "f" && ENTRY_FIELDS.has(key)) {
      await upsertEntry(sb, context.userId, data.propertyId, data.rowId, { value: null });
    } else if (kind === "faq") {
      const { error } = await sb.from("property_faqs").delete().eq("id", key).eq("property_id", data.propertyId);
      if (error) throw new Error(error.message);
      await sb.from("property_playbook_entries").delete().eq("property_id", data.propertyId).eq("field_key", data.rowId);
    } else if (kind === "prov") {
      const { error } = await sb.from("property_providers").delete().eq("id", key).eq("property_id", data.propertyId);
      if (error) throw new Error(error.message);
      await sb.from("property_playbook_entries").delete().eq("property_id", data.propertyId).eq("field_key", data.rowId);
    } else if (kind === "custom") {
      const { error } = await sb.from("property_playbook_entries").delete().eq("property_id", data.propertyId).eq("field_key", data.rowId);
      if (error) throw new Error(error.message);
    } else {
      throw new Error("Este campo não pode ser excluído.");
    }
    await reindex(data.propertyId);
    return { ok: true };
  });

export const savePlaybookNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RowInput.extend({ note: z.string().max(4000) }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as AnySb;
    await assertAccess(sb, context.userId, data.propertyId);
    await upsertEntry(sb, context.userId, data.propertyId, data.rowId, { note: data.note.trim() || null });
    await reindex(data.propertyId);
    return { ok: true };
  });

export const addPlaybookRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    PropertyIdInput.extend({
      section: z.number().int().min(1).max(5),
      label: z.string().trim().min(1).max(120),
      value: z.string().max(20000).default(""),
      audience: z.enum(["G", "P", "I"]),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as AnySb;
    await assertAccess(sb, context.userId, data.propertyId);
    const key = `custom:${crypto.randomUUID()}`;
    await upsertEntry(sb, context.userId, data.propertyId, key, {
      value: data.value.trim() || null,
      custom_label: data.label,
      custom_audience: data.audience,
      section_num: data.section,
    });
    await reindex(data.propertyId);
    return { ok: true, rowId: key };
  });

/* ───────────────────────── EDIÇÃO EM MASSA / REPLICAÇÃO ─────────────────────────
 * Replica (ou muda a audiência de) uma linha do Playbook em vários imóveis da mesma conta.
 * A política de campos vive em `playbook-bulk.ts` (lista branca, recusa no backend).
 * Passo a passo: 1) recusa campo proibido ANTES de tocar no banco; 2) confere acesso ao imóvel
 * de origem e a TODOS os destinos — se um falhar, nada é gravado; 3) aplica imóvel por imóvel,
 * sem derrubar os demais se um falhar; 4) reindexa e registra a trilha de auditoria.
 */
const BulkInput = z.object({
  sourcePropertyId: z.string().uuid(),
  targetPropertyIds: z.array(z.string().uuid()).min(1).max(200),
  action: z.enum(["content", "audience", "both"]),
  audience: z.enum(["G", "P", "I"]).optional(),
  source: z.union([
    z.object({ kind: z.literal("row"), rowId: z.string().min(3).max(80) }),
    z.object({
      kind: z.literal("new"),
      label: z.string().trim().min(1).max(120),
      section: z.number().int().min(1).max(5),
      value: z.string().trim().min(1).max(20000),
    }),
  ]),
});

type BulkSource =
  | { kind: "column" | "list" | "entry"; key: string; rowId: string; value: string }
  | { kind: "faq"; key: string; rowId: string; question: string; value: string }
  | { kind: "custom"; key: string; rowId: string; label: string; section: number; audience: "G" | "P" | "I" | null; value: string };

async function readBulkSource(sb: AnySb, propertyId: string, rowId: string, c: Extract<import("@/lib/playbook-bulk").BulkRowClass, { ok: true }>): Promise<BulkSource> {
  const { BULK_COLUMN_FIELDS } = await import("@/lib/playbook-bulk");
  if (c.kind === "column") {
    const col = BULK_COLUMN_FIELDS[c.key]!;
    const { data, error } = await sb.from("properties").select(col).eq("id", propertyId).maybeSingle();
    if (error) throw new Error(error.message);
    return { kind: "column", key: c.key, rowId, value: String((data as Record<string, unknown> | null)?.[col] ?? "") };
  }
  if (c.kind === "list") {
    const { data, error } = await sb.from("property_checkout_items").select("label, position").eq("property_id", propertyId).order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return { kind: "list", key: c.key, rowId, value: ((data ?? []) as Array<{ label: string }>).map((r) => r.label).join("\n") };
  }
  if (c.kind === "faq") {
    const { data, error } = await sb.from("property_faqs").select("question, answer").eq("id", c.key).eq("property_id", propertyId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("A pergunta de origem não foi encontrada neste imóvel.");
    return { kind: "faq", key: c.key, rowId, question: String(data.question ?? ""), value: String(data.answer ?? "") };
  }
  const { data, error } = await sb
    .from("property_playbook_entries")
    .select("value, custom_label, custom_audience, section_num")
    .eq("property_id", propertyId)
    .eq("field_key", rowId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (c.kind === "entry") return { kind: "entry", key: c.key, rowId, value: String(data?.value ?? "") };
  if (!data) throw new Error("A linha de origem não foi encontrada neste imóvel.");
  return {
    kind: "custom",
    key: c.key,
    rowId,
    label: String(data.custom_label ?? ""),
    section: (data.section_num as number | null) ?? 5,
    audience: (data.custom_audience as "G" | "P" | "I" | null) ?? null,
    value: String(data.value ?? ""),
  };
}

type BulkOutcome = { propertyId: string; result: "updated" | "created" | "skipped"; reason?: string };

async function findCustomInTarget(sb: AnySb, propertyId: string, label: string, section: number) {
  const { sameCustomRow } = await import("@/lib/playbook-bulk");
  const { data, error } = await sb
    .from("property_playbook_entries")
    .select("field_key, custom_label, section_num")
    .eq("property_id", propertyId)
    .like("field_key", "custom:%");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ field_key: string; custom_label: string | null; section_num: number | null }>;
  return rows.find((r) => sameCustomRow(r, { custom_label: label, section_num: section })) ?? null;
}

async function applyBulkToProperty(
  sb: AnySb,
  userId: string,
  propertyId: string,
  src: BulkSource | { kind: "new"; label: string; section: number; value: string },
  action: "content" | "audience" | "both",
  audience: "G" | "P" | "I" | undefined,
): Promise<BulkOutcome> {
  const { BULK_COLUMN_FIELDS } = await import("@/lib/playbook-bulk");
  const wantsContent = action !== "audience";
  const wantsAudience = action !== "content";

  if (src.kind === "column") {
    const { error } = await sb.from("properties").update({ [BULK_COLUMN_FIELDS[src.key]!]: src.value.trim() || null }).eq("id", propertyId);
    if (error) throw new Error(error.message);
    return { propertyId, result: "updated" };
  }
  if (src.kind === "list") {
    await replaceList(sb, "property_checkout_items", propertyId, src.value);
    return { propertyId, result: "updated" };
  }
  if (src.kind === "entry") {
    await upsertEntry(sb, userId, propertyId, src.rowId, { value: src.value.trim() || null });
    return { propertyId, result: "updated" };
  }
  if (src.kind === "faq") {
    const { data, error } = await sb.from("property_faqs").select("id, question").eq("property_id", propertyId);
    if (error) throw new Error(error.message);
    const q = src.question.trim().toLowerCase();
    const found = ((data ?? []) as Array<{ id: string; question: string }>).find((r) => r.question.trim().toLowerCase() === q);
    if (found) {
      const up = await sb.from("property_faqs").update({ answer: src.value.trim() }).eq("id", found.id).eq("property_id", propertyId);
      if (up.error) throw new Error(up.error.message);
      return { propertyId, result: "updated" };
    }
    const ins = await sb.from("property_faqs").insert({ property_id: propertyId, question: src.question.trim(), answer: src.value.trim() });
    if (ins.error) throw new Error(ins.error.message);
    return { propertyId, result: "created" };
  }
  // custom (linha existente na origem) ou new (nota digitada em lote)
  if (src.kind !== "new" && src.kind !== "custom") {
    return { propertyId, result: "skipped", reason: "Tipo de linha não suporta linha personalizada." };
  }
  const label = src.label;
  const section = src.section;
  const aud = wantsAudience ? audience : src.kind === "custom" ? (src.audience ?? undefined) : audience;
  const found = await findCustomInTarget(sb, propertyId, label, section);
  if (found) {
    const patch: Record<string, unknown> = {};
    if (wantsContent) patch.value = src.value.trim() || null;
    if (wantsAudience && aud) patch.custom_audience = aud;
    await upsertEntry(sb, userId, propertyId, found.field_key, patch);
    return { propertyId, result: "updated" };
  }
  if (!wantsContent) return { propertyId, result: "skipped", reason: "A linha não existe neste imóvel (só a audiência foi pedida)." };
  await upsertEntry(sb, userId, propertyId, `custom:${crypto.randomUUID()}`, {
    value: src.value.trim() || null,
    custom_label: label,
    custom_audience: aud ?? "I",
    section_num: section,
  });
  return { propertyId, result: "created" };
}

export const bulkUpdatePlaybookEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => BulkInput.parse(i))
  .handler(async ({ data, context }) => {
    const { classifyBulkRow, assertBulkContentSafe } = await import("@/lib/playbook-bulk");
    const sb = context.supabase as AnySb;
    const targets = Array.from(new Set(data.targetPropertyIds)).filter((id) => id !== data.sourcePropertyId);
    if (targets.length === 0) throw new Error("Escolha ao menos um imóvel de destino diferente do imóvel de origem.");
    if (data.action !== "content" && !data.audience) throw new Error("Escolha a audiência (Hóspede Ativo, Público ou Equipe Interna).");

    // 1) Política de campos: ANTES de qualquer consulta ao banco.
    let cls: Extract<ReturnType<typeof classifyBulkRow>, { ok: true }> | null = null;
    if (data.source.kind === "row") {
      const c = classifyBulkRow(data.source.rowId);
      if (!c.ok) throw new Error(c.reason);
      cls = c;
      if (data.action !== "content" && c.kind !== "custom") {
        throw new Error("A audiência só pode ser alterada em massa nas linhas criadas à mão (as demais têm audiência fixa).");
      }
    } else {
      if (data.action === "audience") throw new Error("Uma nota nova precisa de conteúdo; use \"Replicar conteúdo\" ou \"Ambos\".");
      assertBulkContentSafe(data.source.label, data.source.value);
    }

    // 2) Acesso ao imóvel de origem e a TODOS os destinos — um negado cancela tudo.
    await assertAccess(sb, context.userId, data.sourcePropertyId);
    for (const id of targets) {
      try {
        await assertAccess(sb, context.userId, id);
      } catch {
        throw new Error("Você não tem permissão para editar um dos imóveis de destino. Nada foi alterado.");
      }
    }

    // Mesma conta: replicar entre contas diferentes não é permitido.
    {
      const { data: owners, error } = await sb.from("properties").select("id, owner_id").in("id", [data.sourcePropertyId, ...targets]);
      if (error) throw new Error(error.message);
      const rows = (owners ?? []) as Array<{ id: string; owner_id: string | null }>;
      const own = new Set(rows.map((r) => r.owner_id));
      if (rows.length !== targets.length + 1 || own.size !== 1) {
        throw new Error("Todos os imóveis precisam ser da mesma conta. Nada foi alterado.");
      }
    }

    // 3) Origem.
    let src: Parameters<typeof applyBulkToProperty>[3];
    if (data.source.kind === "row" && cls) {
      const read = await readBulkSource(sb, data.sourcePropertyId, data.source.rowId, cls);
      if (read.kind === "custom") assertBulkContentSafe(read.label, read.value);
      else if (read.kind === "faq") assertBulkContentSafe(read.question, read.value);
      else assertBulkContentSafe(null, read.value);
      src = read;
    } else if (data.source.kind === "new") {
      src = { kind: "new", label: data.source.label, section: data.source.section, value: data.source.value };
    } else {
      throw new Error("Origem inválida.");
    }

    // 4) Aplicação imóvel por imóvel.
    const applied: BulkOutcome[] = [];
    const failed: Array<{ propertyId: string; error: string }> = [];
    for (const propertyId of targets) {
      try {
        const out = await applyBulkToProperty(sb, context.userId, propertyId, src, data.action, data.audience);
        applied.push(out);
        if (out.result !== "skipped") await reindex(propertyId);
      } catch (e) {
        failed.push({ propertyId, error: e instanceof Error ? e.message : "Falha ao aplicar." });
      }
    }

    // 5) Trilha de auditoria (nunca derruba a operação).
    try {
      const { data: prop } = await sb.from("properties").select("owner_id").eq("id", data.sourcePropertyId).maybeSingle();
      const tenantId = (prop as { owner_id?: string } | null)?.owner_id;
      if (tenantId) {
        const { recordAudit } = await import("@/lib/permissions/permission.repository.server");
        await recordAudit({
          tenantId,
          actorId: context.userId,
          scopeType: "PROPERTY",
          scopeId: data.sourcePropertyId,
          action: "playbook_bulk_update",
          metadata: {
            field: data.source.kind === "row" ? data.source.rowId : `nota:${data.source.label}`,
            action: data.action,
            audience: data.audience ?? null,
            sourcePropertyId: data.sourcePropertyId,
            applied: applied.filter((a) => a.result !== "skipped").map((a) => a.propertyId),
            skipped: applied.filter((a) => a.result === "skipped").map((a) => a.propertyId),
            failed: failed.map((f) => f.propertyId),
          },
        });
      }
    } catch (e) {
      console.error("[playbook] auditoria da edição em massa falhou", e);
    }

    return {
      ok: failed.length === 0,
      applied: applied.filter((a) => a.result !== "skipped").length,
      skipped: applied.filter((a) => a.result === "skipped").map((a) => ({ propertyId: a.propertyId, reason: a.reason ?? "" })),
      failed,
    };
  });

/** Imóveis da mesma conta que o usuário pode receber numa replicação (exclui a origem). */
export const listBulkTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ propertyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as AnySb;
    await assertAccess(sb, context.userId, data.propertyId);
    const { data: src } = await sb.from("properties").select("owner_id").eq("id", data.propertyId).maybeSingle();
    const ownerId = (src as { owner_id?: string } | null)?.owner_id;
    if (!ownerId) return [] as Array<{ id: string; name: string }>;
    const { data: rows, error } = await sb
      .from("properties")
      .select("id, name, archived_at")
      .eq("owner_id", ownerId)
      .neq("id", data.propertyId)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return ((rows ?? []) as Array<{ id: string; name: string | null; archived_at: string | null }>)
      .filter((r) => !r.archived_at)
      .map((r) => ({ id: r.id, name: r.name ?? "Imóvel" }));
  });
