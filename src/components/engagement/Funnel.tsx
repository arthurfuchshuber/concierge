type Step = { key: string; label: string; value: number };

export function Funnel({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null;
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-4 pr-14">
        <h3 className="text-sm font-semibold">Funil de comportamento</h3>
        <p className="text-xs text-muted-foreground">Do primeiro acesso à resposta útil</p>
      </header>
      <ul className="space-y-2">
        {steps.map((s, i) => {
          const pct = (s.value / max) * 100;
          const prev = i > 0 ? steps[i - 1].value : s.value;
          const conv = prev > 0 ? Math.round((s.value / prev) * 100) : 100;
          return (
            <li key={s.key} className="space-y-1">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium">{s.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  <span className="text-foreground font-semibold text-sm mr-2">{s.value}</span>
                  {i > 0 && <span>{conv}% do passo anterior</span>}
                </span>
              </div>
              <div className="h-9 rounded-md bg-muted overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary/70 to-primary rounded-md transition-all"
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
