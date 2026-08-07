import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Building2,
  UserRound,
  Check,
  Loader2,
  Mail,
  MapPin,
  Home,
  Calendar,
  Wrench,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MaskedInput, stripMask } from "@/components/inputs/MaskedInput";
import { getStakeholderAccess } from "@/lib/stakeholder-access.functions";
import { inviteTeamMember, revokeTeamInvite, removeTeamMember } from "@/lib/team.functions";
import { saveStakeholder } from "@/lib/stakeholders.functions";
import { lookupCnpj } from "@/lib/br-lookup.functions";
import { isValidCPF, isValidCNPJ, formatBRPhone } from "@/lib/masks";
import { PROVIDER_CATEGORIES, type StakeholderKind } from "./constants";

export type StakeholderFormValues = {
  id: string | null;
  person_type: "pf" | "pj";
  name: string;
  trade_name: string;
  category: string;
  doc: string;
  birth_date: string;
  email: string;
  phone: string;
  cep: string;
  address: string;
  district: string;
  city: string;
  state: string;
  notes: string;
  status: "active" | "inactive";
};

export const emptyStakeholderForm: StakeholderFormValues = {
  id: null,
  person_type: "pf",
  name: "",
  trade_name: "",
  category: "outros",
  doc: "",
  birth_date: "",
  email: "",
  phone: "",
  cep: "",
  address: "",
  district: "",
  city: "",
  state: "",
  notes: "",
  status: "active",
};

export function rowToStakeholderForm(row: Record<string, any>): StakeholderFormValues {
  return {
    id: row.id,
    person_type: (row.person_type as "pf" | "pj") ?? (row.doc_type === "cnpj" ? "pj" : "pf"),
    name: row.name ?? "",
    trade_name: row.trade_name ?? "",
    category: row.category ?? "outros",
    doc: row.doc ?? "",
    birth_date: row.birth_date ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    cep: row.cep ?? "",
    address: row.address ?? "",
    district: row.district ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    notes: row.notes ?? "",
    status: (row.status as "active" | "inactive") ?? "active",
  };
}

function SectionDivider({ label, busy }: { label: string; busy?: boolean }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <div className="h-px flex-1 bg-border/40" />
      <span className="text-[11px] uppercase tracking-widest text-muted-foreground/70 font-medium flex items-center gap-1.5">
        {label}
        {busy && <Loader2 className="size-3 animate-spin text-primary" />}
      </span>
      <div className="h-px flex-1 bg-border/40" />
    </div>
  );
}

