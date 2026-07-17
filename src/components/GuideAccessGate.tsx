import { useState, useEffect } from "react";
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
  ShieldCheck,
  Compass,
  MessageCircle,
  ChevronDown,
  Loader2,
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
  // Acesso expira no dia do check-out às 15h00 (horário local).
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


type Props = {
  slug: string;
  propertyName: string;
  requireReservationCode: boolean;
  onUnlock: (rec: AccessRecord) => void;
};

export function GuideAccessGate({ slug, propertyName, requireReservationCode, onUnlock }: Props) {
  const submit = useServerFn(recordGuideAccess);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [range, setRange] = useState<{ from?: Date; to?: Date } | undefined>();
  const [phone, setPhone] = useState<string | undefined>();
  const [country, setCountry] = useState<Country>("BR");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const existing = readAccessRecord(slug);
    if (existing) onUnlock(existing);
  }, [slug, onUnlock]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim().length < 2) {
      toast.error("Informe seu nome completo.");
      return;
    }
    if (!range?.from || !range?.to) {
      toast.error("Selecione o período da viagem (check-in e check-out).");
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


  return (
    <Dialog open modal>
      <DialogPortal>
        <DialogOverlay className="bg-black/55 backdrop-blur-md data-[state=open]:duration-300 data-[state=closed]:duration-200" />
        <DialogPrimitive.Content
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-1.5rem)] max-w-[440px]",
            "-translate-x-1/2 -translate-y-1/2",
            "rounded-[28px] border border-white/[0.08]",
            "bg-background text-foreground",
            "shadow-[0_24px_60px_-12px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.04)_inset]",
            "p-7 sm:p-8",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 data-[state=open]:zoom-in-[0.98] data-[state=open]:duration-300",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-2 data-[state=closed]:duration-200",
            "focus:outline-none",
          )}
        >
          {/* Header */}
          <div className="mb-7 space-y-2">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-primary">
              Acesso ao guia
            </p>
            <DialogPrimitive.Title className="font-serif text-[26px] leading-[1.1] tracking-tight">
              {propertyName}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-[14px] leading-relaxed text-muted-foreground pt-1">
              Informe seus dados para personalizar sua experiência durante a hospedagem.
            </DialogPrimitive.Description>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="guest-name" className="text-[13px] font-medium">
                Nome
              </Label>
              <div className="relative">
                <User2 className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-primary/80" />
                <Input
                  id="guest-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                  required
                  className="h-[52px] rounded-[14px] pl-11 pr-4 text-[15px] bg-background/40 border-input/80 focus-visible:ring-4 focus-visible:ring-ring/15 focus-visible:border-ring transition-all"
                  placeholder="Como aparece na reserva"
                />
              </div>
            </div>

            {/* Período da viagem */}
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Período da viagem</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "relative w-full h-[52px] rounded-[14px] border border-input/80 bg-background/40",
                      "flex items-center pl-11 pr-11 text-left text-[15px]",
                      "transition-all hover:bg-background/60 focus:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 focus-visible:border-ring",
                      !range?.from && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-primary/80" />
                    <span className="truncate">
                      {range?.from && range?.to
                        ? `${format(range.from, "dd MMM", { locale: ptBR })} — ${format(range.to, "dd MMM yyyy", { locale: ptBR })}`
                        : range?.from
                          ? `${format(range.from, "dd MMM yyyy", { locale: ptBR })} — selecione o check-out`
                          : "Selecionar check-in e check-out"}
                    </span>
                    <ChevronDown className="absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 rounded-2xl" align="start">
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

                </PopoverContent>
              </Popover>
            </div>


            {/* Phone */}
            <div className="space-y-2">
              <Label htmlFor="guest-phone" className="text-[13px] font-medium">
                Telefone
              </Label>
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
                  placeholder="(11) 98765-4321"
                />
              </div>
            </div>

            {requireReservationCode && (
              <div className="space-y-2">
                <Label htmlFor="reservation-code" className="text-[13px] font-medium">
                  Código da reserva
                </Label>
                <Input
                  id="reservation-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={100}
                  required
                  className="h-[52px] rounded-[14px] px-4 text-[15px] bg-background/40 border-input/80 focus-visible:ring-4 focus-visible:ring-ring/15 focus-visible:border-ring transition-all"
                  placeholder="Ex.: HMABC123"
                />
              </div>
            )}

            {/* Security note */}
            <div className="flex items-center gap-2 pt-1 text-[12.5px] text-muted-foreground/90">
              <Lock className="size-3.5 text-primary/70" />
              <span>Seus dados estão seguros e não serão compartilhados.</span>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              disabled={loading}
              className={cn(
                "group relative w-full h-[56px] rounded-full text-[15px] font-semibold",
                "bg-gradient-to-b from-primary to-[color-mix(in_oklab,hsl(var(--primary))_88%,#000)]",
                "text-primary-foreground",
                "shadow-[0_10px_28px_-8px_color-mix(in_oklab,hsl(var(--primary))_55%,transparent),0_1px_0_0_rgba(255,255,255,0.25)_inset]",
                "transition-all duration-200 hover:translate-y-[-1px] hover:shadow-[0_16px_36px_-10px_color-mix(in_oklab,hsl(var(--primary))_65%,transparent),0_1px_0_0_rgba(255,255,255,0.3)_inset]",
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

          {/* Trust badges */}
          <div className="mt-6 pt-5 border-t border-white/[0.06] grid grid-cols-3 gap-3">
            <TrustItem icon={<ShieldCheck className="size-4" />} label="Check-out até 11h" />
            <TrustItem icon={<Compass className="size-4" />} label="Dicas e atrações selecionadas" />
            <TrustItem icon={<MessageCircle className="size-4" />} label="Suporte rápido durante a estadia" />
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

function TrustItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className="text-primary/80">{icon}</span>
      <span className="text-[11px] leading-snug text-muted-foreground">{label}</span>
    </div>
  );
}
