import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Endereço que recebe o aviso de novo contato vindo do site. */
const NOTIFY_EMAIL = "sigma@anfitriaosigma.com.br";

const leadSchema = z.object({
  name: z.string().trim().min(2).max(120),
  company: z.string().trim().max(160).optional().default(""),
  propertiesCount: z.string().trim().max(40).optional().default(""),
  whatsapp: z.string().trim().max(40).optional().default(""),
  email: z.string().trim().email().max(180),
  challenge: z.string().trim().max(120).optional().default(""),
});

export type LandingLeadInput = z.input<typeof leadSchema>;

/**
 * Recebe o formulário público da página inicial: grava o contato e avisa a
 * equipe por e-mail. Endpoint público de propósito — por isso a validação
 * é estrita e nada é lido de volta para o navegador.
 */
export const submitLandingLead = createServerFn({ method: "POST" })
  .inputValidator((input: LandingLeadInput) => leadSchema.parse(input))
  .handler(async ({ data }) => {
    // Formulário público que dispara e-mail para a equipe: sem limite, era um
    // canal aberto de spam (16/09/2026).
    const { allowPublicRate, clientIpFrom } = await import("@/lib/public-rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    if (!allowPublicRate(`landing-lead:${clientIpFrom(getRequest())}`, 5, 10 * 60_000)) {
      throw new Error("Muitos envios em pouco tempo. Tente novamente em alguns minutos.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: inserted, error } = await supabaseAdmin
      .from("landing_leads")
      .insert({
        name: data.name,
        company: data.company || null,
        properties_count: data.propertiesCount || null,
        whatsapp: data.whatsapp || null,
        email: data.email.toLowerCase(),
        challenge: data.challenge || null,
        source: "landing",
      })
      .select("id")
      .single();

    if (error) {
      console.error("[landing-lead] falha ao gravar contato", error);
      throw new Error("Não foi possível registrar seu contato agora.");
    }

    try {
      const { sendAppEmail } = await import("@/lib/email/send-app-email.server");
      await sendAppEmail({
        templateName: "landing-lead",
        recipientEmail: NOTIFY_EMAIL,
        idempotencyKey: `landing-lead-${inserted.id}`,
        templateData: {
          name: data.name,
          company: data.company,
          propertiesCount: data.propertiesCount,
          whatsapp: data.whatsapp,
          email: data.email,
          challenge: data.challenge,
        },
      });
    } catch (e) {
      // O contato já está salvo: falha no aviso não pode quebrar o envio.
      console.error("[landing-lead] falha ao enviar aviso por e-mail", e);
    }

    return { ok: true as const };
  });
