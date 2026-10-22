import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BookOpen,
  Copy,
  ExternalLink,
  FileText,
  Filter,
  Home,
  Info,
  LogIn,
  LogOut,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Link2,
  RefreshCw,
  Users,
} from "lucide-react";
import { PropertyInfoDialog } from "./PropertyInfoDialog";
import { PropertyInstructionsDialog, type InstructionsKind } from "./PropertyInstructionsDialog";
import {
  airbnbUrlOf,
  copyText,
  fullAddressOf,
  hasActiveGuide,
  mapsLinkOf,
  openPublicGuide,
  type PropertyListItem,
} from "./property-actions";
import { CoverImage } from "@/components/ui/cover-image";
import { SearchActionRow } from "@/components/dashboard/SearchActionRow";
import {
  ACTION_BUTTON_TONE,
  ACTION_ICON,
  ACTION_SEGMENT,
  PANEL_SHELL,
} from "@/components/dashboard/panel-chrome";
import {
  FILTER_PANEL_CLASS,
  FILTER_PANEL_COLLISION,
  FILTER_PANEL_OFFSET,
  FilterCountBadge,
  FilterMenuRow,
  FilterMultiSelect,
  FilterRootHeader,
  FilterScreenHeader,
} from "@/components/dashboard/filter-panel";
import { AirbnbAccountFlow, type AirbnbFlowRequest } from "./AirbnbAccountFlow";
import { ConnectedAccountsBar } from "./ConnectedAccountsBar";
import { toast } from "sonner";
import {
  listAirbnbAccounts,
  listSyncDismissedProperties,
  refreshListingFromAirbnb,
  retryAirbnbChat,
  setPropertySyncDismissed,
} from "@/lib/airbnb-account.functions";
import { useImpersonation } from "@/hooks/useImpersonation";
import { Button } from "@/components/ui/button";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { EmptyState } from "@/components/ds/EmptyState";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ClampName } from "@/components/ui/clamp-name";
import { getPendingFullConnections } from "@/lib/channex-full-connect.functions";
import type { PropertyConnectionRow } from "@/lib/property-connection";

/**
 * ABA "IMÓVEIS" DA PÁGINA PROPRIETÁRIOS (mockups aprovados, 13/10/2026).
 *
 * Lista rápida de todos os imóveis da conta no modelo do card de Guias
 * Digitais (foto colada à esquerda, altura cheia), mas com 104px de altura:
 * título (1 linha, com reticências), cidade/UF e, por último,
 * "Proprietário(a): nome" + ícone de mensagem padrão. A situação (Ativo /
 * Inativo — definição de `property-connection.ts`) vai sobre a foto.
 *
 * A situação se filtra num botão de seleção múltipla ao lado da busca, que
 * mostra a palavra inteira da seleção atual (Todos / Ativos / Inativos).
 */
type Prop = PropertyListItem;
type Owner = Record<string, any>;
type FilterScreen = "root" | "account" | "listing" | "city" | "state" | "integration";

