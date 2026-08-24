import { useState, useEffect, useMemo, useRef } from "react";
import { zonedTimeToUtc } from "@/lib/property-timezone";
import { useServerFn } from "@tanstack/react-start";
import { recordGuideAccess, checkReservationBySlug, getGuideCalendarAvailability } from "@/lib/guide-access.functions";
import { BottomNav } from "@/components/guide/BottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CalendarIcon,
  User2,
  Lock,
  ArrowRight,
  ArrowLeft,
  ChevronDown,
  Loader2,
  Clock,
  Car,
  FileText,
  Camera,
  Paperclip,
  CheckCircle2,
  AlertTriangle,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { todayInTZ } from "@/lib/property-timezone";
import { titleCaseName } from "@/lib/masks";

import PhoneInput, { isValidPhoneNumber, type Country } from "react-phone-number-input";
import "react-phone-number-input/style.css";

const STORAGE_PREFIX = "sg-access-";

// Lista de horários de 15 em 15 minutos (00:00 até 23:45) para o dropdown de
// "previsão de chegada" — evita digitação livre e horários inválidos.
const ARRIVAL_TIME_OPTIONS: string[] = Array.from({ length: 24 * 4 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});
const TOUR_PENDING_PREFIX = "sg-tour-pending-";

/**
 * Checa (sem apagar) se o onboarding pós-formulário desta reserva ainda está
 * pendente. Diferente do antigo "consome e apaga na hora": aqui a flag
 * SOBREVIVE a um refresh no meio do onboarding — o hóspede não consegue
 * escapar pra página principal atualizando a tela enquanto não passar por
 * todas as etapas. Só quem apaga a flag é `clearPendingOnboarding`, chamada
 * quando o hóspede realmente termina (qualquer um dos botões finais).
 */
export function hasPendingOnboarding(slug: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(TOUR_PENDING_PREFIX + slug) === "1";
}

export function clearPendingOnboarding(slug: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOUR_PENDING_PREFIX + slug);
}

export type AccessRecord = {
  name: string;
  code: string | null;
  checkinDate: string;
  checkoutDate: string;
  phone: string | null;
  phoneCountry: string | null;
};

type CalendarPeriod = { checkin: string; checkout: string; type: "reservation" | "block" };

/**
 * O acesso vale até as 15h do dia de checkout no fuso do imóvel. Quando o fuso
 * não é conhecido, damos 12h de tolerância para não expulsar um hóspede que
 * está navegando de outro fuso.
 */
function isExpired(checkoutDate: string, timeZone?: string | null): boolean {
  const [y, m, d] = checkoutDate.split("-").map(Number);
  if (!y || !m || !d) return true;
  const end = timeZone
    ? zonedTimeToUtc(y, m, d, 15, 0, timeZone).getTime()
    : Date.UTC(y, m - 1, d, 15, 0, 0, 0) + 12 * 3_600_000;
  return Date.now() > end;
}

export function readAccessRecord(slug: string, timeZone?: string | null): AccessRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + slug);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AccessRecord>;
    if (!parsed?.name || !parsed?.checkinDate || !parsed?.checkoutDate) return null;
    if (isExpired(parsed.checkoutDate, timeZone)) {
      window.localStorage.removeItem(STORAGE_PREFIX + slug);
      return null;
    }
    return {
      name: parsed.name,
      code: parsed.code ?? null,
      checkinDate: parsed.checkinDate,
      checkoutDate: parsed.checkoutDate,
      phone: parsed.phone ?? null,
      phoneCountry: parsed.phoneCountry ?? null,
    };
  } catch {
    return null;
  }
}

/** Remove o registro salvo — usado quando o hóspede volta pro formulário
 * a partir do onboarding (senão o gate reabre e destrava na hora). */
export function clearAccessRecord(slug: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + slug);
  } catch {
    /* noop */
  }
}

export type CollectionConfig = {
  arrivalTime: "off" | "optional" | "required";
  vehicles: "off" | "optional" | "required";
  vehiclesMax: number;
  document: "off" | "optional" | "required";
  documentScope: "main" | "all";
};

type Vehicle = { plate: string; model: string; color: string };
type UploadedDoc = {
  guest_name: string;
  file_path: string | null;
  file_name: string | null;
  legible: boolean | null;
  reason: string;
  uploading: boolean;
};

type Props = {
  slug: string;
  propertyId: string;
  propertyName: string;
  requireReservationCode: boolean;
  /** Guia do tipo "Check-In & Check-Out": exige o código da reserva do
   * Airbnb, validado ao vivo, e preenche o período automaticamente. */
  reservationCodeGate?: boolean;

  collection?: CollectionConfig;
  onUnlock: (rec: AccessRecord) => void;
  theme?: "dark" | "light";
  /** Itens do menu inferior real do guia — mostrado em tela cheia por trás
   * do formulário, com "Chegada" travado (o hóspede não navega pra outra
   * aba antes de se identificar). */
  navItems?: Array<{ key: import("./guide/BottomNav").BottomNavKey; label: string }>;
  /** Dados já informados anteriormente (ex.: hóspede voltou do onboarding). */
  prefill?: AccessRecord | null;
};

