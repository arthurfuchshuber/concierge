export function QuestionsCluster({ items }: { items: Array<{ term: string; count: number }> }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-3">
        <h3 className="text-sm font-semibold">Termos que os hóspedes trazem no chat</h3>
        <p className="text-xs text-muted-foreground">
          Extraídos da primeira mensagem de cada conversa. Aparecem aqui os assuntos que geram dúvida mesmo com o guia.
        </p>
      </header>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">Sem repetição significativa de termos no período.</div>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {items.map((q) => {
            const size = Math.min(1.5, 0.8 + q.count / 8);
            return (
              <li
                key={q.term}
                className="rounded-full border border-border bg-muted/40 px-3 py-1"
                style={{ fontSize: `${size}rem`, lineHeight: 1.1 }}
              >
                <span className="font-medium">{q.term}</span>
                <span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground">×{q.count}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
