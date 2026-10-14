import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  importAirbnbListings,
  listAirbnbAccountListings,
  setAirbnbListingActive,
} from "@/lib/airbnb-account.functions";
import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  Calendar,
  Check,
  Filter,
  Home,
  Link2,
  Lock,
  MapPin,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Unlink,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { SearchActionRow } from "@/components/dashboard/SearchActionRow";
import { SortMenu } from "@/components/dashboard/SortMenu";
import { ACTION_SEGMENT, ACTION_BAR } from "@/components/dashboard/panel-chrome";
import { CARD_8 } from "./owner-ui";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { CoverImage } from "@/components/ui/cover-image";
import { EmptyState } from "@/components/ds/EmptyState";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { copyText, hasActiveGuide, mapsLinkOf, type PropertyListItem } from "./property-actions";

/**
 * ABA "IMÓVEIS" DA FICHA DO PROPRIETÁRIO (mockups P2, P5, P6 e R1, 13/10/2026).
 *
 * Barra padrão (busca + ordenar + situação), faixa "Conta do Airbnb conectada"
 * com o botão "ReImportar", e o card de 112px dos Guias Digitais com a chavinha
 * de ativar/desativar anúncio. Tudo que vem do Airbnb é somente leitura aqui.
 *
 * A chavinha e o ReImportar já têm a tela e as confirmações definitivas, mas a
 * AÇÃO só liga quando a conta do Airbnb puder ser conectada de verdade (fluxo
 * A0–A5): por enquanto confirmar apenas avisa. Nenhuma regra de negócio muda.
 */
type Prop = PropertyListItem & { published?: boolean | null };
type Conn = { property_id: string; airbnb_listing_id: string | null; synced_at: string | null };
type OwnerInfo = { name: string; phone: string | null; phone_country: string | null };
type Sit = "active" | "inactive";
type PropSort = "default" | "name" | "city";

const SORT_OPTIONS: { value: PropSort; label: string }[] = [
  { value: "default", label: "Padrão (situação)" },
  { value: "name", label: "Nome do imóvel (A–Z)" },
  { value: "city", label: "Cidade (A–Z)" },
];

