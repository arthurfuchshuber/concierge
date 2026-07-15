import { Smartphone, Tablet, Monitor } from "lucide-react";

export function DeviceMix({ mix }: { mix: { mobile: number; tablet: number; desktop: number } }) {
  const total = mix.mobile + mix.tablet + mix.desktop;
  const items = [
    { key: "mobile", label: "Mobile", value: mix.mobile, icon: Smartphone, color: "hsl(var(--primary))" },
    { key: "tablet", label: "Tablet", value: mix.tablet, icon: Tablet, color: "hsl(var(--muted-foreground))" },
    { key: "desktop", label: "Desktop", value: mix.desktop, icon: Monitor, color: "hsl(var(--foreground))" },
  ];
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-3">
        <h3 className="text-sm font-semibold">Dispositivo</h3>
        <p className="text-xs text-muted-foreground">Como acessam o guia</p>
      </header>
      {total === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">Sem dados de dispositivo.</div>
      ) : (
        <div className="space-y-2">
          <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
            {items.map((i) => {
              const pct = total > 0 ? (i.value / total) * 100 : 0;
              return <div key={i.key} style={{ width: `${pct}%`, background: i.color }} />;
            })}
          </div>
          <ul className="space-y-1.5 mt-3">
            {items.map((i) => {
              const Icon = i.icon;
              const pct = total > 0 ? Math.round((i.value / total) * 100) : 0;
              return (
                <li key={i.key} className="flex items-center gap-2 text-xs">
                  <Icon className="size-3.5 text-muted-foreground" />
                  <span className="flex-1">{i.label}</span>
                  <span className="tabular-nums font-medium">{i.value}</span>
                  <span className="w-10 text-right text-muted-foreground text-[10px]">{pct}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
