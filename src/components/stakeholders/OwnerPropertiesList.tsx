import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  Check,
  Copy,
  ExternalLink,
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
import { ACTION_SEGMENT, PANEL_SHELL } from "@/components/dashboard/panel-chrome";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { EmptyState } from "@/components/ds/EmptyState";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
type Sit = "active" | "inactive";

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
  // Vazio = Todos. As duas marcadas também equivalem a Todos.
  const [sel, setSel] = useState<Sit[]>([]);

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
    return properties
      .map((p) => ({
        ...p,
        airbnbListingId: listingById.get(p.id) ?? null,
        active: active.has(p.id),
        owner: p.owner_contact_id ? (ownerById.get(p.owner_contact_id) ?? null) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [properties, owners, connections]);

  const infoItem = items.find((i) => i.id === infoId);
  const nActive = items.filter((i) => i.active).length;
  const nInactive = items.length - nActive;
  const all = sel.length === 0 || sel.length === 2;
  const label = all ? "Todos" : sel[0] === "active" ? "Ativos" : "Inativos";

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((i) => {
      if (!all && !sel.includes(i.active ? "active" : "inactive")) return false;
      if (!term) return true;
      const ownerName = i.owner ? String(i.owner.trade_name || i.owner.name || "") : "";
      return [i.name, ownerName, i.city, i.state]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [items, q, sel, all]);

  function toggle(v: Sit) {
    setSel((cur) => {
      const base = cur.length === 0 ? (["active", "inactive"] as Sit[]) : cur;
      const next = base.includes(v) ? base.filter((x) => x !== v) : [...base, v];
      // Nada marcado ou tudo marcado = Todos.
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
  const row = (
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
        className="w-[240px] rounded-[14px] border-0 bg-popover/95 p-2 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_10%,transparent),inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent),0_24px_48px_-12px_rgba(0,0,0,0.85)] backdrop-blur-xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1.5">
          <span className="ds-eyebrow">Situação</span>
          {!all || sel.length === 2 ? (
            <button
              type="button"
              onClick={() => setSel([])}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Limpar
            </button>
          ) : null}
        </div>
        {row("all", "Todos", items.length, all, () => setSel([]))}
        {row("active", "Ativos", nActive, checked("active"), () => toggle("active"), "ok")}
        {row(
          "inactive",
          "Inativos",
          nInactive,
          checked("inactive"),
          () => toggle("inactive"),
          "atencao",
        )}
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="grid gap-4">
      <SearchActionRow
        value={q}
        onChange={setQ}
        placeholder="Buscar imóvel, proprietário, cidade…"
        actions={statusButton}
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={Home}
          title="Nenhum imóvel encontrado"
          description={q ? `Nenhum resultado para "${q}".` : "Não há imóveis nesta situação."}
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
                    className={`absolute left-2 top-2 inline-flex h-[22px] items-center gap-1.5 rounded-full bg-background/70 px-2.5 text-[10.5px] font-extrabold shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)] backdrop-blur-sm ${p.active ? "ds-ok" : "ds-atencao"}`}
                  >
                    <span aria-hidden className="size-1.5 rounded-full bg-current" />
                    {p.active ? "Ativo" : "Inativo"}
                  </span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-3 pl-3.5 pr-2.5">
                  <span className="grid min-w-0 gap-1.5">
                    <span className="block truncate text-[14.5px] font-extrabold leading-tight">
                      {p.name}
                    </span>
                    {place ? (
                      <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
                        <MapPin className="size-3 shrink-0" />
                        <span className="truncate">{place}</span>
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
                      <span />
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
