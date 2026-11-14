import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarCheck, Home, Plus } from "lucide-react";
import { CoverImage } from "@/components/ui/cover-image";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { ACTION_ICON, ACTION_SEGMENT } from "@/components/dashboard/panel-chrome";
import {
  Choice,
  PickList,
  PropertyPickRow,
  PropertySummary,
  SelectAllRow,
  guestShort,
  Step,
  TrailDialog,
  ddmm,
  norm,
} from "@/components/dashboard/TrailParts";
import { RecordSituationSheet } from "@/components/dashboard/RecordSituationSheet";
import { CATEGORIES } from "@/components/dashboard/record-categories";
import { getNewRecordOptions, type RecordCategory } from "@/lib/reservation-records.functions";
import { markDialogHandoff } from "@/lib/global-overlay-store";
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

/** Com vários imóveis só valem as categorias que podem repetir (regra de 13/11/2026). */
const MULTI_CATEGORIES: RecordCategory[] = ["maintenance", "cleaning_audit"];

type Link = "imovel" | "reserva";

export function NewRecordButton() {
  const ownerId = useImpersonation().impersonation?.userId ?? null;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [link, setLink] = useState<Link | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  /** Imóveis marcados (só no vínculo "Imóvel"; mais de um = uma situação para cada). */
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [category, setCategory] = useState<RecordCategory | null>(null);
  const [search, setSearch] = useState("");
  const [sheet, setSheet] = useState<{
    propertyId: string;
    propertyIds: string[];
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
    setPropertyIds([]);
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
    () => {
      // Check-out do MAIS RECENTE para o MAIS ANTIGO, com ou sem busca (23/10/2026).
      const sorted = [...reservations].sort((x, y) =>
        String(y.checkout ?? y.checkin).localeCompare(String(x.checkout ?? x.checkin)),
      );
      return sq
        ? sorted.filter((r) =>
            norm(`${r.label} ${properties.find((p) => p.id === r.propertyId)?.name ?? ""}`).includes(sq),
          )
        : sorted;
    },
    [reservations, properties, sq],
  );

  const multiSel = link === "imovel" ? properties.filter((p) => propertyIds.includes(p.id)) : [];
  const many = multiSel.length > 1;
  const step2Done = link === "reserva" ? !!reservation : step > 2 && multiSel.length > 0;
  const answered = [!!link, step2Done, !!category];
  const answers = [
    link === "imovel" ? "Imóvel" : link === "reserva" ? "Reserva" : undefined,
    link === "reserva" ? (reservation ? resLabel(reservation) : undefined) : multiSel[0]?.name,
    category ? CATEGORIES.find((c) => c.key === category)?.label : undefined,
  ];
  const ownersLabel = (() => {
    const names = Array.from(new Set(multiSel.map((p) => p.ownerName).filter((n): n is string => !!n)));
    if (names.length === 0) return null;
    return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  })();
  const firstOwner = multiSel.find((p) => p.ownerName);
  /** Resposta estruturada do passo 2 (mockup 0m): uma informação por linha. */
  const step2Summary =
    link === "reserva" && reservation ? (
      <PropertySummary
        name={propName(reservation.propertyId)}
        guest={guestShort(reservation.label)}
        period={`${ddmm(reservation.checkin)} → ${ddmm(reservation.checkout)}`}
        ownerName={property?.ownerName}
        ownerPhone={property?.ownerPhone}
        ownerPhoneCountry={property?.ownerPhoneCountry}
      />
    ) : link === "imovel" && many ? (
      <span className="grid min-w-0 gap-[5px]">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex shrink-0 -space-x-2.5">
            {multiSel.slice(0, 3).map((p) => (
              <span
                key={p.id}
                className="relative size-6 overflow-hidden rounded-full bg-foreground/[0.08] ring-2 ring-[var(--panel)]"
              >
                <CoverImage urls={[p.photoUrl]} />
              </span>
            ))}
          </span>
          <span className="min-w-0 truncate text-[13px] font-bold leading-snug text-foreground">
            {multiSel.length} imóveis
          </span>
        </span>
        {ownersLabel ? (
          <span className="flex min-w-0 items-center gap-[5px] text-[11.5px] leading-[1.35] text-muted-foreground">
            <span className="min-w-0 truncate">{ownersLabel}</span>
            <span className="-my-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              <PhoneActionButton phone={firstOwner?.ownerPhone} country={firstOwner?.ownerPhoneCountry} size={13} alwaysShow />
            </span>
          </span>
        ) : null}
      </span>
    ) : link === "imovel" && multiSel.length === 1 ? (
      <PropertySummary
        showMaps
        name={multiSel[0].name}
        ownerName={multiSel[0].ownerName}
        ownerPhone={multiSel[0].ownerPhone}
        ownerPhoneCountry={multiSel[0].ownerPhoneCountry}
        address={multiSel[0].address}
        mapsUrl={multiSel[0].mapsUrl}
        garageMapsUrl={multiSel[0].garageMapsUrl}
      />
    ) : undefined;
  const question2 =
    link === "reserva"
      ? "Qual reserva?"
      : link === "imovel"
        ? step > 2 && many
          ? "Quais imóveis?"
          : step > 2
            ? "Qual imóvel?"
            : "Qual imóvel? (um ou mais)"
        : QUESTIONS[1];
  const ready = answered.every(Boolean) && step === 3;
  const categories = many ? CATEGORIES.filter((c) => MULTI_CATEGORIES.includes(c.key)) : CATEGORIES;
  const toggleProp = (id: string) =>
    setPropertyIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const allShownOn = shownProps.length > 0 && shownProps.every((p) => propertyIds.includes(p.id));
  const toggleAll = () =>
    setPropertyIds((cur) =>
      allShownOn
        ? cur.filter((id) => !shownProps.some((p) => p.id === id))
        : Array.from(new Set([...cur, ...shownProps.map((p) => p.id)])),
    );

  const pickProperty = (id: string, resId: string | null) => {
    setPropertyId(id);
    setPropertyIds([id]);
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
      <button
        type="button"
        title="Novo registro"
        aria-label="Novo registro"
        onClick={() => setOpen(true)}
        className={`${ACTION_SEGMENT} text-accent`}
      >
        <Plus className={ACTION_ICON} />
        <span className="lg:hidden">Registro</span>
      </button>
      <TrailDialog
        open={open}
        onOpenChange={setOpen}
        title="Novo registro"
        /* Mockups atuais (e1–e3): o cabeçalho não mostra mais o contador "X de 3". */
        progress=""
        onBack={step > 1 ? () => setStep(step - 1) : undefined}
        footer={
            <button
              type="button"
              disabled={step === 2 && link === "imovel" ? multiSel.length === 0 : !ready}
              onClick={() => {
                if (step === 2 && link === "imovel") {
                  setSearch("");
                  // Categoria já escolhida que não vale para vários imóveis sai da seleção.
                  if (multiSel.length > 1 && category && !MULTI_CATEGORIES.includes(category)) setCategory(null);
                  setStep(3);
                  return;
                }
                const ids = link === "imovel" ? multiSel.map((p) => p.id) : property ? [property.id] : [];
                if (ids.length === 0 || !category) return;
                markDialogHandoff();
                setSheet({ propertyId: ids[0], propertyIds: ids, reservationId, category });
                setOpen(false);
              }}
              className="ds-surface inline-flex h-10 w-full items-center justify-center gap-1.5 bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-2 text-[13px] font-bold text-white disabled:opacity-40"
            >
              <span className="truncate">
                {step === 2 && link === "imovel" && multiSel.length > 0
                  ? `Continuar · ${multiSel.length} ${multiSel.length === 1 ? "imóvel" : "imóveis"}`
                  : "Continuar"}
              </span>
            </button>
        }
      >
          <ol className="flex flex-col">
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
                  sub="Apenas ligado ao imóvel."
                  selected={link === "imovel"}
                  onClick={() => {
                    if (link !== "imovel") {
                      setReservationId(null);
                      if (link) setPropertyId(null);
                      setPropertyIds([]);
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
                      setPropertyIds([]);
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
              bleed
              active={step === 2}
              done={answered[1]}
              question={question2}
              answer={answers[1]}
              answerNode={step2Summary}
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
                  {shownRes.map((r, i) => {
                    const p = properties.find((x) => x.id === r.propertyId);
                    return (
                      <PropertyPickRow
                        key={r.id}
                        name={propName(r.propertyId)}
                        photoUrl={p?.photoUrl}
                        ownerName={p?.ownerName}
                        ownerPhone={p?.ownerPhone}
                        ownerPhoneCountry={p?.ownerPhoneCountry}
                        hideMaps
                        lines={[
                          {
                            icon: "user",
                            text: guestShort(r.label),
                            suffix: `${ddmm(r.checkin)} → ${ddmm(r.checkout)}`,
                          },
                        ]}
                        selected={r.id === reservationId}
                        onClick={() => pickProperty(r.propertyId, r.id)}
                        last={i === shownRes.length - 1}
                      />
                    );
                  })}
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
                  <SelectAllRow
                    selected={shownProps.filter((p) => propertyIds.includes(p.id)).length}
                    total={shownProps.length}
                    onToggle={toggleAll}
                  />
                  {shownProps.map((p, i) => (
                    <PropertyPickRow
                      key={p.id}
                      name={p.name}
                      photoUrl={p.photoUrl}
                      ownerName={p.ownerName}
                      ownerPhone={p.ownerPhone}
                      ownerPhoneCountry={p.ownerPhoneCountry}
                      city={p.city}
                      address={p.address}
                      mapsUrl={p.mapsUrl}
                      garageMapsUrl={p.garageMapsUrl}
                      multi
                      selected={propertyIds.includes(p.id)}
                      onClick={() => toggleProp(p.id)}
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
                {categories.map((c, i) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setCategory(c.key)}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-foreground/[0.04]",
                      i < categories.length - 1 && "border-b border-[var(--panel-div)]",
                      category === c.key && "bg-accent/[0.10]",
                    )}
                  >
                    <span className={cn("size-2 shrink-0 rounded-full", c.dot)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-foreground">
                        {many && c.key === "cleaning_audit" ? "Auditoria" : c.label}
                      </span>
                      <span className="block truncate text-[10.5px] text-muted-foreground">
                        {c.hint}
                      </span>
                    </span>
                  </button>
                ))}
              </PickList>
              {many ? (
                <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
                  Com vários imóveis, só Manutenção e Auditoria.
                </p>
              ) : null}
            </Step>
          </ol>
      </TrailDialog>

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
          extraProperties={sheet.propertyIds
            .slice(1)
            .map((id) => properties.find((p) => p.id === id))
            .filter((p): p is NonNullable<typeof p> => !!p)
            .map((p) => ({
              id: p.id,
              name: p.name,
              photoUrl: p.photoUrl,
              owner: { name: p.ownerName, phone: p.ownerPhone, country: p.ownerPhoneCountry },
            }))}
          propertyPhotoUrl={sheetProperty?.photoUrl ?? null}
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
