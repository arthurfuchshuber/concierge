import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const DEFAULTS = ["Check-In & Check-Out", "Recomendações Locais", "Informações do Espaço"];

export const getEtiquetaOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("etiqueta_options")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const opts = (data?.etiqueta_options as string[] | null) ?? null;
    return opts && opts.length ? opts : DEFAULTS;
  });

export const setEtiquetaOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        options: z
          .array(z.string().trim().min(1).max(80))
          .max(30)
          .transform((arr) => Array.from(new Set(arr))),
      })
      .parse(i)
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ etiqueta_options: data.options })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { options: data.options };
  });
