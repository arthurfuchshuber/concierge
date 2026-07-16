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

  const startOfWindow = new Date(now);
  startOfWindow.setHours(0, 0, 0, 0);
  const isLight = theme === "light";

  if (now < startOfWindow || now > target) {
    if (diffMs < 0 && Math.abs(diffMs) < 3 * 60 * 60 * 1000) {
      return (
        <div
          className={`mx-4 md:mx-10 lg:mx-16 mb-2.5 rounded-[12px] border px-3.5 py-2.5 flex items-center gap-2 relative z-10 ${
            isLight
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-emerald-500/25 bg-emerald-500/[0.06]"
          }`}
        >
          <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" strokeWidth={2} />
          <p className="text-[11.5px] text-foreground/85 font-medium">
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

  const totalWindow = target.getTime() - startOfWindow.getTime();
  const progressed = now.getTime() - startOfWindow.getTime();
  const pct = Math.max(4, Math.min(100, (progressed / totalWindow) * 100));

  const targetLabel = `${String(parsed.h).padStart(2, "0")}:${String(parsed.m).padStart(2, "0")}`;

  return (
    <div
      className={`mx-4 md:mx-10 lg:mx-16 mb-2.5 md:mb-3 rounded-[12px] border px-3.5 py-2.5 relative z-10 ${
        isLight ? "border-border bg-card/80" : "border-[#332C22] bg-[#1C1712]"
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p
          className={`text-[11px] inline-flex items-center gap-1.5 ${
            isLight ? "text-foreground/75" : "text-[#D8CFC0]"
          }`}
        >
          <Clock className="size-3 text-[#C9A876]" strokeWidth={2} />
          check-in libera em{" "}
          <strong className="text-[#C9A876] font-medium tabular-nums">{label}</strong>
        </p>
        <span
          className={`text-[10px] tabular-nums ${isLight ? "text-foreground/45" : "text-[#8A8378]"}`}
        >
          {targetLabel}
        </span>
      </div>
      <div
        className={`h-[3px] rounded-full overflow-hidden ${
          isLight ? "bg-foreground/10" : "bg-[#332C22]"
        }`}
      >
        <div
          className="h-full bg-[#C9A876] transition-[width] duration-1000 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
