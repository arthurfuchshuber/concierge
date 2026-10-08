/**
 * HISTÓRICO DA RESERVA — a jornada inteira de uma estadia, num lugar só.
 *
 * Pedido explícito (08/09/2026), em duas frases que são a mesma coisa:
 *   · "ao clicar em um card da visão lista no kanban, abrir um tooltip com o
 *     histórico de tudo relacionado àquela reserva";
 *   · "TODOS OS CARDS relacionados à mesma reserva precisam ser O MESMO
 *     CARD... no final, o card precisa apresentar toda a jornada/histórico da
 *     reserva, limpeza, etc".
 *
 * O QUE JÁ ERA VERDADE, E O QUE FALTAVA
 *
 * O card já é o mesmo objeto ao longo da esteira: Check-ins e Em Estadia saem
 * da MESMA lista (`kind: "checkin"`, separadas só por status), e Checkouts e
 * Fila de Limpeza saem da MESMA lista (`kind: "checkout"`) — o "espelho" da
 * limpeza nunca foi um card novo, é a mesma `ArrivalRow`, com os mesmos
 * identificadores, renderizada com outro `mode`. O que faltava não era
 * unificar a identidade: era o card CONTAR essa jornada. Cada coluna mostrava
 * só o instante presente, e o que tinha acontecido antes ficava invisível.
 *
 * É isso que esta função devolve: a linha do tempo da estadia montada a
 * partir do que o sistema de fato gravou — nunca inferida de "onde o card
 * está agora".
 *
 * COMO A JORNADA É RECONSTRUÍDA
 *
 * A fonte é `guest_arrival_status`, que guarda uma linha por lado da estadia
 * (`kind` "checkin" e "checkout") com os carimbos de tempo reais: `done_at`
 * (a etapa aconteceu), `concluded_at` (o card saiu da esteira) e, no lado da
 * saída, `cleaning_type`/`cleaning_price_cents` (que limpeza foi feita e por
 * quanto). Um passo só é dado como concluído quando existe carimbo — jamais
 * porque o passo seguinte existe.
 *
 * A estadia é encontrada pelos DOIS identificadores (log do formulário e
 * reserva do iCal) porque nem todo card carrega os dois: o casamento
 * formulário↔reserva é mais exigente do lado da chegada (ver
 * `findLogsForReservation`). Procurar pelos dois, e completar um pelo outro
 * através da estadia (imóvel + data de entrada), é o que garante que abrir o
 * histórico pelo card de Limpeza mostre o mesmo que abrir pelo de Check-in.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type AnyClient = { from: (t: string) => any };

const TargetInput = z
  .object({
    logId: z.string().uuid().nullable().optional(),
    reservationId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => !!v.logId || !!v.reservationId, { message: "Informe a reserva ou o registro do hóspede." });

/** Quem fez a ação. `name` nulo = dado anterior ao registro de autoria. */
export type JourneyActor = {
  name: string | null;
  role: "Equipe" | "Prestador" | "Hóspede" | "Sistema" | null;
};

/** Um passo da esteira. `state` é o que a interface pinta. */
export type JourneyStep = {
  key: "reserva" | "formulario" | "previsao" | "checkin" | "no_show" | "estadia" | "checkout" | "limpeza" | "concluido";
  label: string;
  state: "done" | "pending" | "skipped";
  /** Quando aconteceu (ISO) — nulo quando ainda não aconteceu. */
  at: string | null;
  /** Linha de apoio: o detalhe que só existe naquele passo. */
  detail: string | null;
  /** Autor da ação; nulo quando o passo não tem autor (estadia, pendentes). */
  actor: JourneyActor | null;
};

export type JourneyTask = {
  id: string;
  title: string;
  status: "pending" | "done" | "canceled";
  category: string;
  dueDate: string | null;
};

