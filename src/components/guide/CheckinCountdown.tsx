import { useEffect, useState } from "react";
import { Clock, CheckCircle2 } from "lucide-react";

function parseTime(t: string | null | undefined): { h: number; m: number } | null {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

export function CheckinCountdown({
  checkinTime,
  theme,
}: {
  checkinTime: string | null | undefined;
  theme: "dark" | "light";
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const parsed = parseTime(checkinTime);
  if (!parsed) return null;

  const target = new Date(now);
  target.setHours(parsed.h, parsed.m, 0, 0);
  const diffMs = target.getTime() - now.getTime();

  // Só mostra dentro de uma janela útil (do início do dia até o horário)
  const startOfWindow = new Date(now);
  startOfWindow.setHours(0, 0, 0, 0);
  if (now < startOfWindow || now > target) {
    if (diffMs < 0 && Math.abs(diffMs) < 3 * 60 * 60 * 1000) {
      // liberado há menos de 3h
      return (
        <div className="mx-5 md:mx-10 lg:mx-16 mb-3 md:mb-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 flex items-center gap-2.5">
          <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
          <p className="text-[12.5px] text-foreground/85 font-medium">
            Check-in liberado —{" "}
            <span className="text-emerald-500 font-semibold">pode chegar quando quiser</span>
          </p>
        </div>
      );
    }
    return null;
  }

  const totalMin = Math.max(1, Math.floor(diffMs / 60_000));
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  const label = hours > 0 ? `${hours}h${String(minutes).padStart(2, "0")}` : `${minutes}min`;

  // Progresso: usa janela das 00h até target
  const totalWindow = target.getTime() - startOfWindow.getTime();
  const progressed = now.getTime() - startOfWindow.getTime();
  const pct = Math.max(4, Math.min(100, (progressed / totalWindow) * 100));

  const isDark = theme === "dark";
  const targetLabel = `${String(parsed.h).padStart(2, "0")}:${String(parsed.m).padStart(2, "0")}`;

  return (
    <div
      className={`mx-5 md:mx-10 lg:mx-16 mb-3 md:mb-4 rounded-2xl border px-4 py-3 relative z-10 ${
        isDark ? "border-border/60 bg-card/40" : "border-border/70 bg-card/70"
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[12px] text-foreground/75 inline-flex items-center gap-1.5">
          <Clock className="size-3.5 text-accent" />
          check-in libera em{" "}
          <strong className="text-accent font-semibold tabular-nums">{label}</strong>
        </p>
        <span className="text-[10.5px] text-foreground/45 tabular-nums">{targetLabel}</span>
      </div>
      <div className="h-1 rounded-full bg-foreground/10 overflow-hidden">
        <div
          className="h-full bg-accent transition-[width] duration-1000 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
