import { Heart, Eye, ThumbsDown } from "lucide-react";

type Row = { key: string; views: number; likes: number; dislikes: number };

export function PoiInsights({ top, cold }: { top: Row[]; cold: Row[] }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card title="Pontos mais engajados" subtitle="Recomendações que atraem interações">
        {top.length === 0
          ? <Empty />
          : <PoiList rows={top} showEmpty={false} />}
      </Card>
      <Card title="Pontos frios" subtitle="Recomendações sem qualquer interação">
        {cold.length === 0
          ? <div className="text-xs text-muted-foreground py-6 text-center">Nenhum ponto frio no período.</div>
          : <PoiList rows={cold} showEmpty />}
      </Card>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </header>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="text-xs text-muted-foreground py-6 text-center">Sem interações no período.</div>;
}

function PoiList({ rows, showEmpty }: { rows: Row[]; showEmpty: boolean }) {
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-2 text-xs">
          <span className="flex-1 truncate font-mono text-[11px]" title={r.key}>{prettify(r.key)}</span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Eye className="size-3" /> {r.views}
          </span>
          {!showEmpty && (
            <>
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Heart className="size-3" /> {r.likes}
              </span>
              {r.dislikes > 0 && (
                <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
                  <ThumbsDown className="size-3" /> {r.dislikes}
                </span>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function prettify(key: string): string {
  // poi_keys costumam vir como `type:place_id` — mostra a parte legível
  const parts = key.split(":");
  return parts.length > 1 ? parts.slice(1).join(":") : key;
}
