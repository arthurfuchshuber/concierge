const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function AccessHeatmap({ matrix }: { matrix: number[][] }) {
  const flat = matrix.flat();
  const max = Math.max(1, ...flat);
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-3">
        <h3 className="text-sm font-semibold">Padrões por dia e hora</h3>
        <p className="text-xs text-muted-foreground">Quando os hóspedes efetivamente abrem o guia</p>
      </header>
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[32px_repeat(24,1fr)] gap-[3px]">
            <div />
            {Array.from({ length: 24 }).map((_, h) => (
              <div key={h} className="text-[9px] text-muted-foreground text-center">
                {h % 3 === 0 ? h : ""}
              </div>
            ))}
            {matrix.map((row, d) => (
              <FragmentRow key={d} day={DAYS[d]} row={row} max={max} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FragmentRow({ day, row, max }: { day: string; row: number[]; max: number }) {
  return (
    <>
      <div className="text-[10px] text-muted-foreground self-center">{day}</div>
      {row.map((v, h) => {
        const intensity = v === 0 ? 0 : 0.15 + (v / max) * 0.85;
        return (
          <div
            key={h}
            title={`${day} ${h}h — ${v} acessos`}
            className="aspect-square rounded-sm"
            style={{
              background: v === 0
                ? "hsl(var(--muted))"
                : `hsl(var(--primary) / ${intensity})`,
            }}
          />
        );
      })}
    </>
  );
}
