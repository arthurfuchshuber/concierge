import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  FILTER_PANEL_CLASS,
  FILTER_PANEL_COLLISION,
  FILTER_PANEL_OFFSET,
} from "@/components/dashboard/filter-panel";
import { CATEGORY_BY_KEY } from "@/components/dashboard/record-categories";
import type { PendingItem, RecordCategory } from "@/lib/reservation-records.functions";

/**
 * TOOLTIP DO "VER SÓ ELAS" (mockup "as três ideias combinadas", aprovado
 * 03/10/2026).
 *
 * Três leituras do mesmo conjunto de pendências, sem poluir:
 *   · TOPO FIXO — total, barra proporcional por categoria e a mais antiga;
 *   · ABA "URGÊNCIA" (abre por padrão) — há quanto tempo estão abertas;
 *   · ABA "IMÓVEIS" — onde estão; tocar num imóvel abre as pendências dele e o
 *     botão de baixo passa a filtrar só aquele imóvel.
 *
 * Tudo sai de `pendingItems` (a mesma leitura dos contadores, sem o teto da
 * lista), então o total sempre fecha com a faixa.
 *
 * REGRAS DO SISTEMA que esta peça cumpre:
 *  · `PopoverContent` — registra na central de sobreposições (véu com
 *    desfoque, ordem de cliques fora), limita a 75% da altura e nunca passa
 *    da tela;
 *  · casca, 16px de folga lateral e 8px do botão são os dos Filtros
 *    (`FILTER_PANEL_*`), com a largura ampliada;
 *  · anti-corte: duas abas que CABEM na largura (sem rolagem lateral), título
 *    e subtítulo com reticências — nada quebra nem fica pela metade;
 *  · "clique ao fundo retorna à página anterior": com um imóvel aberto, tocar
 *    fora recolhe o imóvel em vez de fechar o tooltip;
 *  · altura natural (sem vão); a lista de imóveis rola só se passar do limite,
 *    com folga para a barra não cobrir números, e sem prender a rolagem da página.
 */

const ORDER: RecordCategory[] = ["maintenance", "damage", "incident", "forgotten"];

/** Dias corridos (calendário local) desde a data — mesma conta de `fmtAgo`. */
function daysAgo(iso: string): number {
  const d = new Date(iso);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const now = new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((t0.getTime() - day.getTime()) / 86_400_000));
}

const fmtD = (n: number) => (n === 0 ? "hoje" : `há ${n} d`);

const BUCKETS: { key: string; label: string; test: (d: number) => boolean; color: string }[] = [
  { key: "today", label: "Hoje", test: (d) => d === 0, color: "#7fb79a" },
  { key: "week", label: "1 a 7 dias", test: (d) => d >= 1 && d <= 7, color: "#c9a962" },
  { key: "fortnight", label: "8 a 14 dias", test: (d) => d >= 8 && d <= 14, color: "#c98c8c" },
  { key: "old", label: "+ 15 dias", test: (d) => d >= 15, color: "var(--falta,#e0707a)" },
];

