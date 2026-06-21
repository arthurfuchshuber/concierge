import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  adminListCustomers,
  adminUpdateSubscription,
  checkIsAdmin,
  type AdminCustomerRow,
} from "@/lib/admin-subs.functions";
import { PLANS, type PlanKey } from "@/lib/payments.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, Users, Pencil, Loader2, Shield } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/clientes")({
  beforeLoad: async () => {
    try {
      const res = await checkIsAdmin();
      if (!res.isAdmin) throw redirect({ to: "/admin" });
    } catch {
      throw redirect({ to: "/admin" });
    }
  },
  component: ClientesPage,
});

const PLAN_OPTIONS: PlanKey[] = ["starter", "pro", "business", "enterprise"];
const STATUS_OPTIONS = ["trialing", "active", "past_due", "paused", "canceled"];
const ENV_OPTIONS = ["sandbox", "live"];

function ClientesPage() {
  const fetcher = useServerFn(adminListCustomers);
  const updater = useServerFn(adminUpdateSubscription);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AdminCustomerRow | null>(null);

  const query = useQuery({
    queryKey: ["admin-customers"],
    queryFn: () => fetcher(),
  });

  const customers = query.data?.customers ?? [];
  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.trim().toLowerCase();
    return customers.filter(
      (c) =>
        c.email?.toLowerCase().includes(q) ||
        c.fullName?.toLowerCase().includes(q) ||
        c.subscription?.plan?.toLowerCase().includes(q),
    );
  }, [customers, search]);

  return (
    <div className="px-5 lg:px-10 py-8 lg:py-10 max-w-7xl mx-auto w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-accent font-semibold mb-2">
            <Shield className="size-3" /> Admin SaaS
          </div>
          <h1 className="font-serif text-3xl md:text-4xl flex items-center gap-2.5">
            <Users className="size-7 text-muted-foreground" /> Clientes
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Gerencie planos, valores e períodos de teste de cada cliente.
          </p>
        </div>
        <div className="relative">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por email, nome ou plano…"
            className="pl-9 w-72"
          />
        </div>
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total" value={customers.length} />
        <StatCard
          label="Ativos"
          value={customers.filter((c) => c.subscription?.status === "active" || c.subscription?.status === "trialing").length}
          tone="emerald"
        />
        <StatCard
          label="Em trial"
          value={customers.filter((c) => c.subscription?.status === "trialing").length}
          tone="amber"
        />
        <StatCard
          label="Cancelados"
          value={customers.filter((c) => c.subscription?.status === "canceled" || c.subscription?.status === "past_due").length}
          tone="muted"
        />
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
        {query.isLoading ? (
          <div className="p-8 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 rounded-xl bg-secondary/40 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center">
            <Users className="size-8 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Nenhum cliente encontrado.</p>
          </div>
        ) : (
          <>
            {/* Mobile: card list */}
            <ul className="sm:hidden divide-y divide-border/60">
              {filtered.map((c) => {
                const s = c.subscription;
                const planName = s?.plan ? PLANS[s.plan].name : null;
                const initials = (c.fullName || c.email || "?")
                  .split(/\s+/)
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase();
                const hasCustom = s?.customPriceCents != null;
                const price = hasCustom
                  ? (s!.customPriceCents! / 100).toLocaleString("pt-BR", {
                      style: "currency",
                      currency: s!.customCurrency || "BRL",
                    })
                  : s?.plan
                    ? PLANS[s.plan].priceLabel
                    : null;
                return (
                  <li key={c.userId} className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="size-10 rounded-full bg-accent/15 text-accent grid place-items-center text-[12px] font-semibold shrink-0">
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{c.fullName ?? "—"}</div>
                        <div className="text-xs text-muted-foreground truncate">{c.email ?? "—"}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          {planName ? (
                            <span className="font-medium">{planName}</span>
                          ) : (
                            <span className="text-muted-foreground/60">Sem plano</span>
                          )}
                          {s?.isManual && (
                            <span className="text-[9px] uppercase tracking-wider font-semibold bg-accent/10 text-accent px-1.5 py-0.5 rounded">
                              Manual
                            </span>
                          )}
                          <StatusBadge status={s?.status} />
                          {price && (
                            <span className="tabular-nums text-muted-foreground">· {price}{hasCustom && " (personalizado)"}</span>
                          )}
                        </div>
                        {(s?.trialEndsAt || s?.currentPeriodEnd) && (
                          <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground tabular-nums">
                            {s?.trialEndsAt && (
                              <span>Trial: {new Date(s.trialEndsAt).toLocaleDateString("pt-BR")}</span>
                            )}
                            {s?.currentPeriodEnd && (
                              <span>Renova: {new Date(s.currentPeriodEnd).toLocaleDateString("pt-BR")}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full shrink-0"
                        onClick={() => setEditing(c)}
                      >
                        <Pencil className="size-3 mr-1" /> Editar
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Desktop: table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead className="bg-secondary/30 text-[10px] uppercase tracking-[0.14em] text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left font-semibold px-5 py-3.5">Cliente</th>
                    <th className="text-left font-semibold px-4 py-3.5">Plano</th>
                    <th className="text-left font-semibold px-4 py-3.5">Status</th>
                    <th className="text-right font-semibold px-4 py-3.5">Valor</th>
                    <th className="text-left font-semibold px-4 py-3.5">Trial</th>
                    <th className="text-left font-semibold px-4 py-3.5">Renova</th>
                    <th className="text-right font-semibold px-5 py-3.5">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, idx) => {
                    const s = c.subscription;
                    const planName = s?.plan ? PLANS[s.plan].name : null;
                    const initials = (c.fullName || c.email || "?")
                      .split(/\s+/)
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase();
                    const hasCustom = s?.customPriceCents != null;
                    const price = hasCustom
                      ? (s!.customPriceCents! / 100).toLocaleString("pt-BR", {
                          style: "currency",
                          currency: s!.customCurrency || "BRL",
                        })
                      : s?.plan
                        ? PLANS[s.plan].priceLabel
                        : null;
                    return (
                      <tr
                        key={c.userId}
                        className={`border-t border-border/60 hover:bg-secondary/20 transition-colors ${idx % 2 === 1 ? "bg-secondary/[0.04]" : ""}`}
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="size-9 rounded-full bg-accent/15 text-accent grid place-items-center text-[11px] font-semibold shrink-0">
                              {initials}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium truncate">{c.fullName ?? "—"}</div>
                              <div className="text-xs text-muted-foreground truncate">{c.email ?? "—"}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          {planName ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium">{planName}</span>
                              {s?.isManual && (
                                <span className="text-[9px] uppercase tracking-wider font-semibold bg-accent/10 text-accent px-1.5 py-0.5 rounded">
                                  Manual
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge status={s?.status} />
                        </td>
                        <td className="px-4 py-4 text-right">
                          {price ? (
                            <div className="font-medium tabular-nums">
                              {price}
                              {hasCustom && (
                                <div className="text-[10px] uppercase tracking-wider text-accent font-semibold">
                                  personalizado
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-xs tabular-nums whitespace-nowrap">
                          {s?.trialEndsAt ? (
                            new Date(s.trialEndsAt).toLocaleDateString("pt-BR")
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-xs tabular-nums whitespace-nowrap">
                          {s?.currentPeriodEnd ? (
                            new Date(s.currentPeriodEnd).toLocaleDateString("pt-BR")
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-full"
                            onClick={() => setEditing(c)}
                          >
                            <Pencil className="size-3 mr-1" /> Editar
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {editing && (
        <EditDialog
          customer={editing}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            try {
              await updater({ data: { userId: editing.userId, ...values } });
              toast.success("Assinatura atualizada");
              qc.invalidateQueries({ queryKey: ["admin-customers"] });
              setEditing(null);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Erro ao salvar");
            }
          }}
        />
      )}
    </div>
  );
}

type EditValues = {
  plan: PlanKey;
  status: string;
  environment: "sandbox" | "live";
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  customPriceCents: number | null;
  customCurrency: string | null;
  cancelAtPeriodEnd: boolean;
  adminNotes: string | null;
  maxGuidesOverride: number | null;
  billingPaused: boolean;
};

function toDateInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function fromDateInput(s: string) {
  if (!s) return null;
  return new Date(`${s}T23:59:59Z`).toISOString();
}

function EditDialog({
  customer,
  onClose,
  onSave,
}: {
  customer: AdminCustomerRow;
  onClose: () => void;
  onSave: (v: EditValues) => Promise<void>;
}) {
  const s = customer.subscription;
  const [plan, setPlan] = useState<PlanKey>(s?.plan ?? "starter");
  const [status, setStatus] = useState<string>(s?.status ?? "active");
  const [environment, setEnvironment] = useState<"sandbox" | "live">(
    (s?.environment as "sandbox" | "live") ?? "sandbox",
  );
  const [trialEndsAt, setTrialEndsAt] = useState(toDateInput(s?.trialEndsAt));
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState(toDateInput(s?.currentPeriodEnd));
  const [customPrice, setCustomPrice] = useState(
    s?.customPriceCents != null ? (s.customPriceCents / 100).toString() : "",
  );
  const [customCurrency, setCustomCurrency] = useState(s?.customCurrency ?? "BRL");
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(!!s?.cancelAtPeriodEnd);
  const [adminNotes, setAdminNotes] = useState(s?.adminNotes ?? "");
  const [maxGuidesOverride, setMaxGuidesOverride] = useState(
    s?.maxGuidesOverride != null ? String(s.maxGuidesOverride) : "",
  );
  const [billingPaused, setBillingPaused] = useState(!!s?.billingPaused);

  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const price = customPrice.trim() ? Math.round(Number(customPrice) * 100) : null;
    if (price != null && (Number.isNaN(price) || price < 0)) {
      toast.error("Valor inválido");
      setSaving(false);
      return;
    }
    const maxGuides = maxGuidesOverride.trim() ? Math.trunc(Number(maxGuidesOverride)) : null;
    if (maxGuides != null && (Number.isNaN(maxGuides) || maxGuides < 1)) {
      toast.error("Limite de guias inválido");
      setSaving(false);
      return;
    }
    try {
      await onSave({
        plan,
        status,
        environment,
        trialEndsAt: fromDateInput(trialEndsAt),
        currentPeriodEnd: fromDateInput(currentPeriodEnd),
        customPriceCents: price,
        customCurrency: price != null ? customCurrency.toUpperCase() : null,
        cancelAtPeriodEnd,
        adminNotes: adminNotes.trim() || null,
        maxGuidesOverride: maxGuides,
        billingPaused,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar assinatura</DialogTitle>
          <DialogDescription>
            {customer.fullName ?? customer.email} — alterações são imediatas.
          </DialogDescription>
        </DialogHeader>

        <div className="grid sm:grid-cols-2 gap-4 mt-2">
          <div className="space-y-1.5">
            <Label>Plano</Label>
            <Select value={plan} onValueChange={(v) => setPlan(v as PlanKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLAN_OPTIONS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PLANS[p].name} — {PLANS[p].priceLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Ambiente</Label>
            <Select value={environment} onValueChange={(v) => setEnvironment(v as "sandbox" | "live")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ENV_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{s === "sandbox" ? "Teste" : "Produção"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Trial gratuito até</Label>
            <DatePicker
              value={trialEndsAt}
              onChange={setTrialEndsAt}
              placeholder="Sem trial"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Próxima renovação</Label>
            <DatePicker
              value={currentPeriodEnd}
              onChange={setCurrentPeriodEnd}
              placeholder="Sem renovação programada"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center justify-between">
              Cancelar no fim do período
              <Switch
                checked={cancelAtPeriodEnd}
                onCheckedChange={setCancelAtPeriodEnd}
              />
            </Label>
            <p className="text-xs text-muted-foreground">
              Se ativo, o cliente mantém acesso até a data acima e depois é cancelado.
            </p>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Valor personalizado a cobrar</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder={s?.plan ? PLANS[s.plan].priceLabel : "Ex: 149.90"}
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
                className="flex-1"
              />
              <Input
                value={customCurrency}
                onChange={(e) => setCustomCurrency(e.target.value.toUpperCase().slice(0, 3))}
                placeholder="BRL"
                className="w-24"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Deixe em branco para usar o preço padrão do plano. Use isso para descontos especiais ou contratos.
            </p>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Limite de guias (override)</Label>
            <Input
              type="number"
              step="1"
              min="1"
              placeholder={`Padrão do plano: ${PLANS[plan].maxGuides >= 9999 ? "ilimitado" : PLANS[plan].maxGuides}`}
              value={maxGuidesOverride}
              onChange={(e) => setMaxGuidesOverride(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Deixe em branco para usar o limite padrão do plano. Use para contratos Enterprise com limite customizado.
            </p>
          </div>

          <div className="space-y-1.5 sm:col-span-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <Label className="flex items-center justify-between text-amber-700 dark:text-amber-400">
              Pausar cobranças deste cliente
              <Switch checked={billingPaused} onCheckedChange={setBillingPaused} />
            </Label>
            <p className="text-xs text-muted-foreground">
              Quando ativo, o cliente mantém o acesso mas <strong>nenhuma cobrança</strong> é feita.
              Desative para retomar as cobranças.
            </p>
          </div>


          <div className="space-y-1.5 sm:col-span-2">
            <Label>Anotações internas</Label>
            <Textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder="Visíveis apenas para administradores"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="size-4 mr-1.5 animate-spin" />}
            Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "amber" | "muted" }) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-semibold">{label}</div>
      <div className={`text-2xl font-serif mt-1 tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status?: string | null }) {
  const map: Record<string, { label: string; className: string; dot: string }> = {
    active: { label: "Ativo", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20", dot: "bg-emerald-500" },
    trialing: { label: "Trial", className: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20", dot: "bg-sky-500" },
    past_due: { label: "Atrasado", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20", dot: "bg-amber-500" },
    paused: { label: "Pausado", className: "bg-secondary text-muted-foreground border-border", dot: "bg-muted-foreground" },
    canceled: { label: "Cancelado", className: "bg-secondary text-muted-foreground border-border", dot: "bg-muted-foreground/60" },
  };
  const info = status ? map[status] : null;
  if (!info) {
    return <span className="text-xs text-muted-foreground/60">sem plano</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full border ${info.className}`}>
      <span className={`size-1.5 rounded-full ${info.dot}`} />
      {info.label}
    </span>
  );
}
