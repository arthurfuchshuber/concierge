import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { slugForTag } from "@/lib/guide-tags";

export type GuideTagItemPayload = {
  key: "faq" | "local";
  param: string;
  label: string;
  hint?: string;
};

async function loadItemsForProperty(
  supabase: { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { limit: (n: number) => Promise<{ data: unknown[] | null }> } } } },
  propertyId: string,
): Promise<GuideTagItemPayload[]> {
  const [{ data: faqs }, { data: recs }] = await Promise.all([
    supabase.from("property_faqs").select("id, question").eq("property_id", propertyId).limit(100),
    supabase.from("property_recommendations").select("id, name, category").eq("property_id", propertyId).limit(100),
  ]);
  const out: GuideTagItemPayload[] = [];
  const seen = new Set<string>();
  for (const f of ((faqs ?? []) as Array<{ question?: string }>)) {
    const q = String(f.question ?? "").trim();
    if (!q) continue;
    const base = slugForTag(q);
    if (!base) continue;
    let s = base;
    let n = 1;
    while (seen.has(`faq:${s}`)) s = `${base}-${++n}`;
    seen.add(`faq:${s}`);
    out.push({ key: "faq", param: s, label: q.length > 80 ? q.slice(0, 77) + "…" : q, hint: "FAQ do imóvel" });
  }
  for (const r of ((recs ?? []) as Array<{ name?: string; category?: string }>)) {
    const nm = String(r.name ?? "").trim();
    if (!nm) continue;
    const cat = String(r.category ?? "").trim();
    const base = slugForTag(nm);
    if (!base) continue;
    let s = base;
    let n = 1;
    while (seen.has(`local:${s}`)) s = `${base}-${++n}`;
    seen.add(`local:${s}`);
    out.push({ key: "local", param: s, label: nm, hint: cat || "Recomendação" });
  }
  return out;
}

/** Itens de tag (FAQs, recomendações) para um imóvel específico. */
export const getTagItemsForProperty = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ propertyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Confirma acesso (owner ou membro)
    const { data: prop } = await supabase
      .from("properties").select("id, owner_id").eq("id", data.propertyId).maybeSingle();
    if (!prop) return { items: [] as GuideTagItemPayload[] };
    const { data: canAccess } = await supabase.rpc("user_can_access_property", {
      _user_id: userId, _property_id: data.propertyId,
    });
    if (!canAccess) return { items: [] as GuideTagItemPayload[] };
    const items = await loadItemsForProperty(supabase, data.propertyId);
    return { items };
  });

/** Itens de tag inferidos a partir da conversa (via property_id). */
export const getTagItemsForConversation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ conversationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: conv } = await supabase
      .from("property_chat_conversations")
      .select("property_id")
      .eq("id", data.conversationId)
      .maybeSingle();
    const propertyId = (conv as { property_id?: string } | null)?.property_id;
    if (!propertyId) return { items: [] as GuideTagItemPayload[] };
    const items = await loadItemsForProperty(supabase, propertyId);
    return { items };
  });
