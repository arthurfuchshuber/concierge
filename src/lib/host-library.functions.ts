import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const FaqTag = z.enum(["chegada", "saida", "residencia", "explore"]);

const HostFaqInput = z.object({
  id: z.string().uuid().optional().nullable(),
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(3000),
  tags: z.array(FaqTag).max(4).default([]),
});

const HostKnowledgeInput = z.object({
  id: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  enabled: z.boolean().default(true),
});

export const listHostFaqs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("host_faqs")
      .select("id, question, answer, tags, position, created_at, updated_at")
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
      .select("id, title, body, enabled, position, created_at, updated_at")
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
    }));
    const { error, data: inserted } = await supabase.from("host_knowledge").insert(rows).select("id");
    if (error) throw new Error(error.message);
    return { saved: inserted?.length ?? 0 };
  });
