/**
 * Construtor de contexto do agente.
 * Reúne, a cada mensagem, tudo que um concierge humano teria em mãos:
 * dados da residência, estado atual da estadia, memória do hóspede e
 * comportamento configurado pelo anfitrião.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GuestMemory } from "./memory.server";
import { propertyTimeZone, todayInTZ, zonedTimeToUtc } from "@/lib/property-timezone";

type Admin = SupabaseClient;

export type AgentContext = {
  text: string;
  keys: string[];
  sensitiveLocked: boolean;
  behavior: string;
  stayPhase: "pre_checkin" | "checkin_day" | "in_stay" | "checkout_day" | "post_checkout" | "unknown";
};

function parseHm(v: unknown, fallbackH: number): [number, number] {
  const m = String(v ?? "").match(/^(\d{1,2}):(\d{2})/);
  return m ? [Number(m[1]), Number(m[2])] : [fallbackH, 0];
}

/** Data/hora local do imóvel (em UTC) para uma data ISO + horário configurado. */
function localMoment(dateIso: string, tz: string, time: unknown, fallbackH: number): Date {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = parseHm(time, fallbackH);
  return zonedTimeToUtc(y ?? 1970, m ?? 1, d ?? 1, hh, mm, tz);
}

/** 24h antes do horário previsto de check-in (fuso do imóvel), em UTC. */
function pinReleaseAt(checkinDate: string, tz: string, checkinTime: unknown): Date {
  return new Date(localMoment(checkinDate, tz, checkinTime, 15).getTime() - 86_400_000);
}