function dateFromISODate(value: string): Date | null {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function GuideAccessGate({
  slug,
  propertyId,
  propertyName,
  requireReservationCode,
  reservationCodeGate = false,
  collection,
  onUnlock,
  theme = "dark",
  timeZone = "America/Sao_Paulo",
  navItems = [],
  prefill = null,
  minArrivalTime = null,
}: Props & { timeZone?: string; minArrivalTime?: string | null }) {
  const themeClass = cn("sigma-public-guide", theme === "light" && "theme-light");

  const submit = useServerFn(recordGuideAccess);
  const checkReservation = useServerFn(checkReservationBySlug);
  const loadAvailability = useServerFn(getGuideCalendarAvailability);
  const validateCode = useServerFn(validateGuideReservationCode);
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(prefill?.name ?? "");
  const [code, setCode] = useState(prefill?.code ?? "");
  const [codeCheck, setCodeCheck] = useState<
    | { state: "idle" }
    | { state: "checking" }
    | { state: "valid"; checkin: string; checkout: string }
    | { state: "invalid"; reason: string }
  >({ state: "idle" });

  const [range, setRange] = useState<{ from?: Date; to?: Date } | undefined>(() => {
    const from = prefill?.checkinDate ? dateFromISODate(prefill.checkinDate) : null;
    const to = prefill?.checkoutDate ? dateFromISODate(prefill.checkoutDate) : null;
    return from || to ? { from: from ?? undefined, to: to ?? undefined } : undefined;
  });
  const [phone, setPhone] = useState<string | undefined>(prefill?.phone ?? undefined);
  const [country, setCountry] = useState<Country>((prefill?.phoneCountry as Country) ?? "BR");

  const [loading, setLoading] = useState(false);
  const [resCheck, setResCheck] = useState<
    | { state: "idle" }
    | { state: "checking" }
    | { state: "matched"; matchType?: "reservation" | "block" }
    | { state: "no-ical" }
    | { state: "no-match"; suggestedCheckout?: string }
  >({ state: "idle" });
  const [calendarAvailability, setCalendarAvailability] = useState<
    { state: "loading" } | { state: "ready"; hasIcal: boolean; periods: CalendarPeriod[] } | { state: "unavailable" }
  >({ state: "loading" });

  const cfg: CollectionConfig = collection ?? {
    arrivalTime: "off",
    vehicles: "off",
    vehiclesMax: 2,
    document: "off",
    documentScope: "main",
  };

  const hasOptionals = cfg.arrivalTime !== "off" || cfg.vehicles !== "off" || cfg.document !== "off";

  // Step 2 state — perguntas progressivas
  const [arrivalAns, setArrivalAns] = useState<"yes" | "no" | null>(null);
  const [arrivalTime, setArrivalTime] = useState({ h: "", m: "" });

  const [vehicleAns, setVehicleAns] = useState<"yes" | "no" | null>(null);
  const [vehicleCount, setVehicleCount] = useState<number>(0);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  const [docCount, setDocCount] = useState<number>(0);
  const [docs, setDocs] = useState<UploadedDoc[]>([]);

  useEffect(() => {
    const existing = readAccessRecord(slug);
    if (existing) onUnlock(existing);
  }, [slug, onUnlock]);

  useEffect(() => {
    let cancelled = false;
    setCalendarAvailability({ state: "loading" });
    loadAvailability({ data: { slug, property_id: propertyId } })
      .then((r) => {
        if (cancelled) return;
        setCalendarAvailability({ state: "ready", hasIcal: r.hasIcal, periods: r.periods });
      })
      .catch(() => {
        if (!cancelled) setCalendarAvailability({ state: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [slug, propertyId, loadAvailability]);

  // Map every real reservation check-in date → its check-out date. Blocks,
  // checkout dates and intermediate dates are ignored on purpose: the guest
  // chooses only the arrival day, and the iCal pair fills the departure.
  const reservationMap = useMemo(() => {
    const map = new Map<string, string>();
    if (calendarAvailability.state !== "ready" || !calendarAvailability.hasIcal) return map;
    for (const p of calendarAvailability.periods) {
      if (p.type !== "reservation") continue;
      if (p.checkout <= p.checkin) continue;
      map.set(p.checkin, p.checkout);
    }
    return map;
  }, [calendarAvailability]);

  // Only the check-in dates of real reservations are selectable. The paired
  // check-out is filled automatically by handleRangeSelect, so exposing
  // check-out days here would let guests pick a day that isn't a real arrival.
  const selectableDateSet = useMemo(() => {
    if (calendarAvailability.state !== "ready" || !calendarAvailability.hasIcal) return null;
    const set = new Set<string>();
    for (const checkin of reservationMap.keys()) set.add(checkin);
    return set;
  }, [calendarAvailability, reservationMap]);

  const availableCheckinDates = useMemo(() => {
    const dates: Date[] = [];
    for (const checkin of reservationMap.keys()) {
      const date = dateFromISODate(checkin);
      if (date) dates.push(date);
    }
    return dates;
  }, [reservationMap]);

  const isDateDisabled = (date: Date): boolean => {
    if (selectableDateSet) return !selectableDateSet.has(format(date, "yyyy-MM-dd"));
    // "Hoje" é o dia do imóvel (fuso da cidade), não o do aparelho do hóspede.
    return format(date, "yyyy-MM-dd") < todayInTZ(timeZone);
  };

  // Auto-pair check-out when the user picks a known reservation check-in.
  const [checkinPopoverOpen, setCheckinPopoverOpen] = useState(false);
  const handleCheckinSelect = (selected: Date | undefined) => {
    if (!selected) {
      setRange(undefined);
      return;
    }
    const key = format(selected, "yyyy-MM-dd");
    const pairedCheckout = reservationMap.get(key);
    const checkoutDate = pairedCheckout ? dateFromISODate(pairedCheckout) : null;
    if (checkoutDate) {
      setRange({ from: selected, to: checkoutDate });
    } else {
      setRange({ from: selected });
    }
    setCheckinPopoverOpen(false);
  };

  // Cross-check with Airbnb iCal reservations (soft warning)
  useEffect(() => {
    if (!range?.from || !range?.to) {
      setResCheck({ state: "idle" });
      return;
    }
    const checkin = format(range.from, "yyyy-MM-dd");
    const checkout = format(range.to, "yyyy-MM-dd");
    let cancelled = false;
    setResCheck({ state: "checking" });
    const t = setTimeout(() => {
      checkReservation({ data: { slug, property_id: propertyId, checkin_date: checkin, checkout_date: checkout } })
        .then((r) => {
          if (cancelled) return;
          if (!r.hasIcal) return setResCheck({ state: "no-ical" });
          if (r.matched)
            return setResCheck({ state: "matched", matchType: "matchType" in r ? r.matchType : "reservation" });
          setResCheck({
            state: "no-match",
            suggestedCheckout: "suggestedCheckout" in r ? r.suggestedCheckout : undefined,
          });
        })
        .catch(() => {
          if (!cancelled) setResCheck({ state: "idle" });
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [range?.from, range?.to, slug, propertyId, checkReservation]);

  // sync vehicle rows with count
  useEffect(() => {
    setVehicles((prev) => {
      if (vehicleCount === prev.length) return prev;
      if (vehicleCount > prev.length) {
        return [
          ...prev,
          ...Array.from({ length: vehicleCount - prev.length }, () => ({ plate: "", model: "", color: "" })),
        ];
      }
      return prev.slice(0, vehicleCount);
    });
  }, [vehicleCount]);

  // sync doc rows with count
  useEffect(() => {
    setDocs((prev) => {
      if (docCount === prev.length) return prev;
      if (docCount > prev.length) {
        return [
          ...prev,
          ...Array.from({ length: docCount - prev.length }, () => ({
            guest_name: "",
            file_path: null,
            file_name: null,
            legible: null,
            reason: "",
            uploading: false,
          })),
        ];
      }
      return prev.slice(0, docCount);
    });
  }, [docCount]);

  function validateStep1(): boolean {
    if (!name.trim() || name.trim().length < 2) {
      toast.error("Informe seu nome completo.");
      return false;
    }
    if (!range?.from || !range?.to) {
      toast.error("Selecione o período da viagem.");
      return false;
    }
    if (!phone || !isValidPhoneNumber(phone)) {
      toast.error("Informe um telefone válido.");
      return false;
    }
    if (resCheck.state === "checking") {
      toast.error("Aguarde a validação das datas com a reserva do Airbnb.");
      return false;
    }
    if (resCheck.state === "no-match") {
      toast.error("As datas informadas não correspondem a uma reserva do Airbnb. Confira e ajuste.");
      return false;
    }
    return true;
  }

  async function finalizeSubmit() {
    if (!range?.from || !range?.to) return;
    if (resCheck.state === "checking") {
      toast.error("Aguarde a validação das datas com a reserva do Airbnb.");
      return;
    }
    if (resCheck.state === "no-match") {
      toast.error("As datas informadas não correspondem a uma reserva do Airbnb. Volte e ajuste.");
      return;
    }

    // Required optional fields
    const arrivalStr =
      arrivalAns === "yes" && arrivalTime.h
        ? `${arrivalTime.h.padStart(2, "0")}:${(arrivalTime.m || "00").padStart(2, "0")}`
        : "";
    if (cfg.arrivalTime === "required" && !arrivalStr) {
      toast.error("Informe o horário previsto de chegada.");
      return;
    }
    if (cfg.vehicles === "required" && (vehicleAns !== "yes" || vehicleCount === 0)) {
      toast.error("Informe os dados do(s) veículo(s).");
      return;
    }
    if (vehicleAns === "yes" && vehicleCount > 0) {
      for (const v of vehicles) {
        if (!v.plate.trim() || !v.model.trim() || !v.color.trim()) {
          toast.error("Preencha placa, modelo e cor de cada veículo.");
          return;
        }
      }
    }
    if (cfg.document === "required" && docCount === 0) {
      toast.error("Anexe o(s) documento(s) do(s) hóspede(s).");
      return;
    }
    if (docs.some((d) => d.uploading)) {
      toast.error("Aguarde o upload dos documentos terminar.");
      return;
    }
    if (docCount > 0) {
      for (const d of docs) {
        if (!d.file_path) {
          toast.error("Anexe uma foto ou arquivo para cada hóspede.");
          return;
        }
      }
    }

    const checkinDate = format(range.from, "yyyy-MM-dd");
    const checkoutDate = format(range.to, "yyyy-MM-dd");
    setLoading(true);
    try {
      const res = await submit({
        data: {
          slug,
          property_id: propertyId,
          guest_name: titleCaseName(name),
          reservation_code: requireReservationCode && code.trim() ? code.trim() : null,
          checkin_date: checkinDate,
          checkout_date: checkoutDate,

          guest_phone: phone,
          guest_phone_country: country,
          guest_arrival_time: arrivalStr || null,
          guest_vehicles:
            vehicleAns === "yes" && vehicles.length > 0
              ? vehicles.map((v) => ({ plate: v.plate.trim(), model: v.model.trim(), color: v.color.trim() }))
              : null,
          guest_documents:
            docCount > 0 && docs.length > 0
              ? docs.map((d, i) => ({
                  guest_name: d.guest_name.trim() || (i === 0 ? titleCaseName(name) : `Hóspede ${i + 1}`),
                  file_path: d.file_path,
                  file_name: d.file_name,
                  legible: d.legible,
                }))
              : null,
        },
      });
      if (!res.ok) {
        toast.error(
          "reason" in res && res.reason === "no_match"
            ? "As datas não correspondem ao calendário do anfitrião."
            : "Não foi possível registrar seu acesso.",
        );
        return;
      }
      const rec: AccessRecord = {
        name: name.trim(),
        code: requireReservationCode && code.trim() ? code.trim() : null,
        checkinDate,
        checkoutDate,
        phone: phone ?? null,
        phoneCountry: country,
      };
      window.localStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify(rec));
      // Marca que esta é uma submissão nova de verdade (não uma visita de
      // retorno lendo o registro já salvo) — quem consome isso é o tour de
      // primeiro acesso na página do guia, que só deve aparecer uma vez por
      // reserva (telefone+nome+data+imóvel já identificam essa reserva aqui).
      window.localStorage.setItem(TOUR_PENDING_PREFIX + slug, "1");
      onUnlock(rec);
    } catch {
      toast.error("Erro ao registrar acesso. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  function handleStep1Next(e: React.FormEvent) {
    e.preventDefault();
    if (!validateStep1()) return;
    if (hasOptionals) {
      setStep(2);
    } else {
      void finalizeSubmit();
    }
  }

  const reservationBanner =
    resCheck.state === "matched" ? (
      <div className="flex items-center justify-center gap-2 rounded-[14px] border border-emerald-500/35 bg-emerald-500/[0.08] px-3.5 py-3 text-center text-[13px] font-medium text-emerald-400">
        <span aria-hidden>✓</span>
        <span>Reserva Airbnb encontrada para estas datas.</span>
      </div>

    ) : resCheck.state === "no-match" ? (
      <div className="flex items-start gap-2 rounded-[14px] border border-amber-500/35 bg-amber-500/[0.08] px-3.5 py-3 text-[12.5px] text-amber-300">
        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
        <span>
          Não encontramos uma reserva Airbnb para estas datas.
          {resCheck.suggestedCheckout && (
            <>
              {" "}
              Sua chegada bate com uma reserva, mas a saída é{" "}
              <b>
                {new Date(resCheck.suggestedCheckout + "T12:00:00").toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "short",
                })}
              </b>
              . Confira se digitou corretamente.
            </>
          )}
          {!resCheck.suggestedCheckout &&
            " Confira se selecionou exatamente a entrada e saída liberadas no calendário."}
        </span>
      </div>
    ) : null;

  return (
    <div
      className={cn(themeClass, "fixed inset-0 z-50 bg-background overflow-y-auto")}
      role="region"
      aria-label="Identificação do hóspede"
    >
      <div className="mx-auto flex w-full max-w-[490px] md:max-w-[520px] min-h-[100dvh] items-center px-5 pt-6 pb-[110px]">
        <div
          className={cn(
            "w-full rounded-[22px] border border-[#a855f7]/25",
            "bg-card/95 text-card-foreground",
            "backdrop-blur-2xl backdrop-saturate-150",
            "shadow-[0_28px_70px_-18px_rgba(0,0,0,0.65),0_0_60px_-20px_rgba(232,45,174,0.3)]",
            "p-5 sm:p-5.5",
          )}
        >
          {/* Progress dots (só quando há step 2) */}
          {hasOptionals && (
            <div className="mb-4 flex items-center gap-1.5">
              <span
                className={cn(
                  "h-1 rounded-full transition-all",
                  step === 1 ? "w-6 bg-gradient-to-r from-[#7C1AD8] to-[#E82DAE]" : "w-3 bg-[#a855f7]/25",
                )}
              />
              <span
                className={cn(
                  "h-1 rounded-full transition-all",
                  step === 2 ? "w-6 bg-gradient-to-r from-[#7C1AD8] to-[#E82DAE]" : "w-3 bg-[#a855f7]/25",
                )}
              />
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Passo {step}/2
              </span>
            </div>
          )}

          {step === 1 ? (
            <>
              <div className="mb-4 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#c084fc]">Boas-vindas</p>
                <h2 className="text-[21px] font-bold leading-[1.14] tracking-tight text-foreground">{propertyName}</h2>

                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  Rápido preenchimento para liberar o guia.
                </p>
              </div>

              <form onSubmit={handleStep1Next} className="space-y-2.5">
                <FieldShell icon={<span className="text-[15px] leading-none">👤</span>}>
                  <Label htmlFor="guest-name" className="sr-only">
                    Nome
                  </Label>
                  <Input
                    id="guest-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={200}
                    required
                    className="h-[46px] rounded-[12px] pl-10 pr-3 text-[14px] font-medium bg-transparent border-transparent focus-visible:ring-0 focus-visible:border-transparent"
                    placeholder="Nome como aparece na reserva"
                  />
                </FieldShell>

                <div className="grid grid-cols-2 gap-2.5">
                  <RangeButton
                    themeClass={themeClass}
                    label="Chegada"
                    open={checkinPopoverOpen}
                    onOpenChange={setCheckinPopoverOpen}
                    emoji="📅"
                    value={range?.from ? format(range.from, "dd MMM", { locale: ptBR }) : "—"}
                    popover={
                      <Calendar
                        mode="single"
                        selected={range?.from}
                        onSelect={handleCheckinSelect}
                        numberOfMonths={1}
                        initialFocus
                        locale={ptBR}
                        disabled={isDateDisabled}
                        modifiers={{ availableCheckin: availableCheckinDates }}
                        modifiersClassNames={{ availableCheckin: "guide-available-checkin" }}
                        classNames={{
                          today: "rdp-today",
                          disabled: "rdp-disabled text-neutral-400",
                          outside: "rdp-outside text-neutral-300",
                        }}
                        className="guide-access-calendar p-3 pointer-events-auto"
                      />
                    }
                  />
                  <RangeButton
                    label="Saída"
                    value={range?.to ? format(range.to, "dd MMM", { locale: ptBR }) : "—"}
                    locked
                  />
                </div>

                <div className="sg-phone-input">
                  <PhoneInput
                    id="guest-phone"
                    international
                    defaultCountry="BR"
                    countryCallingCodeEditable={false}
                    value={phone}
                    onChange={(v) => setPhone(v)}
                    onCountryChange={(c) => c && setCountry(c)}
                    limitMaxLength
                    placeholder="Telefone"
                  />
                </div>

                {reservationBanner}


                <div className="pt-1">
                  <PrimaryButton loading={loading}>{hasOptionals ? "Continuar →" : "Acessar guia →"}</PrimaryButton>
                </div>

                <div className="flex items-center justify-center gap-1.5 pt-0.5 text-[11.5px] text-muted-foreground/85">
                  <span aria-hidden className="text-[12px] leading-none">
                    🔒
                  </span>
                  <span>Seus dados ficam seguros e privados.</span>
                </div>


              </form>
            </>
          ) : (
            <Step2
              cfg={cfg}
              slug={slug}
              minArrivalTime={minArrivalTime}
              defaultName={titleCaseName(name)}
              arrivalAns={arrivalAns}
              setArrivalAns={setArrivalAns}
              arrivalTime={arrivalTime}
              setArrivalTime={setArrivalTime}
              vehicleAns={vehicleAns}
              setVehicleAns={setVehicleAns}
              vehicleCount={vehicleCount}
              setVehicleCount={setVehicleCount}
              vehicles={vehicles}
              setVehicles={setVehicles}
              docCount={docCount}
              setDocCount={setDocCount}
              docs={docs}
              setDocs={setDocs}
              loading={loading}
              onBack={() => setStep(1)}
              onSubmit={finalizeSubmit}
            />
          )}
        </div>
      </div>
      <BottomNav theme={theme} active="checkin" items={navItems} onSelect={() => {}} lockedTo="checkin" />
    </div>
  );
}

/* ---------- Step 2 ---------- */

function Step2(props: {
  cfg: CollectionConfig;
  slug: string;
  /** Horário mínimo de check-in do imóvel — a previsão de chegada nunca
   * pode ser anterior a ele. */
  minArrivalTime?: string | null;
  defaultName: string;
  arrivalAns: "yes" | "no" | null;
  setArrivalAns: (v: "yes" | "no" | null) => void;
  arrivalTime: { h: string; m: string };
  setArrivalTime: (v: { h: string; m: string }) => void;
  vehicleAns: "yes" | "no" | null;
  setVehicleAns: (v: "yes" | "no" | null) => void;
  vehicleCount: number;
  setVehicleCount: (n: number) => void;
  vehicles: Vehicle[];
  setVehicles: React.Dispatch<React.SetStateAction<Vehicle[]>>;
  docCount: number;
  setDocCount: (n: number) => void;
  docs: UploadedDoc[];
  setDocs: React.Dispatch<React.SetStateAction<UploadedDoc[]>>;
  loading: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const {
    cfg,
    slug,
    defaultName,
    minArrivalTime,
    arrivalAns,
    setArrivalAns,
    arrivalTime,
    setArrivalTime,
    vehicleAns,
    setVehicleAns,
    vehicleCount,
    setVehicleCount,
    vehicles,
    setVehicles,
    docCount,
    setDocCount,
    docs,
    setDocs,
    loading,
    onBack,
    onSubmit,
  } = props;

  // Piso da previsão de chegada = horário mínimo de check-in do imóvel.
  const minParsed = String(minArrivalTime ?? "").match(/^(\d{1,2}):(\d{2})/);
  const minH = minParsed ? Number(minParsed[1]) : 0;
  const minM = minParsed ? Number(minParsed[2]) : 0;
  const hourOptions = Array.from({ length: 24 - minH }, (_, i) => String(minH + i).padStart(2, "0"));
  const selectedH = arrivalTime.h ? Number(arrivalTime.h) : minH;
  const minuteOptions = ["00", "15", "30", "45"].filter((m) => selectedH > minH || Number(m) >= minM);

  return (
    <>
      <div className="mb-4 space-y-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#c084fc]">Últimos detalhes</p>
        <h2 className="text-[21px] font-bold leading-[1.14] tracking-tight text-foreground">
          Só mais algumas perguntas
        </h2>

        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Isso ajuda o anfitrião a preparar sua chegada.
        </p>
      </div>

      <div className="space-y-2.5">
        {/* Arrival */}
        {cfg.arrivalTime !== "off" && (
          <QuestionBlock
            icon="🕐"
            title="Possui previsão de chegada?"
            required={cfg.arrivalTime === "required"}
            answer={arrivalAns}
            onAnswer={(v) => {
              setArrivalAns(v);
              if (v === "no") setArrivalTime({ h: "", m: "" });
            }}
          >
            {arrivalAns === "yes" && (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-bold whitespace-nowrap">
                  Por volta de
                </label>
                <div className="flex items-center gap-1.5">
                  <Select
                    value={arrivalTime.h ? arrivalTime.h.padStart(2, "0") : undefined}
                    onValueChange={(h) => {
                      const nextM =
                        Number(h) === minH && Number(arrivalTime.m || "0") < minM
                          ? String(minM).padStart(2, "0")
                          : (arrivalTime.m || "00").padStart(2, "0");
                      setArrivalTime({ h, m: nextM });
                    }}
                  >
                    <SelectTrigger className="h-9 w-[54px] justify-center rounded-[10px] border-border bg-foreground/[0.04] text-[14px] font-bold [&>svg]:hidden">
                      <SelectValue placeholder="hh" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[280px] min-w-[70px]">
                      {hourOptions.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-[14px] font-bold text-muted-foreground">:</span>
                  <Select
                    value={arrivalTime.m ? arrivalTime.m.padStart(2, "0") : undefined}
                    onValueChange={(m) => setArrivalTime({ h: arrivalTime.h || String(minH).padStart(2, "0"), m })}
                  >
                    <SelectTrigger className="h-9 w-[54px] justify-center rounded-[10px] border-border bg-foreground/[0.04] text-[14px] font-bold [&>svg]:hidden">
                      <SelectValue placeholder="mm" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[280px] min-w-[70px]">
                      {minuteOptions.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </QuestionBlock>
        )}

        {/* Vehicles */}
        {cfg.vehicles !== "off" && (
          <QuestionBlock
            icon="🚗"
            title="Você virá de veículo?"
            required={cfg.vehicles === "required"}
            answer={vehicleAns}
            onAnswer={(v) => {
              setVehicleAns(v);
              if (v === "no") setVehicleCount(0);
              if (v === "yes" && vehicleCount === 0) setVehicleCount(1);
            }}
          >
            {vehicleAns === "yes" && (
              <div className="mt-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold whitespace-nowrap">
                    Quantos veículos?
                  </label>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: cfg.vehiclesMax }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setVehicleCount(n)}
                        className={cn(
                          "size-8 rounded-full text-[12px] font-semibold border transition-colors",
                          vehicleCount === n
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-white/10 text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                {vehicles.map((v, i) => (
                  <div key={i} className="rounded-xl border border-white/10 p-2.5 space-y-1.5 bg-white/[0.02]">
                    <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground/80 font-semibold whitespace-nowrap">
                      Veículo {i + 1}
                    </div>
                    <Input
                      value={v.plate}
                      onChange={(e) =>
                        setVehicles((arr) =>
                          arr.map((x, j) => (j === i ? { ...x, plate: e.target.value.toUpperCase() } : x)),
                        )
                      }
                      placeholder="Placa"
                      className="h-9 rounded-[10px] bg-transparent uppercase"
                      maxLength={10}
                    />
                    <div className="grid grid-cols-2 gap-1.5">
                      <Input
                        value={v.model}
                        onChange={(e) =>
                          setVehicles((arr) => arr.map((x, j) => (j === i ? { ...x, model: e.target.value } : x)))
                        }
                        placeholder="Modelo"
                        className="h-9 rounded-[10px] bg-transparent"
                      />
                      <Input
                        value={v.color}
                        onChange={(e) =>
                          setVehicles((arr) => arr.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))
                        }
                        placeholder="Cor"
                        className="h-9 rounded-[10px] bg-transparent"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </QuestionBlock>
        )}

        {/* Documents */}
        {cfg.document !== "off" && (
          <QuestionBlock
            icon="📄"
            title={cfg.documentScope === "all" ? "Anexar documento(s) pessoal(is)" : "Anexar documento pessoal"}
            required={cfg.document === "required"}
            asToggle
            answer={
              docCount > 0
                ? "yes"
                : cfg.document === "required"
                  ? null
                  : docCount === 0 && cfg.document === "optional"
                    ? null
                    : null
            }
            onAnswer={(v) => {
              if (v === "yes") setDocCount(Math.max(1, docCount || 1));
              else setDocCount(0);
            }}
          >
            {docCount > 0 && (
              <div className="mt-3 space-y-2.5">
                {cfg.documentScope === "all" && (
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold whitespace-nowrap">
                      Quantos hóspedes?
                    </label>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5, 6].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setDocCount(n)}
                          className={cn(
                            "size-8 rounded-full text-[12px] font-semibold border transition-colors",
                            docCount === n
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-white/10 text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {docs.map((d, i) => (
                  <DocUploadCard
                    key={i}
                    slug={slug}
                    index={i}
                    total={docCount}
                    defaultName={i === 0 ? defaultName : ""}
                    doc={d}
                    onUpdate={(patch) => setDocs((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
                  />
                ))}
              </div>
            )}
          </QuestionBlock>
        )}
      </div>

      <div className="flex items-center gap-2 pt-4">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          className="h-10 rounded-full border-0 px-3.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5 mr-1" /> Voltar
        </Button>
        <div className="flex-1">
          <PrimaryButton loading={loading} onClick={onSubmit}>
            {loading ? "Verificando…" : "Concluir cadastro →"}
          </PrimaryButton>
        </div>
      </div>
    </>
  );
}

/* ---------- Sub-components ---------- */

function QuestionBlock({
  icon,
  title,
  required,
  answer,
  onAnswer,
  children,
  asToggle,
}: {
  icon: React.ReactNode;
  title: string;
  required: boolean;
  answer: "yes" | "no" | null;
  onAnswer: (v: "yes" | "no") => void;
  children?: React.ReactNode;
  asToggle?: boolean;
}) {
  return (
    <div className="rounded-[16px] border border-border p-3.5 transition-colors">
      <div className="flex items-start gap-2 mb-3">
        <span aria-hidden className="text-[14px] leading-[1.25] shrink-0">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-bold leading-snug text-foreground text-pretty">{title}</div>
          {required && <div className="text-[9.5px] uppercase tracking-wider text-[#c084fc]/70 mt-0.5">Obrigatório</div>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onAnswer("yes")}
          className={cn(
            "flex-1 h-[42px] rounded-[12px] text-[13.5px] font-bold border transition-all",
            answer === "yes"
              ? "bg-gradient-to-r from-[#7C1AD8] to-[#E82DAE] text-white border-transparent"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          Sim
        </button>
        <button
          type="button"
          onClick={() => onAnswer("no")}
          className={cn(
            "flex-1 h-[42px] rounded-[12px] text-[13.5px] font-medium border transition-all",
            answer === "no"
              ? "bg-foreground/[0.1] text-foreground border-border"
              : "border-border text-muted-foreground hover:text-foreground",
            required && "opacity-40 cursor-not-allowed",
          )}
          disabled={required}
        >
          Não
        </button>
      </div>
      {children}
    </div>
  );
}

function DocUploadCard({
  slug,
  index,
  total,
  defaultName,
  doc,
  onUpdate,
}: {
  slug: string;
  index: number;
  total: number;
  defaultName: string;
  doc: UploadedDoc;
  onUpdate: (patch: Partial<UploadedDoc>) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(file: File | null) {
    if (!file) return;
    onUpdate({ uploading: true, file_path: null, file_name: file.name, legible: null, reason: "" });
    try {
      const fd = new FormData();
      fd.append("slug", slug);
      fd.append("file", file);
      const res = await fetch("/api/public/guest-doc-upload", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j?.error === "file_too_large" ? "Arquivo muito grande (máx 12MB)." : "Falha ao enviar o arquivo.");
        onUpdate({ uploading: false });
        return;
      }
      const json = (await res.json()) as {
        path: string;
        name: string | null;
        legible: boolean;
        reason: string;
      };
      onUpdate({
        uploading: false,
        file_path: json.path,
        file_name: json.name ?? file.name,
        legible: json.legible,
        reason: json.reason,
      });
    } catch {
      toast.error("Erro no envio. Tente novamente.");
      onUpdate({ uploading: false });
    }
  }

  return (
    <div className="rounded-xl border border-white/10 p-2.5 bg-white/[0.02]">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground/80 font-semibold whitespace-nowrap">
          Hóspede {index + 1}
          {index === 0 ? " · principal" : ""}
        </div>
        {total > 1 && (
          <div className="text-[10px] text-muted-foreground">
            {index + 1}/{total}
          </div>
        )}
      </div>
      <Input
        value={doc.guest_name}
        onChange={(e) => onUpdate({ guest_name: e.target.value })}
        placeholder={defaultName || "Nome do hóspede"}
        className="h-9 rounded-[10px] bg-transparent mb-2"
      />

      {!doc.file_path && !doc.uploading && (
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="h-10 rounded-[10px] border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] text-[12px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            <Camera className="size-3.5" /> Tirar foto
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="h-10 rounded-[10px] border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] text-[12px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            <Paperclip className="size-3.5" /> Anexar
          </button>
        </div>
      )}

      {doc.uploading && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground py-2 px-1">
          <Loader2 className="size-3.5 animate-spin" /> Analisando legibilidade…
        </div>
      )}

      {doc.file_path && !doc.uploading && (
        <div
          className={cn(
            "rounded-[10px] p-2 flex items-start gap-2 border",
            doc.legible === false ? "border-amber-500/40 bg-amber-500/10" : "border-emerald-500/30 bg-emerald-500/10",
          )}
        >
          {doc.legible === false ? (
            <AlertTriangle className="size-4 text-amber-400 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="size-4 text-emerald-400 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium truncate">
              {doc.legible === false ? "Legibilidade baixa" : "Documento anexado"}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              {doc.reason || doc.file_name || "Arquivo enviado com sucesso."}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onUpdate({ file_path: null, file_name: null, legible: null, reason: "" })}
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Remover"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

function FieldShell({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative rounded-[12px] border border-border bg-foreground/[0.04] transition-colors focus-within:border-[#a855f7]/60 focus-within:bg-foreground/[0.06]">
      {icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-accent">{icon}</span>}
      {children}
    </div>
  );
}

function RangeButton({
  label,
  value,
  popover,
  locked = false,
  themeClass,
  open,
  onOpenChange,
  emoji,
}: {
  label: string;
  value: string;
  popover?: React.ReactNode;
  locked?: boolean;
  themeClass?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  emoji?: string;
}) {
  const filled = value !== "—";
  const button = (
    <button
      type="button"
      disabled={locked}
      className={cn(
        "relative w-full h-[52px] rounded-[12px] border bg-foreground/[0.04] px-3 text-left text-foreground",
        "transition-colors hover:bg-foreground/[0.06] focus:outline-none",
        "flex flex-col justify-center disabled:cursor-default disabled:hover:bg-foreground/[0.04]",
        !locked && (open || filled) ? "border-[#a855f7]/70" : "border-border focus-visible:border-[#a855f7]/60",
      )}
    >
      <span className="text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground font-semibold whitespace-nowrap">
        {label}
      </span>
      <span className="text-[14.5px] font-bold flex items-center gap-1.5 mt-0.5 text-foreground">
        {value}
        {emoji && filled && (
          <span aria-hidden className="text-[12px] leading-none">
            {emoji}
          </span>
        )}
      </span>
    </button>
  );

  if (locked || !popover) return button;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent
        className={cn(
          themeClass,
          "w-auto p-0 rounded-2xl border-0 text-neutral-900",
          "bg-[rgba(248,250,252,0.96)] backdrop-blur-2xl backdrop-saturate-150",
          "shadow-[0_0_0_1px_rgba(232,45,174,0.35),0_18px_50px_-12px_rgba(124,26,216,0.55),0_0_60px_-10px_rgba(232,45,174,0.45)]",
        )}
        align="start"
      >
        {popover}
      </PopoverContent>
    </Popover>
  );
}

function PrimaryButton({
  loading,
  onClick,
  children,
}: {
  loading: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type={onClick ? "button" : "submit"}
      onClick={onClick}
      disabled={loading}
      className={cn(
        "group relative w-full h-[44px] rounded-full text-[13.5px] font-semibold text-white border-0",
        "bg-gradient-to-r from-[#7C1AD8] to-[#E82DAE] hover:brightness-110",
        "shadow-[0_10px_30px_-8px_rgba(232,45,174,0.55)]",
        "transition-all duration-200 hover:translate-y-[-1px]",
        "active:translate-y-0 active:scale-[0.99]",
        "disabled:opacity-80 disabled:cursor-wait",
      )}
    >
      <span className="inline-flex items-center justify-center gap-2">
        {loading ? <Loader2 className="size-4 animate-spin" /> : null}
        {children}
      </span>
    </Button>
  );
}
