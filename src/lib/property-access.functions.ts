import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { LocationComplementInput } from "@/lib/property-location";

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

export type AccessMedia = { url: string; type: "image" | "video" };

/** `gate_media`/`lock_media` são JSON livre: só passa o que tem URL e tipo válidos. */
function toMedia(v: unknown): AccessMedia[] {
  if (!Array.isArray(v)) return [];
  const out: AccessMedia[] = [];
  for (const m of v) {
    const url =
      typeof (m as { url?: unknown })?.url === "string" ? (m as { url: string }).url.trim() : "";
    if (!url) continue;
    out.push({ url, type: (m as { type?: unknown }).type === "video" ? "video" : "image" });
  }
  return out;
}

export type PropertyAccessInfo = {
  gateCode: string | null;
  gateInstructions: string | null;
  /** Nome que o anfitrião deu ao portão/fechadura no guia (ex.: "Cadeado-Cofre do Portão"). */
  gateLabel: string | null;
  gateVideoUrl: string | null;
  gateMedia: AccessMedia[];
  lockCode: string | null;
  lockInstructions: string | null;
  lockLabel: string | null;
  lockVideoUrl: string | null;
  lockMedia: AccessMedia[];
  wifiSsid: string | null;
  wifiPassword: string | null;
  provider: { name: string; phone: string | null; phoneCountry: string | null } | null;
  /** Passo a passo de CHEGADA (o mesmo do guia) — texto pode ter `[[tag:senhas-acesso]]`. */
  checkinInstructions: string | null;
  checkinNote: string | null;
  checkinMedia: AccessMedia[];
  /** "Local dentro do prédio" (01/10/2026) — só vale com `in_condominium` ligado. */
  complement: LocationComplementInput;
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
        "owner_id, gate_code, gate_instructions, gate_label, gate_video_url, gate_media, lock_code, lock_instructions, lock_label, lock_video_url, lock_media, wifi_ssid, wifi_password, checkin_instructions, checkin_note, checkin_media, in_condominium, apartment_number, apartment_floor, parking_spots, has_elevator",
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
      gateLabel: clean(p.gate_label),
      gateVideoUrl: clean(p.gate_video_url),
      gateMedia: toMedia(p.gate_media),
      lockCode: clean(p.lock_code),
      lockInstructions: clean(p.lock_instructions),
      lockLabel: clean(p.lock_label),
      lockVideoUrl: clean(p.lock_video_url),
      lockMedia: toMedia(p.lock_media),
      wifiSsid: clean(p.wifi_ssid),
      wifiPassword: clean(p.wifi_password),
      provider,
      checkinInstructions: clean(p.checkin_instructions),
      checkinNote: clean(p.checkin_note),
      checkinMedia: toMedia(p.checkin_media),
      complement: {
        in_condominium: p.in_condominium,
        apartment_number: p.apartment_number,
        apartment_floor: p.apartment_floor,
        parking_spots: p.parking_spots,
        has_elevator: p.has_elevator,
      },
    };
  });
