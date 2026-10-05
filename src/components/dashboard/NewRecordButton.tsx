import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarCheck, Home, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  FILTER_PANEL_CLASS,
  FILTER_PANEL_COLLISION,
  FILTER_PANEL_OFFSET,
  FilterOptionRow,
} from "@/components/dashboard/filter-panel";
import { ACTION_ICON, ACTION_SEGMENT } from "@/components/dashboard/panel-chrome";
import {
  Choice,
  PickList,
  Step,
  ddmm,
  norm,
} from "@/components/dashboard/TrailParts";
import { RecordSituationSheet } from "@/components/dashboard/RecordSituationSheet";
import { CATEGORIES } from "@/components/dashboard/record-categories";
import { getNewRecordOptions, type RecordCategory } from "@/lib/reservation-records.functions";
import { useImpersonation } from "@/hooks/useImpersonation";
import { cn } from "@/lib/utils";

/**
 * "+ REGISTRO" na página Registros (mockup aprovado em 04/10/2026).
 *
 * Pedido do cliente: "coloque o botão de + também na página de registros,
 * para que o usuário consiga registrar coisas sem depender de um checkout
 * diretamente — ele pode vincular só ao imóvel ou a uma reserva". É o mesmo
 * "+" da Limpeza (mesmo segmento, mesmo painel de 300px, mesma trilha de
 * perguntas), com três perguntas:
 *
 *   1. Vincular a um imóvel ou a uma reserva?
 *   2. Qual imóvel / qual reserva?
 *   3. Qual categoria?  (as mesmas categorias da folha de sempre)
 *
 * Ao continuar, abre a MESMA folha "Nova situação" que o prestador já usa nos
 * cards de limpeza (`RecordSituationSheet`) — nada de janela nova: mídias,
 * título, descrição, ditado, envio em segundo plano e rascunho são os de
 * sempre. O cabeçalho ganha "Proprietário: nome" com o ícone de contato e,
 * quando há reserva, a linha dela.
 *
 * Quem vê: qualquer pessoa da equipe e o prestador vinculado ao imóvel (o
 * alcance é o de `accessiblePropertyIds`, o mesmo da lista de Registros).
 */

const QUESTIONS = [
  "Vincular a um imóvel ou a uma reserva?",
  "Qual imóvel ou reserva?",
  "Qual categoria?",
] as const;

type Link = "imovel" | "reserva";

