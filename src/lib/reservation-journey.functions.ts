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
  .refine((v) => !!v.logId || !!v.reservationId, {
    message: "Informe a reserva ou o registro do hóspede.",
  });

/** Um passo da esteira. `state` é o que a interface pinta. */
export type JourneyStep = {
  key:
    | "reserva"
    | "previsao"
    | "checkin"
    | "no_show"
    | "estadia"
    | "checkout"
    | "limpeza"
    | "concluido";
  label: string;
  state: "done" | "pending" | "skipped";
  /** Quando aconteceu (ISO) — nulo quando ainda não aconteceu. */
  at: string | null;
  /** Linha de apoio: o detalhe que só existe naquele passo. */
  detail: string | null;
};

export type JourneyTask = {
  id: string;
  title: string;
  status: "pending" | "done" | "canceled";
  category: string;
  dueDate: string | null;
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
};

function brl(cents: number | null): string | null {
  if (cents == null) return null;
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
            .select(
              "id, property_id, guest_name, reservation_code, checkin_date, checkout_date, guest_arrival_time, created_at",
            )
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
          .select(
            "id, property_id, guest_name, reservation_code, checkin_date, checkout_date, guest_arrival_time, created_at",
          )
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
      .select("id, name, owner_contact_id")
      .eq("id", propertyId)
      .maybeSingle();
    const property = prop as { name: string | null; owner_contact_id: string | null } | null;
    let ownerName: string | null = null;
    if (property?.owner_contact_id) {
      const { data: owner } = await db
        .from("property_owners")
        .select("name, trade_name")
        .eq("id", property.owner_contact_id)
        .maybeSingle();
      const o = owner as { name: string | null; trade_name: string | null } | null;
      ownerName = ((o?.trade_name || o?.name) ?? "").trim() || null;
    }

    // ---- 3. Os carimbos da esteira ----
    const orParts: string[] = [];
    if (logId) orParts.push(`log_id.eq.${logId}`);
    if (reservationId) orParts.push(`reservation_id.eq.${reservationId}`);
    const { data: statusRows } = await db
      .from("guest_arrival_status")
      .select(
        "kind, status, note, done_at, concluded_at, created_at, updated_at, arrival_time_override, arrival_date_override, cleaning_type, cleaning_price_cents",
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

    // ---- 4. Pendências e registros da reserva ----
    const [tasksRes, recordsRes] = await Promise.all([
      db
        .from("tasks")
        .select("id, title, status, category, due_date")
        .or(orParts.join(","))
        .order("created_at", { ascending: true })
        .limit(50),
      db.from("reservation_records").select("id").or(orParts.join(",")).limit(200),
    ]);

    // ---- 5. A jornada ----
    const noShow = (ci?.status ?? "") === "no_show";
    const checkinDone = !!(ci && (ci.status === "done" || ci.done_at)) && !noShow;
    const checkoutDone = !!(co && (co.status === "done" || co.done_at));
    const concluded = !!co?.concluded_at;
    const previsaoData = ci?.arrival_date_override ?? co?.arrival_date_override ?? null;
    const previsaoHora =
      ci?.arrival_time_override ?? co?.arrival_time_override ?? log?.guest_arrival_time ?? null;

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
    });

    if (previsaoData || previsaoHora) {
      steps.push({
        key: "previsao",
        label: "Previsão informada",
        state: "done",
        at: null,
        detail:
          [previsaoData ? fmtDateBR(previsaoData) : null, previsaoHora]
            .filter(Boolean)
            .join(" · ") || null,
      });
    }

    if (noShow) {
      // A jornada PARA aqui, de propósito: quem não chegou não tem saída nem
      // faxina. Mostrar "checkout pendente" depois de um não comparecimento
      // seria repetir na tela o mesmo erro que o quadro já corrigiu.
      steps.push({
        key: "no_show",
        label: "Não compareceu",
        state: "done",
        at: ci?.concluded_at ?? ci?.updated_at ?? null,
        detail: ci?.note ?? null,
      });
      return {
        guestName: log?.guest_name ?? reservation?.guest_hint ?? null,
        propertyName: property?.name ?? null,
        ownerName,
        reservationCode: log?.reservation_code ?? reservation?.guest_hint ?? null,
        checkinDate: log?.checkin_date ?? reservation?.checkin_date ?? null,
        checkoutDate: log?.checkout_date ?? reservation?.checkout_date ?? null,
        steps,
        tasks: (
          (tasksRes.data ?? []) as Array<{
            id: string;
            title: string;
            status: string;
            category: string;
            due_date: string | null;
          }>
        ).map((t) => ({
          id: t.id,
          title: t.title,
          status: (t.status as JourneyTask["status"]) ?? "pending",
          category: t.category,
          dueDate: t.due_date,
        })),
        recordsCount: (recordsRes.data ?? []).length,
      };
    }

    steps.push({
      key: "checkin",
      label: "Check-in",
      state: checkinDone ? "done" : "pending",
      at: ci?.done_at ?? null,
      detail: checkinDone ? null : "Aguardando confirmação",
    });
    steps.push({
      key: "estadia",
      label: "Em estadia",
      state: checkinDone && !checkoutDone ? "done" : checkoutDone ? "done" : "pending",
      at: checkinDone ? (ci?.done_at ?? null) : null,
      detail: checkinDone && !checkoutDone ? "Hóspede no imóvel" : null,
    });
    steps.push({
      key: "checkout",
      label: "Checkout",
      state: checkoutDone ? "done" : "pending",
      at: co?.done_at ?? null,
      detail: checkoutDone ? null : "Aguardando confirmação",
    });
    steps.push({
      key: "limpeza",
      label: "Limpeza",
      state: concluded ? "done" : checkoutDone ? "pending" : "pending",
      at: concluded ? co?.concluded_at : null,
      detail: concluded
        ? [
            co?.cleaning_type === "completa"
              ? "Completa"
              : co?.cleaning_type === "normal"
                ? "Normal"
                : null,
            brl(co?.cleaning_price_cents ?? null),
          ]
            .filter(Boolean)
            .join(" · ") || null
        : checkoutDone
          ? "Liberada — aguardando conclusão"
          : "Aguardando o checkout",
    });
    steps.push({
      key: "concluido",
      label: "Concluído",
      state: concluded ? "done" : "pending",
      at: co?.concluded_at ?? null,
      detail: null,
    });

    return {
      guestName: log?.guest_name ?? reservation?.guest_hint ?? null,
      propertyName: property?.name ?? null,
      ownerName,
      reservationCode: log?.reservation_code ?? reservation?.guest_hint ?? null,
      checkinDate: log?.checkin_date ?? reservation?.checkin_date ?? null,
      checkoutDate: log?.checkout_date ?? reservation?.checkout_date ?? null,
      steps,
      tasks: (
        (tasksRes.data ?? []) as Array<{
          id: string;
          title: string;
          status: string;
          category: string;
          due_date: string | null;
        }>
      ).map((t) => ({
        id: t.id,
        title: t.title,
        status: (t.status as JourneyTask["status"]) ?? "pending",
        category: t.category,
        dueDate: t.due_date,
      })),
      recordsCount: (recordsRes.data ?? []).length,
    };
  });
