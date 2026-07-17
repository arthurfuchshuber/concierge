import { KeyRound, LogOut, Home as HomeIcon, Compass, Home as HouseIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type BottomNavKey = "home" | "checkin" | "saida" | "residencia" | "explore";

export function BottomNav({
  theme,
  active,
  items,
  onSelect,
}: {
  theme: "dark" | "light";
  active: BottomNavKey;
  items: Array<{ key: BottomNavKey; label: string }>;
  onSelect: (key: BottomNavKey) => void;
}) {
  const isDark = theme === "dark";
  if (items.length === 0) return null;

  const iconFor = (k: BottomNavKey) => {
    switch (k) {
      case "home":
        return <HomeIcon className="size-[18px]" strokeWidth={1.9} />;
      case "checkin":
        return <KeyRound className="size-[18px]" strokeWidth={1.9} />;
      case "saida":
        return <LogOut className="size-[18px]" strokeWidth={1.9} />;
      case "residencia":
        return <HouseIcon className="size-[18px]" strokeWidth={1.9} />;
      case "explore":
        return <Compass className="size-[18px]" strokeWidth={1.9} />;
    }
  };

  return (
    <>
      {/* Spacer to prevent last content from sitting under the fixed bar */}
      <div className="h-[86px]" aria-hidden />
      <nav
        aria-label="Navegação do guia"
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 px-3",
          "backdrop-blur-xl border-t",
          isDark
            ? "bg-[#080815]/85 border-white/8 shadow-[0_-20px_50px_-20px_rgba(0,0,0,0.7)]"
            : "bg-white/85 border-slate-900/[0.06] shadow-[0_-16px_40px_-24px_rgba(31,24,74,0.18)]",
        )}
      >
        <ul className="mx-auto flex max-w-[490px] items-stretch justify-around gap-1">
          {items.map((it) => {
            const isActive = it.key === active;
            return (
              <li key={it.key} className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => onSelect(it.key)}
                  className={cn(
                    "group relative flex w-full flex-col items-center justify-center gap-1 py-1.5 rounded-2xl transition-all",
                    "active:scale-[0.96]",
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span
                    className={cn(
                      "grid size-10 place-items-center rounded-2xl transition-all",
                      isActive
                        ? isDark
                          ? "bg-pink-500/20 text-pink-200 shadow-[0_0_18px_-6px_rgba(236,72,153,0.55)]"
                          : "bg-pink-100 text-pink-700"
                        : isDark
                          ? "text-white/60 group-hover:text-white/90"
                          : "text-slate-700/70 group-hover:text-slate-950",
                    )}
                  >
                    {iconFor(it.key)}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] font-bold tracking-tight leading-none truncate max-w-full px-1",
                      isActive
                        ? isDark
                          ? "text-white"
                          : "text-slate-950"
                        : isDark
                          ? "text-white/55"
                          : "text-slate-700/72",
                    )}
                  >
                    {it.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
