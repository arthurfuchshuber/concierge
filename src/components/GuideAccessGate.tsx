import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { recordGuideAccess } from "@/lib/guide-access.functions";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import PhoneInput, { isValidPhoneNumber, type Country } from "react-phone-number-input";
import "react-phone-number-input/style.css";

const STORAGE_PREFIX = "sg-access-";
// Re-ask only 36h after checkin date
const REASK_AFTER_CHECKIN_MS = 36 * 60 * 60 * 1000;

export type AccessRecord = {
  name: string;
  code: string | null;
  checkinDate: string; // YYYY-MM-DD
  phone: string | null;
  phoneCountry: string | null;
};

function isExpired(checkinDate: string): boolean {
  // expires 36h after the start of the checkin day (local time)
  const [y, m, d] = checkinDate.split("-").map(Number);
  if (!y || !m || !d) return true;
  const checkin = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  return Date.now() > checkin + REASK_AFTER_CHECKIN_MS;
}

export function readAccessRecord(slug: string): AccessRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + slug);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AccessRecord>;
    if (!parsed?.name || !parsed?.checkinDate) return null;
    if (isExpired(parsed.checkinDate)) {
      window.localStorage.removeItem(STORAGE_PREFIX + slug);
      return null;
    }
    return {
      name: parsed.name,
      code: parsed.code ?? null,
      checkinDate: parsed.checkinDate,
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
  const [date, setDate] = useState<Date | undefined>();
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
    if (!date) {
      toast.error("Selecione a data de check-in.");
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
    const checkinDate = format(date, "yyyy-MM-dd");
    setLoading(true);
    try {
      const res = await submit({
        data: {
          slug,
          guest_name: name.trim(),
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
      <DialogContent
        className="sm:max-w-sm p-5 gap-3 [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="space-y-0.5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">Acesso ao guia</p>
          <h2 className="font-serif text-lg leading-tight">{propertyName}</h2>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="guest-name" className="text-xs">Nome</Label>
            <Input
              id="guest-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
              autoFocus
              className="h-9 text-sm"
              placeholder="Como aparece na reserva"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Check-in</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn("w-full justify-start text-left font-normal h-9 text-sm", !date && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 size-3.5" />
                  {date ? format(date, "dd 'de' MMM yyyy", { locale: ptBR }) : "Selecionar data"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  initialFocus
                  locale={ptBR}
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1">
            <Label htmlFor="guest-phone" className="text-xs">Telefone</Label>
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
              />
            </div>
          </div>

          {requireReservationCode && (
            <div className="space-y-1">
              <Label htmlFor="reservation-code" className="text-xs">Código da reserva</Label>
              <Input
                id="reservation-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={100}
                required
                className="h-9 text-sm"
                placeholder="Ex.: HMABC123"
              />
            </div>
          )}

          <Button type="submit" disabled={loading} className="w-full rounded-full h-10 text-sm">
            {loading ? "Verificando…" : "Acessar guia"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
