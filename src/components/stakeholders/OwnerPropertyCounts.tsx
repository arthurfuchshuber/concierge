import { ChevronRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PropertyIntegrationSummary } from "@/lib/property-connection";

/**
 * RODAPÉ DO CARD DO PROPRIETÁRIO — "X imóveis ativos" à esquerda e "Y imóveis
 * inativos" na outra ponta (mockup aprovado, 13/10/2026). A situação vem da
 * integração com o Airbnb (ver `property-connection.ts`).
 *
 * Cada lado SÓ aparece quando o número é maior que zero; sem nenhum dos dois,
 * o rodapé inteiro some. Tocar num lado abre o tooltip com a lista dos
 * imóveis — cada linha leva à ficha do imóvel.
 */
function fmtSync(iso: string | null): string {
  if (!iso) return "conectado";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "conectado";
  const now = new Date();
  const same = d.toDateString() === now.toDateString();
  const hh = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return same
    ? `sincronizado hoje, ${hh}`
    : `sincronizado em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "")}`;
}

function CountButton({
  tone,
  count,
  singular,
  plural,
  title,
  items,
  footer,
  align,
}: {
  tone: "ok" | "falta";
  count: number;
  singular: string;
  plural: string;
  title: string;
  items: Array<{ id: string; name: string; sub: string }>;
  footer: string;
  align: "start" | "end";
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="-mx-2 inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:bg-foreground/[0.05] data-[state=open]:bg-foreground/[0.06] data-[state=open]:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent)]"
        >
          <span
            aria-hidden
            className={`size-1.5 shrink-0 rounded-full bg-current ${tone === "ok" ? "ds-ok" : "ds-falta"}`}
          />
          <span>
            <b className="font-extrabold text-foreground tabular-nums">{count}</b>{" "}
            {count === 1 ? singular : plural}
          </span>
          <ChevronRight className="size-3 rotate-90 text-[color:var(--faint)]" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        onClick={(e) => e.stopPropagation()}
        className="w-[290px] rounded-[14px] border-0 bg-popover/95 p-1.5 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_10%,transparent),inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent),0_24px_48px_-12px_rgba(0,0,0,0.85)] backdrop-blur-xl"
      >
        <p className="ds-eyebrow flex items-center gap-2 px-2.5 pb-2 pt-2.5 text-[10px] tracking-[0.2em] text-muted-foreground">
          <span
            aria-hidden
            className={`size-1.5 rounded-full bg-current ${tone === "ok" ? "ds-ok" : "ds-falta"}`}
          />
          {title}
        </p>
        <ul>
          {items.map((it) => (
            <li key={it.id}>
              <Link
                to="/admin/properties/$id"
                params={{ id: it.id }}
                className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 transition-colors hover:bg-foreground/[0.05]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-foreground">
                    {it.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-[color:var(--faint)]">
                    {it.sub}
                  </span>
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-[color:var(--faint)]" />
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-1 border-t border-foreground/[0.06] px-2.5 pb-1.5 pt-2 text-[11px] text-[color:var(--faint)]">
          {footer}
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function OwnerPropertyCounts({ summary }: { summary: PropertyIntegrationSummary }) {
  const { activeCount, inactiveCount, activeItems, inactiveItems } = summary;
  if (activeCount === 0 && inactiveCount === 0) return null;
  const place = (c?: string | null, s?: string | null) =>
    [c, s].filter(Boolean).join(" / ") || "Sem localização";
  return (
    <div className="mt-3 flex items-center justify-between gap-2 border-t border-foreground/[0.06] pt-2">
      {activeCount > 0 ? (
        <CountButton
          tone="ok"
          count={activeCount}
          singular="imóvel ativo"
          plural="imóveis ativos"
          title={`${activeCount} ${activeCount === 1 ? "imóvel ativo" : "imóveis ativos"}`}
          items={activeItems.map((p) => ({
            id: p.id,
            name: p.name,
            sub: `${place(p.city, p.state)} · ${fmtSync(p.syncedAt)}`,
          }))}
          footer="Dados vindos da conexão com o Airbnb"
          align="start"
        />
      ) : (
        <span />
      )}
      {inactiveCount > 0 ? (
        <CountButton
          tone="falta"
          count={inactiveCount}
          singular="imóvel inativo"
          plural="imóveis inativos"
          title={`${inactiveCount} ${inactiveCount === 1 ? "imóvel inativo" : "imóveis inativos"}`}
          items={inactiveItems.map((p) => ({
            id: p.id,
            name: p.name,
            sub: `${place(p.city, p.state)} · sem conexão com o Airbnb`,
          }))}
          footer="Habilite o imóvel na conexão para voltar a ativo"
          align="end"
        />
      ) : null}
    </div>
  );
}
