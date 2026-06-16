import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { recordGuideAccess } from "@/lib/guide-access.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Lock } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STORAGE_PREFIX = "sg-access-";

export type AccessRecord = {
  name: string;
  code: string;
  checkinDate: string; // YYYY-MM-DD
};

export function readAccessRecord(slug: string): AccessRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + slug);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AccessRecord;
    if (!parsed?.name || !parsed?.code || !parsed?.checkinDate) return null;
    return parsed;
  } catch {
    return null;
  }
}

type Props = {
  slug: string;
  propertyName: string;
  onUnlock: (rec: AccessRecord) => void;
};

export function GuideAccessGate({ slug, propertyName, onUnlock }: Props) {
  const submit = useServerFn(recordGuideAccess);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [date, setDate] = useState<Date | undefined>();
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
    if (!code.trim()) {
      toast.error("Informe o código da reserva.");
      return;
    }
    if (!date) {
      toast.error("Selecione a data de check-in.");
      return;
    }
    const checkinDate = format(date, "yyyy-MM-dd");
    setLoading(true);
    try {
      const res = await submit({
        data: {
          slug,
          guest_name: name.trim(),
          reservation_code: code.trim(),
          checkin_date: checkinDate,
        },
      });
      if (!res.ok) {
        toast.error("Não foi possível registrar seu acesso.");
        return;
      }
      const rec: AccessRecord = { name: name.trim(), code: code.trim(), checkinDate };
      sessionStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify(rec));
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
        className="sm:max-w-md [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="mx-auto mb-2 size-12 rounded-full bg-accent/15 text-accent grid place-items-center">
            <Lock className="size-5" strokeWidth={1.75} />
          </div>
          <DialogTitle className="text-center font-serif text-2xl">{propertyName}</DialogTitle>
          <DialogDescription className="text-center">
            Para acessar seu guia, confirme alguns dados da sua reserva.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="guest-name">Nome completo</Label>
            <Input
              id="guest-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
              autoFocus
              placeholder="Como aparece na reserva"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reservation-code">Código da reserva</Label>
            <Input
              id="reservation-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={100}
              required
              placeholder="Ex.: HMABC123"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Data de check-in</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 size-4" />
                  {date ? format(date, "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : "Selecionar data"}
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
          <Button type="submit" disabled={loading} className="w-full rounded-full h-11">
            {loading ? "Verificando…" : "Acessar guia"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
