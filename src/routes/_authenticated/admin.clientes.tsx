import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  adminListCustomers,
  adminUpdateSubscription,
  adminUpdateCustomerProfile,
  adminListUserProperties,
  adminApplyCustomTrial,
  checkIsAdmin,
  type AdminCustomerRow,
} from "@/lib/admin-subs.functions";

import {
  adminCreateEnterpriseSubscription,
  adminAnchorSubscriptionToDay1,
  adminCancelEnterpriseSubscription,
} from "@/lib/admin-enterprise.functions";
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
import { Search, Users, Pencil, Loader2, Shield, Crown, Anchor, Ban, Calendar, Filter, MessageCircle } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";
import { toast } from "sonner";
import { formatCPF, onlyDigits, isValidCPF, isValidEmail, titleCaseName, formatIntlPhone, toE164, toWhatsappNumber, isValidIntlPhone } from "@/lib/masks";
import PhoneInput, { type Country } from "react-phone-number-input";
import "react-phone-number-input/style.css";


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

function WhatsAppLink({
  phone,
  country,
  className,
}: {
  phone: string | null;
  country: string | null;
  className?: string;
}) {
  if (!phone) return null;
  const waNumber = toWhatsappNumber(phone, country);
  if (!waNumber) return null;
  const label = formatIntlPhone(phone, country);
  return (
    <a
      href={`https://wa.me/${waNumber}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 text-[11px] font-medium tabular-nums transition",
        className,
      )}
    >
      <MessageCircle className="size-3" />
      {label}
    </a>
  );
}


type StatusFilter = "all" | "active" | "trialing" | "canceled" | "past_due" | "incomplete";
type PlanFilter = "all" | PlanKey | "none";

function isIncomplete(c: AdminCustomerRow) {
  return !c.subscription;
}

function ClientesPage() {
  const fetcher = useServerFn(adminListCustomers);
  const updater = useServerFn(adminUpdateSubscription);
  const profileUpdater = useServerFn(adminUpdateCustomerProfile);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AdminCustomerRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [planFilter, setPlanFilter] = useState<PlanFilter>("all");
  const [churnOnly, setChurnOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const query = useQuery({
    queryKey: ["admin-customers"],
    queryFn: () => fetcher(),
  });

  const customers = query.data?.customers ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (q) {
        const hay = `${c.email ?? ""} ${c.fullName ?? ""} ${c.subscription?.plan ?? ""} ${c.phone ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter !== "all") {
        if (statusFilter === "incomplete") {
          if (!isIncomplete(c)) return false;
        } else if (c.subscription?.status !== statusFilter) return false;
      }
      if (planFilter !== "all") {
        if (planFilter === "none") {
          if (c.subscription) return false;
        } else if (c.subscription?.plan !== planFilter) return false;
      }
      if (churnOnly && !c.churnRisk) return false;
      return true;
    });
  }, [customers, search, statusFilter, planFilter, churnOnly]);

  const activeFilterCount =
    (statusFilter !== "all" ? 1 : 0) + (planFilter !== "all" ? 1 : 0) + (churnOnly ? 1 : 0);

  return (
    <div className="px-5 lg:px-10 py-8 lg:py-10 max-w-7xl mx-auto w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-accent font-semibold mb-2">
            <Shield className="size-3" /> Admin SaaS
          </div>
          <h1 className="font-display text-3xl md:text-4xl flex items-center gap-2.5">
            <Users className="size-7 text-muted-foreground" /> Clientes
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Gerencie planos, valores e períodos de teste de cada cliente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por email, nome, plano ou telefone…"
              className="pl-9 w-72"
            />
          </div>
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label="Filtros"
                className="relative size-10 rounded-full shrink-0"
              >
                <Filter className="size-4" />
                {activeFilterCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full text-[9px] font-semibold flex items-center justify-center bg-primary text-primary-foreground"
                  >
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[min(92vw,380px)] sm:max-w-md">
              <SheetHeader>
                <SheetTitle>Filtros</SheetTitle>
              </SheetHeader>
              <div className="space-y-5 py-4">
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Status</label>
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                    <SelectTrigger className="mt-1.5 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="active">Ativos</SelectItem>
                      <SelectItem value="trialing">Em trial</SelectItem>
                      <SelectItem value="past_due">Atrasados</SelectItem>
                      <SelectItem value="canceled">Cancelados</SelectItem>
                      <SelectItem value="incomplete">Cadastro incompleto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Plano</label>
                  <Select value={planFilter} onValueChange={(v) => setPlanFilter(v as PlanFilter)}>
                    <SelectTrigger className="mt-1.5 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="none">Sem plano</SelectItem>
                      {PLAN_OPTIONS.map((p) => (
                        <SelectItem key={p} value={p}>{PLANS[p].name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2.5 cursor-pointer">
                  <span className="text-sm">Somente risco de churn</span>
                  <Checkbox checked={churnOnly} onCheckedChange={(v) => setChurnOnly(!!v)} />
                </label>
              </div>
              <SheetFooter className="flex-row gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setStatusFilter("all");
                    setPlanFilter("all");
                    setChurnOnly(false);
                  }}
                >
                  Limpar
                </Button>
                <Button className="flex-1" onClick={() => setFiltersOpen(false)}>Aplicar</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Stats — refletem os filtros aplicados */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard label="Total" value={filtered.length} />
        <StatCard
          label="Ativos"
          value={filtered.filter((c) => c.subscription?.status === "active" || c.subscription?.status === "trialing").length}
          tone="emerald"
        />
        <StatCard
          label="Em trial"
          value={filtered.filter((c) => c.subscription?.status === "trialing").length}
          tone="amber"
        />
        <StatCard
          label="Cadastro incompleto"
          value={filtered.filter(isIncomplete).length}
          tone="muted"
        />
        <StatCard
          label="Cancelados"
          value={filtered.filter((c) => c.subscription?.status === "canceled" || c.subscription?.status === "past_due").length}
          tone="muted"
        />
        <StatCard
          label="Risco de churn"
          value={filtered.filter((c) => c.churnRisk).length}
          tone="red"
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
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium truncate text-[15px] leading-tight">{c.fullName ?? "—"}</div>
                            <div className="text-[11px] text-muted-foreground truncate">{c.email ?? "—"}</div>
                            <WhatsAppLink phone={c.phone} country={c.phoneCountry} className="mt-1" />
                          </div>
                          <div className="shrink-0 flex items-center gap-1">
                            <OpenGuidesButton userId={c.userId} email={c.email} />
                            <button
                              type="button"
                              onClick={() => setEditing(c)}
                              className="size-8 grid place-items-center rounded-full border border-border hover:bg-secondary text-muted-foreground hover:text-foreground transition"
                              aria-label="Editar cliente"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                          </div>

                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {planName ? (
                            <span className="text-[11px] font-semibold">{planName}</span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground/60">Sem plano</span>
                          )}
                          <StatusBadge status={s?.status} userStatus={c.userStatus} />
                          {s?.billingPaused && (
                            <span className="text-[9px] uppercase tracking-wider font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full">
                              Sem cobrança
                            </span>
                          )}
                          {c.churnRisk && (
                            <span className="text-[9px] uppercase tracking-wider font-semibold bg-red-500/15 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-full">
                              Risco churn
                            </span>
                          )}
                        </div>
                        {price && (
                          <div className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">
                            {price}{hasCustom && " · personalizado"}
                          </div>
                        )}
                        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                          <span>{c.publishedGuides}/{c.totalGuides} guias</span>
                          <span>·</span>
                          <span>{c.guestAccesses30d > 0 ? `${c.guestAccesses30d} acessos 30d` : "Sem hóspedes"}</span>
                          <span>·</span>
                          <span>Login: {c.lastSignInAt ? new Date(c.lastSignInAt).toLocaleDateString("pt-BR") : "Nunca"}</span>
                        </div>
                      </div>
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
                    <th className="text-left font-semibold px-4 py-3.5">Guias</th>
                    <th className="text-left font-semibold px-4 py-3.5">Hóspedes 30d</th>
                    <th className="text-left font-semibold px-4 py-3.5">Último login</th>
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
                              <WhatsAppLink phone={c.phone} country={c.phoneCountry} className="mt-1" />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          {planName ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium">{planName}</span>
                              {s?.billingPaused && (
                                <span className="text-[9px] uppercase tracking-wider font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">
                                  Sem cobrança
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground/70 italic">Sem plano</span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge status={s?.status} userStatus={c.userStatus} />
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
                          <div className="flex items-center gap-1.5">
                            <span className={c.publishedGuides > 0 ? "font-medium" : "text-muted-foreground"}>
                              {c.publishedGuides}/{c.totalGuides}
                            </span>
                            {c.totalGuides > 0 && (
                              <div className="w-12 h-1.5 rounded-full bg-secondary overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${c.avgCompletenessScore >= 70 ? "bg-emerald-500" : c.avgCompletenessScore >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                                  style={{ width: `${c.avgCompletenessScore}%` }}
                                />
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-xs tabular-nums whitespace-nowrap">
                          <span className={c.guestAccesses30d > 0 ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
                            {c.guestAccesses30d > 0 ? c.guestAccesses30d : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-xs whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {c.churnRisk && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider">
                                Risco
                              </span>
                            )}
                            <span className="text-muted-foreground">
                              {c.lastSignInAt ? new Date(c.lastSignInAt).toLocaleDateString("pt-BR") : "Nunca"}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <OpenGuidesButton userId={c.userId} email={c.email} />
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-full"
                              onClick={() => setEditing(c)}
                            >
                              <Pencil className="size-3 mr-1" /> Editar
                            </Button>
                          </div>
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
              const { fullName, cpf, phone, plan, ...rest } = values;
              await profileUpdater({ data: { userId: editing.userId, fullName, cpf, phone, phoneCountry: "55" } });

              if (plan) {
                await updater({ data: { userId: editing.userId, plan, ...rest } });
              }
              toast.success("Cliente atualizado");
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
  fullName: string | null;
  cpf: string | null;
  phone: string | null;
  phoneCountry: string | null;
  plan: PlanKey | null;
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
  const [fullName, setFullName] = useState(customer.fullName ?? "");
  const [cpf, setCpf] = useState(formatCPF(customer.cpf ?? ""));
  const initialPhoneE164 = toE164(customer.phone ?? "", customer.phoneCountry ?? undefined);
  const [phone, setPhone] = useState<string | undefined>(initialPhoneE164 || undefined);
  const [phoneCountry, setPhoneCountry] = useState<Country>(
    (customer.phoneCountry && /^[A-Za-z]{2}$/.test(customer.phoneCountry)
      ? (customer.phoneCountry.toUpperCase() as Country)
      : "BR"),
  );
  // null = "Sem plano" (não cria/atualiza assinatura). Quando o usuário não
  // tem assinatura, o padrão é "Sem plano" — coerente com o pedido do
  // anfitrião de não forçar plano em quem ainda não contratou.
  const [plan, setPlan] = useState<PlanKey | null>(s?.plan ?? null);
  const [status, setStatus] = useState<string>(s?.status ?? "active");
  const [environment, setEnvironment] = useState<"sandbox" | "live">(
    (s?.environment as "sandbox" | "live") ?? "live",
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
    // Validação obrigatória: nome, CPF e telefone celular.
    const cleanedName = titleCaseName(fullName);
    if (!cleanedName || cleanedName.trim().split(/\s+/).length < 2) {
      toast.error("Informe o nome completo do cliente (nome e sobrenome).");
      return;
    }
    const cpfDigits = onlyDigits(cpf);
    if (!isValidCPF(cpfDigits)) {
      toast.error("CPF inválido. Use o formato 000.000.000-00.");
      return;
    }
    const phoneE164 = phone ? toE164(phone, phoneCountry) : "";
    if (!phoneE164 || !isValidIntlPhone(phoneE164)) {
      toast.error("Telefone inválido. Selecione o país e informe o número completo.");
      return;
    }
    if (customer.email && !isValidEmail(customer.email)) {
      toast.error("O email do cliente é inválido.");
      return;
    }
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
        fullName: cleanedName,
        cpf: cpfDigits,
        phone: phoneE164,
        phoneCountry,
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
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Nome completo <span className="text-destructive">*</span></Label>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              onBlur={(e) => setFullName(titleCaseName(e.target.value))}
              placeholder="Ex.: Igor Fuchshuber"
              required
              autoComplete="name"
            />
            <p className="text-[11px] text-muted-foreground">
              Salvamos com a primeira letra maiúscula (padronização visual).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>CPF <span className="text-destructive">*</span></Label>
            <Input
              inputMode="numeric"
              value={cpf}
              onChange={(e) => setCpf(formatCPF(e.target.value))}
              placeholder="000.000.000-00"
              required
              maxLength={14}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Telefone (qualquer país) <span className="text-destructive">*</span></Label>
            <div className="sg-phone-input">
              <PhoneInput
                international
                defaultCountry={phoneCountry}
                value={phone}
                onChange={(v) => setPhone(v)}
                onCountryChange={(c) => c && setPhoneCountry(c)}
                limitMaxLength
                placeholder="Ex.: +55 11 98765-4321"
              />
            </div>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Email</Label>
            <Input
              type="email"
              value={customer.email ?? ""}
              readOnly
              disabled
              placeholder="email@exemplo.com"
              autoComplete="email"
            />
            <p className="text-[11px] text-muted-foreground">
              Alterado apenas pelo próprio cliente (segurança da conta).
            </p>
          </div>



          <div className="space-y-1.5">
            <Label>Plano</Label>
            <Select
              value={plan ?? "__none__"}
              onValueChange={(v) => setPlan(v === "__none__" ? null : (v as PlanKey))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sem plano</SelectItem>
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
            <div className="flex gap-2">
              <div className="flex-1">
                <DatePicker
                  value={trialEndsAt}
                  onChange={setTrialEndsAt}
                  placeholder="Sem trial"
                />
              </div>
              <ApplyCustomTrialButton
                userId={customer.userId}
                trialEndsAt={trialEndsAt}
                hasRealPaddleSub={
                  !!s?.paddleSubscriptionId &&
                  !s.paddleSubscriptionId.startsWith("manual_")
                }
                onApplied={(paused) => {
                  // Sincroniza o estado local para o "Salvar" não desfazer
                  // a pausa (ou retomada) que acabou de ser aplicada no Paddle.
                  setBillingPaused(paused);
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              "Aplicar ao Paddle" pausa a cobrança agora e retoma automaticamente na data escolhida —
              enquanto isso, o cliente não é cobrado.
            </p>
          </div>


          {plan === "enterprise" && (
            <EnterpriseSection
              customer={customer}
              environment={environment}
              defaultAmountCents={s?.customPriceCents ?? null}
            />
          )}

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Limite de guias (override)</Label>
            <Input
              type="number"
              step="1"
              min="1"
              placeholder={plan ? `Padrão do plano: ${PLANS[plan].maxGuides >= 9999 ? "ilimitado" : PLANS[plan].maxGuides}` : "Selecione um plano primeiro"}
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

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "amber" | "muted" | "red" }) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "muted"
          ? "text-muted-foreground"
          : tone === "red"
            ? "text-red-600 dark:text-red-400"
            : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-semibold">{label}</div>
      <div className={`text-2xl font-display mt-1 tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function ApplyCustomTrialButton({
  userId,
  trialEndsAt,
  hasRealPaddleSub,
  onApplied,
}: {
  userId: string;
  trialEndsAt: string;
  hasRealPaddleSub: boolean;
  onApplied?: (paused: boolean) => void;
}) {
  const applyTrial = useServerFn(adminApplyCustomTrial);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const iso = trialEndsAt ? fromDateInput(trialEndsAt) : null;
  const isFuture = iso ? new Date(iso).getTime() > Date.now() : false;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy || !hasRealPaddleSub}
      title={
        !hasRealPaddleSub
          ? "Disponível apenas para assinaturas ativas do Paddle (não manuais)"
          : isFuture
            ? "Pausa a cobrança no Paddle e retoma nesta data"
            : "Encerra o trial custom (retoma cobrança imediatamente)"
      }
      onClick={async () => {
        setBusy(true);
        try {
          const res = await applyTrial({ data: { userId, trialEndsAt: iso } });
          toast.success(
            res.paused
              ? "Trial aplicado no Paddle — cobrança pausada até a data escolhida."
              : "Trial customizado encerrado — cobrança normal retomada.",
          );
          onApplied?.(!!res.paused);
          qc.invalidateQueries({ queryKey: ["admin-customers"] });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Erro ao aplicar trial");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Calendar className="size-3.5" />}
      Aplicar ao Paddle
    </Button>
  );
}

function StatusBadge({
  status,
  userStatus,
}: {
  status?: string | null;
  userStatus?: "active" | "blocked" | "pending";
}) {
  const map: Record<string, { label: string; className: string; dot: string }> = {
    active: { label: "Ativo", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20", dot: "bg-emerald-500" },
    trialing: { label: "Trial", className: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20", dot: "bg-sky-500" },
    past_due: { label: "Atrasado", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20", dot: "bg-amber-500" },
    paused: { label: "Pausado", className: "bg-secondary text-muted-foreground border-border", dot: "bg-muted-foreground" },
    canceled: { label: "Cancelado", className: "bg-secondary text-muted-foreground border-border", dot: "bg-muted-foreground/60" },
  };
  const info = status ? map[status] : null;
  if (!info) {
    // Sem assinatura → mostra status do próprio usuário.
    const u =
      userStatus === "blocked"
        ? { label: "Bloqueado", className: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20", dot: "bg-red-500" }
        : userStatus === "pending"
          ? { label: "Aguardando 1º acesso", className: "bg-secondary text-muted-foreground border-border", dot: "bg-muted-foreground/60" }
          : { label: "Ativo", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20", dot: "bg-emerald-500" };
    return (
      <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full border ${u.className}`}>
        <span className={`size-1.5 rounded-full ${u.dot}`} />
        {u.label}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full border ${info.className}`}>
      <span className={`size-1.5 rounded-full ${info.dot}`} />
      {info.label}
    </span>
  );
}

function EnterpriseSection({
  customer,
  environment,
  defaultAmountCents,
}: {
  customer: AdminCustomerRow;
  environment: "sandbox" | "live";
  defaultAmountCents: number | null;
}) {
  const createFn = useServerFn(adminCreateEnterpriseSubscription);
  const anchorFn = useServerFn(adminAnchorSubscriptionToDay1);
  const cancelFn = useServerFn(adminCancelEnterpriseSubscription);

  const s = customer.subscription;
  const paddleSubId = s?.paddleSubscriptionId ?? "";
  const hasRealSub = paddleSubId.startsWith("sub_");

  const [amount, setAmount] = useState(
    defaultAmountCents != null ? (defaultAmountCents / 100).toString() : "",
  );
  const [trial, setTrial] = useState("7");
  const [busy, setBusy] = useState<"create" | "anchor" | "cancel-soft" | "cancel-now" | null>(null);

  async function handleCreate() {
    if (!customer.email) {
      toast.error("Cliente sem email cadastrado.");
      return;
    }
    const cents = Math.round(parseFloat(amount.replace(",", ".")) * 100);
    if (!cents || cents < 70) {
      toast.error("Valor inválido (mínimo R$ 0,70)");
      return;
    }
    const trialDays = parseInt(trial, 10);
    if (Number.isNaN(trialDays) || trialDays < 0 || trialDays > 90) {
      toast.error("Trial inválido (0-90 dias)");
      return;
    }
    setBusy("create");
    try {
      const res = await createFn({
        data: {
          email: customer.email,
          monthlyAmountBRLCents: cents,
          trialDays,
          environment,
        },
      });
      toast.success(`Assinatura Enterprise criada. Transaction ${res.transactionId}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar assinatura");
    } finally {
      setBusy(null);
    }
  }

  async function handleAnchor() {
    setBusy("anchor");
    try {
      const r = await anchorFn({ data: { paddleSubscriptionId: paddleSubId, environment } });
      toast.success(`Cobrança ancorada para ${new Date(r.anchoredTo).toLocaleDateString("pt-BR")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao ancorar");
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel(immediate: boolean) {
    if (!confirm(immediate ? "Cancelar imediatamente?" : "Cancelar no fim do período atual?")) return;
    setBusy(immediate ? "cancel-now" : "cancel-soft");
    try {
      await cancelFn({ data: { paddleSubscriptionId: paddleSubId, environment, immediate } });
      toast.success("Cancelamento solicitado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao cancelar");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sm:col-span-2 rounded-xl border border-accent/30 bg-accent/5 p-4 space-y-3">
      <div className="flex items-center gap-2 text-accent font-semibold text-sm">
        <Crown className="size-4" /> Regras Enterprise
      </div>
      <p className="text-xs text-muted-foreground">
        Cobrança recorrente todo dia 1 do mês. A primeira cobrança após o trial é proporcional aos dias até o próximo dia 1.
        O cliente precisa ter cartão cadastrado no Paddle antes de criar a assinatura.
      </p>

      {!hasRealSub && (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Valor mensal (R$)</Label>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="230.00"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Trial (dias)</Label>
              <Input
                type="number"
                min="0"
                max="90"
                value={trial}
                onChange={(e) => setTrial(e.target.value)}
              />
            </div>
          </div>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={busy === "create"}
            className="w-full"
          >
            {busy === "create" ? (
              <Loader2 className="size-4 animate-spin mr-1.5" />
            ) : (
              <Crown className="size-4 mr-1.5" />
            )}
            Criar assinatura Enterprise no Paddle
          </Button>
        </div>
      )}

      {hasRealSub && (
        <div className="space-y-2 pt-1">
          <div className="text-xs text-muted-foreground font-mono break-all">
            {paddleSubId}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAnchor}
              disabled={busy === "anchor"}
            >
              {busy === "anchor" ? <Loader2 className="size-3 animate-spin mr-1.5" /> : <Anchor className="size-3 mr-1.5" />}
              Ancorar dia 1
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleCancel(false)}
              disabled={busy === "cancel-soft" || s?.status === "canceled"}
            >
              {busy === "cancel-soft" ? <Loader2 className="size-3 animate-spin mr-1.5" /> : <Calendar className="size-3 mr-1.5" />}
              Cancelar fim do período
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleCancel(true)}
              disabled={busy === "cancel-now" || s?.status === "canceled"}
            >
              {busy === "cancel-now" ? <Loader2 className="size-3 animate-spin mr-1.5" /> : <Ban className="size-3 mr-1.5" />}
              Cancelar agora
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function OpenGuidesButton({ userId, email }: { userId: string; email: string | null }) {
  const [open, setOpen] = useState(false);
  const listFn = useServerFn(adminListUserProperties);
  const q = useQuery({
    queryKey: ["admin-user-properties", userId],
    queryFn: () => listFn({ data: { userId } }),
    enabled: open,
  });
  const props = q.data?.properties ?? [];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="size-8 grid place-items-center rounded-full border border-border hover:bg-secondary text-muted-foreground hover:text-foreground transition"
        aria-label="Acessar guias do cliente"
        title="Acessar guias do cliente"
      >
        <Shield className="size-3.5" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Acessar guias do cliente</DialogTitle>
            <DialogDescription>
              {email ?? "Cliente"} — você acessará o painel como admin (todas as alterações ficam vinculadas ao cliente).
            </DialogDescription>
          </DialogHeader>
          {q.isLoading ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin inline" /> Carregando…
            </div>
          ) : props.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Este cliente ainda não tem guias.</p>
          ) : (
            <ul className="space-y-2 max-h-96 overflow-y-auto">
              {props.map((p) => (
                <li key={p.id}>
                  <Link
                    to="/admin/properties/$id"
                    params={{ id: p.id }}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3 hover:border-border hover:bg-secondary/30 transition"
                  >
                    {p.hero_image_url ? (
                      <img src={p.hero_image_url} alt="" className="size-10 rounded-lg object-cover" />
                    ) : (
                      <div className="size-10 rounded-lg bg-secondary grid place-items-center text-muted-foreground">
                        <Shield className="size-4" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.name ?? "Guia sem nome"}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {p.city ?? "—"} · {p.published ? "Publicado" : "Rascunho"}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
