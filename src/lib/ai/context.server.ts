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

const TZ = "America/Sao_Paulo";

/** Offset (em minutos) do fuso de São Paulo para uma data UTC. */
function tzOffsetMinutes(date: Date): number {
  const asTz = new Date(date.toLocaleString("en-US", { timeZone: TZ }));
  const asUtc = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  return (asTz.getTime() - asUtc.getTime()) / 60000;
}

/** 17:00 (horário de São Paulo) do dia anterior ao check-in, em UTC. */
function pinReleaseAt(checkinDate: string): Date {
  const [y, m, d] = checkinDate.split("-").map(Number);
  const base = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 17, 0, 0) - 86_400_000;
  const guess = new Date(base);
  return new Date(base - tzOffsetMinutes(guess) * 60000);
}

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

  const accessPin =
    typeof p.access_codes_pin === "string" ? (p.access_codes_pin as string).trim() : "";
  const sensitiveLocked = accessPin.length > 0;
  if (sensitiveLocked) {
    keys.push("sensitive_locked");
    lines.push(
      "\n⚠️ Dados sensíveis (senha do Wi-Fi, códigos de portão/fechadura) estão BLOQUEADOS POR SENHA. " +
        "Nunca revele nem dê pistas; oriente o hóspede a liberar no próprio guia pelo botão 'Ver Senha'.",
    );
  }

  // Estado da estadia (fase) — determina prioridade e tom.
  let stayPhase: AgentContext["stayPhase"] = "unknown";
  let checkinDate: string | null = null;
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
      checkinDate = ci;
      const co = log.checkout_date ? String(log.checkout_date).slice(0, 10) : null;
      if (today < ci) stayPhase = "pre_checkin";
      else if (today === ci) stayPhase = "checkin_day";
      else if (co && today === co) stayPhase = "checkout_day";
      else if (co && today > co) stayPhase = "post_checkout";
      else stayPhase = "in_stay";
      const dayMs = 86400000;
      const daysTo = Math.round((Date.parse(`${ci}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / dayMs);
      const fmt = (d: string) => d.split("-").reverse().join("/");
      const phaseNote =
        stayPhase === "pre_checkin"
          ? `O hóspede AINDA NÃO ESTÁ NA CIDADE: faltam ${daysTo} dia(s) para o check-in. ` +
            "NUNCA sugira algo para 'hoje', 'agora' ou 'hoje à noite', nem use o clima de hoje como base. " +
            "Fale sempre no futuro, referindo-se aos dias da estadia, e trate qualquer conversa atual como planejamento antecipado."
          : stayPhase === "post_checkout"
            ? "A estadia já terminou: não sugira programas locais como se ele estivesse hospedado."
            : "O hóspede está na estadia: sugestões para hoje/agora são apropriadas.";
      lines.push(
        `\n## Reserva do hóspede\nHóspede: ${log.guest_name}\nHoje: ${fmt(today)}\nCheck-in: ${fmt(ci)}${co ? `\nCheck-out: ${fmt(co)}` : ""}\nFase da estadia: ${stayPhase}\n${phaseNote}`,
      );
    }

  }

  // ── Senha de liberação do guia (código de visualização)
  // Só pode ser informada pela IA a partir das 17:00 (America/Sao_Paulo) do dia
  // anterior ao check-in. Antes disso a IA avisa que ainda não está liberada.
  if (sensitiveLocked) {
    keys.push("access_pin_policy");
    if (!checkinDate) {
      lines.push(
        "\n## Senha de liberação do guia (código de visualização)\n" +
          "Não foi possível confirmar a data de check-in deste hóspede. NÃO informe a senha de liberação. " +
          "Explique que ela é liberada a partir das 17:00 do dia anterior ao check-in e peça que ele confirme os dados de check-in no guia.",
      );
    } else {
      const releaseAt = pinReleaseAt(checkinDate);
      const released = Date.now() >= releaseAt.getTime();
      const releaseLabel = new Intl.DateTimeFormat("pt-BR", {
        timeZone: TZ,
        day: "2-digit",
        month: "2-digit",
      }).format(releaseAt);
      if (released) {
        lines.push(
          "\n## Senha de liberação do guia (código de visualização)\n" +
            `LIBERADA. Se o hóspede pedir, informe o código: \`${accessPin}\`\n` +
            "Escreva o código SEMPRE entre crases (\\`código\\`) para que o hóspede possa copiar com um toque. " +
            "Depois de informar, oriente que ele digite esse código no guia (botão 'Ver Senha') para liberar Wi-Fi e códigos de acesso. " +
            "As senhas da residência (Wi-Fi, portão, fechadura) continuam bloqueadas para você — nunca as revele no chat.",
        );
      } else {
        lines.push(
          "\n## Senha de liberação do guia (código de visualização)\n" +
            `AINDA NÃO LIBERADA. NUNCA informe o código agora, nem parcialmente. Diga com gentileza que ele é liberado a partir das 17:00 do dia ${releaseLabel} (véspera do check-in).`,
        );
      }
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
