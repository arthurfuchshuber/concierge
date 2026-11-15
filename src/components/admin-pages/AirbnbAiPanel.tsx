import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Link2, Plug, Power, PowerOff, RotateCw, Search, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SELECTED_ITEM_CLASS, SelectionBar } from "@/components/ui/selection-bar";
import { Switch } from "@/components/ui/switch";
import {
  ActionSquare,
  IntegrationShell,
  PrimaryAction,
  SoftToggles,
} from "@/components/admin-pages/integration-window";
import { useLongPress } from "@/hooks/useLongPress";
import {
  getAirbnbAiToggles,
  getListingSenders,
  setAirbnbAiToggle,
  setListingSender,
  type AirbnbAiToggle,
} from "@/lib/channex.functions";
import { cn } from "@/lib/utils";

const TOGGLES_KEY = ["airbnb-ai-toggles"] as const;
const SENDERS_KEY = ["listing-senders"] as const;

type Filter = "todos" | "com" | "sem";
type SenderInfo = NonNullable<ReturnType<typeof useSenders>["data"]>[number];

/** Um cartão por imóvel: o principal e, se houver, o anúncio gêmeo (a chave e quem assina valem para os dois). */
type Group = {
  propertyId: string;
  primary: AirbnbAiToggle;
  twins: AirbnbAiToggle[];
  listingIds: string[];
};