function nowInfo(tz: string): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
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

  // O "agora" e o "hoje" seguem o fuso da CIDADE do imóvel: em UTC, das 21h
  // à meia-noite no Brasil o dia já virava e a IA errava a fase da estadia.
  const tz = propertyTimeZone(
    typeof p.city === "string" ? p.city : null,
    typeof p.country === "string" ? p.country : null,
  );
  lines.push(`## Momento atual\n${nowInfo(tz)} (fuso ${tz})`);

  lines.push(`\n## Residência\nNome: ${p.name ?? ""}`);
  if (p.tagline) lines.push(String(p.tagline));
  if (p.city) lines.push(`Cidade: ${p.city}${p.country ? ` (${p.country})` : ""}`);
  if (p.host_name) lines.push(`Anfitrião: ${p.host_name}`);

  // ── Marketplace / serviços parceiros (upsell)
  try {
    const { cityKey } = await import("@/lib/city-key");
    type MktLink = { label?: string | null; url?: string | null; description?: string | null };
    const own = Array.isArray(p.marketplace_links) ? (p.marketplace_links as MktLink[]) : [];
    const ck = cityKey(typeof p.city === "string" ? p.city : null);
    let cityMkt: MktLink[] = [];
    if (ck) {
      const { data } = await supabase
        .from("sigma_city_marketplace")
        .select("label, url, description")
        .eq("city_key", ck)
        .order("position");
      cityMkt = (data ?? []) as MktLink[];
    }
    const all = [...own, ...cityMkt].filter((l) => l && l.url && l.label);
    if (all.length > 0) {
      keys.push("marketplace");
      lines.push(
        "\n## Marketplace / serviços parceiros disponíveis (upsell)\n" +
          all
            .map((l) => `- [${l.label}](${l.url})${l.description ? ` — ${l.description}` : ""}`)
            .join("\n") +
          "\nUse SOMENTE estes links quando o assunto da conversa tiver relação real com eles (passeios, ingressos, transfer, experiências). " +
          "Ofereça como sugestão natural e útil, no formato markdown [texto](url), no máximo um por resposta e nunca de forma insistente.",
      );
    }
  } catch (e) {
    console.warn("marketplace context failed", e);
  }


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
  let checkoutDate: string | null = null;
  let checkinDone = false;
  let checkoutDone = false;
  const guestName = (params.guestName ?? "").trim();
  {
    type AccessLog = { id: string; guest_name: string; checkin_date: string; checkout_date: string | null };
    const todayIso = todayInTZ(tz);
    const { data: rows } = await supabase
      .from("guide_access_logs")
      .select("id, guest_name, checkin_date, checkout_date")
      .eq("property_id", p.id as string)
      .order("created_at", { ascending: false })
      .limit(60);
    const logs = (rows ?? []) as AccessLog[];
    const norm = (s: string) =>
      s
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    const target = norm(guestName);
    const covers = (l: AccessLog) => {
      const ci = String(l.checkin_date).slice(0, 10);
      const co = l.checkout_date ? String(l.checkout_date).slice(0, 10) : ci;
      return todayIso >= ci && todayIso <= co;
    };
    // 1) nome exato (normalizado) → 2) primeiro nome → 3) reserva vigente hoje
    // → 4) reserva mais recente. Antes exigíamos igualdade caractere a caractere,
    // o que deixava a IA sem a reserva e livre para especular sobre a estadia.
    let log: AccessLog | null = null;
    if (target) {
      log =
        logs.find((l) => norm(l.guest_name) === target) ??
        logs.find((l) => {
          const a = norm(l.guest_name).split(" ")[0];
          const b = target.split(" ")[0];
          return !!a && !!b && a === b;
        }) ??
        null;
    }
    if (!log) log = logs.find(covers) ?? logs[0] ?? null;
    if (log?.checkin_date) {
      keys.push("reservation");
      const today = todayIso;
      const ci = String(log.checkin_date).slice(0, 10);
      checkinDate = ci;
      const co = log.checkout_date ? String(log.checkout_date).slice(0, 10) : null;
      checkoutDate = co;
      // Check-in / check-out marcados como concluídos (pelo hóspede no guia ou
      // pelo anfitrião no Kanban da Operação).
      try {
        const { data: statuses } = await supabase
          .from("guest_arrival_status")
          .select("kind, status, done_at")
          .eq("log_id", log.id);
        for (const s of (statuses ?? []) as Array<{ kind: string; status: string | null; done_at: string | null }>) {
          if (!(s.status === "done" || s.done_at)) continue;
          if (s.kind === "checkin") checkinDone = true;
          if (s.kind === "checkout") checkoutDone = true;
        }
      } catch (e) {
        console.warn("stay status lookup failed", e);
      }
      if (checkoutDone) stayPhase = "post_checkout";
      else if (today < ci) stayPhase = "pre_checkin";
      else if (today === ci) stayPhase = "checkin_day";
      else if (co && today === co) stayPhase = "checkout_day";
      else if (co && today > co) stayPhase = "post_checkout";
      else stayPhase = "in_stay";
      const dayMs = 86400000;
      const daysTo = Math.round((Date.parse(`${ci}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / dayMs);
      const fmt = (d: string) => d.split("-").reverse().join("/");
      const phaseNote = checkoutDone
        ? "CHECK-OUT JÁ CONCLUÍDO (confirmado pelo hóspede ou pelo anfitrião). NÃO HÁ ESTADIA EM ANDAMENTO: " +
          "não fale como se ele estivesse na residência, não informe senhas, códigos de acesso, Wi-Fi, endereço, " +
          "instruções de chegada ou qualquer dado do imóvel/da estadia — esses conteúdos foram ocultados no guia. " +
          "Trate a conversa como pós-estadia (agradecimento, dúvidas gerais sobre a cidade, objetos esquecidos, futura reserva)."
        : stayPhase === "pre_checkin"
          ? `O hóspede AINDA NÃO ESTÁ NA CIDADE: faltam ${daysTo} dia(s) para o check-in. ` +
            "NUNCA sugira algo para 'hoje', 'agora' ou 'hoje à noite', nem use o clima de hoje como base. " +
            "Fale sempre no futuro, referindo-se aos dias da estadia, e trate qualquer conversa atual como planejamento antecipado."
          : stayPhase === "post_checkout"
            ? "A estadia já terminou: não sugira programas locais como se ele estivesse hospedado."
            : "O hóspede está na estadia: sugestões para hoje/agora são apropriadas.";

      // No dia do check-in, mas ainda antes do horário oficial de liberação,
      // um relato de "dificuldade para entrar" NÃO é incidente operacional —
      // é simplesmente cedo demais. Calculado aqui, não deixado para o modelo
      // estimar por conta própria (mesmo racional já usado abaixo para a
      // liberação do PIN do guia): garante que a resposta nunca dependa da
      // aritmética de horário sair certa na cabeça da IA.
      let checkinTimingNote = "";
      if (!checkinDone && stayPhase === "checkin_day") {
        const now = new Date();
        const releaseAt = localMoment(ci, tz, p.checkin_time, 15);
        const minutesToRelease = Math.round((releaseAt.getTime() - now.getTime()) / 60000);
        const [rh, rm] = parseHm(p.checkin_time, 15);
        const releaseLabel = `${String(rh).padStart(2, "0")}:${String(rm).padStart(2, "0")}`;
        if (minutesToRelease > 30) {
          const h = Math.floor(minutesToRelease / 60);
          const m = minutesToRelease % 60;
          const faltam = h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ""}` : `${m} min`;
          checkinTimingNote =
            `\nCheck-in ainda NÃO liberado hoje: horário oficial é ${releaseLabel}, faltam ${faltam}. Isso NÃO é ` +
            "incidente operacional — se o hóspede disser que está com dificuldade, não conseguiu entrar ou já chegou, " +
            "NÃO acione request_human_handoff e NÃO diga que avisou a equipe só por causa do horário. Em uma frase, " +
            `diga que o check-in começa às ${releaseLabel} e pergunte se ele combinou antecipação com a equipe com antecedência.`;
        } else if (minutesToRelease > 0) {
          checkinTimingNote =
            `\nCheck-in libera em ${minutesToRelease} min (às ${releaseLabel}). Se o hóspede relatar dificuldade agora, ainda ` +
            "não é incidente — oriente aguardar esses minutos finais antes de qualquer escalonamento.";
        } else {
          checkinTimingNote = `\nCheck-in já liberado desde ${releaseLabel}. A partir de agora, dificuldade real para entrar é incidente operacional normal (ver seção de escalonamento).`;
        }
      }

      lines.push(
        `\n## Dados de estadia informados no acesso ao guia\nHóspede: ${log.guest_name}\nHoje: ${fmt(today)}\nCheck-in: ${fmt(ci)}${co ? `\nCheck-out: ${fmt(co)}` : ""}\nCheck-in concluído: ${checkinDone ? "sim" : "não"}\nCheck-out concluído: ${checkoutDone ? "sim" : "não"}\nFase da estadia: ${stayPhase}\n${phaseNote}${checkinTimingNote}`,
      );
    }

  }

  // ── Senha de liberação do guia (código de visualização)
  // Liberada 24h antes do horário de check-in e encerrada no horário de
  // check-out (ou assim que o check-out for marcado como concluído).
  if (sensitiveLocked) {
    keys.push("access_pin_policy");
    const windowClosed =
      checkoutDone ||
      (!!checkoutDate && Date.now() > localMoment(checkoutDate, tz, p.checkout_time, 11).getTime());
    if (windowClosed) {
      lines.push(
        "\n## Senha de liberação do guia (código de visualização)\n" +
          "JANELA ENCERRADA (check-out realizado ou horário de check-out atingido). NUNCA informe o código nem qualquer dado de acesso do imóvel.",
      );
    } else if (!checkinDate) {
      lines.push(
        "\n## Senha de liberação do guia (código de visualização)\n" +
          "Não há data de check-in informada no acesso ao guia. NÃO informe a senha de liberação. " +
          "Explique que ela é liberada 24h antes do horário de check-in e peça que ele confirme os dados de check-in no guia.",
      );
    } else {
      const releaseAt = pinReleaseAt(checkinDate, tz, p.checkin_time);
      const released = Date.now() >= releaseAt.getTime();
      const releaseLabel = new Intl.DateTimeFormat("pt-BR", {
        timeZone: tz,
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
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
            `AINDA NÃO LIBERADA. NUNCA informe o código agora, nem parcialmente. Diga com gentileza que ele é liberado em ${releaseLabel} (24h antes do horário de check-in).`,
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
