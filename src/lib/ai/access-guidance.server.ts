/**
 * ORIENTAÇÃO DE ACESSO PARA O MODELO (17/10/2026, decisões do anfitrião).
 *
 * Regras:
 *  - Credenciais (senha, código, endereço, instruções) podem ser enviadas NO DIA
 *    do check-in, sempre reforçando ao hóspede os horários e regras do anúncio.
 *  - Antes do horário: se o hóspede PEDIR a credencial, a IA entrega com o
 *    reforço de horário/regras. Se ele estiver na porta sem acesso antes do
 *    horário, a IA conduz com gentileza (regras, horários, instruções) e aciona a
 *    equipe (handoff) perguntando se pode liberar antecipadamente.
 *  - Nunca promete nem alega ação remota (abrir portão, validar código).
 *  - Fora do dia do check-in / sem estadia aberta: nada é liberado (o
 *    `resolveStayAccess` continua fechado e o guardrail determinístico cuida).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { propertyTimeZone, todayInTZ, zonedTimeToUtc } from "@/lib/property-timezone";

export type AccessTiming = {
  isCheckinDay: boolean;
  early: boolean;
  allowed: string | null;
  staff: string | null;
  /** Check-out: o horário limite já passou e a saída ainda não foi concluída? */
  checkoutOverdue: boolean;
  minutesLate: number;
  checkoutLimit: string | null;
  /** O limite de saída é um check-out tardio alinhado com a equipe. */
  checkoutAgreed?: boolean;
};

const EMPTY_TIMING: AccessTiming = {
  isCheckinDay: false,
  early: false,
  allowed: null,
  staff: null,
  checkoutOverdue: false,
  minutesLate: 0,
  checkoutLimit: null,
};

/**
 * Check-out atrasado: já passou da data+horário limite do imóvel (fuso do
 * imóvel) e a estadia ainda está aberta. Pura, para teste.
 */
export function checkoutLateness(p: {
  nowMs: number;
  checkoutDate: string | null | undefined;
  checkoutTime: unknown;
  agreedTime?: string | null;
  tz: string;
}): { overdue: boolean; minutesLate: number; label: string | null } {
  const rx = (v: unknown) => String(v ?? "").match(/^(\d{1,2}):(\d{2})/);
  const a = rx(p.agreedTime);
  const b = rx(p.checkoutTime);
  const m = a && b ? (Number(a[1]) * 60 + Number(a[2]) > Number(b[1]) * 60 + Number(b[2]) ? a : b) : (a ?? b);
  const d = p.checkoutDate ? String(p.checkoutDate).slice(0, 10).split("-").map(Number) : null;
  if (!m || !d || d.length !== 3 || d.some((x) => !Number.isFinite(x))) return { overdue: false, minutesLate: 0, label: null };
  const h = Number(m[1]);
  const min = Number(m[2]);
  const gate = zonedTimeToUtc(d[0]!, d[1]!, d[2]!, h, min, p.tz).getTime();
  const label = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  const late = Math.floor((p.nowMs - gate) / 60_000);
  return late > 0 ? { overdue: true, minutesLate: late, label } : { overdue: false, minutesLate: 0, label };
}