function useSenders() {
  const sendersFn = useServerFn(getListingSenders);
  return useQuery({ queryKey: SENDERS_KEY, queryFn: () => sendersFn(), retry: false, staleTime: 60_000 });
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const initials = (title: string) =>
  title
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

const AVATAR =
  "grid size-[18px] shrink-0 place-items-center rounded-full bg-foreground/[0.08] text-[9px] font-bold text-foreground/90";

/** "Assina como": quem assina as respostas deste imóvel (e do gêmeo). */
function SenderPicker({
  sender,
  disabled,
  onPick,
}: {
  sender: SenderInfo;
  disabled?: boolean;
  onPick: (channelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = sender.options.find((o) => o.channelId === sender.currentChannelId) ?? sender.options[0];
  const single = sender.options.length <= 1;
  const box =
    "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[9px] border border-border/70 bg-[color-mix(in_oklab,var(--card),var(--background)_55%)] pl-2 pr-2.5 text-left text-xs text-foreground";
  if (single || disabled) {
    return (
      <div className={cn(box, disabled && "opacity-70")}>
        <span className={AVATAR}>{initials(current?.title ?? "")}</span>
        <span className="min-w-0 flex-1 truncate">{current?.title ?? "—"}</span>
      </div>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-haspopup="listbox" aria-expanded={open} className={box}>
          <span className={AVATAR}>{initials(current?.title ?? "")}</span>
          <span className="min-w-0 flex-1 truncate">{current?.title ?? "—"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        role="listbox"
        className="w-[var(--radix-popover-trigger-width)] rounded-[10px] border border-border bg-popover p-1 text-xs text-popover-foreground shadow-md"
      >
        {sender.options.map((o) => {
          const on = o.channelId === current?.channelId;
          return (
            <button
              key={o.channelId}
              type="button"
              role="option"
              aria-selected={on}
              onClick={() => {
                setOpen(false);
                if (!on) onPick(o.channelId);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.06]",
                on && "bg-foreground/10 font-semibold",
              )}
            >
              <span className={AVATAR}>{initials(o.title)}</span>
              <span className="min-w-0 flex-1 truncate">{o.title}</span>
              {on ? <Check className="size-3.5 shrink-0" strokeWidth={2.4} /> : null}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function ListingCard({
  g,
  sender,
  readOnly,
  busy,
  selected,
  selecting,
  onToggleSelect,
  onStartSelect,
  onToggleAi,
  onPickSender,
}: {
  g: Group;
  sender: SenderInfo | undefined;
  readOnly?: boolean;
  busy?: boolean;
  selected: boolean;
  selecting: boolean;
  onToggleSelect: () => void;
  onStartSelect: () => void;
  onToggleAi: (next: boolean) => void;
  onPickSender: (channelId: string) => void;
}) {
  const on = g.primary.enabled;
  const { handlers, consumeClick } = useLongPress(() => {
    if (!readOnly) onStartSelect();
  });
  const twin = g.twins[0];
  return (
    <div
      data-clip-row
      data-selected={selected || undefined}
      {...(readOnly ? {} : handlers)}
      onClick={(e) => {
        if (consumeClick()) return;
        const el = e.target as HTMLElement | null;
        const interactive = el?.closest("button, a, input, select, textarea, label, [role='switch'], [role='option']");
        if (interactive && interactive !== e.currentTarget) return;
        if (selecting) onToggleSelect();
      }}
      className={cn(
        "relative min-w-0 select-none rounded-[12px] border py-3 pl-[17px] pr-3.5 shadow-sm [-webkit-touch-callout:none]",
        selected ? SELECTED_ITEM_CLASS : "border-border/70 bg-card",
        selecting && !readOnly && "cursor-pointer",
      )}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[12px]">
        <span
          className={cn(
            "absolute inset-y-0 left-0 w-[3px]",
            on ? "bg-emerald-500" : "bg-[#c4c4cc] dark:bg-[#9a9aa2]",
          )}
        />
      </span>
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate font-display text-[12.5px] font-bold leading-[1.3] tracking-[-0.01em]",
              on ? "text-foreground" : "text-foreground/70",
            )}
          >
            {g.primary.name}
          </p>
          {g.primary.ownerName ? (
            <div className="mt-1 flex min-w-0 items-center gap-1 text-[11px] leading-[15px]">
              <span className="min-w-0 truncate font-semibold text-foreground" title={g.primary.ownerName}>
                {g.primary.ownerName}
              </span>
              <PhoneActionButton
                phone={g.primary.ownerPhone}
                country={g.primary.ownerPhoneCountry}
                size={11}
                alwaysShow
                className="-my-1 shrink-0"
              />
            </div>
          ) : null}
          {twin ? (
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-[15px] text-muted-foreground">
              <Link2 className="size-3 shrink-0" />
              <span className="min-w-0 truncate">Gêmeo: {twin.name}</span>
            </div>
          ) : null}
        </div>
        <Switch
          className="mt-px"
          aria-label={`IA responde em ${g.primary.name}`}
          checked={on}
          disabled={readOnly || busy}
          onCheckedChange={onToggleAi}
        />
      </div>
      {sender ? (
        <div className="relative mt-1 flex min-w-0 items-center gap-2 border-t border-border/60 pt-2">
          <span className="shrink-0 text-[11px] text-muted-foreground">Assina como</span>
          <SenderPicker sender={sender} disabled={readOnly} onPick={onPickSender} />
        </div>
      ) : null}
    </div>
  );
}

const plural = (n: number) => `${n} ${n === 1 ? "imóvel" : "imóveis"}`;

/**
 * Janela "IA no Airbnb" (mockup aprovado, 15/11/2026): por imóvel, liga/desliga a IA no chat e
 * escolhe quem assina as respostas. O anúncio gêmeo mora no cartão do imóvel e espelha a chave.
 * Segurar um cartão entra na seleção múltipla (sem checkbox) para ligar/desligar a IA em lote.
 */
export function AirbnbAiPanel({ readOnly }: { readOnly?: boolean }) {
  const qc = useQueryClient();
  const togglesFn = useServerFn(getAirbnbAiToggles);
  const setToggleFn = useServerFn(setAirbnbAiToggle);
  const setSenderFn = useServerFn(setListingSender);

  const toggles = useQuery({ queryKey: TOGGLES_KEY, queryFn: () => togglesFn(), retry: false });
  const senders = useSenders();
  const senderBy = useMemo(() => new Map((senders.data ?? []).map((s) => [s.listingId, s])), [senders.data]);

  const [filter, setFilter] = useState<Filter>("todos");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selecting = selected.size > 0;

  const groups = useMemo<Group[]>(() => {
    const rows = toggles.data ?? [];
    return rows
      .filter((r) => r.kind === "primary")
      .map((p) => {
        const twins = rows.filter((r) => r.kind === "twin" && r.propertyId === p.propertyId);
        return { propertyId: p.propertyId, primary: p, twins, listingIds: [p.listingId, ...twins.map((t) => t.listingId)] };
      });
  }, [toggles.data]);

  const visible = useMemo(() => {
    const nq = norm(q.trim());
    return groups.filter((g) => {
      if (filter === "com" && !g.primary.enabled) return false;
      if (filter === "sem" && g.primary.enabled) return false;
      if (!nq) return true;
      const cur = senderBy.get(g.primary.listingId);
      const senderTitle = cur?.options.find((o) => o.channelId === cur.currentChannelId)?.title ?? "";
      const hay = norm(
        [
          g.primary.name,
          ...g.twins.map((t) => t.name),
          g.primary.ownerName,
          g.primary.city,
          g.primary.address,
          senderTitle,
        ]
          .filter(Boolean)
          .join(" "),
      );
      return hay.includes(nq);
    });
  }, [groups, filter, q, senderBy]);

  // A seleção só vale para o que existe e está visível.
  useEffect(() => {
    if (!selected.size) return;
    const ids = new Set(visible.map((g) => g.propertyId));
    const next = new Set([...selected].filter((id) => ids.has(id)));
    if (next.size !== selected.size) setSelected(next);
  }, [visible, selected]);

  useEffect(() => {
    if (!selected.size) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size]);

  const toggleSelect = (id: string) =>
    setSelected((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allPicked = visible.length > 0 && visible.every((g) => selected.has(g.propertyId));

  const setCache = (ids: string[], enabled: boolean) =>
    qc.setQueryData<AirbnbAiToggle[]>(TOGGLES_KEY, (old) =>
      old?.map((t) => (ids.includes(t.propertyId) ? { ...t, enabled } : t)),
    );

  const toggle = useMutation({
    mutationFn: (v: { propertyId: string; enabled: boolean }) => setToggleFn({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: TOGGLES_KEY });
      const prev = qc.getQueryData<AirbnbAiToggle[]>(TOGGLES_KEY);
      setCache([v.propertyId], v.enabled);
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(TOGGLES_KEY, ctx.prev);
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar.");
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: TOGGLES_KEY });
      toast.success(v.enabled ? "IA ligada neste anúncio." : "IA desligada: a equipe responde neste anúncio.");
    },
  });

  const bulk = useMutation({
    mutationFn: async (v: { propertyIds: string[]; enabled: boolean }) => {
      await Promise.all(v.propertyIds.map((propertyId) => setToggleFn({ data: { propertyId, enabled: v.enabled } })));
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: TOGGLES_KEY });
      const prev = qc.getQueryData<AirbnbAiToggle[]>(TOGGLES_KEY);
      setCache(v.propertyIds, v.enabled);
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(TOGGLES_KEY, ctx.prev);
      qc.invalidateQueries({ queryKey: TOGGLES_KEY });
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar.");
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: TOGGLES_KEY });
      setSelected(new Set());
      toast.success(
        v.enabled
          ? `IA ligada em ${plural(v.propertyIds.length)}.`
          : `IA desligada em ${plural(v.propertyIds.length)}: a equipe responde.`,
      );
    },
  });

  const changeSender = useMutation({
    mutationFn: (v: { listingIds: string[]; channelId: string }) => setSenderFn({ data: v }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: SENDERS_KEY });
      toast.success(`Respostas assinadas por "${r.title}".`);
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: SENDERS_KEY });
      toast.error(e instanceof Error ? e.message : "Não foi possível trocar a conta.");
    },
  });

  const loading = toggles.isLoading;
  const failed = toggles.isError;
  const empty = !loading && !failed && groups.length === 0;
  const showList = !loading && !failed && !empty;
  const picked = [...selected];

  const stateIcon = "grid size-10 place-items-center rounded-[10px] [&_svg]:size-4";
  const stateBox = "grid place-items-center gap-2 py-12 text-center";

  return (
    <IntegrationShell
      inWindow
      title="IA no Airbnb"
      subtitle="Sem IA, a equipe responde os hóspedes."
      bodyDeps={[visible.length, loading, failed, selecting, filter, q]}
      toggles={
        showList ? (
          <>
            <SoftToggles
              items={[
                { key: "todos", label: "Todos" },
                { key: "com", label: "Com IA" },
                { key: "sem", label: "Sem IA" },
              ]}
              value={filter}
              onChange={setFilter}
            />
            <div className="pt-2.5">
              <div className="relative h-10 shrink-0 overflow-hidden rounded-[9px] bg-card shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_7%,transparent),inset_0_0_0_1px_var(--border)]">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground opacity-60" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar imóvel, proprietário, cidade…"
                  aria-label="Buscar imóvel, proprietário, cidade"
                  className="h-full w-full bg-transparent pl-9 pr-9 text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                {q ? (
                  <button
                    type="button"
                    onClick={() => setQ("")}
                    aria-label="Limpar busca"
                    className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
          </>
        ) : null
      }
      above={
        selecting ? (
          <SelectionBar
            count={selected.size}
            allSelected={allPicked}
            onClear={() => setSelected(new Set())}
            onToggleAll={() => setSelected(allPicked ? new Set() : new Set(visible.map((g) => g.propertyId)))}
          />
        ) : null
      }
      footer={
        !showList ? null : selecting ? (
          <>
            <PrimaryAction
              icon={<Power />}
              disabled={bulk.isPending}
              onClick={() => bulk.mutate({ propertyIds: picked, enabled: true })}
            >
              Ligar IA em {plural(picked.length)}
            </PrimaryAction>
            <ActionSquare
              label="Desligar IA"
              disabled={bulk.isPending}
              onClick={() => bulk.mutate({ propertyIds: picked, enabled: false })}
            >
              <PowerOff strokeWidth={2} />
            </ActionSquare>
          </>
        ) : (
          <p className="flex w-full items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <Check className="size-3" strokeWidth={2.4} />
            As mudanças são salvas na hora.
          </p>
        )
      }
    >
      {loading ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[112px] animate-pulse rounded-[12px] bg-primary/10" />
          ))}
        </div>
      ) : failed ? (
        <div className={stateBox}>
          <span className={cn(stateIcon, "bg-destructive/10 text-destructive")}>
            <TriangleAlert strokeWidth={2} />
          </span>
          <p className="text-sm font-semibold text-foreground">Não foi possível carregar</p>
          <p className="max-w-[240px] text-[11.5px] leading-[16px] text-muted-foreground">
            Os anúncios não responderam agora. Tente de novo em instantes.
          </p>
          <button
            type="button"
            onClick={() => toggles.refetch()}
            className="mt-1 box-border inline-flex h-7 flex-none items-center justify-center gap-2 whitespace-nowrap rounded-[8px] border border-border/60 bg-muted px-2.5 text-[11.5px] font-medium leading-none text-foreground"
          >
            <RotateCw className="size-3" strokeWidth={2.2} />
            <span className="overflow-hidden text-ellipsis">Tentar de novo</span>
          </button>
        </div>
      ) : empty ? (
        <div className={stateBox}>
          <span className={cn(stateIcon, "border border-border/70 bg-muted text-foreground")}>
            <Plug strokeWidth={2} />
          </span>
          <p className="text-sm font-semibold text-foreground">Nenhum anúncio conectado</p>
          <p className="max-w-[240px] text-[11.5px] leading-[16px] text-muted-foreground">
            Quando houver anúncios do Airbnb conectados, eles aparecem aqui.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-[12px] text-muted-foreground">Nenhum imóvel encontrado.</p>
      ) : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] auto-rows-max gap-2">
          {visible.map((g) => (
            <ListingCard
              key={g.propertyId}
              g={g}
              sender={senderBy.get(g.primary.listingId)}
              readOnly={readOnly}
              busy={toggle.isPending || bulk.isPending}
              selected={selected.has(g.propertyId)}
              selecting={selecting}
              onToggleSelect={() => toggleSelect(g.propertyId)}
              onStartSelect={() => setSelected(new Set([g.propertyId]))}
              onToggleAi={(next) => toggle.mutate({ propertyId: g.propertyId, enabled: next })}
              onPickSender={(channelId) => changeSender.mutate({ listingIds: g.listingIds, channelId })}
            />
          ))}
          <div className="h-2" />
        </div>
      )}
    </IntegrationShell>
  );
}
