import { useEffect, useState } from "react";
import { Clock, ChevronDown } from "lucide-react";

function parseTime(t: string | null | undefined): { h: number; m: number } | null {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

export function CheckinCountdown({
  checkinTime,
  theme,
  expandable = false,
  open = false,
  onToggle,
}: {
  checkinTime: string | null | undefined;
  theme: "dark" | "light";
  expandable?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const parsed = parseTime(checkinTime);
  if (!parsed || !now) return null;

  const target = new Date(now);
  target.setHours(parsed.h, parsed.m, 0, 0);
  const diffMs = target.getTime() - now.getTime();

  const startOfWindow = new Date(now);
  startOfWindow.setHours(0, 0, 0, 0);
  const isLight = theme === "light";

  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    expandable ? (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="block w-full text-left"
      >
        {children}
      </button>
    ) : (
      <div>{children}</div>
    );

  const Chevron = () =>
    expandable ? (
      <ChevronDown
        className={`size-4 shrink-0 transition-transform duration-300 ${open ? "rotate-180" : ""} ${
          isLight ? "text-foreground/60" : "text-white/70"
        }`}
        strokeWidth={2.2}
      />
    ) : null;

  if (now < startOfWindow || now > target) {
    if (diffMs < 0 && Math.abs(diffMs) < 3 * 60 * 60 * 1000) {
      return (
        <div className="mx-4 md:mx-10 lg:mx-16 mb-3 relative z-10">
          <Wrapper>
            <div
              className={`relative rounded-2xl border backdrop-blur-xl px-4 py-3 flex items-center gap-2.5 overflow-hidden ${
                isLight
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-emerald-400/25 bg-emerald-500/[0.08]"
              }`}
            >
              <span className="absolute -inset-px rounded-2xl bg-gradient-to-r from-emerald-400/10 via-transparent to-emerald-400/10 opacity-60 pointer-events-none" />
              <span className="relative flex size-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full size-2 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
              </span>
              <p className="relative flex-1 text-[12px] font-medium text-foreground/90">
                Check-in liberado —{" "}
                <span className="text-emerald-400 font-semibold">
                  {expandable ? "toque para ver senhas" : "pode chegar quando quiser"}
                </span>
              </p>
              <Chevron />
            </div>
          </Wrapper>
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
    <div className="mx-4 md:mx-10 lg:mx-16 mb-3 md:mb-4 relative z-10">
      <Wrapper>
        <div
          className={`relative overflow-hidden rounded-2xl border backdrop-blur-xl px-4 py-3 ${
            isLight
              ? "border-border bg-card/70"
              : "border-white/10 bg-white/[0.04]"
          }`}
        >
          <span className="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full bg-amber-400/20 blur-2xl" />
          <div className="relative flex items-center justify-between gap-2 mb-2">
            <p
              className={`text-[11.5px] inline-flex items-center gap-1.5 ${
                isLight ? "text-foreground/75" : "text-white/80"
              }`}
            >
              <Clock className="size-3 text-amber-400" strokeWidth={2} />
              check-in libera em{" "}
              <strong className="text-amber-300 font-semibold tabular-nums">{label}</strong>
            </p>
            <div className="flex items-center gap-2">
              <span
                className={`text-[10px] tabular-nums font-medium ${isLight ? "text-foreground/45" : "text-white/40"}`}
              >
                {targetLabel}
              </span>
              <Chevron />
            </div>
          </div>
          <div
            className={`relative h-[3px] rounded-full overflow-hidden ${
              isLight ? "bg-foreground/10" : "bg-white/10"
            }`}
          >
            <div
              className="h-full bg-gradient-to-r from-amber-500 via-amber-400 to-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.6)] transition-[width] duration-1000 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </Wrapper>
    </div>
  );
}

