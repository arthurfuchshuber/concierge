import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,64}$/) });

/** Emite um token curto para pré-visualizar o guia (inclusive rascunhos).
 *  A RLS de `properties` garante que só quem tem acesso ao imóvel recebe. */
export const createGuidePreviewToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }) => {
    const { data: prop } = await context.supabase
      .from("properties")
      .select("id")
      .eq("slug", data.slug)
      .maybeSingle();
    let allowed = !!prop;
    if (!allowed) {
      // Admin do SaaS (modo visualização de outra conta) também pode pré-visualizar.
      const { data: isAdmin } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      allowed = !!isAdmin;
    }
    if (!allowed) return { token: null as string | null };
    const { createGuidePreviewTokenFor } = await import("@/lib/guide-preview.server");
    return { token: await createGuidePreviewTokenFor(data.slug) };
  });