/** Uma linha da seção "Atividade": tudo que aconteceu, do mais novo ao mais antigo. */
export type JourneyActivity = {
  id: string;
  at: string;
  tag: "Registro" | "Pendência" | "Check-in" | "Check-out" | "Limpeza" | "Previsão" | "Formulário" | "Reserva";
  title: string;
  sub: string | null;
  actor: JourneyActor;
  /** Registros e pendências abrem o item ao tocar. */
  opens: "records" | null;
};

export type ReservationJourney = {
  guestName: string | null;
  propertyName: string | null;
  ownerName: string | null;
  reservationCode: string | null;
  checkinDate: string | null;
  checkoutDate: string | null;
  steps: JourneyStep[];
  tasks: JourneyTask[];
  activity: JourneyActivity[];
  /** Status em uma palavra, para a pílula do cabeçalho. */
  statusLabel: string;
  propertyCoverUrls: string[];
  ownerPhone: string | null;
  ownerPhoneCountry: string | null;
  /** Quantos registros (fotos, áudios, notas) a reserva acumulou. */
  recordsCount: number;
};

type LogRow = {
  id: string;
  property_id: string;
  guest_name: string | null;
  reservation_code: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  guest_arrival_time: string | null;
  created_at: string | null;
};

type ReservationRow = {
  id: string;
  property_id: string;
  checkin_date: string | null;
  checkout_date: string | null;
  guest_hint: string | null;
  created_at: string | null;
};

type StatusRow = {
  kind: string;
  status: string | null;
  note: string | null;
  done_at: string | null;
  concluded_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  arrival_time_override: string | null;
  arrival_date_override: string | null;
  cleaning_type: string | null;
  cleaning_price_cents: number | null;
  cleaning_approval_status: string | null;
};