export async function accessTiming(params: {
  supabase: SupabaseClient;
  property: Record<string, unknown>;
  checkin: string | null | undefined;
  checkout?: string | null | undefined;
  /** Check-out tardio alinhado ("HH:MM"): vale no lugar do padrão se for mais tarde. */
  agreedCheckout?: string | null;
  now?: Date;
}): Promise<AccessTiming | null> {
  const ci = params.checkin ? String(params.checkin).slice(0, 10) : null;
  if (!ci) return null;
  const p = params.property;
  const tz = propertyTimeZone(
    typeof p.city === "string" ? p.city : null,
    typeof p.country === "string" ? p.country : null,
  );
  const now = params.now ?? new Date();
  const today = todayInTZ(tz);
  const late = checkoutLateness({ nowMs: now.getTime(), checkoutDate: params.checkout, checkoutTime: p.checkout_time, agreedTime: params.agreedCheckout, tz });
  const base: AccessTiming = {
    ...EMPTY_TIMING,
    checkoutOverdue: late.overdue,
    minutesLate: late.minutesLate,
    checkoutLimit: late.label,
    checkoutAgreed: !!params.agreedCheckout,
  };
  const isCheckinDay = today === ci;
  if (!isCheckinDay) return base;
  try {
    const { findStayForEvent, assessStayTimes } = await import("./stay-events.server");
    const stay = await findStayForEvent(params.supabase, { propertyId: String(p.id), checkinDate: ci, checkoutDate: null });
    if (!stay) return { ...base, isCheckinDay };
    const t = await assessStayTimes(params.supabase, { propertyId: String(p.id), stay });
    return { ...base, isCheckinDay, early: t.early, allowed: t.checkinAllowed, staff: t.staffCheckin };
  } catch (e) {
    console.error("[access-guidance] horários indisponíveis", e);
    return { ...base, isCheckinDay };
  }
}

/**
 * DECISÃO DE ACESSO (regras finais do anfitrião, 17/10/2026)
 *
 * A IA NUNCA segura credenciais enquanto consulta a equipe: entrega com
 * transparência sobre a situação do check-in/check-out e, quando cabe,
 * aciona a equipe em paralelo (sem esperar resposta para ajudar).
 *
 *  - Dia do check-in, ANTES do horário:
 *      · card NÃO liberado → entrega, reforçando que o check-in ainda não foi
 *        liberado, os horários e as regras. Sem acionar a equipe.
 *      · card liberado → entrega ciente de que é antes do horário e confirma
 *        com a equipe, em paralelo, se pode antecipar.
 *  - Horário JÁ PASSOU:
 *      · card liberado → é só seguir (entrega). Sem equipe.
 *      · card NÃO liberado → entrega com transparência sobre o atraso na
 *        liberação e informa a equipe (atraso + sentimento do hóspede).
 *  - Credenciais valem no dia do check-in e até 1 h após o horário de check-out (padrão ou o alinhado com a equipe).
 *  - Qualquer resposta humana na conversa vale como a palavra da equipe.
 */
export type AccessMode = "deliver" | "deliver_not_released" | "confirm_early" | "report_delay";

export function decideAccess(p: {
  isCheckinDay: boolean;
  early: boolean;
  released: boolean;
  hasTeamAnswer: boolean;
}): AccessMode {
  if (p.hasTeamAnswer) return "deliver";
  if (p.isCheckinDay && p.early) return p.released ? "confirm_early" : "deliver_not_released";
  return p.released ? "deliver" : "report_delay";
}

