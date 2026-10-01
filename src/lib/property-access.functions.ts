import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * ACESSO DO IMÓVEL PARA A EQUIPE DE LIMPEZA (mockup "Chave de acesso no card
 * de limpeza · v2", aprovado 30/09/2026).
 *
 * O card "Em Limpeza" ganhou uma chave ao lado do pino do Maps; ao tocar,
 * abre o quadrante "Acesso" com portão, fechadura e Wi-Fi para quem vai
 * chegar no imóvel. Pedido original: "colocar informações de acesso e
 * informações de wifi em um botão no card de limpeza para facilitar a vida
 * do pessoal de limpeza quando chegam no imóvel".
 *
 * POR QUE UMA FUNÇÃO PRÓPRIA (e não um campo a mais na lista do quadro):
 * regra de 16/09/2026 — senha de imóvel só sai do servidor com prova. A lista
 * do Kanban é carregada inteira, para todo card, a cada atualização; colocar
 * os códigos ali faria todas as senhas de todos os imóveis viajarem para o
 * navegador sem ninguém ter pedido. Aqui os códigos de UM imóvel só saem
 * quando alguém da equipe toca na chave, e só se esse imóvel estiver entre
 * os que a pessoa enxerga na conta ativa (`accessiblePropertyIds`: mesma
 * regra de conta + recorte por residências atendidas que monta o quadro).
 *
 * O prestador (para o botão "Enviar à <nome>") só é devolvido se for da
 * MESMA conta do imóvel — mesma trava de `setCleaningAssignment`.
 */

export type PropertyAccessInfo = {
  gateCode: string | null;
  gateInstructions: string | null;
  lockCode: string | null;
  lockInstructions: string | null;
  wifiSsid: string | null;
  wifiPassword: string | null;
  provider: { name: string; phone: string | null; phoneCountry: string | null } | null;
};

const clean = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  return s ? s : null;
};

export const getPropertyAccessInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        propertyId: z.string().uuid(),
        ownerId: z.string().uuid().nullable().optional(),
        providerId: z.string().uuid().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<PropertyAccessInfo> => {
    const sb = context.supabase;
    const { accessiblePropertyIds } = await import("@/lib/dashboard.functions");
    const allowed = await accessiblePropertyIds(sb as never, data.ownerId ?? null, context.userId);
    if (!allowed.includes(data.propertyId)) {
      throw new Error("Você não tem acesso a este imóvel.");
    }

    const { data: p, error } = await sb
      .from("properties")
      .select(
        "owner_id, gate_code, gate_instructions, lock_code, lock_instructions, wifi_ssid, wifi_password",
      )
      .eq("id", data.propertyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!p) throw new Error("Imóvel não encontrado.");

    let provider: PropertyAccessInfo["provider"] = null;
    if (data.providerId) {
      const { data: prov } = await sb
        .from("service_providers")
        .select("name, trade_name, phone, phone_country, account_owner_id")
        .eq("id", data.providerId)
        .maybeSingle();
      if (prov && prov.account_owner_id === p.owner_id) {
        provider = {
          name: (prov.trade_name || prov.name || "Prestador").trim(),
          phone: clean(prov.phone),
          phoneCountry: clean(prov.phone_country),
        };
      }
    }

    return {
      gateCode: clean(p.gate_code),
      gateInstructions: clean(p.gate_instructions),
      lockCode: clean(p.lock_code),
      lockInstructions: clean(p.lock_instructions),
      wifiSsid: clean(p.wifi_ssid),
      wifiPassword: clean(p.wifi_password),
      provider,
    };
  });
