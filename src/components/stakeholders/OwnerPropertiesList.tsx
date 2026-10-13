import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Home, MapPin } from "lucide-react";
import { SearchActionRow } from "@/components/dashboard/SearchActionRow";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { EmptyState } from "@/components/ds/EmptyState";
import { CARD_OWNER } from "@/components/dashboard/card-colors";
import type { PropertyConnectionRow } from "@/lib/property-connection";

/**
 * ABA "IMÓVEIS" DA PÁGINA PROPRIETÁRIOS (mockup aprovado, 13/10/2026): lista
 * rápida de todos os imóveis da conta, cada um com miniatura, nome,
 * "Proprietário(a): nome" + ícone de mensagem padrão, cidade/UF e a situação
 * (Ativo/Inativo — mesma definição de `property-connection.ts`).
 */
type Prop = {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  owner_contact_id?: string | null;
  hero_image_url?: string | null;
};
type Owner = Record<string, any>;

type Situation = "all" | "active" | "inactive";

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
  const [sit, setSit] = useState<Situation>("all");

  const items = useMemo(() => {
    const active = new Set(
      connections.filter((c) => c.airbnb_listing_id).map((c) => c.property_id),
    );
    const ownerById = new Map(owners.map((o) => [o.id as string, o]));
    return properties
      .map((p) => ({
        ...p,
        active: active.has(p.id),
        owner: p.owner_contact_id ? (ownerById.get(p.owner_contact_id) ?? null) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [properties, owners, connections]);

  const nActive = items.filter((i) => i.active).length;
  const nInactive = items.length - nActive;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((i) => {
      if (sit === "active" && !i.active) return false;
      if (sit === "inactive" && i.active) return false;
      if (!term) return true;
      const ownerName = i.owner ? String(i.owner.trade_name || i.owner.name || "") : "";
      return [i.name, ownerName, i.city, i.state]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [items, q, sit]);

  const chip = (value: Situation, label: string, n: number, dot?: "ok" | "falta") => {
    const on = sit === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => setSit(value)}
        className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-semibold transition-colors ${
          on
            ? "bg-foreground/[0.08] text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_20%,transparent)]"
            : "text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent)] hover:text-foreground"
        }`}
      >
        {dot ? (
          <span
            aria-hidden
            className={`size-1.5 rounded-full bg-current ${dot === "ok" ? "ds-ok" : "ds-falta"}`}
          />
        ) : null}
        {label} <b className="font-extrabold tabular-nums">{n}</b>
      </button>
    );
  };

  return (
    <div className="grid gap-4">
      <SearchActionRow
        value={q}
        onChange={setQ}
        placeholder="Buscar imóvel, proprietário, cidade…"
      />
      <div className="ds-segmented flex gap-1.5">
        {chip("all", "Todos", items.length)}
        {chip("active", "Ativos", nActive, "ok")}
        {chip("inactive", "Inativos", nInactive, "falta")}
      </div>

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
              <Link
                key={p.id}
                to="/admin/properties/$id"
                params={{ id: p.id }}
                className={`${PANEL_SHELL} flex min-w-0 gap-3 p-2.5 transition-all ${p.active ? "" : "opacity-80"}`}
              >
                <span className="relative grid size-[84px] shrink-0 place-items-center overflow-hidden rounded-[10px] bg-foreground/[0.05] text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]">
                  {p.hero_image_url ? (
                    <img
                      src={p.hero_image_url}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <Home className="size-[22px]" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col justify-between py-0.5 pr-0.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-bold leading-tight">
                      {p.name}
                    </span>
                    {ownerName ? (
                      <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs">
                        <span className="ds-faint shrink-0">Proprietário(a):</span>
                        <span className={`min-w-0 truncate font-semibold ${CARD_OWNER}`}>
                          {ownerName}
                        </span>
                        <PhoneActionButton
                          phone={p.owner?.phone}
                          country={p.owner?.phone_country}
                          size={13}
                          alwaysShow
                        />
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    {place ? (
                      <span className="ds-meta flex min-w-0 items-center gap-1.5">
                        <MapPin className="size-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{place}</span>
                      </span>
                    ) : (
                      <span />
                    )}
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 text-[11px] font-bold ${p.active ? "ds-ok" : "ds-atencao"}`}
                    >
                      <span aria-hidden className="size-1.5 rounded-full bg-current" />
                      {p.active ? "Ativo" : "Inativo"}
                    </span>
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
