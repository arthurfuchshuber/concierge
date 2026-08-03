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

function pushChunk(out: Chunk[], chunk: Chunk) {
  const content = chunk.content.replace(/\s+/g, " ").trim();
  if (content.length < 8) return;
  if (content.length <= MAX_CHARS) {
    out.push({ ...chunk, content });
    return;
  }
  // Divide textos longos em partes com sobreposição leve.
  for (let i = 0; i < content.length; i += MAX_CHARS - 150) {
    out.push({ ...chunk, content: content.slice(i, i + MAX_CHARS) });
  }
}

async function collectChunks(supabase: Admin, propertyId: string, prop: Record<string, unknown>) {
  const chunks: Chunk[] = [];
  const name = String(prop.name ?? "");

  const facts: Array<[string, unknown]> = [
    ["Cidade", prop.city],
    ["Endereço", prop.address],
    ["Como chegar", prop.address_note],
    ["Horário de check-in", prop.checkin_time],
    ["Horário limite de check-in", prop.checkin_time_max],
    ["Horário de check-out", prop.checkout_time],
    ["Instruções de check-in", prop.checkin_instructions],
    ["Instruções de check-out", prop.checkout_instructions],
    ["Regras do espaço", prop.house_rules],
    ["Rede Wi-Fi", prop.wifi_ssid],
    ["Anfitrião", prop.host_name],
    ["Descrição", prop.tagline],
  ];
  for (const [label, value] of facts) {
    if (value) pushChunk(chunks, { source: "property", sourceId: label, title: `${name} — ${label}`, content: `${label}: ${value}` });
  }

  const [manual, faqs, rules, checkout, recs, knowledge, behavior, emergency] = await Promise.all([
    supabase.from("property_manual_items").select("id, title, description, body").eq("property_id", propertyId),
    supabase.from("property_faqs").select("id, question, answer").eq("property_id", propertyId),
    supabase.from("property_recommendations").select("id, name, category, type, distance_text, note").eq("property_id", propertyId),
    supabase.from("property_checkout_items").select("id, label").eq("property_id", propertyId),
    supabase.from("property_emergency_contacts").select("id, label, number").eq("property_id", propertyId),
    supabase.from("host_knowledge").select("id, title, body, scope_property_id").eq("enabled", true),
    supabase.from("host_behavior").select("id, title, body, scope_property_id").eq("enabled", true),
    Promise.resolve(null),
  ]);
  void emergency;

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
  for (const r of (rules.data ?? []) as Array<Record<string, unknown>>) {
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
  for (const c of (recs.data ?? []) as Array<Record<string, unknown>>) {
    pushChunk(chunks, { source: "procedures", sourceId: String(c.id), title: "Contato de emergência", content: `${c.label}: ${c.number}` });
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
