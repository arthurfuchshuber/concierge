import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";

type Row = { id: string; name: string; completeness: number; accesses: number };

export function CompletenessScatter({ rows, onSelect }: { rows: Row[]; onSelect?: (id: string) => void }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-2">
        <h3 className="text-sm font-semibold">Completude × Engajamento</h3>
        <p className="text-xs text-muted-foreground">
          Guias completos com poucos acessos indicam problema de distribuição. Guias populares com baixa completude, oportunidade urgente.
        </p>
      </header>
      <div className="h-64">
        {rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Sem imóveis para exibir.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 12, bottom: 22, left: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" />
              <XAxis
                type="number"
                dataKey="completeness"
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                label={{ value: "Completude", position: "insideBottom", offset: -8, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                type="number"
                dataKey="accesses"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                width={30}
              />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as Row;
                  return (
                    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-muted-foreground">Completude {p.completeness}/100 · {p.accesses} acessos</div>
                    </div>
                  );
                }}
              />
              <Scatter
                data={rows}
                onClick={(pt: unknown) => {
                  const p = pt as { payload?: { id?: string } };
                  if (p?.payload?.id) onSelect?.(p.payload.id);
                }}
              >
                {rows.map((r, i) => (
                  <Cell key={i} fill="hsl(var(--primary))" />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
