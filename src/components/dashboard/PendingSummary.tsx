import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
 *  · `DialogContent` (centralizado, X padrão) — registra na central de sobreposições (véu com
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

type Drill = { from: "bucket" | "cat"; bucket: string | null; cat: RecordCategory | null };

/** "Proprietário(a): Nome" — mesmo texto em todo lugar que cita imóvel/anúncio. */
const ownerText = (name: string) => `Proprietário(a): ${name.trim().split(/\s+/)[0]}`;

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

type PropGroup = { id: string; name: string; items: PendingItem[] };

function groupByProperty(list: PendingItem[]): PropGroup[] {
  const props = new Map<string, PropGroup>();
  for (const i of list) {
    const p = props.get(i.propertyId) ?? { id: i.propertyId, name: i.propertyName, items: [] };
    p.items.push(i); // a lista já vem da mais antiga para a mais nova
    props.set(i.propertyId, p);
  }
  return Array.from(props.values()).sort(
    (a, b) => b.items.length - a.items.length || a.items[0].createdAt.localeCompare(b.items[0].createdAt),
  );
}

/** Imóvel (nome + total), proprietário com mensagem e as pendências tocáveis. */
function PropertyGroups({
  groups,
  tones,
  onPick,
}: {
  groups: PropGroup[];
  tones: Record<RecordCategory, string>;
  onPick: (it: PendingItem) => void;
}) {
  return (
    <div>
      {groups.map((p, idx) => {
        const first = p.items[0];
        return (
          <div key={p.id} className={`py-2.5 ${idx > 0 ? "border-t border-[var(--panel-div)]" : ""}`}>
            <div className="flex items-center gap-2 text-[12.5px] font-bold leading-tight">
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="shrink-0 text-[14px] font-extrabold tabular-nums text-[#c98c8c]">{p.items.length}</span>
            </div>
            {first.ownerName && (
              <div className="mt-0.5 flex min-w-0 items-center gap-0.5">
                <span className="min-w-0 truncate text-[11px] leading-snug text-muted-foreground" title={first.ownerName}>
                  {ownerText(first.ownerName)}
                </span>
                <PhoneActionButton
                  phone={first.ownerPhone}
                  country={first.ownerPhoneCountry}
                  size={12}
                  alwaysShow
                  className="-my-1"
                />
              </div>
            )}
            <ul className="mt-1 space-y-0.5 border-l-2 border-[#c98c8c]/35 pl-2.5">
              {p.items.map((it) => {
                const Icon = CATEGORY_BY_KEY.get(it.category)?.icon;
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => onPick(it)}
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
          </div>
        );
      })}
    </div>
  );
}

export function PendingSummary({
  items,
  tones,
  onOpenItem,
  viewerOpen = false,
  children,
}: {
  items: PendingItem[];
  /** Cor de cada categoria (mesmo mapa dos filtros). */
  tones: Record<RecordCategory, string>;
  /** Tocar numa pendência da lista: o tooltip fecha e a pendência abre. */
  onOpenItem: (item: PendingItem) => boolean;
  /** A pendência oficial está aberta por cima: o tooltip espera e volta depois. */
  viewerOpen?: boolean;
  /** O gatilho (o botão "Ver só elas"). */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"urgency" | "properties">("urgency");
  const [drill, setDrill] = useState<Drill | null>(null);
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
    const properties = groupByProperty(items);
    return {
      total: items.length,
      oldest: ages.length ? Math.max(...ages) : 0,
      byCat,
      buckets: BUCKETS.map((b) => ({ ...b, n: ages.filter(b.test).length })),
      properties,
    };
  }, [items]);

  const maxBucket = Math.max(1, ...data.buckets.map((b) => b.n));

  function close() {
    setOpen(false);
    setDrill(null);
  }

  // Itens do detalhe aberto (faixa e/ou categoria), agrupados por imóvel.
  const drillBucket = drill?.bucket ? BUCKETS.find((b) => b.key === drill.bucket) : null;
  const drillItems = drill
    ? items.filter(
        (i) =>
          (!drillBucket || drillBucket.test(daysAgo(i.createdAt))) && (!drill.cat || i.category === drill.cat),
      )
    : [];
  const drillGroups = groupByProperty(drillItems);

  function pick(it: PendingItem) {
    if (onOpenItem(it)) {
      // Esconde o tooltip guardando onde estava: ao fechar a pendência, volta igual.
      returning.current = true;
      setOpen(false);
    } else {
      close();
    }
  }

  function DrillView() {
    if (!drill) return null;
    const title = drillBucket ? drillBucket.label : (CATEGORY_BY_KEY.get(drill.cat as RecordCategory)?.label ?? "");
    // Chips: cruzam com a outra dimensão (categoria ↔ faixa), só as que têm itens.
    const base = items.filter((i) =>
      drill.from === "bucket"
        ? (drillBucket as (typeof BUCKETS)[number]).test(daysAgo(i.createdAt))
        : i.category === drill.cat,
    );
    const chips =
      drill.from === "bucket"
        ? ORDER.map((k) => ({ key: k, label: CATEGORY_BY_KEY.get(k)?.short ?? k, n: base.filter((i) => i.category === k).length }))
        : BUCKETS.map((b) => ({ key: b.key, label: b.label, n: base.filter((i) => b.test(daysAgo(i.createdAt))).length }));
    const active = drill.from === "bucket" ? drill.cat : drill.bucket;
    const setChip = (key: string | null) =>
      setDrill(
        drill.from === "bucket"
          ? { ...drill, cat: key as RecordCategory | null }
          : { ...drill, bucket: key },
      );
    return (
      <div>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <button
          type="button"
          onClick={() => setDrill(null)}
          className="flex min-h-8 w-full items-center gap-1 pr-11 text-left text-[12px] font-bold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4 shrink-0" />
          <span className="min-w-0 truncate">Resumo das pendências</span>
        </button>
        <p className="mt-1 truncate font-display text-[17px] font-extrabold leading-tight">{title}</p>
        <p className="truncate text-[12px] text-muted-foreground">
          {drillItems.length} {drillItems.length === 1 ? "pendência" : "pendências"} em {drillGroups.length}{" "}
          {drillGroups.length === 1 ? "imóvel" : "imóveis"}
        </p>
        <div className="ds-scroll-x mt-2.5 gap-1.5">
          {[{ key: null as string | null, label: "Todas", n: base.length }, ...chips.filter((c) => c.n > 0)].map((c) => (
            <button
              key={c.key ?? "all"}
              type="button"
              onClick={() => setChip(c.key)}
              className={`shrink-0 whitespace-nowrap rounded-full border border-foreground/10 px-2.5 py-1 text-[11px] font-bold transition-colors ${
                active === c.key ? "bg-foreground/[0.1] text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.label} {c.n}
            </button>
          ))}
        </div>
        <div className="mt-1 max-h-[min(360px,50dvh)] overflow-y-auto overscroll-auto pr-3 sg-elegant-scroll [scrollbar-gutter:stable]">
          <PropertyGroups groups={drillGroups} tones={tones} onPick={pick} />
        </div>
      </div>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // "Clique ao fundo retorna à página anterior": dentro de um detalhe,
        // tocar fora volta ao resumo em vez de fechar tudo.
        if (!v && drill) {
          setDrill(null);
          return;
        }
        setOpen(v);
        if (!v) setDrill(null);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      {/* Centralizado na tela, com o X padrão do sistema (DialogContent). 90% da
          altura (20% a mais que os 75% padrão); nada é cortado: o corpo cresce
          com o conteúdo e só a lista de imóveis rola, por dentro. */}
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[min(75dvh,calc(100dvh_-_var(--kb-inset,0px)_-_3rem))] max-w-[min(380px,calc(100vw-32px))] grid-cols-[minmax(0,1fr)] gap-0 overflow-x-hidden rounded-[var(--win-radius)] p-0 sm:p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="min-w-0 px-5 pb-5 pt-4">
          {drill ? (
            DrillView()
          ) : (
          <>
          <div className="flex min-h-8 items-center pr-11">
            <DialogTitle className="ds-eyebrow flex min-w-0 flex-1 items-center gap-2 text-[10px] font-normal leading-none tracking-[0.18em] text-muted-foreground">
              <span className="shrink-0">Resumo das pendências</span>
              <span aria-hidden className="h-px min-w-0 flex-1 bg-foreground/10" />
            </DialogTitle>
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
            {ORDER.map((k) => {
              const n = data.byCat.get(k) ?? 0;
              return (
                <button
                  key={k}
                  type="button"
                  disabled={n === 0}
                  onClick={() => setDrill({ from: "cat", bucket: null, cat: k })}
                  className="-mx-1.5 flex min-w-0 items-center gap-1.5 rounded-[7px] px-1.5 py-0.5 text-left text-muted-foreground transition-colors enabled:hover:bg-foreground/[0.06] disabled:cursor-default"
                >
                  <i className="size-[7px] shrink-0 rounded-full" style={{ background: tones[k] }} />
                  <span className="min-w-0 flex-1 truncate">{CATEGORY_BY_KEY.get(k)?.short ?? k}</span>
                  <b className="shrink-0 font-bold tabular-nums text-foreground">{n}</b>
                </button>
              );
            })}
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
                ? "max-h-[min(300px,42dvh)] overflow-y-auto overscroll-auto pr-3 sg-elegant-scroll [scrollbar-gutter:stable]"
                : ""
            }
          >
            {tab === "urgency" ? (
              <div className="space-y-3.5 pt-1 pb-1">
                {data.buckets.map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    disabled={b.n === 0}
                    onClick={() => setDrill({ from: "bucket", bucket: b.key, cat: null })}
                    className="-mx-1.5 flex w-[calc(100%+12px)] items-center gap-2.5 rounded-[8px] px-1.5 py-1 text-left text-[12px] transition-colors enabled:hover:bg-foreground/[0.06] disabled:cursor-default"
                  >
                    <span className="w-[84px] shrink-0 truncate text-muted-foreground">{b.label}</span>
                    <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/[0.06]">
                      <i
                        className="block h-full rounded-full"
                        style={{ width: `${(b.n / maxBucket) * 100}%`, background: b.color }}
                      />
                    </span>
                    <b className="w-5 shrink-0 text-right font-bold tabular-nums">{b.n}</b>
                  </button>
                ))}
              </div>
            ) : (
              <PropertyGroups groups={data.properties} tones={tones} onPick={pick} />
            )}
          </div>
          </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
