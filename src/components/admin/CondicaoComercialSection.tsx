import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { adminGetBillingTerms, adminSaveBillingTerms } from "@/lib/billing/billing-terms.functions";
import { BILLING_ANCHOR_DAY, monthlyTotalCents, STANDARD_TERMS } from "@/lib/billing/listing-billing";
import { friendlyErrorMessage } from "@/lib/friendly-error";

/**
 * Admin SaaS › Condição Comercial / Precificação Especial de uma conta (06/11/2026).
 * Tabela oficial por faixas ou condição negociada: valor por imóvel, piso mínimo, cortesia total.
 * Carência opcional até um dia 25 (todo cliente vence no dia 25). Cartão sempre obrigatório.
 */
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/** Próximos 13 meses em que a cobrança pode começar (sempre no dia 25). */
function startOptions(): Array<{ value: string; label: string }> {
  const now = new Date();
  const out: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 25, 3));
    if (d.getTime() <= Date.now()) continue;
    out.push({
      value: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: `${BILLING_ANCHOR_DAY} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`,
    });
  }
  return out;
}

export function CondicaoComercialSection({ ownerId }: { ownerId: string }) {
  const getFn = useServerFn(adminGetBillingTerms);
  const saveFn = useServerFn(adminSaveBillingTerms);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-billing-terms", ownerId], queryFn: () => getFn({ data: { ownerId } }) });

  const [mode, setMode] = useState<"official" | "custom">("official");
  const [unit, setUnit] = useState("");
  const [minUnits, setMinUnits] = useState("");
  const [courtesy, setCourtesy] = useState(false);
  const [startMonth, setStartMonth] = useState<string>("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const t = q.data;
    if (!t) return;
    setMode(t.mode);
    setUnit(t.unitCents != null ? (t.unitCents / 100).toFixed(2).replace(".", ",") : "");
    setMinUnits(t.minUnits != null ? String(t.minUnits) : "");
    setCourtesy(t.courtesy);
    setStartMonth(t.billingStartsMonth ?? "");
    setNotes(t.notes ?? "");
  }, [q.data]);

  const unitCents = unit.trim() ? Math.round(Number(unit.replace(/\./g, "").replace(",", ".")) * 100) : null;
  const min = minUnits.trim() ? Math.trunc(Number(minUnits)) : null;
  const terms = mode === "custom" ? { unitCents, minUnits: min, courtesy, billingStartsAt: null } : STANDARD_TERMS;
  const options = useMemo(startOptions, []);

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          ownerId,
          mode,
          unitCents: mode === "custom" ? unitCents : null,
          minUnits: mode === "custom" ? min : null,
          courtesy: mode === "custom" ? courtesy : false,
          billingStartsMonth: startMonth || null,
          notes: notes.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Condição comercial salva. A assinatura na Stripe será ajustada em instantes.");
      qc.invalidateQueries({ queryKey: ["admin-billing-terms", ownerId] });
      qc.invalidateQueries({ queryKey: ["admin-customers"] });
    },
    onError: (e) => toast.error(friendlyErrorMessage(e, "Não foi possível salvar a condição comercial.")),
  });

  const invalidUnit = mode === "custom" && unit.trim() !== "" && (unitCents == null || Number.isNaN(unitCents) || unitCents < 100);
  const invalidMin = mode === "custom" && minUnits.trim() !== "" && (min == null || Number.isNaN(min) || min < 1);

  return (
    <div className="sm:col-span-2 rounded-xl border border-border p-3">
      <div className="ds-eyebrow mb-2">Condição Comercial / Precificação Especial</div>
      {q.isLoading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div role="radiogroup" aria-label="Tipo de condição" className="grid grid-cols-2 gap-1 rounded-full bg-secondary/40 p-1">
            {(["official", "custom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`h-9 rounded-full text-[13px] font-semibold transition-colors ${
                  mode === m ? "bg-foreground text-background" : "text-muted-foreground"
                }`}
              >
                {m === "official" ? "Tabela Oficial por Faixas" : "Condição Negociada"}
              </button>
            ))}
          </div>

          {mode === "custom" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cc-unit">Valor por imóvel (R$)</Label>
                <Input
                  id="cc-unit"
                  inputMode="decimal"
                  placeholder="Tabela oficial"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value.replace(/[^\d,.]/g, ""))}
                  disabled={courtesy}
                  aria-invalid={invalidUnit}
                />
                <p className="text-[11px] text-muted-foreground">Em branco = valores da tabela oficial.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cc-min">Piso mínimo (imóveis)</Label>
                <Input
                  id="cc-min"
                  inputMode="numeric"
                  placeholder="3"
                  value={minUnits}
                  onChange={(e) => setMinUnits(e.target.value.replace(/\D/g, ""))}
                  disabled={courtesy}
                  aria-invalid={invalidMin}
                />
                <p className="text-[11px] text-muted-foreground">Mínimo de imóveis cobrados por mês.</p>
              </div>
              <Label className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 sm:col-span-2">
                <span>
                  Cortesia total
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    Nada é cobrado. O cartão continua obrigatório no cadastro.
                  </span>
                </span>
                <Switch checked={courtesy} onCheckedChange={setCourtesy} />
              </Label>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="cc-start">Início da cobrança (carência)</Label>
            <select
              id="cc-start"
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">Sem carência (cobra a partir do cadastro)</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Até essa data o cliente tem acesso total e o cartão fica salvo, sem cobrança. Vencimento sempre no dia {BILLING_ANCHOR_DAY}.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cc-notes">Justificativa comercial</Label>
            <Textarea
              id="cc-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: rede parceira, contrato de 12 meses"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary/30 px-3 py-2 text-[12px]">
            <span className="text-muted-foreground">Simulação</span>
            <span className="tabular-nums">
              {[1, 5, 30].map((n) => `${n} ${n === 1 ? "imóvel" : "imóveis"}: ${courtesy && mode === "custom" ? "Cortesia" : brl(monthlyTotalCents(n, terms))}`).join(" · ")}
            </span>
          </div>

          <div className="flex justify-end">
            <Button type="button" onClick={() => save.mutate()} disabled={save.isPending || invalidUnit || invalidMin}>
              {save.isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Salvar Condição Comercial
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
