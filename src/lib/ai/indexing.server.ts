/**
 * Indexação de conhecimento (embeddings) para o Hybrid RAG.
 * Transforma o guia digital, manual, FAQs, regras, recomendações e a base do
 * anfitrião em chunks pesquisáveis por similaridade e por texto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { embedTexts, EMPTY_USAGE, mergeUsage, type Usage } from "./gateway.server";
import { confidenceOf } from "./sources";

type Admin = SupabaseClient;

type Chunk = { source: string; sourceId: string | null; title: string | null; content: string };

const MAX_CHARS = 1400;

/** Preserva quebras de parágrafo (ex.: passo a passo de check-in) — só colapsa
 * espaços/tabs redundantes dentro de cada linha, não achata tudo num bloco só. */
function normalizeText(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.replace(/[ \t]+/g, " ").replace(/\n/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Corta no limite de palavra mais próximo — nunca no meio de uma palavra. */
function splitAtWordBoundary(text: string, maxChars: number, overlap: number): string[] {
  const parts: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + maxChars, text.length);
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(" ", end);
      if (lastSpace > i) end = lastSpace;
    }
    parts.push(text.slice(i, end).trim());
    if (end >= text.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return parts;
}

function pushChunk(out: Chunk[], chunk: Chunk) {
  const content = normalizeText(chunk.content);
  if (content.length < 8) return;
  if (content.length <= MAX_CHARS) {
    out.push({ ...chunk, content });
    return;
  }
  // Divide textos longos em partes com sobreposição leve, sempre em limite de palavra.
  for (const part of splitAtWordBoundary(content, MAX_CHARS, 150)) {
    if (part.length >= 8) out.push({ ...chunk, content: part });
  }
}

/**
 * Textos operacionais (portão, fechadura, chegada) podem conter o código
 * escrito no meio da frase. Quando o guia está protegido por senha, qualquer
 * sequência numérica é removida ANTES de virar chunk — assim o RAG nunca
 * devolve um código que o hóspede ainda não liberou.
 */
function maskDigitsIfLocked(value: unknown, locked: boolean): string | null {
  if (!value) return null;
  const text = String(value);
  if (!locked) return text;
  return text.replace(/\d[\d\s.-]{2,}/g, "[BLOQUEADO — liberar no guia]");
}

async function collectChunks(supabase: Admin, propertyId: string, prop: Record<string, unknown>) {
  const chunks: Chunk[] = [];
  const name = String(prop.name ?? "");
  const locked =
    typeof prop.access_codes_pin === "string" && (prop.access_codes_pin as string).trim().length > 0;

  const facts: Array<[string, unknown]> = [
    ["Cidade", prop.city],
    ["Estado", prop.state],
    ["País", prop.country],
    ["Endereço", prop.address],
    ["Como chegar", prop.address_note],
    ["Localização no mapa", prop.maps_url],
    ["Garagem / estacionamento", prop.garage_maps_url],
    ["Horário de check-in", prop.checkin_time],
    ["Horário limite de check-in", prop.checkin_time_max],
    ["Horário de check-out", prop.checkout_time],
    ["Horário mínimo de check-out", prop.checkout_time_min],
    ["Instruções de check-in", prop.checkin_instructions],
    ["Observações do check-in", prop.checkin_note],
    ["Instruções de check-out", prop.checkout_instructions],
    ["Observações do check-out", prop.checkout_note],
    ["Regras do espaço", prop.house_rules],
    ["Rede Wi-Fi", prop.wifi_ssid],
    ["Vagas de veículo", prop.vehicles_max],
    ["Anfitrião", prop.host_name],
    ["Descrição", prop.tagline],
    [
      `Entrada / ${prop.gate_label ? String(prop.gate_label) : "portão"}`,
      maskDigitsIfLocked(prop.gate_instructions, locked),
    ],
    [
      `Fechadura / ${prop.lock_label ? String(prop.lock_label) : "porta"}`,
      maskDigitsIfLocked(prop.lock_instructions, locked),
    ],
  ];
  for (const [label, value] of facts) {
    if (value) pushChunk(chunks, { source: "property", sourceId: label, title: `${name} — ${label}`, content: `${label}: ${value}` });
  }

  const cityKeyValue = await (async () => {
    try {
      const { cityKey } = await import("@/lib/city-key");
      return cityKey(typeof prop.city === "string" ? prop.city : null);
    } catch {
      return null;
    }
  })();

  const [
    manual,
    faqs,
    recommendations,
    checkout,
    emergency,
    details,
    knowledge,
    behavior,
    hostFaqs,
    tenantKnowledge,
    propertyType,
    cityFaqs,
    cityRecs,
  ] = await Promise.all([
    supabase.from("property_manual_items").select("id, title, description, body").eq("property_id", propertyId),
    supabase.from("property_faqs").select("id, question, answer").eq("property_id", propertyId),
    supabase.from("property_recommendations").select("id, name, category, type, distance_text, note").eq("property_id", propertyId),
    supabase.from("property_checkout_items").select("id, label").eq("property_id", propertyId),
    supabase.from("property_emergency_contacts").select("id, label, number").eq("property_id", propertyId),
    supabase.from("property_details").select("id, title, content").eq("property_id", propertyId),
    supabase.from("host_knowledge").select("id, title, body, scope_property_id").eq("owner_id", prop.owner_id as string).eq("enabled", true),
    supabase.from("host_behavior").select("id, title, body, scope_property_id").eq("owner_id", prop.owner_id as string).eq("enabled", true),
    supabase.from("host_faqs").select("id, question, answer, scope_property_id").eq("owner_id", prop.owner_id as string),
    supabase
      .from("ai_tenant_knowledge")
      .select("id, category, content, property_id, status")
      .eq("owner_id", prop.owner_id as string)
      .eq("status", "active"),
    prop.property_type_id
      ? supabase.from("property_types").select("label").eq("id", prop.property_type_id as string).maybeSingle()
      : Promise.resolve({ data: null }),
    cityKeyValue
      ? supabase.from("sigma_city_faqs").select("id, question, answer").eq("city_key", cityKeyValue)
      : Promise.resolve({ data: [] }),
    cityKeyValue
      ? supabase
          .from("sigma_city_recommendations")
          .select("id, name, category, address, note, opening_hours")
          .eq("city_key", cityKeyValue)
      : Promise.resolve({ data: [] }),
  ]);

  const typeLabel = (propertyType as { data?: { label?: string } | null }).data?.label;
  if (typeLabel) {
    pushChunk(chunks, {
      source: "property",
      sourceId: "Tipo de imóvel",
      title: `${name} — Tipo de imóvel`,
      content: `Tipo de imóvel: ${typeLabel}`,
    });
  }

  for (const f of ((hostFaqs as { data?: unknown }).data ?? []) as Array<Record<string, unknown>>) {
    if (f.scope_property_id && f.scope_property_id !== propertyId) continue;
    pushChunk(chunks, {
      source: "faq",
      sourceId: String(f.id),
      title: String(f.question ?? "FAQ do anfitrião"),
      content: `Pergunta: ${f.question}\nResposta: ${f.answer}`,
    });
  }
  for (const k of ((tenantKnowledge as { data?: unknown }).data ?? []) as Array<Record<string, unknown>>) {
    if (k.property_id && k.property_id !== propertyId) continue;
    pushChunk(chunks, {
      source: "tenant_knowledge",
      sourceId: String(k.id),
      title: String(k.category ?? "Conhecimento da empresa"),
      content: String(k.content ?? ""),
    });
  }
  for (const f of ((cityFaqs as { data?: unknown }).data ?? []) as Array<Record<string, unknown>>) {
    pushChunk(chunks, {
      source: "city_reference",
      sourceId: String(f.id),
      title: String(f.question ?? "Dúvida sobre a cidade"),
      content: `Pergunta: ${f.question}\nResposta: ${f.answer}`,
    });
  }
  for (const r of ((cityRecs as { data?: unknown }).data ?? []) as Array<Record<string, unknown>>) {
    pushChunk(chunks, {
      source: "city_reference",
      sourceId: String(r.id),
      title: String(r.name ?? "Recomendação da cidade"),
      content: [r.name, r.category, r.address, r.note, Array.isArray(r.opening_hours) ? (r.opening_hours as string[]).join("; ") : null]
        .filter(Boolean)
        .join(" — "),
    });
  }

  for (const m of (manual.data ?? []) as Array<Record<string, unknown>>) {
    pushChunk(chunks, {
      source: "manual",
      sourceId: String(m.id),
      title: String(m.title ?? "Manual da casa"),
      content: [m.title, m.description, m.body].filter(Boolean).join(" — "),
    });
  }
  for (const f of (faqs.data ?? []) as Array<Record<string, unknown>>) {
    pushChunk(chunks, {
      source: "faq",
      sourceId: String(f.id),
      title: String(f.question ?? "FAQ"),
      content: `Pergunta: ${f.question}\nResposta: ${f.answer}`,
    });
  }
  for (const r of (recommendations.data ?? []) as Array<Record<string, unknown>>) {
    pushChunk(chunks, {
      source: "recommendation",
      sourceId: String(r.id),
      title: String(r.name ?? "Recomendação"),
      content: [r.name, r.category, r.type, r.distance_text, r.note].filter(Boolean).join(" — "),
    });
  }
  for (const c of (checkout.data ?? []) as Array<Record<string, unknown>>) {
    pushChunk(chunks, { source: "checkout", sourceId: String(c.id), title: "Antes de sair", content: String(c.label ?? "") });
  }
  for (const c of (emergency.data ?? []) as Array<Record<string, unknown>>) {
    pushChunk(chunks, { source: "procedures", sourceId: String(c.id), title: "Contato de emergência", content: `${c.label}: ${c.number}` });
  }
  for (const d of (details.data ?? []) as Array<Record<string, unknown>>) {
    pushChunk(chunks, {
      source: "property_detail",
      sourceId: String(d.id),
      title: String(d.title ?? "Detalhamento do imóvel"),
      content: [d.title, d.content].filter(Boolean).join(" — "),
    });
  }
  for (const k of (knowledge.data ?? []) as Array<Record<string, unknown>>) {
    if (k.scope_property_id && k.scope_property_id !== propertyId) continue;
    pushChunk(chunks, { source: "host_knowledge", sourceId: String(k.id), title: String(k.title ?? ""), content: String(k.body ?? "") });
  }
  for (const b of (behavior.data ?? []) as Array<Record<string, unknown>>) {
    if (b.scope_property_id && b.scope_property_id !== propertyId) continue;
    pushChunk(chunks, { source: "host_behavior", sourceId: String(b.id), title: String(b.title ?? ""), content: String(b.body ?? "") });
  }

  return chunks;
}

/** Reindexa toda a base de conhecimento de uma residência. */
export async function reindexProperty(
  supabase: Admin,
  propertyId: string,
): Promise<{ indexed: number; usage: Usage }> {
  const { data: prop } = await supabase
    .from("properties")
    .select("*")
    .eq("id", propertyId)
    .maybeSingle();
  if (!prop) return { indexed: 0, usage: EMPTY_USAGE };

  const ownerId = String((prop as Record<string, unknown>).owner_id);
  const chunks = await collectChunks(supabase, propertyId, prop as Record<string, unknown>);
  if (!chunks.length) {
    await supabase.from("ai_kb_chunks").delete().eq("property_id", propertyId);
    return { indexed: 0, usage: EMPTY_USAGE };
  }

  let usage = EMPTY_USAGE;
  const { vectors, usage: embedUsage } = await embedTexts(
    chunks.map((c) => `${c.title ?? ""}\n${c.content}`),
  );
  usage = mergeUsage(usage, embedUsage);

  await supabase.from("ai_kb_chunks").delete().eq("property_id", propertyId);

  const rows = chunks.map((c, i) => ({
    owner_id: ownerId,
    tenant_id: ownerId,
    property_id: propertyId,
    source: c.source,
    source_id: c.sourceId,
    title: c.title,
    content: c.content,
    confidence: confidenceOf(c.source),
    embedding: vectors[i]?.length ? (vectors[i] as unknown as string) : null,
    updated_at: new Date().toISOString(),
  }));

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("ai_kb_chunks").insert(rows.slice(i, i + 200));
    if (error) console.error("[ai-index] insert falhou", error.message);
  }

  return { indexed: rows.length, usage };
}