function brl(cents: number | null): string | null {
  if (cents == null) return null;
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "04/10 · 15:46" no fuso de São Paulo. */
function fmtShort(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")}/${g("month")} · ${g("hour")}:${g("minute")}`;
}

function fmtDateBR(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : iso;
}

export const getReservationJourney = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => TargetInput.parse(i))
  .handler(async ({ data, context }): Promise<ReservationJourney> => {
    const db = context.supabase as unknown as AnyClient;

    // ---- 1. A estadia: formulário do hóspede e/ou reserva do iCal ----
    let logId = data.logId ?? null;
    let reservationId = data.reservationId ?? null;

    const [logRes, resRes] = await Promise.all([
      logId
        ? db
            .from("guide_access_logs")
            .select("id, property_id, guest_name, reservation_code, checkin_date, checkout_date, guest_arrival_time, created_at")
            .eq("id", logId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      reservationId
        ? db
            .from("property_reservations")
            .select("id, property_id, checkin_date, checkout_date, guest_hint, created_at")
            .eq("id", reservationId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    let log: LogRow | null = (logRes.data as LogRow | null) ?? null;
    let reservation: ReservationRow | null = (resRes.data as ReservationRow | null) ?? null;

    const propertyId = log?.property_id ?? reservation?.property_id ?? null;
    const checkinDate = log?.checkin_date ?? reservation?.checkin_date ?? null;
    if (!propertyId) throw new Error("Reserva não encontrada.");

    // Completa o lado que faltou pela ESTADIA (imóvel + data de entrada) —
    // sem isso, abrir o histórico por um card traria menos coisa do que
    // abrir pelo outro, e a jornada dependeria de por onde se entrou.
    if (checkinDate) {
      if (!reservation) {
        const { data: r } = await db
          .from("property_reservations")
          .select("id, property_id, checkin_date, checkout_date, guest_hint, created_at")
          .eq("property_id", propertyId)
          .eq("checkin_date", checkinDate)
          .limit(1);
        reservation = (r?.[0] as ReservationRow | undefined) ?? null;
        reservationId = reservation?.id ?? reservationId;
      }
      if (!log) {
        const { data: l } = await db
          .from("guide_access_logs")
          .select("id, property_id, guest_name, reservation_code, checkin_date, checkout_date, guest_arrival_time, created_at")
          .eq("property_id", propertyId)
          .eq("checkin_date", checkinDate)
          .order("created_at", { ascending: true })
          .limit(1);
        log = (l?.[0] as LogRow | undefined) ?? null;
        logId = log?.id ?? logId;
      }
    }

    // ---- 2. Imóvel e proprietário ----
    const { data: prop } = await db
      .from("properties")
      .select("id, name, owner_id, owner_contact_id, hero_image_url, gallery_images")
      .eq("id", propertyId)
      .maybeSingle();
    const property = prop as {
      name: string | null;
      owner_id: string | null;
      owner_contact_id: string | null;
      hero_image_url: string | null;
      gallery_images: string[] | null;
    } | null;
    let ownerName: string | null = null;
    let ownerPhone: string | null = null;
    let ownerPhoneCountry: string | null = null;
    if (property?.owner_contact_id) {
      const { data: owner } = await db
        .from("property_owners")
        .select("name, trade_name, phone, phone_country")
        .eq("id", property.owner_contact_id)
        .maybeSingle();
      const o = owner as {
        name: string | null;
        trade_name: string | null;
        phone: string | null;
        phone_country: string | null;
      } | null;
      ownerName = ((o?.trade_name || o?.name) ?? "").trim() || null;
      ownerPhone = o?.phone ?? null;
      ownerPhoneCountry = o?.phone_country ?? null;
    }

    // ---- 3. Os carimbos da esteira ----
    const orParts: string[] = [];
    if (logId) orParts.push(`log_id.eq.${logId}`);
    if (reservationId) orParts.push(`reservation_id.eq.${reservationId}`);
    const { data: statusRows } = await db
      .from("guest_arrival_status")
      .select(
        "kind, status, note, done_at, concluded_at, created_at, updated_at, arrival_time_override, arrival_date_override, cleaning_type, cleaning_price_cents, cleaning_approval_status",
      )
      .or(orParts.join(","))
      .order("updated_at", { ascending: true });

    const all = (statusRows ?? []) as StatusRow[];
    // Quando os dois identificadores existem, pode haver duas linhas do mesmo
    // lado (legado por log + atual por reserva). A mais completa manda: a que
    // tem carimbo de conclusão, senão a que tem carimbo de "feito".
    const pick = (kind: string): StatusRow | null => {
      const rows = all.filter((r) => r.kind === kind);
      if (rows.length === 0) return null;
      return (
        rows.find((r) => !!r.concluded_at) ?? rows.find((r) => !!r.done_at) ?? rows[rows.length - 1]
      );
    };
    const ci = pick("checkin");
    const co = pick("checkout");

    // ---- 4. Pendências, registros e EVENTOS (quem fez o quê) ----
    const [tasksRes, recordsRes, eventsRes] = await Promise.all([
      db
        .from("tasks")
        .select("id, title, status, category, due_date, created_by, created_at, priority")
        .or(orParts.join(","))
        .order("created_at", { ascending: true })
        .limit(50),
      db
        .from("reservation_records")
        .select("id, group_id, category, kind, created_by, created_by_name, created_at")
        .or(orParts.join(","))
        .limit(200),
      // Tabela de eventos não existe no banco: consulta removida (só gerava erro e atraso).
      Promise.resolve({ data: [] as unknown[] }),
    ]);
    type EventRow = { id: string; kind: string; detail: Record<string, string | number | null> | null; actor_id: string | null; created_at: string };
    type TaskRow = { id: string; title: string; status: string; category: string; due_date: string | null; created_by: string | null; created_at: string | null; priority: string | null };
    type RecRow = { id: string; group_id: string | null; category: string | null; kind: string | null; created_by: string | null; created_by_name: string | null; created_at: string };
    // Falha de leitura (tabela ainda sem migração, p.ex.) não derruba o histórico.
    const events = ((eventsRes as { data?: EventRow[] | null }).data ?? []) as EventRow[];
    const taskRows = ((tasksRes.data ?? []) as TaskRow[]);
    const recRows = ((recordsRes.data ?? []) as RecRow[]);

    // ---- 4b. Nome e papel de cada autor ----
    const actorIds = Array.from(
      new Set([...events.map((e) => e.actor_id), ...taskRows.map((t) => t.created_by), ...recRows.map((r) => r.created_by)].filter((x): x is string => !!x)),
    );
    const actorById = new Map<string, JourneyActor>();
    if (actorIds.length > 0) {
      const [profRes, provRes, memRes] = await Promise.all([
        db.from("profiles").select("id, full_name, trade_name").in("id", actorIds),
        db.from("service_providers").select("member_user_id, name, trade_name").in("member_user_id", actorIds),
        db.from("account_members").select("member_user_id").in("member_user_id", actorIds).eq("status", "active"),
      ]);
      const provIds = new Set(((provRes.data ?? []) as Array<{ member_user_id: string }>).map((p) => p.member_user_id));
      const memberIds = new Set(((memRes.data ?? []) as Array<{ member_user_id: string }>).map((m) => m.member_user_id));
      for (const pr of (profRes.data ?? []) as Array<{ id: string; full_name: string | null; trade_name: string | null }>) {
        const name = ((pr.trade_name || pr.full_name) ?? "").trim() || null;
        const role: JourneyActor["role"] = provIds.has(pr.id) && !memberIds.has(pr.id) && pr.id !== property?.owner_id ? "Prestador" : "Equipe";
        actorById.set(pr.id, { name, role });
      }
    }
    const actorOf = (id: string | null | undefined): JourneyActor =>
      id ? (actorById.get(id) ?? { name: null, role: null }) : { name: "Sincronização", role: "Sistema" };
    const lastEvent = (kind: string): EventRow | null => {
      const rows = events.filter((e) => e.kind === kind);
      return rows.length ? rows[rows.length - 1]! : null;
    };
    const SYSTEM: JourneyActor = { name: "Sincronização", role: "Sistema" };
    const GUEST: JourneyActor = { name: log?.guest_name ?? "Hóspede", role: "Hóspede" };
    /** Passo feito: autor do evento, ou "não registrado" para dado antigo. */
    const authorFor = (ev: EventRow | null): JourneyActor => (ev ? actorOf(ev.actor_id) : { name: null, role: null });

    // ---- 5. A jornada ----
    const noShow = (ci?.status ?? "") === "no_show";
    const checkinDone = !!(ci && (ci.status === "done" || ci.done_at)) && !noShow;
    const checkoutDone = !!(co && (co.status === "done" || co.done_at));
    const concluded = !!co?.concluded_at;
    const previsaoData = ci?.arrival_date_override ?? co?.arrival_date_override ?? null;
    const previsaoHora = ci?.arrival_time_override ?? co?.arrival_time_override ?? log?.guest_arrival_time ?? null;

    const steps: JourneyStep[] = [];
    steps.push({
      key: "reserva",
      label: "Reserva registrada",
      state: "done",
      at: reservation?.created_at ?? log?.created_at ?? null,
      detail:
        [
          fmtDateBR(log?.checkin_date ?? reservation?.checkin_date ?? null),
          fmtDateBR(log?.checkout_date ?? reservation?.checkout_date ?? null),
        ]
          .filter(Boolean)
          .join(" → ") || null,
      actor: reservation ? SYSTEM : GUEST,
    });

    if (log) {
      steps.push({
        key: "formulario",
        label: "Formulário preenchido",
        state: "done",
        at: log.created_at,
        detail:
          [log.guest_arrival_time ? `Chegada prevista ${log.guest_arrival_time.slice(0, 5)}` : null]
            .filter(Boolean)
            .join(" · ") || null,
        actor: GUEST,
      });
    }

    const evPrevisao = lastEvent("previsao_hora") ?? lastEvent("previsao_data");
    if (previsaoData || previsaoHora) {
      steps.push({
        key: "previsao",
        label: "Previsão informada",
        state: "done",
        at: evPrevisao?.created_at ?? null,
        detail: [previsaoData ? fmtDateBR(previsaoData) : null, previsaoHora?.slice(0, 5)].filter(Boolean).join(" · ") || null,
        actor: evPrevisao ? authorFor(evPrevisao) : log?.guest_arrival_time && !ci?.arrival_time_override ? GUEST : authorFor(null),
      });
    }

    const pickResult = (): { checkinDate: string | null; checkoutDate: string | null } => ({
      checkinDate: log?.checkin_date ?? reservation?.checkin_date ?? null,
      checkoutDate: log?.checkout_date ?? reservation?.checkout_date ?? null,
    });

    // ---- 6. A ATIVIDADE (tudo que aconteceu, do mais novo ao mais antigo) ----
    const activity: JourneyActivity[] = [];
    // A Atividade NÃO repete o que a Jornada já conta (formulário, check-in,
    // check-out, limpeza, não comparecimento) — pedido explícito, 05/10/2026:
    // "a timeline acima possui essa info". Fica só o que a Jornada não mostra:
    // mudanças de previsão, registros e pendências.
    for (const e of events) {
      const d = e.detail ?? {};
      const a = authorFor(e);
      if (e.kind === "previsao_hora" || e.kind === "previsao_data") {
        const lado = d.side === "checkout" ? "Saída" : "Chegada";
        const toV = e.kind === "previsao_hora" ? String(d.to ?? "").slice(0, 5) : fmtDateBR((d.to as string | null) ?? null);
        const fromV = e.kind === "previsao_hora" ? String(d.from ?? "").slice(0, 5) : fmtDateBR((d.from as string | null) ?? null);
        activity.push({
          id: e.id,
          at: e.created_at,
          tag: "Previsão",
          title: toV ? `${lado} ${e.kind === "previsao_hora" ? "alterada para" : "remarcada para"} ${toV}` : `Previsão de ${lado.toLowerCase()} removida`,
          sub: fromV ? `Antes: ${fromV}` : null,
          actor: a,
          opens: null,
        });
      }
    }
    // Registros: um item por grupo (várias fotos do mesmo registro = uma linha).
    const groups = new Map<string, RecRow[]>();
    for (const r of recRows) {
      const k = r.group_id ?? r.id;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    for (const [k, items] of groups) {
      const first = items.slice().sort((x, y) => x.created_at.localeCompare(y.created_at))[0]!;
      const media = items.filter((r) => r.kind && r.kind !== "note").length;
      const by = first.created_by_name?.trim()
        ? { name: first.created_by_name.trim(), role: actorById.get(first.created_by ?? "")?.role ?? ("Equipe" as const) }
        : first.created_by ? actorOf(first.created_by) : { name: null, role: null };
      activity.push({
        id: `rec-${k}`,
        at: first.created_at,
        tag: "Registro",
        title: first.category ? `Registro · ${first.category}` : "Registro",
        sub: media > 0 ? `${media} ${media === 1 ? "anexo" : "anexos"}` : null,
        actor: by,
        opens: "records",
      });
    }
    for (const t of taskRows) {
      if (!t.created_at) continue;
      activity.push({
        id: `task-${t.id}`,
        at: t.created_at,
        tag: "Pendência",
        title: t.title,
        sub: t.status === "done" ? "Concluída" : t.status === "canceled" ? "Arquivada" : "Aberta",
        actor: t.created_by ? actorOf(t.created_by) : { name: null, role: null },
        opens: "records",
      });
    }
    activity.sort((x, y) => y.at.localeCompare(x.at));

    const tasks: JourneyTask[] = taskRows.map((t) => ({
      id: t.id,
      title: t.title,
      status: (t.status as JourneyTask["status"]) ?? "pending",
      category: t.category,
      dueDate: t.due_date,
    }));
    const recordsCount = groups.size;
    const base = {
      guestName: log?.guest_name ?? reservation?.guest_hint ?? null,
      propertyName: property?.name ?? null,
      ownerName,
      ownerPhone,
      ownerPhoneCountry,
      propertyCoverUrls: [property?.hero_image_url, ...(property?.gallery_images ?? [])].filter((u): u is string => !!u),
      reservationCode: log?.reservation_code ?? reservation?.guest_hint ?? null,
      ...pickResult(),
      tasks,
      activity,
      recordsCount,
    };

    if (noShow) {
      // A jornada PARA aqui, de propósito: quem não chegou não tem saída nem
      // faxina. Mostrar "checkout pendente" depois de um não comparecimento
      // seria repetir na tela o mesmo erro que o quadro já corrigiu.
      const ev = lastEvent("no_show");
      steps.push({
        key: "no_show",
        label: "Não compareceu",
        state: "done",
        at: ev?.created_at ?? ci?.concluded_at ?? ci?.updated_at ?? null,
        detail: ci?.note ?? null,
        actor: authorFor(ev),
      });
      return { ...base, steps, statusLabel: "Não compareceu" };
    }

    const evCheckin = lastEvent("checkin");
    const evCheckout = lastEvent("checkout");
    const evConcluded = lastEvent("concluded");
    steps.push({
      key: "checkin",
      label: "Check-in",
      state: checkinDone ? "done" : "pending",
      at: evCheckin?.created_at ?? ci?.done_at ?? null,
      detail: checkinDone ? "Presença confirmada na entrada" : "Aguardando confirmação",
      actor: checkinDone ? authorFor(evCheckin) : null,
    });
    steps.push({
      key: "estadia",
      label: "Em estadia",
      state: checkinDone ? "done" : "pending",
      at: checkinDone ? (ci?.done_at ?? null) : null,
      detail: checkinDone
        ? checkoutDone
          ? "Estadia encerrada"
          : `Hóspede no imóvel desde ${fmtShort(ci?.done_at ?? null) ?? "a chegada"}`
        : null,
      actor: null,
    });
    steps.push({
      key: "checkout",
      label: "Checkout",
      state: checkoutDone ? "done" : "pending",
      at: evCheckout?.created_at ?? co?.done_at ?? null,
      detail: checkoutDone ? "Saída confirmada" : "Aguardando confirmação",
      actor: checkoutDone ? authorFor(evCheckout) : null,
    });
    steps.push({
      key: "limpeza",
      label: "Limpeza",
      state: concluded ? "done" : "pending",
      at: concluded ? (evConcluded?.created_at ?? co?.concluded_at ?? null) : null,
      detail: concluded
        ? [
            co?.cleaning_type === "completa" ? "Completa" : co?.cleaning_type === "normal" ? "Normal" : null,
            brl(co?.cleaning_price_cents ?? null),
            // Completa só conta no custo depois de aprovada (17/09/2026).
            co?.cleaning_approval_status === "pending"
              ? "aguardando aprovação"
              : co?.cleaning_approval_status === "rejected"
                ? "ajustada para normal pelo gestor"
                : null,
          ]
            .filter(Boolean)
            .join(" · ") || null
        : checkoutDone
          ? "Liberada — aguardando conclusão"
          : "Aguardando o checkout",
      actor: concluded ? authorFor(evConcluded) : null,
    });
    steps.push({
      key: "concluido",
      label: "Concluído",
      state: concluded ? "done" : "pending",
      at: co?.concluded_at ?? null,
      detail: concluded ? null : "Aguardando a limpeza",
      actor: concluded ? authorFor(evConcluded) : null,
    });

    const statusLabel = concluded
      ? "Concluída"
      : checkoutDone
        ? "Em limpeza"
        : checkinDone
          ? "Em estadia"
          : "Aguardando chegada";
    return { ...base, steps, statusLabel };
  });
