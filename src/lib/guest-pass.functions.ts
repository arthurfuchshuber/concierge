import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  guestName: z.string().trim().min(2).max(80),
  reservationCode: z.string().trim().max(40).optional().nullable(),
});

/**
 * Emite o passe de identificação do hóspede para um guia publicado.
 * Guias com calendário do Airbnb exigem um código de reserva válido.
 */
export const issueGuestPass = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data }) => {
    const { allowPublicRate, clientIpFrom } = await import("@/lib/public-rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    if (!allowPublicRate(`guest-pass:${clientIpFrom(getRequest())}`, 20, 60_000)) {
      throw new Error("Muitas tentativas. Aguarde um instante e tente de novo.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("id, airbnb_ical_url")
      .eq("slug", data.slug)
      .eq("published", true)
      .maybeSingle();
    if (!prop) throw new Error("Este guia não está disponível.");

    let verified = false;
    if ((prop.airbnb_ical_url ?? "").trim()) {
      const code = (data.reservationCode ?? "").trim();
      if (!code) throw new Error("Informe o código da reserva para continuar.");
      const { lookupReservationByCode } = await import("@/lib/guest-access.server");
      const res = await lookupReservationByCode(data.slug, prop.id, code);
      if (!res.ok && res.reason !== "no_ical") {
        throw new Error("O código da reserva não confere. Confira o código e tente de novo.");
      }
      verified = res.ok;
    }
    const { signGuestPass } = await import("@/lib/guest-pass.server");
    return { pass: signGuestPass(`guide:${prop.id}`, data.guestName, 30, verified) };
  });
