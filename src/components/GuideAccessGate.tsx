import { useState, useEffect, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { recordGuideAccess } from "@/lib/guide-access.functions";
import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CalendarIcon,
  User2,
  Lock,
  ArrowRight,
  ChevronDown,
  Loader2,
  Clock,
  Car,
  FileText,
  Plus,
  X,
  Check,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { titleCaseName } from "@/lib/masks";

import PhoneInput, { isValidPhoneNumber, type Country } from "react-phone-number-input";
import "react-phone-number-input/style.css";

const STORAGE_PREFIX = "sg-access-";

export type AccessRecord = {
  name: string;
  code: string | null;
  checkinDate: string;
  checkoutDate: string;
  phone: string | null;
  phoneCountry: string | null;
};

function isExpired(checkoutDate: string): boolean {
  const [y, m, d] = checkoutDate.split("-").map(Number);
  if (!y || !m || !d) return true;
  const end = new Date(y, m - 1, d, 15, 0, 0, 0).getTime();
  return Date.now() > end;
}

export function readAccessRecord(slug: string): AccessRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + slug);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AccessRecord>;
    if (!parsed?.name || !parsed?.checkinDate || !parsed?.checkoutDate) return null;
    if (isExpired(parsed.checkoutDate)) {
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

export type CollectionConfig = {
  arrivalTime: "off" | "optional" | "required";
  vehicles: "off" | "optional" | "required";
  vehiclesMax: number;
  document: "off" | "optional" | "required";
  documentScope: "main" | "all";
};

type Vehicle = { plate: string; model: string; color: string };
type Doc = { guest_name: string; doc_number: string };

type Props = {
  slug: string;
  propertyName: string;
  requireReservationCode: boolean;
  collection?: CollectionConfig;
  onUnlock: (rec: AccessRecord) => void;
};

export function GuideAccessGate({ slug, propertyName, requireReservationCode, collection, onUnlock }: Props) {
  const submit = useServerFn(recordGuideAccess);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [range, setRange] = useState<{ from?: Date; to?: Date } | undefined>();
  const [phone, setPhone] = useState<string | undefined>();
  const [country, setCountry] = useState<Country>("BR");
  const [loading, setLoading] = useState(false);

  // Optional fields
  const cfg: CollectionConfig = collection ?? {
    arrivalTime: "off",
    vehicles: "off",
    vehiclesMax: 2,
    document: "off",
    documentScope: "main",
  };

  const [arrivalOpen, setArrivalOpen] = useState(cfg.arrivalTime === "required");
  const [arrivalTime, setArrivalTime] = useState("");

  const [vehiclesOpen, setVehiclesOpen] = useState(cfg.vehicles === "required");
  const [vehicleCount, setVehicleCount] = useState<number>(cfg.vehicles === "required" ? 1 : 0);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  const [docOpen, setDocOpen] = useState(cfg.document === "required");
  const [docCount, setDocCount] = useState<number>(cfg.document === "required" ? 1 : 0);
  const [docs, setDocs] = useState<Doc[]>([]);

  const chips = useMemo(() => {
    const list: Array<{ id: "arrival" | "vehicles" | "docs"; label: string; icon: React.ReactNode; open: boolean; visible: boolean; required: boolean }> = [];
    if (cfg.arrivalTime !== "off")
      list.push({ id: "arrival", label: "Horário previsto", icon: <Clock className="size-3.5" />, open: arrivalOpen, visible: true, required: cfg.arrivalTime === "required" });
    if (cfg.vehicles !== "off")
      list.push({ id: "vehicles", label: "Veículo(s)", icon: <Car className="size-3.5" />, open: vehiclesOpen, visible: true, required: cfg.vehicles === "required" });
    if (cfg.document !== "off")
      list.push({ id: "docs", label: "Documento", icon: <FileText className="size-3.5" />, open: docOpen, visible: true, required: cfg.document === "required" });
    return list;
  }, [cfg, arrivalOpen, vehiclesOpen, docOpen]);

  useEffect(() => {
    const existing = readAccessRecord(slug);
    if (existing) onUnlock(existing);
  }, [slug, onUnlock]);

  // sync vehicle rows with count
  useEffect(() => {
    setVehicles((prev) => {
      if (vehicleCount === prev.length) return prev;
      if (vehicleCount > prev.length) {
        return [...prev, ...Array.from({ length: vehicleCount - prev.length }, () => ({ plate: "", model: "", color: "" }))];
      }
      return prev.slice(0, vehicleCount);
    });
  }, [vehicleCount]);

  // sync doc rows with count
  useEffect(() => {
    setDocs((prev) => {
      if (docCount === prev.length) return prev;
      if (docCount > prev.length) {
        return [...prev, ...Array.from({ length: docCount - prev.length }, () => ({ guest_name: "", doc_number: "" }))];
      }
      return prev.slice(0, docCount);
    });
  }, [docCount]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim().length < 2) {
      toast.error("Informe seu nome completo.");
      return;
    }
    if (!range?.from || !range?.to) {
      toast.error("Selecione o período da viagem.");
      return;
    }
    if (!phone || !isValidPhoneNumber(phone)) {
      toast.error("Informe um telefone válido.");
      return;
    }
    if (requireReservationCode && !code.trim()) {
      toast.error("Informe o código da reserva.");
      return;
    }
    // Required optional fields
    if (cfg.arrivalTime === "required" && !arrivalTime.trim()) {
      toast.error("Informe o horário previsto de chegada.");
      return;
    }
    if (cfg.vehicles === "required" && vehicleCount === 0) {
      toast.error("Informe a quantidade de veículos.");
      return;
    }
    if (vehiclesOpen && vehicleCount > 0) {
      for (const v of vehicles) {
        if (!v.plate.trim() || !v.model.trim() || !v.color.trim()) {
          toast.error("Preencha placa, modelo e cor de cada veículo.");
          return;
        }
      }
    }
    if (cfg.document === "required" && docCount === 0) {
      toast.error("Informe o documento do hóspede.");
      return;
    }
    if (docOpen && docCount > 0) {
      for (const d of docs) {
        if (!d.guest_name.trim() || !d.doc_number.trim()) {
          toast.error("Preencha nome e documento de cada hóspede.");
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
          guest_name: titleCaseName(name),
          reservation_code: requireReservationCode ? code.trim() : null,
          checkin_date: checkinDate,
          guest_phone: phone,
          guest_phone_country: country,
          guest_arrival_time: arrivalOpen && arrivalTime.trim() ? arrivalTime.trim() : null,
          guest_vehicles:
            vehiclesOpen && vehicles.length > 0
              ? vehicles.map((v) => ({ plate: v.plate.trim(), model: v.model.trim(), color: v.color.trim() }))
              : null,
          guest_documents:
            docOpen && docs.length > 0
              ? docs.map((d) => ({ guest_name: d.guest_name.trim(), doc_number: d.doc_number.trim() }))
              : null,
        },
      });
      if (!res.ok) {
        toast.error("Não foi possível registrar seu acesso.");
        return;
      }
      const rec: AccessRecord = {
        name: name.trim(),
        code: requireReservationCode ? code.trim() : null,
        checkinDate,
        checkoutDate,
        phone,
        phoneCountry: country,
      };
      window.localStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify(rec));
      onUnlock(rec);
    } catch {
      toast.error("Erro ao registrar acesso. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  function toggleChip(id: "arrival" | "vehicles" | "docs") {
    if (id === "arrival") {
      if (cfg.arrivalTime === "required") return;
      setArrivalOpen((v) => !v);
      if (arrivalOpen) setArrivalTime("");
    } else if (id === "vehicles") {
      if (cfg.vehicles === "required") return;
      setVehiclesOpen((v) => !v);
      if (vehiclesOpen) setVehicleCount(0);
    } else {
      if (cfg.document === "required") return;
      setDocOpen((v) => !v);
      if (docOpen) setDocCount(0);
    }
  }

  return (
    <Dialog open modal>
      <DialogPortal>
        <DialogOverlay className="bg-black/70 backdrop-blur-md data-[state=open]:duration-300 data-[state=closed]:duration-200" />
        <DialogPrimitive.Content
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-1.25rem)] max-w-[440px]",
            "-translate-x-1/2 -translate-y-1/2",
            "max-h-[92vh] overflow-y-auto",
            "rounded-[26px] border border-white/[0.09]",
            // glass editorial
            "bg-[color-mix(in_oklab,hsl(var(--background))_78%,transparent)]",
            "backdrop-blur-2xl backdrop-saturate-150",
            "shadow-[0_28px_70px_-18px_rgba(0,0,0,0.65),0_0_0_1px_rgba(255,255,255,0.05)_inset]",
            "p-6 sm:p-7",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=open]:duration-300",
            "focus:outline-none",
          )}
        >
          {/* Header */}
          <div className="mb-5 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-primary/85">
              Boas-vindas
            </p>
            <DialogPrimitive.Title className="font-serif text-[24px] leading-[1.1] tracking-tight">
              {propertyName}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-[13px] leading-relaxed text-muted-foreground">
              Rápido preenchimento para liberar o guia.
            </DialogPrimitive.Description>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <FieldShell icon={<User2 className="size-[17px]" />}>
              <Label htmlFor="guest-name" className="sr-only">Nome</Label>
              <Input
                id="guest-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                required
                className="h-[48px] rounded-[12px] pl-10 pr-3 text-[14.5px] bg-transparent border-transparent focus-visible:ring-0 focus-visible:border-transparent"
                placeholder="Nome como aparece na reserva"
              />
            </FieldShell>

            {/* Range in two segments */}
            <div className="grid grid-cols-2 gap-2">
              <RangeButton
                label="Chegada"
                value={range?.from ? format(range.from, "dd MMM", { locale: ptBR }) : "—"}
                popover={
                  <Calendar
                    mode="range"
                    selected={range as never}
                    onSelect={(r) => setRange(r as { from?: Date; to?: Date } | undefined)}
                    numberOfMonths={1}
                    initialFocus
                    locale={ptBR}
                    disabled={(date) => {
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      return date < today;
                    }}
                    className="p-3 pointer-events-auto"
                  />
                }
              />
              <RangeButton
                label="Saída"
                value={range?.to ? format(range.to, "dd MMM", { locale: ptBR }) : "—"}
                popover={
                  <Calendar
                    mode="range"
                    selected={range as never}
                    onSelect={(r) => setRange(r as { from?: Date; to?: Date } | undefined)}
                    numberOfMonths={1}
                    initialFocus
                    locale={ptBR}
                    disabled={(date) => {
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      return date < today;
                    }}
                    className="p-3 pointer-events-auto"
                  />
                }
              />
            </div>

            {/* Phone */}
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

            {requireReservationCode && (
              <FieldShell>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={100}
                  required
                  className="h-[48px] rounded-[12px] px-3 text-[14.5px] bg-transparent border-transparent focus-visible:ring-0"
                  placeholder="Código da reserva"
                />
              </FieldShell>
            )}

            {/* Chips opcionais */}
            {chips.length > 0 && (
              <div>
                <div className="flex flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleChip(c.id)}
                      disabled={c.required}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-medium transition-all",
                        "border",
                        c.open
                          ? "bg-primary/12 border-primary/30 text-primary"
                          : "bg-white/[0.03] border-white/[0.08] text-muted-foreground hover:text-foreground hover:border-white/20",
                        c.required && "cursor-default opacity-95",
                      )}
                    >
                      {c.open ? <Check className="size-3" /> : <Plus className="size-3" />}
                      {c.icon}
                      {c.label}
                      {c.required && <span className="text-[9px] uppercase tracking-wider text-primary/70 ml-0.5">obrig.</span>}
                    </button>
                  ))}
                </div>

                {/* Arrival */}
                {arrivalOpen && (
                  <ExpandBlock>
                    <label className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Horário previsto de chegada</label>
                    <Input
                      type="time"
                      value={arrivalTime}
                      onChange={(e) => setArrivalTime(e.target.value)}
                      className="h-10 rounded-[10px] mt-1.5 bg-transparent"
                    />
                  </ExpandBlock>
                )}

                {/* Vehicles */}
                {vehiclesOpen && (
                  <ExpandBlock>
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Veículo(s)</label>
                      <div className="flex items-center gap-1">
                        <span className="text-[10.5px] text-muted-foreground mr-1">Qtde</span>
                        {Array.from({ length: cfg.vehiclesMax + 1 }, (_, i) => i).map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setVehicleCount(n)}
                            className={cn(
                              "size-7 rounded-full text-[11px] font-semibold border transition-colors",
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
                      <div key={i} className="mt-2.5 rounded-xl border border-white/10 p-2.5 space-y-1.5 bg-white/[0.02]">
                        <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground/80 font-semibold">Veículo {i + 1}</div>
                        <Input
                          value={v.plate}
                          onChange={(e) => setVehicles((arr) => arr.map((x, j) => (j === i ? { ...x, plate: e.target.value.toUpperCase() } : x)))}
                          placeholder="Placa"
                          className="h-9 rounded-[10px] bg-transparent uppercase"
                          maxLength={10}
                        />
                        <div className="grid grid-cols-2 gap-1.5">
                          <Input
                            value={v.model}
                            onChange={(e) => setVehicles((arr) => arr.map((x, j) => (j === i ? { ...x, model: e.target.value } : x)))}
                            placeholder="Modelo"
                            className="h-9 rounded-[10px] bg-transparent"
                          />
                          <Input
                            value={v.color}
                            onChange={(e) => setVehicles((arr) => arr.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))}
                            placeholder="Cor"
                            className="h-9 rounded-[10px] bg-transparent"
                          />
                        </div>
                      </div>
                    ))}
                  </ExpandBlock>
                )}

                {/* Documents */}
                {docOpen && (
                  <ExpandBlock>
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
                        Documento{cfg.documentScope === "all" ? " (todos os hóspedes)" : " (hóspede principal)"}
                      </label>
                      {cfg.documentScope === "all" && (
                        <div className="flex items-center gap-1">
                          <span className="text-[10.5px] text-muted-foreground mr-1">Qtde</span>
                          {[1, 2, 3, 4, 5, 6].map((n) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setDocCount(n)}
                              className={cn(
                                "size-7 rounded-full text-[11px] font-semibold border transition-colors",
                                docCount === n
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "border-white/10 text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {cfg.documentScope === "main" && docCount === 0 && (
                      <button
                        type="button"
                        onClick={() => setDocCount(1)}
                        className="mt-2 text-[12px] text-primary hover:underline"
                      >
                        Adicionar documento do hóspede principal
                      </button>
                    )}
                    {docs.map((d, i) => (
                      <div key={i} className="mt-2.5 rounded-xl border border-white/10 p-2.5 space-y-1.5 bg-white/[0.02]">
                        <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground/80 font-semibold">Hóspede {i + 1}</div>
                        <Input
                          value={d.guest_name}
                          onChange={(e) => setDocs((arr) => arr.map((x, j) => (j === i ? { ...x, guest_name: e.target.value } : x)))}
                          placeholder="Nome completo"
                          className="h-9 rounded-[10px] bg-transparent"
                        />
                        <Input
                          value={d.doc_number}
                          onChange={(e) => setDocs((arr) => arr.map((x, j) => (j === i ? { ...x, doc_number: e.target.value } : x)))}
                          placeholder="CPF ou documento"
                          className="h-9 rounded-[10px] bg-transparent"
                        />
                      </div>
                    ))}
                  </ExpandBlock>
                )}
              </div>
            )}

            <div className="flex items-center gap-1.5 pt-0.5 text-[11.5px] text-muted-foreground/85">
              <Lock className="size-3 text-primary/70" />
              <span>Seus dados ficam seguros e privados.</span>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className={cn(
                "group relative w-full h-[52px] rounded-full text-[14.5px] font-semibold",
                "bg-gradient-to-b from-primary to-[color-mix(in_oklab,hsl(var(--primary))_86%,#000)]",
                "text-primary-foreground",
                "shadow-[0_10px_28px_-8px_color-mix(in_oklab,hsl(var(--primary))_55%,transparent),0_1px_0_0_rgba(255,255,255,0.25)_inset]",
                "transition-all duration-200 hover:translate-y-[-1px]",
                "active:translate-y-0 active:scale-[0.99]",
                "disabled:opacity-80 disabled:cursor-wait",
              )}
            >
              <span className="inline-flex items-center justify-center gap-2">
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Verificando…
                  </>
                ) : (
                  <>
                    Acessar guia
                    <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </>
                )}
              </span>
            </Button>
          </form>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

function FieldShell({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative rounded-[12px] border border-white/10 bg-white/[0.03] transition-colors focus-within:border-primary/50 focus-within:bg-white/[0.05]">
      {icon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-primary/80">{icon}</span>
      )}
      {children}
    </div>
  );
}

function RangeButton({ label, value, popover }: { label: string; value: string; popover: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative w-full h-[54px] rounded-[12px] border border-white/10 bg-white/[0.03] px-3 text-left",
            "transition-all hover:bg-white/[0.06] focus:outline-none focus-visible:border-primary/50",
            "flex flex-col justify-center",
          )}
        >
          <span className="text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground/85 font-semibold">{label}</span>
          <span className="text-[14px] font-medium flex items-center gap-1.5 mt-0.5">
            <CalendarIcon className="size-3.5 text-primary/70" />
            {value}
            <ChevronDown className="size-3 text-muted-foreground ml-auto" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 rounded-2xl" align="start">
        {popover}
      </PopoverContent>
    </Popover>
  );
}

function ExpandBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-[14px] border border-primary/15 bg-primary/[0.04] p-3 animate-in fade-in-0 slide-in-from-top-1 duration-200">
      {children}
    </div>
  );
}