export function StakeholderFormDialog({
  kind,
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  kind: StakeholderKind;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: StakeholderFormValues | null;
  onSaved?: (id: string, isNew: boolean, form: StakeholderFormValues) => void;
}) {
  const saveFn = useServerFn(saveStakeholder);
  const cnpjFn = useServerFn(lookupCnpj);

  const [form, setForm] = useState<StakeholderFormValues>(emptyStakeholderForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checkingCnpj, setCheckingCnpj] = useState(false);
  const [loadingCep, setLoadingCep] = useState(false);
  const [saving, setSaving] = useState(false);
  const lastCep = useRef("");
  const accessFn = useServerFn(getStakeholderAccess);
  const inviteFn = useServerFn(inviteTeamMember);
  const provisionalFn = useServerFn(createStakeholderProvisionalAccess);
  const revokeInviteFn = useServerFn(revokeTeamInvite);
  const removeMemberFn = useServerFn(removeTeamMember);
  const [systemAccess, setSystemAccess] = useState(false);
  const [provisionalPwd, setProvisionalPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);


  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim());
  const accessQuery = useQuery({
    queryKey: ["stakeholder-access", form.email.trim().toLowerCase()],
    queryFn: () => accessFn({ data: { email: form.email.trim().toLowerCase() } }),
    enabled: open && emailValid,
    retry: false,
  });
  const access = accessQuery.data;

  useEffect(() => {
    if (access) setSystemAccess(access.status !== "none");
  }, [access]);

  useEffect(() => {
    if (!open) return;
    setForm(initial ?? emptyStakeholderForm);
    setErrors({});
    setSystemAccess(false);
    lastCep.current = "";
  }, [open, initial]);

  const isPJ = form.person_type === "pj";
  const singular = kind === "owner" ? "proprietário" : "prestador";

  const set = (patch: Partial<StakeholderFormValues>) => setForm((p) => ({ ...p, ...patch }));
  const clearError = (k: string) =>
    setErrors((p) => {
      if (!p[k]) return p;
      const n = { ...p };
      delete n[k];
      return n;
    });

  async function handleDocBlur() {
    const d = stripMask(form.doc);
    if (!d) return clearError("doc");
    if (!isPJ) {
      if (d.length !== 11) return setErrors((p) => ({ ...p, doc: "CPF incompleto" }));
      if (!isValidCPF(d)) return setErrors((p) => ({ ...p, doc: "CPF inválido" }));
      return clearError("doc");
    }
    if (d.length !== 14) return setErrors((p) => ({ ...p, doc: "CNPJ incompleto" }));
    if (!isValidCNPJ(d)) return setErrors((p) => ({ ...p, doc: "CNPJ inválido" }));
    clearError("doc");
    setCheckingCnpj(true);
    try {
      const res = await cnpjFn({ data: { cnpj: d } });
      if (!res.ok || !res.data) {
        setErrors((p) => ({ ...p, doc: res.error ?? "CNPJ inválido" }));
        return;
      }
      if (res.data.situacao && res.data.situacao !== "ATIVA") {
        setErrors((p) => ({ ...p, doc: `Situação cadastral: ${res.data!.situacao}` }));
      }
      setForm((p) => ({
        ...p,
        name: res.data!.razao_social || p.name,
        trade_name: p.trade_name || res.data!.nome_fantasia,
        email: p.email || res.data!.email,
        phone: p.phone || res.data!.telefone,
        cep: res.data!.cep || p.cep,
        address: res.data!.logradouro || p.address,
        district: res.data!.bairro || p.district,
        city: res.data!.cidade || p.city,
        state: res.data!.estado || p.state,
      }));
      toast.success("Dados preenchidos pela Receita Federal.");
    } finally {
      setCheckingCnpj(false);
    }
  }

  async function handleCep(raw: string) {
    set({ cep: raw });
    if (raw.length !== 8 || lastCep.current === raw) return;
    lastCep.current = raw;
    setLoadingCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${raw}/json/`);
      const j = await res.json();
      if (j?.erro) return;
      setForm((p) => ({
        ...p,
        address: j.logradouro || p.address,
        district: j.bairro || p.district,
        city: j.localidade || p.city,
        state: j.uf || p.state,
      }));
      toast.success("Endereço preenchido.");
    } catch {
      /* silencioso: o usuário pode digitar manualmente */
    } finally {
      setLoadingCep(false);
    }
  }

  async function submit() {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = isPJ ? "Razão social obrigatória" : "Nome obrigatório";
    const d = stripMask(form.doc);
    if (d) {
      if (!isPJ && !isValidCPF(d)) errs.doc = "CPF inválido";
      if (isPJ && !isValidCNPJ(d)) errs.doc = "CNPJ inválido";
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim()))
      errs.email = "E-mail inválido";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      const res = await saveFn({
        data: {
          kind,
          id: form.id ?? undefined,
          person_type: form.person_type,
          doc_type: isPJ ? "cnpj" : "cpf",
          name: form.name.trim(),
          trade_name: form.trade_name.trim() || null,
          category: kind === "provider" ? form.category : null,
          doc: d || null,
          birth_date: !isPJ && form.birth_date ? form.birth_date : null,
          email: form.email.trim() || null,
          phone: stripMask(form.phone) || null,
          cep: stripMask(form.cep) || null,
          address: form.address.trim() || null,
          district: form.district.trim() || null,
          city: form.city.trim() || null,
          state: form.state.trim().toUpperCase() || null,
          notes: form.notes.trim() || null,
          status: form.status,
        },
      });
      // Acesso ao sistema: mesmo fluxo de convite dos membros da equipe.
      try {
        const current = access?.status ?? "none";
        if (systemAccess && current === "none" && emailValid) {
          await inviteFn({ data: { email: form.email.trim().toLowerCase(), role: "agent" as const } });
          toast.success("Convite de acesso enviado por e-mail.");
        } else if (!systemAccess && current === "pending" && access?.inviteId) {
          await revokeInviteFn({ data: { inviteId: access.inviteId } });
          toast.success("Convite de acesso cancelado.");
        } else if (!systemAccess && current === "active" && access?.memberId) {
          await removeMemberFn({ data: { memberId: access.memberId } });
          toast.success("Acesso ao sistema removido.");
        }
        void accessQuery.refetch();
      } catch (e) {
        toast.error(
          `Cadastro salvo, mas não foi possível atualizar o acesso: ${(e as Error).message}`,
        );
      }

      toast.success(form.id ? "Cadastro atualizado." : `Cadastro de ${singular} criado.`);
      onOpenChange(false);
      onSaved?.(res.id as string, !form.id, form);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl capitalize">
            {form.id ? `Editar ${singular}` : `Novo ${singular}`}
          </DialogTitle>
          <DialogDescription>CNPJ e CEP preenchem os dados automaticamente.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          {/* Tipo */}
          <div className="grid grid-cols-2 gap-2">
            {([
              { key: "pf" as const, label: "Pessoa Física", sub: "CPF", icon: UserRound },
              { key: "pj" as const, label: "Pessoa Jurídica", sub: "CNPJ", icon: Building2 },
            ]).map(({ key, label, sub, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  set({ person_type: key, doc: "" });
                  clearError("doc");
                }}
                className={`flex items-center gap-2.5 p-3 rounded-xl border transition-all text-left ${
                  form.person_type === key
                    ? "border-primary bg-primary/10"
                    : "border-border/60 hover:border-primary/40"
                }`}
              >
                <Icon
                  className={`size-4 shrink-0 ${form.person_type === key ? "text-primary" : "text-muted-foreground"}`}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{label}</span>
                  <span className="block text-[11px] text-muted-foreground">{sub}</span>
                </span>
                {form.person_type === key && <Check className="size-4 text-primary ml-auto" />}
              </button>
            ))}
          </div>

          <SectionDivider label="Dados cadastrais" busy={checkingCnpj} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {isPJ ? "Razão social *" : "Nome completo *"}
              </Label>
              <Input
                value={form.name}
                maxLength={160}
                placeholder={isPJ ? `Razão social do ${singular}` : `Nome do ${singular}`}
                onChange={(e) => {
                  set({ name: e.target.value });
                  clearError("name");
                }}
                className={errors.name ? "border-destructive" : ""}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>

            <MaskedInput
              label={isPJ ? "CNPJ" : "CPF"}
              mask={isPJ ? "00.000.000/0000-00" : "000.000.000-00"}
              placeholder={isPJ ? "00.000.000/0000-00" : "000.000.000-00"}
              value={form.doc}
              onValueChange={(raw) => {
                set({ doc: raw });
                clearError("doc");
              }}
              onBlur={handleDocBlur}
              error={errors.doc}
            />

            {isPJ ? (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Nome fantasia</Label>
                <Input
                  value={form.trade_name}
                  maxLength={160}
                  placeholder="Como o cliente é conhecido"
                  onChange={(e) => set({ trade_name: e.target.value })}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Calendar className="size-3.5" /> Data de nascimento
                </Label>
                <Input
                  type="date"
                  value={form.birth_date}
                  onChange={(e) => set({ birth_date: e.target.value })}
                />
              </div>
            )}

            {kind === "provider" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Wrench className="size-3.5" /> Categoria de serviço
                </Label>
                <Select value={form.category} onValueChange={(v) => set({ category: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Situação</Label>
              <Select
                value={form.status}
                onValueChange={(v) => set({ status: v as "active" | "inactive" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <SectionDivider label="Contato" />

          <div className="grid gap-3 sm:grid-cols-2">
            <MaskedInput
              label="Telefone / WhatsApp"
              mask="(00) 00000-0000"
              placeholder="(00) 00000-0000"
              value={form.phone}
              onValueChange={(raw) => set({ phone: raw })}
              hint={form.phone ? formatBRPhone(form.phone) : undefined}
            />
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Mail className="size-3.5" /> E-mail
              </Label>
              <Input
                type="email"
                maxLength={200}
                placeholder="email@exemplo.com"
                value={form.email}
                onChange={(e) => {
                  set({ email: e.target.value });
                  clearError("email");
                }}
                className={errors.email ? "border-destructive" : ""}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>
          </div>

          <SectionDivider label="Acesso ao sistema" />

          <div className="rounded-xl border border-border/60 p-3.5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">Permitir acesso ao sistema</p>
                <p className="text-xs text-muted-foreground">
                  {access?.status === "active"
                    ? "Esta pessoa já acessa o sistema. As permissões por área ficam na ficha, na aba “Acessos”."
                    : access?.status === "pending"
                      ? "Convite enviado — o acesso passa a valer quando a pessoa aceitar no primeiro login."
                      : "Enviamos um convite por e-mail para criar a senha. A pessoa entra sem nenhum acesso e você libera cada área depois."}
                </p>
              </div>
              <Switch
                checked={systemAccess}
                disabled={!emailValid || accessQuery.isLoading}
                onCheckedChange={setSystemAccess}
              />
            </div>
            {!emailValid && (
              <p className="mt-2 text-xs text-amber-500">
                Informe um e-mail válido acima para liberar o acesso ao sistema.
              </p>
            )}
          </div>

          <SectionDivider label="Endereço" busy={loadingCep} />

          <div className="grid gap-3 sm:grid-cols-3">
            <MaskedInput
              label="CEP"
              mask="00000-000"
              placeholder="00000-000"
              value={form.cep}
              onValueChange={(raw) => void handleCep(raw)}
            />
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Home className="size-3.5" /> Logradouro
              </Label>
              <Input
                maxLength={300}
                placeholder="Rua, avenida, número..."
                value={form.address}
                onChange={(e) => set({ address: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Bairro</Label>
              <Input
                maxLength={120}
                placeholder="Bairro"
                value={form.district}
                onChange={(e) => set({ district: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <MapPin className="size-3.5" /> Cidade
              </Label>
              <Input
                maxLength={120}
                placeholder="Cidade"
                value={form.city}
                onChange={(e) => set({ city: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Estado</Label>
              <Input
                maxLength={2}
                placeholder="UF"
                value={form.state}
                onChange={(e) => set({ state: e.target.value.toUpperCase() })}
              />
            </div>
          </div>

          <SectionDivider label="Extras" />

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Observações</Label>
            <Textarea
              rows={3}
              maxLength={4000}
              placeholder={`Observações sobre o ${singular}...`}
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-border/30">
          <Button variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="rounded-full"
            onClick={submit}
            disabled={saving || checkingCnpj}
          >
            {saving || checkingCnpj ? (
              <Loader2 className="size-4 mr-1.5 animate-spin" />
            ) : (
              <Check className="size-4 mr-1.5" />
            )}
            {form.id ? "Salvar alterações" : `Salvar ${singular}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
