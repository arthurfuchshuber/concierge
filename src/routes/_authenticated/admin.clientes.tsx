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
import { Search, Users, Pencil, Loader2 } from "lucide-react";
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

      <div className="mt-6 rounded-2xl border border-border bg-card overflow-hidden">
        {query.isLoading ? (
          <div className="p-8 h-40 animate-pulse" />
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Nenhum cliente encontrado.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Cliente</th>
                  <th className="text-left font-medium px-4 py-3">Plano</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="text-left font-medium px-4 py-3">Valor</th>
                  <th className="text-left font-medium px-4 py-3">Trial até</th>
                  <th className="text-left font-medium px-4 py-3">Renova</th>
                  <th className="text-right font-medium px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const s = c.subscription;
                  const planName = s?.plan ? PLANS[s.plan].name : "—";
                  const price =
                    s?.customPriceCents != null
                      ? (s.customPriceCents / 100).toLocaleString("pt-BR", {
                          style: "currency",
                          currency: s.customCurrency || "BRL",
                        }) + " (custom)"
                      : s?.plan
                        ? PLANS[s.plan].priceLabel
                        : "—";
                  return (
                    <tr key={c.userId} className="border-t border-border hover:bg-secondary/20">
                      <td className="px-4 py-3">
                        <div className="font-medium">{c.fullName ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{c.email ?? "—"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium">{planName}</span>
                        {s?.isManual && (
                          <span className="ml-1.5 text-[10px] uppercase tracking-wider font-semibold bg-accent/10 text-accent px-1.5 py-0.5 rounded-full">
                            Manual
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${
                            s?.status === "active" || s?.status === "trialing"
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : s?.status === "past_due"
                                ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                                : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          {s?.status ?? "sem plano"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">{price}</td>
                      <td className="px-4 py-3 text-xs">
                        {s?.trialEndsAt
                          ? new Date(s.trialEndsAt).toLocaleDateString("pt-BR")
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {s?.currentPeriodEnd
                          ? new Date(s.currentPeriodEnd).toLocaleDateString("pt-BR")
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
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
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const price = customPrice.trim() ? Math.round(Number(customPrice) * 100) : null;
    if (price != null && (Number.isNaN(price) || price < 0)) {
      toast.error("Valor inválido");
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
            <Input
              type="date"
              value={trialEndsAt}
              onChange={(e) => setTrialEndsAt(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Próxima renovação</Label>
            <Input
              type="date"
              value={currentPeriodEnd}
              onChange={(e) => setCurrentPeriodEnd(e.target.value)}
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
