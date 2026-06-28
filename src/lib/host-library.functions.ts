import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const FaqTag = z.enum(["chegada", "saida", "residencia", "explore"]);

const HostFaqInput = z.object({
  id: z.string().uuid().optional().nullable(),
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(3000),
  tags: z.array(FaqTag).max(4).default([]),
  scope_property_id: z.string().uuid().nullable().optional(),
});

const HostKnowledgeInput = z.object({
  id: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  enabled: z.boolean().default(true),
  scope_property_id: z.string().uuid().nullable().optional(),
});

export const listHostFaqs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("host_faqs")
      .select("id, question, answer, tags, position, scope_property_id, created_at, updated_at")
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveHostFaqs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ items: z.array(HostFaqInput).max(200).default([]) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Replace-all strategy keeps the editor simple
    const { error: delErr } = await supabase.from("host_faqs").delete().eq("owner_id", userId);
    if (delErr) throw new Error(delErr.message);
    if (!data.items.length) return { saved: 0 };
    const rows = data.items.map((it, i) => ({
      owner_id: userId,
      question: it.question,
      answer: it.answer,
      tags: it.tags,
      position: i,
      scope_property_id: it.scope_property_id ?? null,
    }));
    const { error, data: inserted } = await supabase.from("host_faqs").insert(rows).select("id");
    if (error) throw new Error(error.message);
    return { saved: inserted?.length ?? 0 };
  });

export const listHostKnowledge = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("host_knowledge")
      .select("id, title, body, enabled, position, scope_property_id, created_at, updated_at")
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveHostKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ items: z.array(HostKnowledgeInput).max(50).default([]) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error: delErr } = await supabase.from("host_knowledge").delete().eq("owner_id", userId);
    if (delErr) throw new Error(delErr.message);
    if (!data.items.length) return { saved: 0 };
    const rows = data.items.map((it, i) => ({
      owner_id: userId,
      title: it.title,
      body: it.body,
      enabled: it.enabled,
      position: i,
      scope_property_id: it.scope_property_id ?? null,
    }));
    const { error, data: inserted } = await supabase.from("host_knowledge").insert(rows).select("id");
    if (error) throw new Error(error.message);
    return { saved: inserted?.length ?? 0 };
  });

export const listPropertiesBrief = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("properties")
      .select("id, name, city, address")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const applyHostFaqsToProperties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      faqIds: z.array(z.string().uuid()).min(1).max(200),
      propertyIds: z.array(z.string().uuid()).min(1).max(200),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Fetch the selected FAQs (scoped to current user)
    const { data: faqs, error: fErr } = await supabase
      .from("host_faqs")
      .select("question, answer, tags")
      .eq("owner_id", userId)
      .in("id", data.faqIds);
    if (fErr) throw new Error(fErr.message);
    if (!faqs?.length) return { inserted: 0 };

    // For each property, fetch existing questions to avoid duplicates and compute next position
    const allowedTags = new Set(["chegada", "saida", "residencia", "explore"]);
    let totalInserted = 0;
    for (const propertyId of data.propertyIds) {
      const { data: existing, error: eErr } = await supabase
        .from("property_faqs")
        .select("question, position")
        .eq("property_id", propertyId);
      if (eErr) throw new Error(eErr.message);
      const existingQs = new Set((existing ?? []).map((r) => r.question.trim().toLowerCase()));
      const startPos = (existing ?? []).reduce((m, r) => Math.max(m, (r.position ?? 0) + 1), 0);
      const rows = faqs
        .filter((f) => !existingQs.has(f.question.trim().toLowerCase()))
        .map((f, i) => ({
          property_id: propertyId,
          question: f.question,
          answer: f.answer,
          tags: (f.tags ?? []).filter((t: string) => allowedTags.has(t)),
          position: startPos + i,
        }));
      if (!rows.length) continue;
      const { error: insErr, data: ins } = await supabase
        .from("property_faqs")
        .insert(rows)
        .select("id");
      if (insErr) throw new Error(insErr.message);
      totalInserted += ins?.length ?? 0;
    }
    return { inserted: totalInserted };
  });
