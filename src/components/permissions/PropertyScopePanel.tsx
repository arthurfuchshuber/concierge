import { useMemo, useState } from "react";
import { Home, MapPin, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OwnerLine } from "@/components/dashboard/OwnerLine";
import type { CenterProperty } from "@/lib/permissions/permission.center.server";

const ALL = "__all__";

/**
 * Quadrante de residências atendidas: busca, filtros por cidade e proprietário,
 * seleção múltipla e ativação em massa.
 */
export function PropertyScopePanel({
  properties,
  disabled,
  pending,
  onToggle,
  onBulk,
}: {
  properties: CenterProperty[];
  disabled?: boolean;
  pending?: boolean;
  onToggle: (propertyId: string, assigned: boolean) => void;
  onBulk: (propertyIds: string[], assigned: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [city, setCity] = useState(ALL);
  const [owner, setOwner] = useState(ALL);
  const [selected, setSelected] = useState<string[]>([]);

  const cities = useMemo(
    () => [...new Set(properties.map((p) => p.city).filter((c): c is string => !!c))].sort(),
    [properties],
  );
  const owners = useMemo(
    () =>
      [...new Set(properties.map((p) => p.ownerName).filter((o): o is string => !!o))].sort(),
    [properties],
  );

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return properties.filter((p) => {
      if (city !== ALL && p.city !== city) return false;
      if (owner !== ALL && p.ownerName !== owner) return false;
      if (!q) return true;
      return [p.name, p.address, p.city, p.ownerName]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [properties, term, city, owner]);

  const filteredIds = filtered.map((p) => p.id);
  const selectedVisible = selected.filter((id) => filteredIds.includes(id));
  const allVisibleSelected = filteredIds.length > 0 && selectedVisible.length === filteredIds.length;

  function toggleSelect(id: string, on: boolean) {
    setSelected((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  }

  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Home className="h-4 w-4" /> Residências que esta pessoa atende
        </span>
        <span className="text-xs text-muted-foreground">
          {properties.filter((p) => p.assigned).length} de {properties.length}
        </span>
      </button>

      {open ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Buscar por anúncio, endereço ou proprietário"
                className="h-9 pl-8"
              />
            </div>
            <Select value={city} onValueChange={setCity}>
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue placeholder="Cidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as cidades</SelectItem>
                {cities.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={owner} onValueChange={setOwner}>
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue placeholder="Proprietário" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os proprietários</SelectItem>
                {owners.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={(v) => setSelected(v ? filteredIds : [])}
                disabled={disabled || filteredIds.length === 0}
              />
              Selecionar {filtered.length} visíveis
            </label>
            <span className="ml-auto text-xs text-muted-foreground">
              {selectedVisible.length} selecionadas
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || pending || selectedVisible.length === 0}
              onClick={() => onBulk(selectedVisible, true)}
            >
              Ativar
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || pending || selectedVisible.length === 0}
              onClick={() => onBulk(selectedVisible, false)}
            >
              Desativar
            </Button>
          </div>

          <div className="divide-y rounded-lg border">
            {filtered.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                Nenhuma residência encontrada com estes filtros.
              </p>
            ) : (
              filtered.map((p) => (
                <div key={p.id} className="flex items-start gap-3 px-3 py-3">
                  <Checkbox
                    className="mt-1"
                    checked={selected.includes(p.id)}
                    onCheckedChange={(v) => toggleSelect(p.id, !!v)}
                    disabled={disabled}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    {p.address ? (
                      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {p.address}
                      </p>
                    ) : null}
                    {p.city ? (
                      <p className="text-xs text-muted-foreground">
                        {p.city}
                        {p.state ? ` — ${p.state}` : ""}
                      </p>
                    ) : null}
                    <OwnerLine
                      name={p.ownerName}
                      phone={p.ownerPhone}
                      country={p.ownerPhoneCountry}
                    />
                  </div>
                  <Switch
                    className="ml-auto mt-1 shrink-0"
                    checked={p.assigned}
                    disabled={disabled || pending}
                    onCheckedChange={(v) => onToggle(p.id, v)}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