export function PendingSummary({
  items,
  tones,
  onApply,
  onOpenItem,
  viewerOpen = false,
  children,
}: {
  items: PendingItem[];
  /** Cor de cada categoria (mesmo mapa dos filtros). */
  tones: Record<RecordCategory, string>;
  /** `null` = filtrar todas as pendências; id = só aquele imóvel. */
  onApply: (propertyId: string | null) => void;
  /** Tocar numa pendência da lista: o tooltip fecha e a pendência abre. */
  onOpenItem: (item: PendingItem) => boolean;
  /** A pendência oficial está aberta por cima: o tooltip espera e volta depois. */
  viewerOpen?: boolean;
  /** O gatilho (o botão "Ver só elas"). */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"urgency" | "properties">("urgency");
  const [expanded, setExpanded] = useState<string | null>(null);
  // Voltar ao tooltip depois de fechar a pendência aberta por ele.
  const returning = useRef(false);
  useEffect(() => {
    if (!viewerOpen && returning.current) {
      returning.current = false;
      setOpen(true);
    }
  }, [viewerOpen]);

  const data = useMemo(() => {
    const ages = items.map((i) => daysAgo(i.createdAt));
    const byCat = new Map<RecordCategory, number>();
    for (const i of items) byCat.set(i.category, (byCat.get(i.category) ?? 0) + 1);
    const props = new Map<string, { id: string; name: string; items: PendingItem[] }>();
    for (const i of items) {
      const p = props.get(i.propertyId) ?? { id: i.propertyId, name: i.propertyName, items: [] };
      p.items.push(i); // `items` já vem da mais antiga para a mais nova
      props.set(i.propertyId, p);
    }
    const properties = Array.from(props.values()).sort(
      (a, b) => b.items.length - a.items.length || a.items[0].createdAt.localeCompare(b.items[0].createdAt),
    );
    return {
      total: items.length,
      oldest: ages.length ? Math.max(...ages) : 0,
      byCat,
      buckets: BUCKETS.map((b) => ({ ...b, n: ages.filter(b.test).length })),
      properties,
    };
  }, [items]);

  const expandedProp = expanded ? data.properties.find((p) => p.id === expanded) : null;
  const maxBucket = Math.max(1, ...data.buckets.map((b) => b.n));

  function close() {
    setOpen(false);
    setExpanded(null);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        // "Clique ao fundo retorna à página anterior": com um imóvel aberto,
        // tocar fora só o recolhe.
        if (!v && expanded) {
          setExpanded(null);
          return;
        }
        setOpen(v);
        if (!v) setExpanded(null);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={FILTER_PANEL_OFFSET}
        collisionPadding={FILTER_PANEL_COLLISION}
        className={`${FILTER_PANEL_CLASS} !w-[min(344px,calc(100vw-32px))]`}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-4 pb-4 pt-3.5">
          <div className="flex items-center gap-2">
            <p className="ds-eyebrow flex min-w-0 flex-1 items-center gap-2 text-[10px] tracking-[0.18em] text-muted-foreground">
              <span className="shrink-0">Resumo das pendências</span>
              <span aria-hidden className="h-px min-w-0 flex-1 bg-foreground/10" />
            </p>
            <button
              type="button"
              aria-label="Fechar"
              onClick={close}
              className="grid size-[26px] shrink-0 place-items-center rounded-md bg-secondary/60 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" strokeWidth={2.2} />
            </button>
          </div>

          {/* TOPO FIXO */}
          <div className="mt-2.5 flex items-center gap-2.5">
            <span className="font-display text-[34px] font-bold leading-none tracking-[-0.03em] tabular-nums">
              {data.total}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] leading-tight">
              <b className="font-bold">em aberto</b>
              <span className="block truncate text-muted-foreground">
                em {data.properties.length} {data.properties.length === 1 ? "imóvel" : "imóveis"}
              </span>
            </span>
            {data.total > 0 && (
              <span className="shrink-0 rounded-full border border-[var(--falta,#e0707a)]/30 bg-[var(--falta,#e0707a)]/12 px-2.5 py-1 text-[11px] font-bold text-[var(--falta,#e0707a)]">
                Mais antiga {data.oldest === 0 ? "hoje" : `${data.oldest} d`}
              </span>
            )}
          </div>

          <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {ORDER.filter((k) => (data.byCat.get(k) ?? 0) > 0).map((k) => (
              <i key={k} className="block rounded-[2px]" style={{ flex: data.byCat.get(k), background: tones[k] }} />
            ))}
          </div>
          {/* LEGENDA — grade 2x2 de células iguais: nunca quebra de forma torta */}
          <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11.5px]">
            {ORDER.map((k) => (
              <span key={k} className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <i className="size-[7px] shrink-0 rounded-full" style={{ background: tones[k] }} />
                <span className="min-w-0 flex-1 truncate">{CATEGORY_BY_KEY.get(k)?.short ?? k}</span>
                <b className="shrink-0 font-bold tabular-nums text-foreground">{data.byCat.get(k) ?? 0}</b>
              </span>
            ))}
          </div>

          {/* ABAS — duas, cabem na largura: sem rolagem lateral, nada cortado */}
          <div role="tablist" className="mb-2.5 mt-3.5 grid grid-cols-2 gap-0.5 rounded-[9px] bg-foreground/[0.05] p-[3px]">
            {(
              [
                ["urgency", "Urgência"],
                ["properties", "Imóveis"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => {
                  setTab(k);
                  setExpanded(null);
                }}
                className={`truncate rounded-[7px] py-1.5 text-[12px] font-bold transition-colors ${
                  tab === k ? "bg-foreground/[0.1] text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ALTURA NATURAL: sem vão. Só rola (e só ali) se a lista passar do
              limite; sem `overscroll-contain`, então quando não há o que rolar
              a rolagem segue para a página. */}
          <div
            className={
              tab === "properties"
                ? "max-h-[min(250px,36dvh)] overflow-y-auto overscroll-auto pr-3 sg-elegant-scroll [scrollbar-gutter:stable]"
                : ""
            }
          >
            {tab === "urgency" ? (
              <div className="space-y-3.5 pt-1 pb-1">
                {data.buckets.map((b) => (
                  <div key={b.key} className="flex items-center gap-2.5 text-[12px]">
                    <span className="w-[84px] shrink-0 truncate text-muted-foreground">{b.label}</span>
                    <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/[0.06]">
                      <i
                        className="block h-full rounded-full"
                        style={{ width: `${(b.n / maxBucket) * 100}%`, background: b.color }}
                      />
                    </span>
                    <b className="w-5 shrink-0 text-right font-bold tabular-nums">{b.n}</b>
                  </div>
                ))}
              </div>
            ) : (
              <div>
                {data.properties.map((p, idx) => {
                  const isOpen = expanded === p.id;
                  const oldest = daysAgo(p.items[0].createdAt);
                  return (
                    <div key={p.id} className={idx > 0 ? "border-t border-[var(--panel-div)]" : ""}>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setExpanded(isOpen ? null : p.id)}
                        className="flex w-full items-center gap-2.5 py-2 text-left"
                      >
                        <span className="grid size-5 shrink-0 place-items-center rounded-[7px] bg-[#c98c8c]/20 text-[10.5px] font-extrabold text-[#c98c8c]">
                          {idx + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-bold leading-tight">{p.name}</span>
                          <span className="block truncate text-[10.5px] leading-tight text-muted-foreground">
                            Mais antiga {oldest === 0 ? "hoje" : `há ${oldest} dias`}
                          </span>
                        </span>
                        <span className="w-6 shrink-0 text-right text-[14px] font-extrabold tabular-nums text-[#c98c8c]">
                          {p.items.length}
                        </span>
                        <ChevronRight
                          className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                        />
                      </button>
                      {isOpen && (
                        <ul className="mb-2 ml-[30px] space-y-0.5 border-l-2 border-[#c98c8c]/35 pl-2.5">
                          {p.items.map((it) => {
                            const Icon = CATEGORY_BY_KEY.get(it.category)?.icon;
                            return (
                              <li key={it.id}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (onOpenItem(it)) {
                                      // Esconde o tooltip, guardando aba e imóvel: ao
                                      // fechar a pendência, ele reaparece como estava.
                                      returning.current = true;
                                      setOpen(false);
                                    } else {
                                      close();
                                    }
                                  }}
                                  className="flex w-full items-center gap-2 rounded-[7px] py-1.5 pr-1 text-left text-[11.5px] transition-colors hover:bg-foreground/[0.06]"
                                >
                                  {Icon && <Icon className="size-3 shrink-0" style={{ color: tones[it.category] }} />}
                                  <span className="min-w-0 flex-1 truncate">{it.title}</span>
                                  <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                                    {fmtD(daysAgo(it.createdAt))}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {expandedProp && (
            <button
              type="button"
              onClick={() => {
                onApply(expandedProp.id);
                close();
              }}
              className="mt-3 block w-full truncate rounded-[9px] bg-[#b4545c] px-3 py-2.5 text-[12.5px] font-extrabold text-white transition-opacity hover:opacity-90"
            >
              Ver só {expandedProp.name}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