function sinceLabel(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

export function OwnerPropertiesPanel({
  properties,
  accountProperties,
  connections,
  ownersById,
  ownerId,
  owner,
  busy,
  otherOwners,
  onOpen,
  onTransfer,
  accountOwnerId,
  onChanged,
}: {
  accountOwnerId?: string | null;
  /** Recarrega a ficha depois de ativar/desativar/importar. */
  onChanged: () => void;
  properties: Prop[];
  accountProperties: Prop[];
  connections: Conn[];
  ownersById: Record<string, OwnerInfo>;
  ownerId: string;
  owner: OwnerInfo;
  busy: boolean;
  otherOwners: Array<{ id: string; label: string }> | undefined;
  onOpen: (id: string) => void;
  onTransfer: (propertyId: string, targetId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<PropSort>("default");
  const [sel, setSel] = useState<Sit[]>([]);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [transferId, setTransferId] = useState<string | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [confirm, setConfirm] = useState<{ id: string; next: boolean } | null>(null);
  const [reimport, setReimport] = useState(false);
  const [toggling, setToggling] = useState(false);
  const setActiveFn = useServerFn(setAirbnbListingActive);

  async function applyToggle() {
    if (!confirm) return;
    setToggling(true);
    try {
      await setActiveFn({
        data: { accountOwnerId, propertyId: confirm.id, active: confirm.next },
      });
      toast.success(confirm.next ? "Anúncio ativado." : "Anúncio desativado.");
      setConfirm(null);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setToggling(false);
    }
  }

  const activeIds = useMemo(
    () => new Set(connections.filter((c) => c.airbnb_listing_id).map((c) => c.property_id)),
    [connections],
  );
  const lastSync = useMemo(() => {
    const own = new Set(properties.map((p) => p.id));
    const dates = connections
      .filter((c) => c.airbnb_listing_id && own.has(c.property_id) && c.synced_at)
      .map((c) => String(c.synced_at));
    return dates.sort().at(-1) ?? null;
  }, [connections, properties]);

  const all = sel.length === 0 || sel.length === 2;
  const label = all ? "Todos" : sel[0] === "active" ? "Ativos" : "Inativos";
  const items = properties.map((p) => ({ ...p, active: activeIds.has(p.id) }));
  const nActive = items.filter((i) => i.active).length;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = items.filter((i) => {
      if (!all && !sel.includes(i.active ? "active" : "inactive")) return false;
      if (!term) return true;
      return [i.name, owner.name, i.city, i.state]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
    const cmp = (x: string, y: string) => x.localeCompare(y, "pt-BR");
    // Mesma regra de ordenação da lista de imóveis: Inativo → Ativo sem Guia → Ativo com Guia.
    const rank = (i: (typeof items)[number]) => (!i.active ? 0 : hasActiveGuide(i) ? 2 : 1);
    return [...list].sort((a, b) => {
      if (sort === "name") return cmp(a.name, b.name);
      if (sort === "city") return cmp(a.city ?? "", b.city ?? "") || cmp(a.name, b.name);
      return rank(a) - rank(b) || cmp(a.name, b.name) || cmp(a.city ?? "", b.city ?? "");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, activeIds, q, sel, sort, properties]);

  function toggleSel(v: Sit) {
    setSel((cur) => {
      const base = cur.length === 0 ? (["active", "inactive"] as Sit[]) : cur;
      const next = base.includes(v) ? base.filter((x) => x !== v) : [...base, v];
      return next.length === 0 || next.length === 2 ? [] : next;
    });
  }
  const checked = (v: Sit) => all || sel.includes(v);

  const Box = ({ on }: { on: boolean }) => (
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
  );
  const optRow = (
    key: string,
    text: string,
    n: number,
    on: boolean,
    onClick: () => void,
    dot?: "ok" | "atencao",
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`flex min-h-[38px] w-full items-center gap-2.5 rounded-lg px-2.5 text-[12.5px] font-semibold transition-colors ${
        on ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.04]"
      }`}
    >
      <Box on={on} />
      {dot ? (
        <span
          aria-hidden
          className={`size-1.5 rounded-full bg-current ${dot === "ok" ? "ds-ok" : "ds-atencao"}`}
        />
      ) : null}
      {text}
      <em className="ml-auto text-[11px] font-bold not-italic text-muted-foreground tabular-nums">
        {n}
      </em>
    </button>
  );

  const statusButton = (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-action-wide
          aria-label={`Situação: ${label}`}
          className={`${ACTION_SEGMENT} !flex-none !w-auto justify-between gap-2.5 px-3 text-[12px] font-bold text-foreground data-[state=open]:bg-foreground/[0.06]`}
        >
          {!all ? (
            <span
              aria-hidden
              className={`size-1.5 rounded-full bg-current ${sel[0] === "active" ? "ds-ok" : "ds-atencao"}`}
            />
          ) : null}
          {label}
          <Filter className="size-[15px] shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[240px] rounded-lg border-0 bg-popover/95 p-2 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_10%,transparent),inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent),0_24px_48px_-12px_rgba(0,0,0,0.85)] backdrop-blur-xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1.5">
          <span className="ds-eyebrow">Situação</span>
          {!all ? (
            <button
              type="button"
              onClick={() => setSel([])}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Limpar
            </button>
          ) : null}
        </div>
        {optRow("all", "Todos", items.length, all, () => setSel([]))}
        {optRow("active", "Ativos", nActive, checked("active"), () => toggleSel("active"), "ok")}
        {optRow(
          "inactive",
          "Inativos",
          items.length - nActive,
          checked("inactive"),
          () => toggleSel("inactive"),
          "atencao",
        )}
      </PopoverContent>
    </Popover>
  );

  const confirmProp = confirm ? items.find((i) => i.id === confirm.id) : null;
  const hasConnection = activeIds.size > 0 || connections.length > 0;

  return (
    <div className="grid gap-3">
      <SearchActionRow
        value={q}
        onChange={setQ}
        placeholder="Buscar imóvel…"
        actions={
          <>
            <SortMenu
              value={sort}
              defaultValue="default"
              options={SORT_OPTIONS}
              onChange={setSort}
              title="Ordenar imóveis por"
              bare
            />
            {statusButton}
          </>
        }
      />

      {/* Faixa da conta do Airbnb (mockup `.zsy`) — o ReImportar é o único botão de importação. */}
      <div className="flex items-center gap-2.5 rounded-lg bg-[color-mix(in_oklab,#7fb79a_7%,transparent)] px-3 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,#7fb79a_25%,transparent)]">
        <span className="ds-ok grid size-[30px] shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,#7fb79a_15%,transparent)]">
          <RefreshCw className="size-3.5" />
        </span>
        <span className="grid min-w-0 flex-1 gap-px">
          <b className="truncate text-[12.5px] font-bold text-foreground">
            {hasConnection ? "Conta do Airbnb conectada" : "Conta do Airbnb não conectada"}
          </b>
          <span className="truncate text-[12px] text-muted-foreground">
            {hasConnection
              ? lastSync
                ? `Sincronizada ${sinceLabel(lastSync)}`
                : "Aguardando a primeira sincronização"
              : "Conecte para importar seus anúncios"}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setReimport(true)}
          className="inline-flex h-7 shrink-0 items-center gap-[5px] rounded-full px-2.5 text-[11.5px] font-bold text-foreground/90 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)] transition-colors hover:bg-foreground/[0.05]"
        >
          <RefreshCw className="size-3" />
          ReImportar
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Home}
          title="Nenhum imóvel encontrado"
          description={
            q
              ? `Nenhum resultado para "${q}".`
              : "Este proprietário ainda não tem imóveis nesta situação."
          }
        />
      ) : (
        <div className="grid gap-3">
          {filtered.map((p) => {
            const place = [p.city, p.state].filter(Boolean).join(" / ");
            const maps = mapsLinkOf(p);
            return (
              <div
                key={p.id}
                onClick={(e) => {
                  const el = e.target as HTMLElement | null;
                  const interactive = el?.closest(
                    "button, a, input, select, textarea, label, [role='switch'], [role='button'], [data-radix-popper-content-wrapper]",
                  );
                  if (interactive && interactive !== e.currentTarget) return;
                  onOpen(p.id);
                }}
                className={`${CARD_8} flex h-[112px] min-w-0 cursor-pointer overflow-hidden transition-all`}
              >
                <span className="relative w-[92px] shrink-0 overflow-hidden bg-foreground/[0.05] text-muted-foreground">
                  <CoverImage urls={[p.hero_image_url, ...(p.gallery_images ?? [])]} />
                  <span
                    className={`absolute left-2 top-2 inline-flex h-[22px] items-center gap-1.5 rounded-full bg-background/70 px-[9px] text-[10.5px] font-extrabold shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)] backdrop-blur-sm ${p.active ? "ds-ok" : "ds-atencao"}`}
                  >
                    <span aria-hidden className="size-1.5 rounded-full bg-current" />
                    {p.active ? "Ativo" : "Inativo"}
                  </span>
                  {hasActiveGuide(p) ? (
                    <span className="absolute bottom-2 left-2 inline-flex h-5 items-center gap-[5px] rounded-full bg-background/70 px-[7px] text-[9px] font-extrabold uppercase tracking-[0.08em] text-foreground/85 backdrop-blur-sm">
                      <BookOpen className="size-2.5" />
                      Guia
                    </span>
                  ) : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col justify-between py-[11px] pl-3.5 pr-3">
                  <span className="block min-w-0">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="min-w-0 flex-1 truncate text-[14px] font-extrabold leading-[1.2]"
                        title={p.name}
                      >
                        {p.name}
                      </span>
                      <Popover
                        open={menuId === p.id}
                        onOpenChange={(o) => {
                          setMenuId(o ? p.id : null);
                          if (!o) {
                            setTransferId(null);
                            setTransferTo("");
                          }
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            title="Mais opções"
                            aria-label="Mais opções"
                            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                          >
                            <MoreHorizontal className="size-4" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-60 p-1.5">
                          {transferId === p.id ? (
                            <div className="grid gap-3 p-2.5">
                              <b className="text-[13.5px] font-semibold">Transferir {p.name}</b>
                              <Select value={transferTo} onValueChange={setTransferTo}>
                                <SelectTrigger className="h-9 rounded-[8px] text-[13px]">
                                  <SelectValue placeholder="Escolher proprietário" />
                                </SelectTrigger>
                                <SelectContent>
                                  {(otherOwners ?? []).map((o) => (
                                    <SelectItem key={o.id} value={o.id}>
                                      {o.label}
                                    </SelectItem>
                                  ))}
                                  {otherOwners?.length === 0 && (
                                    <div className="px-3 py-2 text-xs text-muted-foreground">
                                      Nenhum outro proprietário cadastrado.
                                    </div>
                                  )}
                                </SelectContent>
                              </Select>
                              <p className="text-[11.5px] leading-[1.45] text-[color:var(--faint)]">
                                Todo imóvel precisa de um proprietário.
                              </p>
                              <div className={`${ACTION_BAR} !h-10 !w-full`}>
                                <button
                                  type="button"
                                  disabled={busy || !transferTo}
                                  onClick={() => {
                                    onTransfer(p.id, transferTo);
                                    setMenuId(null);
                                    setTransferId(null);
                                    setTransferTo("");
                                  }}
                                  className={`${ACTION_SEGMENT} !w-auto !flex-1 text-foreground disabled:opacity-40`}
                                >
                                  Transferir
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <MenuItem
                                icon={<Home className="size-3.5 text-muted-foreground" />}
                                onClick={() => {
                                  setMenuId(null);
                                  onOpen(p.id);
                                }}
                              >
                                Abrir imóvel
                              </MenuItem>
                              <Link
                                to="/admin/properties/$id"
                                params={{ id: p.id }}
                                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary"
                              >
                                <Pencil className="size-3.5 text-muted-foreground" /> Editar imóvel
                              </Link>
                              <MenuItem
                                icon={<Link2 className="size-3.5 text-muted-foreground" />}
                                disabled={!maps}
                                onClick={() => {
                                  setMenuId(null);
                                  copyText(maps ?? "", "Link do Maps copiado");
                                }}
                              >
                                Copiar link do Maps
                              </MenuItem>
                              {maps ? (
                                <a
                                  href={maps}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary"
                                >
                                  <MapPin className="size-3.5 text-muted-foreground" /> Abrir no
                                  Maps
                                </a>
                              ) : null}
                              <MenuItem
                                icon={<Unlink className="size-3.5 text-muted-foreground" />}
                                onClick={() => setTransferId(p.id)}
                              >
                                Transferir para outro proprietário
                              </MenuItem>
                            </>
                          )}
                        </PopoverContent>
                      </Popover>
                    </span>
                    {place ? (
                      <span className="mt-[5px] flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
                        <MapPin className="size-3 shrink-0" />
                        <span className="truncate">{place}</span>
                      </span>
                    ) : null}
                  </span>
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-[5px] text-[11.5px]">
                      <span className="shrink-0 text-muted-foreground">Proprietário(a):</span>
                      <span className="min-w-0 truncate font-bold text-foreground">
                        {(p.owner_contact_id && ownersById[p.owner_contact_id]?.name) || owner.name}
                      </span>
                      <PhoneActionButton
                        phone={ownersById[p.owner_contact_id ?? ownerId]?.phone ?? owner.phone}
                        country={
                          ownersById[p.owner_contact_id ?? ownerId]?.phone_country ??
                          owner.phone_country
                        }
                        size={13}
                        alwaysShow
                        className="shrink-0 !p-0"
                      />
                    </span>
                    {/* Chavinha de ativar anúncio (mockup `.sw`: 36×20, igual ao Switch do sistema). */}
                    <Switch
                      checked={p.active}
                      onCheckedChange={(v) => setConfirm({ id: p.id, next: v })}
                      aria-label={p.active ? "Desativar anúncio" : "Ativar anúncio"}
                      className="data-[state=checked]:bg-[#4f8f73] data-[state=unchecked]:bg-foreground/[0.14] [&>span]:bg-[#d8d2ca] data-[state=checked]:[&>span]:bg-white"
                    />
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p className="flex items-start gap-[7px] text-[11px] leading-[1.45] text-[color:var(--faint)]">
        <Lock className="mt-px size-3 shrink-0" />
        Dados vindos do Airbnb são somente leitura. Para alterar, edite no anúncio.
      </p>

      {/* P5/P6 — confirmação da chavinha (sempre pergunta; desativar perde a sincronização). */}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="max-w-[380px] gap-3.5 p-[18px] sm:p-[18px]">
          {confirm && confirmProp ? (
            <>
              <span
                className={`grid size-12 place-items-center rounded-lg ${
                  confirm.next
                    ? "ds-ok bg-[color-mix(in_oklab,#7fb79a_14%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,#7fb79a_35%,transparent)]"
                    : "ds-falta bg-[color-mix(in_oklab,#c98c8c_14%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,#c98c8c_35%,transparent)]"
                }`}
              >
                {confirm.next ? (
                  <Link2 className="size-[22px]" />
                ) : (
                  <TriangleAlert className="size-[22px]" />
                )}
              </span>
              <DialogTitle className="font-display text-[19px] font-extrabold leading-[1.2] tracking-[-0.01em]">
                {confirm.next ? "Ativar este anúncio?" : "Desativar este anúncio?"}
              </DialogTitle>
              <div className="flex items-center gap-2.5 rounded-lg bg-foreground/[0.04] px-[11px] py-[9px] text-[12.5px] font-bold shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_9%,transparent)]">
                <span className="relative size-[34px] shrink-0 overflow-hidden rounded-[9px] bg-foreground/[0.05]">
                  <CoverImage
                    urls={[confirmProp.hero_image_url, ...(confirmProp.gallery_images ?? [])]}
                  />
                </span>
                <span className="min-w-0 truncate">{confirmProp.name}</span>
              </div>
              <DialogDescription className="text-[12.5px] leading-[1.55]">
                {confirm.next ? (
                  <>
                    Conectar o anúncio e{" "}
                    <b className="font-bold text-foreground">
                      importar os dados direto da plataforma Airbnb
                    </b>
                    .
                  </>
                ) : (
                  <>
                    Se você desativar,{" "}
                    <b className="font-bold text-foreground">perderá toda a sincronização</b> com
                    este anúncio - incluindo os dados existentes.
                  </>
                )}
              </DialogDescription>
              <div
                className={`grid gap-2 rounded-lg px-[13px] py-3 ${
                  confirm.next
                    ? "bg-[color-mix(in_oklab,#7fb79a_7%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,#7fb79a_25%,transparent)]"
                    : "bg-[color-mix(in_oklab,#c98c8c_7%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,#c98c8c_25%,transparent)]"
                }`}
              >
                {(confirm.next
                  ? [
                      [Check, "Fotos, endereço, horários e capacidade"],
                      [Check, "Calendário e reservas sempre atualizados"],
                      [Lock, "Esses campos ficam bloqueados aqui"],
                    ]
                  : [
                      [Calendar, "Calendário e reservas param de atualizar"],
                      [Home, "Dados do Airbnb deixam de ser atualizados"],
                      [RefreshCw, "Para voltar, é preciso ativar de novo"],
                    ]
                ).map(([I, t]) => {
                  const Ico = I as typeof Check;
                  return (
                    <div
                      key={String(t)}
                      className="flex items-center gap-[9px] text-[12px] text-foreground/85"
                    >
                      <Ico
                        className={`size-[13px] shrink-0 ${confirm.next ? "ds-ok" : "ds-falta"}`}
                      />
                      {String(t)}
                    </div>
                  );
                })}
              </div>
              <div className="grid gap-2">
                <button
                  type="button"
                  disabled={toggling}
                  onClick={applyToggle}
                  className={`flex h-9 items-center justify-center rounded-lg text-[13.5px] font-extrabold text-white disabled:opacity-60 ${
                    confirm.next ? "bg-gradient-to-br from-[#7c1ad8] to-[#e82dae]" : "bg-[#b24a4a]"
                  }`}
                >
                  {confirm.next ? "Sim, ativar anúncio" : "Sim, desativar anúncio"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirm(null)}
                  className="flex h-9 items-center justify-center rounded-lg bg-foreground/[0.04] text-[12.5px] font-bold text-foreground/85 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_12%,transparent)]"
                >
                  Cancelar
                </button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ReimportWindow
        open={reimport}
        onClose={() => setReimport(false)}
        accountProperties={accountProperties}
        ownersById={ownersById}
        owner={owner}
        ownerId={ownerId}
        accountOwnerId={accountOwnerId}
        onImported={onChanged}
      />
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
    >
      {icon}
      {children}
    </button>
  );
}

/** R1 — todos os anúncios da conta do Airbnb: os já importados vêm marcados e bloqueados; só os novos se escolhem. */
function ReimportWindow({
  open,
  onClose,
  accountProperties,
  ownersById,
  owner,
  ownerId,
  accountOwnerId,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  accountProperties: Prop[];
  ownersById: Record<string, OwnerInfo>;
  owner: OwnerInfo;
  ownerId: string;
  accountOwnerId?: string | null;
  onImported: () => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const listFn = useServerFn(listAirbnbAccountListings);
  const importFn = useServerFn(importAirbnbListings);
  const inv = useQuery({
    queryKey: ["airbnb-account-listings", accountOwnerId ?? "self"],
    queryFn: () => listFn({ data: { accountOwnerId } }),
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  const propById = useMemo(
    () => new Map(accountProperties.map((p) => [p.id, p])),
    [accountProperties],
  );
  const all = inv.data?.listings ?? [];
  const term = q.trim().toLowerCase();
  const rows = all
    .map((l) => {
      const prop = l.propertyId ? propById.get(l.propertyId) : undefined;
      const own = prop?.owner_contact_id
        ? ownersById[prop.owner_contact_id]
        : l.imported
          ? null
          : owner;
      return { ...l, prop, own };
    })
    .filter((l) => {
      if (!term) return true;
      return [l.title, l.own?.name, l.city].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(term),
      );
    })
    .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
  const imported = all.filter((l) => l.imported).length;
  const n = picked.length;

  async function doImport() {
    setBusy(true);
    try {
      const res = await importFn({
        data: { accountOwnerId, ownerId, listingIds: picked },
      });
      if (res.imported > 0)
        toast.success(
          `${res.imported} ${res.imported === 1 ? "anúncio importado" : "anúncios importados"}.`,
        );
      for (const f of res.failed) toast.error(`${f.title}: ${f.error}`);
      setPicked([]);
      onImported();
      if (res.failed.length === 0) onClose();
      else inv.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setQ("");
          setPicked([]);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-[380px] gap-3 p-4 sm:p-4">
        <div className="grid gap-1.5 pr-9">
          <DialogTitle className="font-display text-[18px] font-extrabold leading-[1.2] tracking-[-0.01em]">
            ReImportar anúncios
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-[1.5]">
            Anúncios já importados ficam marcados e bloqueados. Só os novos podem ser selecionados.
          </DialogDescription>
        </div>
        <div className="relative h-10 overflow-hidden rounded-[9px] bg-card shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_7%,transparent),inset_0_0_0_1px_var(--border)]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground opacity-60" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar anúncio ou proprietário…"
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
        <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
          <span className="font-bold text-foreground/85">
            {all.length} {all.length === 1 ? "anúncio" : "anúncios"} na conta
          </span>
          <span>
            {imported} {imported === 1 ? "já importado" : "já importados"}
          </span>
        </div>
        <div className="grid gap-2">
          {inv.isLoading ? (
            <p className="py-6 text-center text-[12.5px] text-muted-foreground">
              Buscando anúncios no Airbnb…
            </p>
          ) : inv.isError ? (
            <p className="py-6 text-center text-[12.5px] text-muted-foreground">
              Não foi possível consultar o Airbnb agora. Tente de novo em instantes.
            </p>
          ) : inv.data && !inv.data.connected ? (
            <p className="py-6 text-center text-[12.5px] text-muted-foreground">
              Conta do Airbnb ainda não conectada.
            </p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-muted-foreground">
              Nenhum anúncio encontrado.
            </p>
          ) : null}
          {rows.map((l) => {
            const locked = l.imported;
            const on = locked || picked.includes(l.listingId);
            const own = l.own;
            return (
              <button
                key={l.listingId}
                type="button"
                data-clip-row
                disabled={locked}
                onClick={() =>
                  setPicked((cur) =>
                    cur.includes(l.listingId)
                      ? cur.filter((x) => x !== l.listingId)
                      : [...cur, l.listingId],
                  )
                }
                className={`flex items-center gap-[11px] rounded-lg px-3 py-2.5 text-left shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)] ${
                  locked
                    ? "bg-foreground/[0.025]"
                    : on
                      ? "bg-foreground/[0.06] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_20%,transparent)]"
                      : "bg-foreground/[0.03] hover:bg-foreground/[0.05]"
                }`}
              >
                <span
                  aria-hidden
                  className={`grid size-4 shrink-0 place-items-center rounded-[5px] ${
                    locked
                      ? "bg-foreground/20 text-white"
                      : on
                        ? "bg-gradient-to-br from-[#7c1ad8] to-[#e82dae] text-white"
                        : "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_25%,transparent)]"
                  }`}
                >
                  {on ? <Check className="size-2.5" strokeWidth={3} /> : null}
                </span>
                <span
                  className={`relative size-[46px] shrink-0 overflow-hidden rounded-lg bg-foreground/[0.05] ${locked ? "opacity-60" : ""}`}
                >
                  <CoverImage urls={[l.prop?.hero_image_url, ...(l.prop?.gallery_images ?? [])]} />
                </span>
                <span className={`grid min-w-0 flex-1 gap-[3px] ${locked ? "opacity-60" : ""}`}>
                  <b className="truncate text-[13px] font-bold">{l.title}</b>
                  <small className="flex items-center gap-[5px] truncate text-[11px] text-muted-foreground">
                    Proprietário(a):{" "}
                    <b className="truncate text-[11px] font-semibold text-foreground">
                      {own?.name ?? "—"}
                    </b>
                    <PhoneActionButton
                      phone={own?.phone}
                      country={own?.phone_country}
                      size={11}
                      alwaysShow
                      className="shrink-0 !p-0"
                    />
                  </small>
                </span>
                {locked ? (
                  <span className="flex shrink-0 items-center gap-[5px] text-[10.5px] font-bold text-[color:var(--faint)]">
                    <Lock className="size-3" />
                    Importado
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="grid gap-2 pt-1">
          <button
            type="button"
            disabled={n === 0 || busy}
            onClick={doImport}
            className="flex h-9 items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-[#7c1ad8] to-[#e82dae] text-[13.5px] font-extrabold text-white disabled:opacity-40"
          >
            <RefreshCw className="size-4" />
            {n === 0 ? "Importar anúncios" : `Importar ${n} ${n === 1 ? "anúncio" : "anúncios"}`}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 items-center justify-center rounded-lg bg-foreground/[0.04] text-[12.5px] font-bold text-foreground/85 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_12%,transparent)]"
          >
            Cancelar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
