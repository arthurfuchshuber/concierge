import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDownLeft, ArrowUpRight, Check, Coins, Filter, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { SearchActionRow } from "@/components/dashboard/SearchActionRow";
import { SortMenu } from "@/components/dashboard/SortMenu";
import {
  ACTION_BUTTON_TONE,
  ACTION_ICON,
  ACTION_SEGMENT,
} from "@/components/dashboard/panel-chrome";
import { CARD_8 } from "./owner-ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteOwnerLedgerEntry,
  listOwnerLedger,
  saveOwnerLedgerEntry,
  setOwnerLedgerPaid,
  type LedgerEntry,
} from "@/lib/owner-finance.functions";
import { OwnerEmpty, StatsStrip } from "./owner-ui";

/**
 * ABA "FINANCEIRO" DA FICHA DO PROPRIETÁRIO (mockup P3).
 *
 * Lançamentos a receber / a pagar deste proprietário. Os três totais do topo
 * somam os lançamentos (sem centavos, sempre arredondados para cima).
 */
type Sort = "due_desc" | "due_asc" | "amount" | "desc";
type Dir = "receivable" | "payable";
type Sit = "open" | "paid";

const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "due_desc", label: "Vencimento (mais recentes)" },
  { value: "due_asc", label: "Vencimento (mais antigos)" },
  { value: "amount", label: "Maior valor" },
  { value: "desc", label: "Descrição (A–Z)" },
];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function brlWhole(v: number) {
  return Math.ceil(v).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}
function dueLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const cur = new Date().getFullYear();
  return `${d} ${MONTHS[m - 1]}${y !== cur ? ` ${y}` : ""}`;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function OwnerFinancePanel({
  ownerId,
  accountOwnerId,
  properties,
}: {
  ownerId: string;
  accountOwnerId?: string | null;
  properties: Array<{ id: string; name: string }>;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listOwnerLedger);
  const saveFn = useServerFn(saveOwnerLedgerEntry);
  const paidFn = useServerFn(setOwnerLedgerPaid);
  const delFn = useServerFn(deleteOwnerLedgerEntry);
  const key = ["owner-ledger", accountOwnerId ?? "self", ownerId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { ownerId, accountOwnerId } }),
  });
  const entries = useMemo(() => q.data?.entries ?? [], [q.data]);
  const propName = useMemo(() => new Map(properties.map((p) => [p.id, p.name])), [properties]);

  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<Sort>("due_desc");
  const [dirs, setDirs] = useState<Dir[]>([]);
  const [sits, setSits] = useState<Sit[]>([]);
  const [editing, setEditing] = useState<LedgerEntry | "new" | null>(null);

  const totals = useMemo(() => {
    let rec = 0;
    let got = 0;
    let pay = 0;
    for (const e of entries) {
      if (e.direction === "receivable") {
        if (e.paid_at) got += e.amount;
        else rec += e.amount;
      } else if (!e.paid_at) pay += e.amount;
    }
    return { rec, got, pay };
  }, [entries]);

  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    const list = entries.filter((e) => {
      if (dirs.length && !dirs.includes(e.direction)) return false;
      if (sits.length && !sits.includes(e.paid_at ? "paid" : "open")) return false;
      if (!t) return true;
      return (
        e.description.toLowerCase().includes(t) ||
        (e.property_id ? (propName.get(e.property_id) ?? "").toLowerCase().includes(t) : false)
      );
    });
    list.sort((a, b) => {
      if (sort === "due_asc") return a.due_date.localeCompare(b.due_date);
      if (sort === "amount") return b.amount - a.amount;
      if (sort === "desc") return a.description.localeCompare(b.description, "pt-BR");
      return b.due_date.localeCompare(a.due_date);
    });
    return list;
  }, [entries, term, dirs, sits, sort, propName]);

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const togglePaid = useMutation({
    mutationFn: (e: LedgerEntry) =>
      paidFn({ data: { ownerId, accountOwnerId, id: e.id, paid: !e.paid_at } }),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível atualizar."),
  });

  const filterCount = dirs.length + sits.length;
  const toggle = <T extends string>(set: (f: (c: T[]) => T[]) => void, v: T) =>
    set((c) => (c.includes(v) ? c.filter((x) => x !== v) : [...c, v]));

  return (
    <>
      <SearchActionRow
        value={term}
        onChange={setTerm}
        placeholder="Buscar lançamento…"
        actions={
          <>
            <button
              type="button"
              onClick={() => setEditing("new")}
              aria-label="Novo lançamento"
              title="Novo lançamento"
              className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE}`}
            >
              <Plus className={`${ACTION_ICON} text-accent`} />
            </button>
            <SortMenu
              value={sort}
              defaultValue="due_desc"
              options={SORT_OPTIONS}
              onChange={setSort}
              title="Ordenar lançamentos por"
              bare
            />
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Filtrar lançamentos"
                  title="Filtrar lançamentos"
                  className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE} relative data-[state=open]:bg-foreground/[0.06]`}
                >
                  <Filter className={ACTION_ICON} />
                  {filterCount > 0 && (
                    <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[240px] rounded-lg border-0 bg-popover/95 p-2 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_10%,transparent),inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent),0_24px_48px_-12px_rgba(0,0,0,0.85)] backdrop-blur-xl"
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1.5">
                  <span className="ds-eyebrow">Filtrar</span>
                  {filterCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setDirs([]);
                        setSits([]);
                      }}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      Limpar
                    </button>
                  )}
                </div>
                {(
                  [
                    [
                      "Tipo",
                      dirs,
                      setDirs,
                      [
                        ["receivable", "A receber"],
                        ["payable", "A pagar"],
                      ],
                    ],
                    [
                      "Situação",
                      sits,
                      setSits,
                      [
                        ["open", "Em aberto"],
                        ["paid", "Pago / recebido"],
                      ],
                    ],
                  ] as const
                ).map(([title, cur, set, opts]) => (
                  <div key={title} className="pb-1">
                    <p className="ds-eyebrow px-2.5 pb-1 pt-1.5 opacity-70">{title}</p>
                    {opts.map(([v, label]) => {
                      const on = (cur as string[]).includes(v);
                      return (
                        <button
                          key={v}
                          type="button"
                          onClick={() => toggle(set as never, v)}
                          className={`flex min-h-[38px] w-full items-center gap-2.5 rounded-lg px-2.5 text-[12.5px] font-semibold transition-colors ${
                            on ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.04]"
                          }`}
                        >
                          <span
                            aria-hidden
                            className={`grid size-4 shrink-0 place-items-center rounded-[5px] ${
                              on
                                ? "bg-gradient-to-br from-[#7c1ad8] to-[#e82dae] text-white"
                                : "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_25%,transparent)]"
                            }`}
                          >
                            {on ? <Check className="size-2.5" strokeWidth={3} /> : null}
                          </span>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </PopoverContent>
            </Popover>
          </>
        }
      />

      <div className="mt-[26px] grid gap-6">
        <div className={CARD_8}>
          <StatsStrip
            items={[
              { label: "A receber", value: brlWhole(totals.rec), tone: "ok" },
              { label: "Recebido", value: brlWhole(totals.got), tone: "data" },
              { label: "A pagar", value: brlWhole(totals.pay), tone: "at" },
            ]}
          />
        </div>

        {q.isLoading ? (
          <p className="flex items-center gap-1.5 ds-meta">
            <Loader2 className="size-3 animate-spin" /> Carregando lançamentos…
          </p>
        ) : shown.length === 0 ? (
          <OwnerEmpty
            icon={Coins}
            title={entries.length === 0 ? "Nenhum lançamento" : "Nada encontrado"}
            text={
              entries.length === 0
                ? "Use o botão + para lançar uma cobrança a receber ou um repasse a pagar."
                : "Nenhum lançamento bate com a busca ou os filtros."
            }
          />
        ) : (
          <div className="grid gap-2">
            {shown.map((e) => {
              const isRec = e.direction === "receivable";
              const overdue = !e.paid_at && e.due_date < todayISO();
              const status = e.paid_at
                ? isRec
                  ? "Recebido"
                  : "Pago"
                : isRec
                  ? "A receber"
                  : "A pagar";
              return (
                <div
                  key={e.id}
                  className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-lg bg-foreground/[0.03] py-3 pl-3 pr-2 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]"
                >
                  <span className="grid size-8 place-items-center rounded-lg bg-foreground/[0.05] text-muted-foreground">
                    {isRec ? (
                      <ArrowDownLeft className="size-[15px]" />
                    ) : (
                      <ArrowUpRight className="size-[15px]" />
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditing(e)}
                    className="min-w-0 text-left"
                    title="Editar lançamento"
                  >
                    <b className="block truncate text-[13px] font-bold">{e.description}</b>
                    <small className="block truncate text-[11px] leading-[1.35] text-muted-foreground">
                      {e.property_id ? `${propName.get(e.property_id) ?? "Imóvel"} · ` : ""}
                      <span className={overdue ? "ds-falta" : undefined}>
                        vence {dueLabel(e.due_date)}
                      </span>
                    </small>
                  </button>
                  <span className="flex items-center gap-2 pl-2">
                    <span className="text-right">
                      <b className="block text-[13px] font-extrabold tabular-nums">
                        {brlWhole(e.amount)}
                      </b>
                      <small
                        className={`block text-[11px] font-semibold ${
                          e.paid_at ? "ds-ok" : isRec ? "text-muted-foreground" : "ds-atencao"
                        }`}
                      >
                        {status}
                      </small>
                    </span>
                    <button
                      type="button"
                      disabled={togglePaid.isPending}
                      onClick={() => togglePaid.mutate(e)}
                      aria-label={e.paid_at ? "Reabrir lançamento" : "Marcar como pago"}
                      title={
                        e.paid_at
                          ? "Reabrir lançamento"
                          : isRec
                            ? "Marcar como recebido"
                            : "Marcar como pago"
                      }
                      className={`grid size-7 place-items-center rounded-[7px] transition-colors disabled:opacity-40 ${
                        e.paid_at
                          ? "bg-[#4f8f73] text-white"
                          : "text-muted-foreground shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_25%,transparent)] hover:text-foreground"
                      }`}
                    >
                      <Check className="size-3.5" strokeWidth={3} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <EntryWindow
        key={editing === null ? "none" : editing === "new" ? "new" : editing.id}
        entry={editing}
        properties={properties}
        onClose={() => setEditing(null)}
        onSave={async (v) => {
          await saveFn({
            data: {
              ownerId,
              accountOwnerId,
              id: editing && editing !== "new" ? editing.id : undefined,
              ...v,
            },
          });
          await refresh();
          toast.success(editing === "new" ? "Lançamento criado." : "Lançamento atualizado.");
          setEditing(null);
        }}
        onDelete={async () => {
          if (!editing || editing === "new") return;
          await delFn({ data: { ownerId, accountOwnerId, id: editing.id } });
          await refresh();
          toast.success("Lançamento excluído.");
          setEditing(null);
        }}
      />
    </>
  );
}

type Draft = {
  direction: Dir;
  description: string;
  amount: number;
  dueDate: string;
  propertyId: string | null;
  paid: boolean;
};

function EntryWindow({
  entry,
  properties,
  onClose,
  onSave,
  onDelete,
}: {
  entry: LedgerEntry | "new" | null;
  properties: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (v: Draft) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const cur = entry && entry !== "new" ? entry : null;
  const [dir, setDir] = useState<Dir>(cur?.direction ?? "receivable");
  const [desc, setDesc] = useState(cur?.description ?? "");
  const [cents, setCents] = useState<number | null>(cur ? Math.round(cur.amount * 100) : null);
  const [due, setDue] = useState(cur?.due_date ?? todayISO());
  const [prop, setProp] = useState<string>(cur?.property_id ?? "none");
  const [paid, setPaid] = useState(!!cur?.paid_at);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  }
  const valid = desc.trim().length > 0 && cents !== null && /^\d{4}-\d{2}-\d{2}$/.test(due);

  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-[380px] gap-3 p-4 sm:p-4">
        <div className="grid gap-1.5 pr-9">
          <DialogTitle className="font-display text-[18px] font-extrabold leading-[1.2] tracking-[-0.01em]">
            {cur ? "Editar lançamento" : "Novo lançamento"}
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-[1.5]">
            Cobrança a receber ou repasse a pagar deste proprietário.
          </DialogDescription>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-foreground/[0.05] p-1">
          {(
            [
              ["receivable", "A receber"],
              ["payable", "A pagar"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setDir(v)}
              className={`h-9 rounded-[8px] text-[12.5px] font-bold transition-colors ${
                dir === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="grid gap-1.5">
          <span className="ds-eyebrow">Descrição</span>
          <Input
            value={desc}
            maxLength={160}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Ex.: Repasse de setembro"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5">
            <span className="ds-eyebrow">Valor</span>
            <MoneyInput cents={cents} onChange={setCents} placeholder="0,00" />
          </label>
          <label className="grid gap-1.5">
            <span className="ds-eyebrow">Vencimento</span>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        </div>

        <div className="grid gap-1.5">
          <span className="ds-eyebrow">Imóvel (opcional)</span>
          <Select value={prop} onValueChange={setProp}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem imóvel</SelectItem>
              {properties.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] font-semibold">
            {dir === "receivable" ? "Já foi recebido" : "Já foi pago"}
          </span>
          <Switch
            checked={paid}
            onCheckedChange={setPaid}
            className="data-[state=checked]:bg-[#4f8f73] data-[state=unchecked]:bg-foreground/[0.14] [&>span]:bg-[#d8d2ca] data-[state=checked]:[&>span]:bg-white"
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          {cur && (
            <button
              type="button"
              disabled={busy}
              onClick={() => (confirmDel ? run(onDelete) : setConfirmDel(true))}
              className="h-9 rounded-lg px-3 text-[12.5px] font-bold ds-falta hover:bg-foreground/[0.05] disabled:opacity-40"
            >
              {confirmDel ? "Confirmar exclusão" : "Excluir"}
            </button>
          )}
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() =>
              run(() =>
                onSave({
                  direction: dir,
                  description: desc.trim(),
                  amount: (cents ?? 0) / 100,
                  dueDate: due,
                  propertyId: prop === "none" ? null : prop,
                  paid,
                }),
              )
            }
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-br from-[#7c1ad8] to-[#e82dae] px-4 text-[12.5px] font-bold text-white disabled:opacity-40"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Salvar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
