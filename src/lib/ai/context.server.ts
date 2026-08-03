/**
 * Construtor de contexto do agente.
 * Reúne, a cada mensagem, tudo que um concierge humano teria em mãos:
 * dados da residência, estado atual da estadia, memória do hóspede e
 * comportamento configurado pelo anfitrião.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GuestMemory } from "./memory.server";

type Admin = SupabaseClient;

export type AgentContext = {
  text: string;
  keys: string[];
  sensitiveLocked: boolean;
  behavior: string;
  stayPhase: "pre_checkin" | "checkin_day" | "in_stay" | "checkout_day" | "post_checkout" | "unknown";
};

function nowInfo(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "full",
    timeStyle: "short",
  });
  return fmt.format(now);
}

export async function buildAgentContext(params: {
  supabase: Admin;
  property: Record<string, unknown>;
  guestName: string | null;
  memory: GuestMemory | null;
}): Promise<AgentContext> {
  const { supabase, property: p } = params;
  const keys: string[] = ["datetime", "property"];
  const lines: string[] = [];

  lines.push(`## Momento atual\n${nowInfo()} (fuso America/Sao_Paulo)`);

  lines.push(`\n## Residência\nNome: ${p.name ?? ""}`);
  if (p.tagline) lines.push(String(p.tagline));
  if (p.city) lines.push(`Cidade: ${p.city}${p.country ? ` (${p.country})` : ""}`);
  if (p.host_name) lines.push(`Anfitrião: ${p.host_name}`);

  const sensitiveLocked =
    typeof p.access_codes_pin === "string" && (p.access_codes_pin as string).trim().length > 0;
  if (sensitiveLocked) {
    keys.push("sensitive_locked");
    lines.push(
      "\n⚠️ Dados sensíveis (senha do Wi-Fi, códigos de portão/fechadura) estão BLOQUEADOS POR SENHA. " +
        "Nunca revele nem dê pistas; oriente o hóspede a liberar no próprio guia pelo botão 'Ver Senha'.",
    );
  }

  // Estado da estadia (fase) — determina prioridade e tom.
  let stayPhase: AgentContext["stayPhase"] = "unknown";
  const guestName = (params.guestName ?? "").trim();
  if (guestName) {
    const { data: log } = await supabase
      .from("guide_access_logs")
      .select("guest_name, checkin_date, checkout_date")
      .eq("property_id", p.id as string)
      .eq("guest_name", guestName)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (log?.checkin_date) {
      keys.push("reservation");
      const today = new Date().toISOString().slice(0, 10);
      const ci = String(log.checkin_date).slice(0, 10);
      const co = log.checkout_date ? String(log.checkout_date).slice(0, 10) : null;
      if (today < ci) stayPhase = "pre_checkin";
      else if (today === ci) stayPhase = "checkin_day";
      else if (co && today === co) stayPhase = "checkout_day";
      else if (co && today > co) stayPhase = "post_checkout";
      else stayPhase = "in_stay";
      lines.push(
        `\n## Reserva do hóspede\nHóspede: ${log.guest_name}\nCheck-in: ${ci}${co ? `\nCheck-out: ${co}` : ""}\nFase da estadia: ${stayPhase}`,
      );
    }
  }

  if (params.memory) {
    keys.push("guest_memory");
    lines.push(
      `\n## Memória deste hóspede (conversas anteriores)\n${params.memory.summary ?? "(sem resumo)"}\n` +
        `Preferências: ${JSON.stringify(params.memory.preferences ?? {})}`,
    );
  }

  // Comportamento configurado pelo anfitrião — instruções de mais alta prioridade.
  const { data: behaviorRows } = await supabase
    .from("host_behavior")
    .select("title, body, scope_property_id")
    .eq("owner_id", p.owner_id as string)
    .eq("enabled", true);
  const behavior = (behaviorRows ?? [])
    .filter((b) => !b.scope_property_id || b.scope_property_id === p.id)
    .map((b) => `### ${b.title}\n${b.body}`)
    .join("\n");
  if (behavior) keys.push("host_behavior");

  return { text: lines.join("\n"), keys, sensitiveLocked, behavior, stayPhase };
}