export function NewRecordButton() {
  const ownerId = useImpersonation().impersonation?.userId ?? null;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [link, setLink] = useState<Link | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [category, setCategory] = useState<RecordCategory | null>(null);
  const [search, setSearch] = useState("");
  const [sheet, setSheet] = useState<{
    propertyId: string;
    reservationId: string | null;
    category: RecordCategory;
  } | null>(null);

  const optionsFn = useServerFn(getNewRecordOptions);
  const q = useQuery({
    queryKey: ["new-record-options", ownerId],
    queryFn: () => optionsFn({ data: { ownerId } }),
    enabled: open || !!sheet,
    staleTime: 60_000,
  });
  const properties = q.data?.properties ?? [];
  const reservations = q.data?.reservations ?? [];
  const property = properties.find((p) => p.id === propertyId) ?? null;
  const reservation = reservations.find((r) => r.id === reservationId) ?? null;
  const propName = (id: string) => properties.find((p) => p.id === id)?.name ?? "Imóvel";
  const resLabel = (r: { label: string; checkin: string; checkout: string | null }) =>
    `${r.label || "Reserva"} · ${ddmm(r.checkin)} → ${ddmm(r.checkout)}`;

  const reset = () => {
    setStep(1);
    setLink(null);
    setPropertyId(null);
    setReservationId(null);
    setCategory(null);
    setSearch("");
  };

  const sq = norm(search.trim());
  const shownProps = useMemo(
    () =>
      sq
        ? properties.filter((p) => norm(`${p.name} ${p.ownerName ?? ""}`).includes(sq))
        : properties,
    [properties, sq],
  );
  const shownRes = useMemo(
    () =>
      sq
        ? reservations.filter((r) =>
            norm(`${r.label} ${properties.find((p) => p.id === r.propertyId)?.name ?? ""}`).includes(sq),
          )
        : reservations,
    [reservations, properties, sq],
  );

  const answered = [
    !!link,
    link === "reserva" ? !!reservation : !!property,
    !!category,
  ];
  const answers = [
    link === "imovel" ? "Imóvel" : link === "reserva" ? "Reserva" : undefined,
    link === "reserva" ? (reservation ? resLabel(reservation) : undefined) : property?.name,
    category ? CATEGORIES.find((c) => c.key === category)?.label : undefined,
  ];
  const question2 =
    link === "reserva" ? "Qual reserva?" : link === "imovel" ? "Qual imóvel?" : QUESTIONS[1];
  const ready = answered.every(Boolean) && step === 3;

  const pickProperty = (id: string, resId: string | null) => {
    setPropertyId(id);
    setReservationId(resId);
    setSearch("");
    setStep(3);
  };

  const sheetProperty = sheet ? properties.find((p) => p.id === sheet.propertyId) : null;
  const sheetReservation = sheet?.reservationId
    ? reservations.find((r) => r.id === sheet.reservationId)
    : null;

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            title="Novo registro"
            aria-label="Novo registro"
            className={`${ACTION_SEGMENT} text-accent`}
          >
            <Plus className={ACTION_ICON} />
            <span className="lg:hidden">Registro</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={FILTER_PANEL_OFFSET}
          collisionPadding={FILTER_PANEL_COLLISION}
          className={`${FILTER_PANEL_CLASS} w-[300px]`}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--panel-div)] px-3.5 py-3">
            <span className="ds-eyebrow text-muted-foreground">Novo registro</span>
            <span className="text-[11px] font-semibold tabular-nums text-foreground/55">
              {Math.min(step, 3)} de 3
            </span>
          </div>
          <ol className="flex flex-col px-3.5 pb-0 pt-3.5">
            <Step
              n={1}
              active={step === 1}
              done={answered[0]}
              question={QUESTIONS[0]}
              answer={answers[0]}
              onReopen={() => setStep(1)}
            >
              <div role="radiogroup" className="flex gap-1.5">
                <Choice
                  icon={Home}
                  title="Imóvel"
                  sub="Sem hóspede, só o imóvel"
                  selected={link === "imovel"}
                  onClick={() => {
                    if (link !== "imovel") {
                      setReservationId(null);
                      if (link) setPropertyId(null);
                    }
                    setLink("imovel");
                    setSearch("");
                    setStep(2);
                  }}
                />
                <Choice
                  icon={CalendarCheck}
                  title="Reserva"
                  sub="Ligado a uma estadia"
                  selected={link === "reserva"}
                  onClick={() => {
                    if (link !== "reserva") {
                      setReservationId(null);
                      setPropertyId(null);
                    }
                    setLink("reserva");
                    setSearch("");
                    setStep(2);
                  }}
                />
              </div>
            </Step>
            <Step
              n={2}
              active={step === 2}
              done={answered[1]}
              question={question2}
              answer={answers[1]}
              onReopen={() => answered[0] && setStep(2)}
            >
              {link === "reserva" ? (
                <PickList
                  search={search}
                  onSearch={setSearch}
                  placeholder="Buscar hóspede ou imóvel…"
                  empty={
                    q.isLoading
                      ? "Carregando…"
                      : q.isError
                        ? "Não foi possível carregar as reservas."
                        : shownRes.length === 0
                          ? "Nenhuma reserva encontrada."
                          : null
                  }
                >
                  {shownRes.map((r, i) => (
                    <FilterOptionRow
                      key={r.id}
                      label={`${resLabel(r)} · ${propName(r.propertyId)}`}
                      selected={r.id === reservationId}
                      onClick={() => pickProperty(r.propertyId, r.id)}
                      last={i === shownRes.length - 1}
                    />
                  ))}
                </PickList>
              ) : (
                <PickList
                  search={search}
                  onSearch={setSearch}
                  placeholder="Buscar imóvel ou proprietário…"
                  empty={
                    q.isLoading
                      ? "Carregando…"
                      : q.isError
                        ? "Não foi possível carregar os imóveis."
                        : shownProps.length === 0
                          ? "Nenhum imóvel encontrado."
                          : null
                  }
                >
                  {shownProps.map((p, i) => (
                    <FilterOptionRow
                      key={p.id}
                      label={p.name}
                      selected={p.id === propertyId}
                      onClick={() => pickProperty(p.id, null)}
                      last={i === shownProps.length - 1}
                    />
                  ))}
                </PickList>
              )}
            </Step>
            <Step
              n={3}
              active={step === 3}
              done={answered[2]}
              last
              question={QUESTIONS[2]}
              answer={answers[2]}
              onReopen={() => answered[1] && setStep(3)}
            >
              <PickList empty={null}>
                {CATEGORIES.map((c, i) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setCategory(c.key)}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-foreground/[0.04]",
                      i < CATEGORIES.length - 1 && "border-b border-[var(--panel-div)]",
                      category === c.key && "bg-accent/[0.10]",
                    )}
                  >
                    <span className={cn("size-2 shrink-0 rounded-full", c.dot)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-foreground">
                        {c.label}
                      </span>
                      <span className="block truncate text-[10.5px] text-muted-foreground">
                        {c.hint}
                      </span>
                    </span>
                  </button>
                ))}
              </PickList>
            </Step>
          </ol>
          <div className="border-t border-[var(--panel-div)] px-3.5 py-3">
            <button
              type="button"
              disabled={!ready}
              onClick={() => {
                if (!property || !category) return;
                setSheet({ propertyId: property.id, reservationId, category });
                setOpen(false);
              }}
              className="ds-surface inline-flex h-8 w-full items-center justify-center gap-1.5 bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-2 text-[12px] font-bold text-white disabled:opacity-40"
            >
              <span className="truncate">Continuar</span>
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {sheet && (
        <RecordSituationSheet
          open
          onOpenChange={(v) => {
            if (!v) {
              setSheet(null);
              reset();
            }
          }}
          propertyId={sheet.propertyId}
          propertyLabel={sheetProperty?.name ?? "Imóvel"}
          owner={
            sheetProperty
              ? {
                  name: sheetProperty.ownerName,
                  phone: sheetProperty.ownerPhone,
                  country: sheetProperty.ownerPhoneCountry,
                }
              : null
          }
          contextLine={sheetReservation ? resLabel(sheetReservation) : null}
          target={sheet.reservationId ? { reservationId: sheet.reservationId } : {}}
          cardMode={null}
          category={sheet.category}
          initial={null}
          onSaved={() => {
            for (const k of ["account-records", "reservation-records", "dash-tasks"]) {
              void qc.invalidateQueries({ queryKey: [k] });
            }
          }}
        />
      )}
    </>
  );
}