export function accessGuidanceText(t: AccessTiming | null, incident: boolean, mode: AccessMode = "deliver"): string {
  const L: string[] = [];
  L.push("\n\nACESSO E CHECK-IN (prioridade máxima; vale sobre qualquer regra anterior de acesso)");
  if (t?.isCheckinDay) {
    L.push(
      `- HOJE é o dia do check-in. Horário de entrada do anúncio: ${t.allowed ?? "conforme as instruções do imóvel"}${t.staff ? ` (a equipe antecipou para ${t.staff})` : ""}.`,
    );
  } else {
    L.push("- A estadia está em andamento: use apenas o que está liberado no contexto; não invente dados de acesso.");
  }
  if (mode === "deliver") {
    L.push(
      "- Você PODE informar senhas, códigos e instruções de entrada. Ao fazer isso, reforce com gentileza o horário de check-in e as regras do anúncio (uma frase natural, sem tom de bronca). Siga as instruções oficiais do imóvel sem acionar a equipe.",
      "- Se o contexto trouxer resposta da equipe sobre este acesso, ela manda: siga o que a equipe disse.",
    );
  } else if (mode === "deliver_not_released") {
    L.push(
      "- Ainda é ANTES do horário de check-in e o imóvel ainda NÃO foi liberado pela operação (limpeza ou saída anterior em andamento).",
      "- Você PODE entregar as credenciais e as instruções, mas SEMPRE reforçando com gentileza: o check-in ainda não foi liberado, o horário de entrada do anúncio e as regras (ex.: o imóvel pode ainda estar sendo preparado). Não acione a equipe só por isso.",
    );
  } else if (mode === "confirm_early") {
    L.push(
      "- Ainda é ANTES do horário de check-in. O imóvel está liberado no sistema, mas isso NÃO significa que a entrada antecipada está autorizada.",
      "- Você PODE entregar senha, código e instruções de entrada, mas deixe claro, com gentileza, que ainda é antes do horário do anúncio e que a entrada antecipada depende da confirmação da equipe. Em paralelo, chame request_human_handoff perguntando se pode liberar antecipadamente (inclua o SENTIMENTO do hóspede). Não espere a resposta para ajudar.",
    );
  } else {
    L.push(
      "- O horário de check-in JÁ PASSOU, mas o card de check-in do hóspede continua TRAVADO (limpeza ou saída anterior ainda não concluída).",
      "- Você PODE entregar as credenciais e as instruções de entrada, com transparência: explique com sobriedade que o imóvel ainda está em preparo/liberação e que a equipe está sendo avisada. Peça desculpas pelo contratempo sem exagero.",
      "- Em paralelo, chame request_human_handoff informando à equipe, com gentileza e precisão, o ATRASO NA LIBERAÇÃO do check-in e o SENTIMENTO do hóspede neste momento (calmo, ansioso, irritado…). Continue apoiando o hóspede enquanto a equipe responde. Sem prazo, sem emoji.",
    );
  }
  if (t?.checkoutOverdue) {
    L.push(
      `- CHECK-OUT ATRASADO: o horário limite de saída${t.checkoutAgreed ? " alinhado com a equipe" : ""} (${t.checkoutLimit ?? "do anúncio"}) já passou há cerca de ${t.minutesLate} min e a saída ainda não foi concluída.`,
      "- As credenciais só continuam disponíveis até 1 h após esse horário; se o hóspede pedir, informe, ciente da situação.",
      "- Com o hóspede: informe com gentileza e clareza que o horário de check-out já passou, lembre o horário limite do anúncio e pergunte se ele já está saindo ou se precisa de algo; peça que avise quando concluir a saída. Sem acusação, sem bronca, sem emoji.",
      "- Com a equipe: chame request_human_handoff (urgência normal) informando que o hóspede passou do horário de check-out, há quantos minutos e o SENTIMENTO dele neste momento (tranquilo, apressado, irritado…), para a equipe decidir (ex.: aguardar, autorizar saída tardia). Se a equipe já respondeu sobre isso, siga a resposta dela.",
    );
  }
  if (incident) {
    L.push(
      "- O hóspede relatou PROBLEMA FÍSICO DE ACESSO. A equipe já foi acionada em paralelo. Converse: confirme onde ele está, o que tentou e o que vê, e conduza a entrada passo a passo usando SOMENTE as instruções oficiais (respeitando a regra acima).",
    );
  }
  L.push(
    "- Códigos de ACESSO (portão, fechadura, cadeado, cofre, caixa de chave) são SEMPRE chamados de \"senha temporária\" e citados com o nome do dispositivo, ex.: \"a senha temporária do cadeado cofre é 0000\". Já Wi-Fi e outras senhas não sensíveis (equipamentos, áreas internas) mantêm o nome normal (\"a senha do Wi-Fi é …\"), sem o rótulo de temporária.",
    "- NUNCA diga nem insinue que você abriu, destravou, liberou, acionou ou validou algo remotamente. Você não faz ações físicas nem valida códigos.",
    "- Nunca prometa prazo específico de atendimento da equipe.",
  );
  return L.join("\n");
}
