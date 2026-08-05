import { useMemo, useState } from "react";
import { Home, MapPin, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
 * seleção múltipla e ativação em massa. Cada residência é um item expansivo
 * (somente um aberto por vez) mostrando por padrão apenas o título do anúncio
 * e a linha do proprietário.
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
  const [openItem, setOpenItem] = useState<string>("");

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
    const list = properties.filter((p) => {
      if (city !== ALL && p.city !== city) return false;
      if (owner !== ALL && p.ownerName !== owner) return false;
      if (!q) return true;
      return [p.name, p.address, p.city, p.ownerName]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q));
    });
    // Ordem fixa: cidade (A→Z) → status do guia (publicados primeiro) → proprietário (A→Z).
    const cmp = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" });
    return list.sort(
      (a, b) =>
        cmp(a.city ?? "zzz", b.city ?? "zzz") ||
        Number(b.published) - Number(a.published) ||
        cmp(a.ownerName ?? "zzz", b.ownerName ?? "zzz") ||
        cmp(a.name, b.name),
    );
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
          <div className="space-y-2">
            <div className="relative w-full">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Buscar por anúncio, endereço ou proprietário"
                className="h-9 w-full pl-8"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select value={city} onValueChange={setCity}>
                <SelectTrigger className="h-9 w-full min-w-0">
                  <SelectValue placeholder="Cidades" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Cidades</SelectItem>
                  {cities.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger className="h-9 w-full min-w-0">
                  <SelectValue placeholder="Proprietários" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Proprietários</SelectItem>
                  {owners.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-2">
              <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={(v) => setSelected(v ? filteredIds : [])}
                  disabled={disabled || filteredIds.length === 0}
                />
                <span className="truncate">Selecionar {filtered.length} visíveis</span>
              </label>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {selectedVisible.length} selecionadas
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                disabled={disabled || pending || selectedVisible.length === 0}
                onClick={() => onBulk(selectedVisible, true)}
              >
                Ativar
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                disabled={disabled || pending || selectedVisible.length === 0}
                onClick={() => onBulk(selectedVisible, false)}
              >
                Desativar
              </Button>
            </div>
          </div>


          <div className="overflow-hidden rounded-lg border">
            {filtered.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                Nenhuma residência encontrada com estes filtros.
              </p>
            ) : (
              <Accordion
                type="single"
                collapsible
                value={openItem}
                onValueChange={setOpenItem}
                className="divide-y"
              >
                {filtered.map((p) => (
                  <AccordionItem key={p.id} value={p.id} className="border-0">
                    <div className="flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden px-3 py-2">
                      <span className="shrink-0">
                        <Checkbox
                          checked={selected.includes(p.id)}
                          onCheckedChange={(v) => toggleSelect(p.id, !!v)}
                          disabled={disabled}
                        />
                      </span>
                      <AccordionTrigger className="min-w-0 flex-1 overflow-hidden py-1 hover:no-underline [&>svg]:shrink-0">

                        <div className="min-w-0 max-w-full flex-1 space-y-0.5 overflow-hidden text-left">
                          <p className="truncate text-sm font-medium" title={p.name}>
                            {p.name}
                          </p>
                          <OwnerLine
                            name={p.ownerName}
                            phone={p.ownerPhone}
                            country={p.ownerPhoneCountry}
                          />
                        </div>
                      </AccordionTrigger>

                      <Switch
                        className="shrink-0"
                        checked={p.assigned}
                        disabled={disabled || pending}
                        onCheckedChange={(v) => onToggle(p.id, v)}
                      />
                    </div>
                    <AccordionContent className="px-3 pb-3 pl-11">
                      <div className="space-y-1">
                        {p.address ? (
                          <p className="flex items-start gap-1 text-xs text-muted-foreground">
                            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                            {p.address}
                          </p>
                        ) : null}
                        {p.city ? (
                          <p className="text-xs text-muted-foreground">
                            {p.city}
                            {p.state ? ` — ${p.state}` : ""}
                          </p>
                        ) : null}
                        <p className="text-xs">
                          <span className="text-muted-foreground">Guia: </span>
                          <span className={p.published ? "text-emerald-500" : "text-amber-500"}>
                            {p.published ? "Publicado" : "Desativado"}
                          </span>
                        </p>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