export function OwnerPropertiesList({
  properties,
  owners,
  connections,
}: {
  properties: Prop[];
  owners: Owner[];
  connections: PropertyConnectionRow[];
}) {
  const [q, setQ] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);
  const [instr, setInstr] = useState<{ id: string; kind: InstructionsKind } | null>(null);
  // Filtro (mesmo modelo de Guias): só o ícone; Conta, Anúncio, Cidade e Estado, cada um com seleção múltipla.
  const [accountFilters, setAccountFilters] = useState<string[]>([]);
  const [listingFilters, setListingFilters] = useState<string[]>([]);
  const [cityFilters, setCityFilters] = useState<string[]>([]);
  const [stateFilters, setStateFilters] = useState<string[]>([]);
  // Integração: "none" = só imóveis sem integração com o Airbnb (os que precisam ser sincronizados).
  const [integrationFilters, setIntegrationFilters] = useState<string[]>([]);
  const [filterScreen, setFilterScreen] = useState<FilterScreen>("root");
  const [flow, setFlow] = useState<AirbnbFlowRequest>(null);
  const { impersonation } = useImpersonation();
  const accountOwnerId = impersonation?.userId ?? null;
  const qc = useQueryClient();
  const retryChatFn = useServerFn(retryAirbnbChat);
  async function retryChat(propertyId: string) {
    setMenuId(null);
    try {
      const r = await retryChatFn({ data: { accountOwnerId, propertyId } });
      if (r.ok) toast.success("Chat ativado.");
      else toast.error("A Channex ainda não ativou o chat. Tente de novo em instantes.");
      qc.invalidateQueries({ queryKey: ["stakeholders"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ativar o chat.");
    }
  }
  const refreshListingFn = useServerFn(refreshListingFromAirbnb);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  async function refreshListing(propertyId: string) {
    if (refreshingId) return;
    setRefreshingId(propertyId);
    try {
      await refreshListingFn({ data: { accountOwnerId, propertyId } });
      toast.success("Anúncio sincronizado com sucesso!");
      for (const key of [
        "stakeholders",
        "properties",
        "property",
        "airbnb-accounts",
        "dash-occupancy",
        "dashboard",
      ]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível atualizar o anúncio.");
    } finally {
      setRefreshingId(null);
      setMenuId(null);
    }
  }
  const accountsFn = useServerFn(listAirbnbAccounts);
  const accountsQ = useQuery({
    queryKey: ["airbnb-accounts", accountOwnerId ?? "self"],
    refetchOnWindowFocus: true,
    queryFn: () => accountsFn({ data: { accountOwnerId } }),
    staleTime: 60_000,
    retry: false,
  });
  const airbnbAccounts = useMemo(() => accountsQ.data ?? [], [accountsQ.data]);
  // Selo de status do Modo Full: anúncios aguardando "Já conectei todos".
  const pendingFullFn = useServerFn(getPendingFullConnections);
  const pendingFullQ = useQuery({
    queryKey: ["full-connect-pending"],
    queryFn: () => pendingFullFn(),
    staleTime: 60_000,
    retry: false,
  });
  const pendingFullIds = useMemo(
    () => new Set((pendingFullQ.data?.items ?? []).map((i: { propertyId: string }) => i.propertyId)),
    [pendingFullQ.data],
  );
  // Imóveis dispensados do aviso ("Não sincronizar"): marca no card + "Voltar a sincronizar".
  const dismissedFn = useServerFn(listSyncDismissedProperties);
  const dismissedQ = useQuery({
    queryKey: ["sync-dismissed", accountOwnerId ?? "self"],
    queryFn: () => dismissedFn({ data: { accountOwnerId } }),
    staleTime: 30_000,
    retry: false,
  });
  const dismissedIds = useMemo(() => new Set(dismissedQ.data?.ids ?? []), [dismissedQ.data]);
  const undismissFn = useServerFn(setPropertySyncDismissed);
  async function backToSync(propertyId: string) {
    setMenuId(null);
    try {
      await undismissFn({ data: { accountOwnerId, propertyId, dismissed: false } });
      toast.success("O imóvel voltou para a sincronização.");
      qc.invalidateQueries({ queryKey: ["sync-dismissed"] });
      qc.invalidateQueries({ queryKey: ["unsynced-properties"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível voltar a sincronizar.");
    }
  }

  const items = useMemo(() => {
    const active = new Set(
      connections.filter((c) => c.airbnb_listing_id).map((c) => c.property_id),
    );
    const ownerById = new Map(owners.map((o) => [o.id as string, o]));
    const listingById = new Map(
      connections
        .filter((c) => c.airbnb_listing_id)
        .map((c) => [c.property_id, c.airbnb_listing_id]),
    );
    const channelById = new Map(
      connections
        .filter((c) => c.channex_channel_id)
        .map((c) => [c.property_id, c.channex_channel_id as string]),
    );
    const pendingById = new Map(
      connections
        .filter((c) => c.airbnb_listing_id && c.pending)
        .map((c) => [c.property_id, c.pending]),
    );
    return properties
      .map((p) => ({
        ...p,
        pending: pendingById.get(p.id) ?? null,
        airbnbListingId: listingById.get(p.id) ?? null,
        channelId: channelById.get(p.id) ?? null,
        active: active.has(p.id),
        owner: p.owner_contact_id ? (ownerById.get(p.owner_contact_id) ?? null) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [properties, owners, connections]);
  const ownerNameOf = (i: { owner: { trade_name?: unknown; name?: unknown } | null }) =>
    i.owner ? String(i.owner.trade_name || i.owner.name || "") : "";

  const infoItem = items.find((i) => i.id === infoId);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = items.filter((i) => {
      if (accountFilters.length > 0 && !accountFilters.includes(i.channelId ?? "")) return false;
      if (listingFilters.length > 0 && !listingFilters.includes(i.id)) return false;
      if (cityFilters.length > 0 && !cityFilters.includes(i.city ?? "")) return false;
      if (stateFilters.length > 0 && !stateFilters.includes(i.state ?? "")) return false;
      if (integrationFilters.includes("none") && i.active) return false;
      if (!term) return true;
      const ownerName = i.owner ? String(i.owner.trade_name || i.owner.name || "") : "";
      return [i.name, ownerName, i.city, i.state]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
    const cmp = (x: string, y: string) => x.localeCompare(y, "pt-BR");
    // Padrão: Inativo → Ativo sem Guia → Ativo com Guia; depois nome, cidade e proprietário.
    const rank = (i: (typeof items)[number]) => (!i.active ? 0 : hasActiveGuide(i) ? 2 : 1);
    return [...list].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        cmp(a.name, b.name) ||
        cmp(a.city ?? "", b.city ?? "") ||
        cmp(ownerNameOf(a), ownerNameOf(b)),
    );
  }, [items, q, accountFilters, listingFilters, cityFilters, stateFilters, integrationFilters]);

  const panelFiltersActive =
    accountFilters.length +
      listingFilters.length +
      cityFilters.length +
      stateFilters.length +
      integrationFilters.length >
    0;
  function clearFilters() {
    setAccountFilters([]);
    setListingFilters([]);
    setCityFilters([]);
    setStateFilters([]);
    setIntegrationFilters([]);
  }
  const multiLabel = (arr: string[], all: string, many: string) =>
    arr.length === 0 ? all : arr.length === 1 ? arr[0] : `${arr.length} ${many}`;
  const accountTitle = (id: string) =>
    airbnbAccounts.find((a) => a.channelId === id)?.title ?? "Conta do Airbnb";
  const accountOptions = useMemo(
    () =>
      airbnbAccounts.map((a) => ({
        value: a.channelId,
        label: a.title,
        sublabel: `${items.filter((i) => i.channelId === a.channelId).length} imóveis`,
      })),
    [airbnbAccounts, items],
  );
  const listingOptions = useMemo(
    () =>
      items.map((i) => ({
        value: i.id,
        label: i.name,
        sublabel: [i.city, i.state].filter(Boolean).join("/") || null,
      })),
    [items],
  );
  const uniq = (vals: Array<string | null | undefined>) =>
    Array.from(new Set(vals.filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((v) => ({ value: v, label: v }));
  const cityOptions = useMemo(() => uniq(items.map((i) => i.city)), [items]);
  const stateOptions = useMemo(() => uniq(items.map((i) => i.state)), [items]);
  const integrationOptions = useMemo(
    () => [
      {
        value: "none",
        label: "Sem integração",
        sublabel: `${items.filter((i) => !i.active).length} imóveis`,
      },
    ],
    [items],
  );

  const filterButton = (
    <Popover onOpenChange={(o) => !o && setFilterScreen("root")}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE}`}
          aria-label="Filtros"
          title="Filtros"
        >
          <Filter className={ACTION_ICON} />
          {panelFiltersActive && (
            <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={FILTER_PANEL_OFFSET}
        collisionPadding={FILTER_PANEL_COLLISION}
        className={FILTER_PANEL_CLASS}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {filterScreen === "root" ? (
          <>
            <FilterRootHeader canClear={panelFiltersActive} onClear={clearFilters} />
            <FilterMenuRow
              icon={Users}
              label="Conta"
              value={
                accountFilters.length === 1
                  ? accountTitle(accountFilters[0])
                  : multiLabel(accountFilters, "Todas", "selecionadas")
              }
              active={accountFilters.length > 0}
              onClick={() => setFilterScreen("account")}
            />
            <FilterMenuRow
              icon={Home}
              label="Anúncio"
              value={
                listingFilters.length === 1
                  ? (items.find((i) => i.id === listingFilters[0])?.name ?? "1 selecionado")
                  : multiLabel(listingFilters, "Todos", "selecionados")
              }
              active={listingFilters.length > 0}
              onClick={() => setFilterScreen("listing")}
            />
            <FilterMenuRow
              icon={MapPin}
              label="Cidade"
              value={multiLabel(cityFilters, "Todas", "selecionadas")}
              active={cityFilters.length > 0}
              onClick={() => setFilterScreen("city")}
            />
            <FilterMenuRow
              icon={MapPin}
              label="Estado"
              value={multiLabel(stateFilters, "Todos", "selecionados")}
              active={stateFilters.length > 0}
              onClick={() => setFilterScreen("state")}
            />
            <FilterMenuRow
              icon={Link2}
              label="Integração"
              value={integrationFilters.length > 0 ? "Sem integração" : "Todos"}
              active={integrationFilters.length > 0}
              onClick={() => setFilterScreen("integration")}
              last
            />
          </>
        ) : null}
        {filterScreen === "account" ? (
          <>
            <FilterScreenHeader
              icon={Users}
              title="Conta"
              onBack={() => setFilterScreen("root")}
              right={<FilterCountBadge count={accountFilters.length} />}
            />
            <FilterMultiSelect
              options={accountOptions}
              selected={accountFilters}
              onChange={setAccountFilters}
              searchPlaceholder="Buscar conta..."
            />
          </>
        ) : null}
        {filterScreen === "listing" ? (
          <>
            <FilterScreenHeader
              icon={Home}
              title="Anúncio"
              onBack={() => setFilterScreen("root")}
              right={<FilterCountBadge count={listingFilters.length} />}
            />
            <FilterMultiSelect
              options={listingOptions}
              selected={listingFilters}
              onChange={setListingFilters}
              searchPlaceholder="Buscar anúncio..."
            />
          </>
        ) : null}
        {filterScreen === "city" ? (
          <>
            <FilterScreenHeader
              icon={MapPin}
              title="Cidade"
              onBack={() => setFilterScreen("root")}
              right={<FilterCountBadge count={cityFilters.length} />}
            />
            <FilterMultiSelect
              options={cityOptions}
              selected={cityFilters}
              onChange={setCityFilters}
              searchPlaceholder="Buscar cidade..."
            />
          </>
        ) : null}
        {filterScreen === "state" ? (
          <>
            <FilterScreenHeader
              icon={MapPin}
              title="Estado"
              onBack={() => setFilterScreen("root")}
              right={<FilterCountBadge count={stateFilters.length} />}
            />
            <FilterMultiSelect
              options={stateOptions}
              selected={stateFilters}
              onChange={setStateFilters}
              searchPlaceholder="Buscar estado..."
            />
          </>
        ) : null}
        {filterScreen === "integration" ? (
          <>
            <FilterScreenHeader
              icon={Link2}
              title="Integração"
              onBack={() => setFilterScreen("root")}
              right={<FilterCountBadge count={integrationFilters.length} />}
            />
            <FilterMultiSelect
              options={integrationOptions}
              selected={integrationFilters}
              onChange={setIntegrationFilters}
              searchPlaceholder="Buscar..."
            />
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="grid gap-4">
      <SearchActionRow
        value={q}
        onChange={setQ}
        placeholder="Buscar imóvel, proprietário, cidade…"
        actions={<>{filterButton}</>}
      />
      <ConnectedAccountsBar />

      {items.length === 0 ? (
        <EmptyState
          icon={Home}
          title="Nenhum imóvel ainda"
          description="Conecte uma conta do Airbnb para importar seus anúncios."
          action={
            <Button onClick={() => setFlow({ type: "connect" })}>
              <Link2 /> Conectar conta
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Home}
          title="Nenhum imóvel encontrado"
          description={q ? `Nenhum resultado para "${q}".` : "Nenhum imóvel com esses filtros."}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => {
            const place = [p.city, p.state].filter(Boolean).join("/");
            const ownerName = p.owner ? String(p.owner.trade_name || p.owner.name || "") : "";
            return (
              <div
                key={p.id}
                onClick={(e) => {
                  // Igual aos Guias Digitais: toque em qualquer ponto abre o menu ⋯.
                  const el = e.target as HTMLElement | null;
                  const interactive = el?.closest(
                    "button, a, input, select, textarea, label, [role='button'], [data-radix-popper-content-wrapper]",
                  );
                  if (interactive && interactive !== e.currentTarget) return;
                  setMenuId(p.id);
                }}
                className={`${PANEL_SHELL} flex h-[112px] min-w-0 cursor-pointer overflow-hidden transition-all`}
              >
                <span className="relative w-24 shrink-0 overflow-hidden bg-foreground/[0.05] text-muted-foreground">
                  <CoverImage urls={[p.hero_image_url, ...(p.gallery_images ?? [])]} />
                  <span
                    className={`absolute left-2 top-2 inline-flex h-[22px] items-center gap-1.5 rounded-full bg-background/70 px-2.5 text-[10.5px] font-extrabold shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)] backdrop-blur-sm ${p.pending ? "ds-falta" : p.active ? "ds-ok" : "ds-atencao"}`}
                  >
                    <span aria-hidden className="size-1.5 rounded-full bg-current" />
                    {p.pending ? "Sem conexão" : p.active ? "Ativo" : "Inativo"}
                  </span>
                  {!p.active && dismissedIds.has(p.id) ? (
                    <span className="absolute inset-x-2 bottom-2 inline-flex h-5 items-center justify-center whitespace-nowrap rounded-full bg-background/80 px-1 text-[10px] font-bold text-muted-foreground backdrop-blur-sm">
                      Não sincronizar
                    </span>
                  ) : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-3 pl-3.5 pr-2.5">
                  <span className="grid min-w-0 gap-1.5">
                    {/* Título + ícone do dossiê (pedido explícito, 21/10/2026): o título termina
                        ANTES do ícone, que fica alinhado à direita, na mesma coluna do ⋯ da linha
                        de baixo (mesmo tamanho: size-7). */}
                    <span className="flex min-w-0 items-start gap-1">
                      <ClampName
                        text={p.name}
                        className="min-w-0 flex-1 text-[14.5px] font-extrabold leading-tight"
                      />
                      <Link
                        to="/admin/playbook/$id"
                        params={{ id: p.id }}
                        title="Playbook do imóvel"
                        aria-label={`Playbook do imóvel ${p.name}`}
                        className="-mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        <FileText className="size-4" />
                      </Link>
                    </span>
                    {place || p.airbnbListingId ? (
                      <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
                        {place ? (
                          <>
                            <MapPin className="size-3 shrink-0" />
                            <span className="min-w-0 truncate">{place}</span>
                          </>
                        ) : null}
                        {/* A etiqueta "Airbnb · Conectado" saiu (pedido explícito, 21/10/2026): conectado é o
                            normal e não precisa de selo. Só o aviso de ativação pendente continua. */}
                        {p.airbnbListingId && pendingFullIds.has(p.id) ? (
                          <span className="ml-auto shrink-0 whitespace-nowrap text-[10.5px] font-extrabold ds-atencao">
                            Pendente de ativação
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    {ownerName ? (
                      <span className="flex min-w-0 items-center gap-1.5 text-xs">
                        <span className="shrink-0 text-[11.5px] text-muted-foreground">
                          Proprietário(a):
                        </span>
                        <span className="min-w-0 truncate font-semibold text-foreground">
                          {ownerName}
                        </span>
                        <PhoneActionButton
                          phone={p.owner?.phone}
                          country={p.owner?.phone_country}
                          size={13}
                          alwaysShow
                          className="shrink-0"
                        />
                      </span>
                    ) : (
                      <span className="flex min-w-0 items-center gap-1.5 text-xs">
                        <span className="shrink-0 text-[11.5px] text-muted-foreground">
                          Proprietário(a):
                        </span>
                        <span className="min-w-0 truncate font-semibold ds-atencao">
                          sem proprietário
                        </span>
                      </span>
                    )}
                    <Popover
                      open={menuId === p.id}
                      onOpenChange={(o) => setMenuId(o ? p.id : null)}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          title="Mais opções"
                          aria-label="Mais opções"
                          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
                          <MoreHorizontal className="size-4" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-56 p-1.5">
                        {p.pending === "chat" ? (
                          <button
                            type="button"
                            onClick={() => void retryChat(p.id)}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary"
                          >
                            <RefreshCw className="size-3.5 text-muted-foreground" /> Tentar ativar o
                            chat de novo
                          </button>
                        ) : null}
                        {p.active ? (
                          <button
                            type="button"
                            disabled={refreshingId !== null}
                            onClick={() => void refreshListing(p.id)}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-60"
                          >
                            <RefreshCw
                              className={`size-3.5 text-muted-foreground ${refreshingId === p.id ? "animate-spin" : ""}`}
                            />{" "}
                            {refreshingId === p.id ? "Atualizando…" : "Atualizar anúncio"}
                          </button>
                        ) : null}
                        {!p.active && dismissedIds.has(p.id) ? (
                          <button
                            type="button"
                            onClick={() => void backToSync(p.id)}
                            className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-bold transition-colors hover:bg-secondary"
                          >
                            <RefreshCw className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                            <span className="grid min-w-0 gap-0.5">
                              Voltar a sincronizar
                              <small className="text-[11px] font-medium leading-snug text-muted-foreground">
                                Volta a aparecer no aviso até ser vinculado ao Airbnb.
                              </small>
                            </span>
                          </button>
                        ) : null}
                        {!p.active ? (
                          <button
                            type="button"
                            disabled={airbnbAccounts.length === 0}
                            onClick={() => {
                              setMenuId(null);
                              setFlow({
                                type: "syncProperty",
                                property: {
                                  id: p.id,
                                  name: p.name,
                                  ownerName: ownerName || null,
                                  ownerPhone: p.owner?.phone,
                                  ownerPhoneCountry: p.owner?.phone_country,
                                },
                              });
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-bold transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
                          >
                            <RefreshCw className="size-3.5 text-muted-foreground" /> Sincronizar com
                            o Airbnb
                          </button>
                        ) : null}
                        <Link
                          to="/admin/properties/$id"
                          params={{ id: p.id }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
                        >
                          <Pencil className="size-3.5 text-muted-foreground" /> Editar imóvel
                        </Link>
                        {hasActiveGuide(p) ? (
                          <button
                            type="button"
                            onClick={() => {
                              setMenuId(null);
                              openPublicGuide(p.slug);
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
                          >
                            <BookOpen className="size-3.5 text-muted-foreground" /> Ver o Guia
                            Digital
                          </button>
                        ) : (
                          <Link
                            to="/admin/properties/$id"
                            params={{ id: p.id }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
                          >
                            <Plus className="size-3.5 text-muted-foreground" /> Criar Guia Digital
                          </Link>
                        )}
                        <button
                          type="button"
                          disabled={!mapsLinkOf(p)}
                          onClick={() => {
                            setMenuId(null);
                            copyText(mapsLinkOf(p) ?? "", "Link do Maps copiado");
                          }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
                        >
                          <Link2 className="size-3.5 text-muted-foreground" /> Copiar link do Maps
                        </button>
                        <button
                          type="button"
                          disabled={!fullAddressOf(p)}
                          onClick={() => {
                            setMenuId(null);
                            copyText(fullAddressOf(p), "Endereço copiado");
                          }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
                        >
                          <Copy className="size-3.5 text-muted-foreground" /> Copiar endereço
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMenuId(null);
                            setInfoId(p.id);
                          }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
                        >
                          <Info className="size-3.5 text-muted-foreground" /> Ver informações
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMenuId(null);
                            setInstr({ id: p.id, kind: "checkin" });
                          }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
                        >
                          <LogIn className="size-3.5 text-muted-foreground" /> Instruções de
                          Check-In
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMenuId(null);
                            setInstr({ id: p.id, kind: "checkout" });
                          }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
                        >
                          <LogOut className="size-3.5 text-muted-foreground" /> Instruções de
                          Checkout
                        </button>
                        {airbnbUrlOf(p) ? (
                          <a
                            href={airbnbUrlOf(p) ?? undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setMenuId(null)}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
                          >
                            <ExternalLink className="size-3.5 text-muted-foreground" /> Abrir no
                            Airbnb
                          </a>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
                          >
                            <ExternalLink className="size-3.5 text-muted-foreground" /> Abrir no
                            Airbnb
                          </button>
                        )}
                      </PopoverContent>
                    </Popover>
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
      <AirbnbAccountFlow request={flow} onClose={() => setFlow(null)} />
      <PropertyInstructionsDialog
        property={items.find((i) => i.id === instr?.id) ?? null}
        kind={instr?.kind ?? "checkin"}
        onOpenChange={(o) => !o && setInstr(null)}
      />
      <PropertyInfoDialog
        property={infoItem ?? null}
        active={!!infoItem?.active}
        ownerName={
          infoItem?.owner ? String(infoItem.owner.trade_name || infoItem.owner.name || "") : ""
        }
        ownerPhone={infoItem?.owner?.phone}
        ownerPhoneCountry={infoItem?.owner?.phone_country}
        onOpenChange={(o) => !o && setInfoId(null)}
      />
    </div>
  );
}
