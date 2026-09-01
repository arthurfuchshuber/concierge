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
  Calendar,
  KeyRound,
  Eye,
  EyeOff,

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
import { usePresence } from "@/hooks/usePresence";
import { PresenceAvatars } from "@/components/presence/PresenceAvatars";
import { FieldTypingBadge } from "@/components/presence/FieldTypingBadge";
import { getStakeholderAccess, createStakeholderProvisionalAccess } from "@/lib/stakeholder-access.functions";
import { inviteTeamMember, revokeTeamInvite, removeTeamMember } from "@/lib/team.functions";
import { saveStakeholder } from "@/lib/stakeholders.functions";
import { lookupCnpj } from "@/lib/br-lookup.functions";
import { isValidCPF, isValidCNPJ, formatBRPhone } from "@/lib/masks";
import { type StakeholderKind } from "./constants";
import { CategoryPicker } from "./CategoryPicker";
import { AddressAutocomplete } from "./AddressAutocomplete";

export type StakeholderFormValues = {
  id: string | null;
  person_type: "pf" | "pj";
  name: string;
  trade_name: string;
  category: string;
  categories: string[];
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
  contract_start: string;
  contract_end: string;
};

export const emptyStakeholderForm: StakeholderFormValues = {
  id: null,
  person_type: "pf",
  name: "",
  trade_name: "",
  category: "outros",
  categories: [],
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
  contract_start: "",
  contract_end: "",
};

export function rowToStakeholderForm(row: Record<string, any>): StakeholderFormValues {
  return {
    id: row.id,
    person_type: (row.person_type as "pf" | "pj") ?? (row.doc_type === "cnpj" ? "pj" : "pf"),
    name: row.name ?? "",
    trade_name: row.trade_name ?? "",
    category: row.category ?? "outros",
    categories: Array.isArray(row.categories) && row.categories.length > 0
      ? (row.categories as string[])
      : row.category
        ? [row.category as string]
        : [],
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
    contract_start: row.contract_start ?? "",
    contract_end: row.contract_end ?? "",
  };
}

/** Título de seção do formulário (Sora 700 15px, alinhado à esquerda). */
function SectionTitle({ label, busy }: { label: string; busy?: boolean }) {
  return (
    <h3 className="ds-section-title mb-6 flex items-center gap-1.5">
      {label}
      {busy && <Loader2 className="size-3 animate-spin text-primary" />}
    </h3>
  );
}


export function StakeholderFormDialog({
  kind,
  open,
  onOpenChange,
  initial,
  accountOwnerId,
  onSaved,
}: {
  kind: StakeholderKind;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: StakeholderFormValues | null;
  accountOwnerId?: string | null;
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

  // Presença em tempo real: só existe sala pra registros já salvos (com id) —
  // um cadastro novo, ainda sem id, não tem o que outra pessoa acompanhar.
  const presence = usePresence(form.id ? `stakeholder:${form.id}` : null);


  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim());
  const accessQuery = useQuery({
    queryKey: ["stakeholder-access", form.email.trim().toLowerCase()],
    queryFn: () => accessFn({ data: { email: form.email.trim().toLowerCase() } }),
    enabled: open && emailValid,
    retry: false,
  });
  const access = accessQuery.data;

  // Reflete o estado real do acesso sempre que o diálogo abre — mesmo quando a
  // consulta vem do cache (mesmo objeto), o `open` no deps força a sincronia.
  useEffect(() => {
    if (!open || !access) return;
    setSystemAccess(access.status !== "none");
  }, [access?.status, open]);


  useEffect(() => {
    if (!open) return;
    setForm(initial ?? emptyStakeholderForm);
    setErrors({});
    setSystemAccess(false);
    setProvisionalPwd("");
    setShowPwd(false);

    lastCep.current = "";
  }, [open, initial]);

  const isPJ = form.person_type === "pj";
  const singular = kind === "owner" ? "proprietário" : "prestador";
  /** Prestadores: tudo obrigatório, exceto observações. */
  const allRequired = kind === "provider";
  const req = allRequired ? " *" : "";


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

    // Prestadores: todos os campos são obrigatórios — só "Observações" é opcional.
    if (allRequired) {
      if (!d) errs.doc = isPJ ? "CNPJ obrigatório" : "CPF obrigatório";
      if (isPJ && !form.trade_name.trim()) errs.trade_name = "Nome fantasia obrigatório";
      if (!isPJ && !form.birth_date) errs.birth_date = "Data de nascimento obrigatória";
      if (form.categories.length === 0) errs.category = "Selecione ao menos uma categoria";
      if (stripMask(form.phone).length < 10) errs.phone = "Telefone obrigatório";
      if (!form.email.trim()) errs.email = "E-mail obrigatório";
      if (stripMask(form.cep).length !== 8) errs.cep = "CEP obrigatório";
      if (!form.address.trim()) errs.address = "Logradouro obrigatório";
      if (!form.district.trim()) errs.district = "Bairro obrigatório";
      if (!form.city.trim()) errs.city = "Cidade obrigatória";
      if (form.state.trim().length !== 2) errs.state = "Estado obrigatório";
    }

    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error("Preencha todos os campos obrigatórios.");
      return;
    }


    setSaving(true);
    try {
      const res = await saveFn({
        data: {
          kind,
          accountOwnerId,
          id: form.id ?? undefined,
          person_type: form.person_type,
          doc_type: isPJ ? "cnpj" : "cpf",
          name: form.name.trim(),
          trade_name: form.trade_name.trim() || null,
          category: kind === "provider" ? form.categories[0] ?? "outros" : null,
          categories: kind === "provider" ? form.categories : undefined,
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
          contract_start: form.contract_start || null,
          contract_end: form.contract_end || null,
        },
      });
      // Acesso ao sistema: mesmo fluxo de convite dos membros da equipe.
      try {
        const current = access?.status ?? "none";
        if (systemAccess && current === "none" && emailValid) {
          if (provisionalPwd.trim().length >= 8) {
            await provisionalFn({
              data: {
                email: form.email.trim().toLowerCase(),
                password: provisionalPwd.trim(),
                name: form.name.trim() || undefined,
                // Já temos CPF e nascimento no cadastro — o convidado não
                // precisa preencher de novo no primeiro acesso.
                cpf: !isPJ && d.length === 11 ? d : undefined,
                birth_date: !isPJ && form.birth_date ? form.birth_date : undefined,
                phone: stripMask(form.phone) || undefined,
              },
            });

            setProvisionalPwd("");
            toast.success(
              "Acesso liberado com senha provisória. No primeiro login a pessoa cria a própria senha.",
            );
          } else {
            await inviteFn({ data: { email: form.email.trim().toLowerCase(), role: "agent" as const } });
            toast.success("Convite de acesso enviado por e-mail.");
          }
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
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-2xl overflow-x-hidden">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="font-display text-2xl capitalize">
              {form.id ? `Editar ${singular}` : `Novo ${singular}`}
            </DialogTitle>
            <PresenceAvatars users={presence.users} />
          </div>
          <DialogDescription>CNPJ e CEP preenchem os dados automaticamente.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[65vh] overflow-y-auto overflow-x-hidden pr-1">
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
                    ? "border-transparent bg-gradient-to-r from-primary to-accent shadow-sm"
                    : "border-border/60 hover:border-primary/40"
                }`}
              >
                <Icon
                  className={`size-4 shrink-0 ${form.person_type === key ? "text-primary-foreground" : "text-muted-foreground"}`}
                />
                <span className="min-w-0">
                  <span className={`block text-sm font-medium truncate ${form.person_type === key ? "text-primary-foreground" : ""}`}>{label}</span>
                  <span className={`block ds-meta ${form.person_type === key ? "text-primary-foreground/80" : ""}`}>{sub}</span>
                </span>
                {form.person_type === key && <Check className="size-4 text-primary-foreground ml-auto" />}
              </button>
            ))}
          </div>

          <SectionDivider label="Dados cadastrais" busy={checkingCnpj} />

          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
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
                  presence.broadcastTyping("name", e.target.value);
                }}
                onBlur={() => presence.broadcastFieldBlur("name")}
                className={errors.name ? "border-destructive" : ""}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
              <FieldTypingBadge typing={presence.typing["name"]} />
            </div>

            <div className="min-w-0">
              <MaskedInput
                label={`${isPJ ? "CNPJ" : "CPF"}${req}`}
                mask={isPJ ? "00.000.000/0000-00" : "000.000.000-00"}
                placeholder={isPJ ? "00.000.000/0000-00" : "000.000.000-00"}
                value={form.doc}
                onValueChange={(raw) => {
                  set({ doc: raw });
                  clearError("doc");
                  presence.broadcastTyping("doc", raw);
                }}
                onBlur={() => {
                  presence.broadcastFieldBlur("doc");
                  void handleDocBlur();
                }}
                error={errors.doc}
              />
              <FieldTypingBadge typing={presence.typing["doc"]} />
            </div>

            {isPJ ? (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Nome fantasia{req}</Label>
                <Input
                  value={form.trade_name}
                  maxLength={160}
                  placeholder="Como o cliente é conhecido"
                  onChange={(e) => {
                    set({ trade_name: e.target.value });
                    clearError("trade_name");
                    presence.broadcastTyping("trade_name", e.target.value);
                  }}
                  onBlur={() => presence.broadcastFieldBlur("trade_name")}
                  className={errors.trade_name ? "border-destructive" : ""}
                />
                {errors.trade_name && (
                  <p className="text-xs text-destructive">{errors.trade_name}</p>
                )}
                <FieldTypingBadge typing={presence.typing["trade_name"]} />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Calendar className="size-3.5" /> Data de nascimento{req}
                </Label>
                <Input
                  type="date"
                  value={form.birth_date}
                  onChange={(e) => {
                    set({ birth_date: e.target.value });
                    clearError("birth_date");
                    presence.broadcastTyping("birth_date", e.target.value);
                  }}
                  onBlur={() => presence.broadcastFieldBlur("birth_date")}
                  className={errors.birth_date ? "border-destructive" : ""}
                />
                {errors.birth_date && (
                  <p className="text-xs text-destructive">{errors.birth_date}</p>
                )}
                <FieldTypingBadge typing={presence.typing["birth_date"]} />
              </div>
            )}


            {kind === "provider" && (
              <div className="sm:col-span-2">
                <CategoryPicker
                  value={form.categories}
                  error={errors.category}
                  onChange={(next) => {
                    set({ categories: next });
                    clearError("category");
                  }}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Situação</Label>
              <Select
                value={form.status}
                onValueChange={(v) => {
                  set({ status: v as "active" | "inactive" });
                  presence.broadcastTyping("status", v === "active" ? "Ativo" : "Inativo");
                }}
                onOpenChange={(o) => !o && presence.broadcastFieldBlur("status")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
              <FieldTypingBadge typing={presence.typing["status"]} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Calendar className="size-3.5" /> Início do contrato
              </Label>
              <Input
                type="date"
                value={form.contract_start}
                onChange={(e) => {
                  set({ contract_start: e.target.value });
                  presence.broadcastTyping("contract_start", e.target.value);
                }}
                onBlur={() => presence.broadcastFieldBlur("contract_start")}
              />
              <FieldTypingBadge typing={presence.typing["contract_start"]} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Calendar className="size-3.5" /> Fim do contrato (se houver)
              </Label>
              <Input
                type="date"
                value={form.contract_end}
                onChange={(e) => {
                  set({ contract_end: e.target.value });
                  presence.broadcastTyping("contract_end", e.target.value);
                }}
                onBlur={() => presence.broadcastFieldBlur("contract_end")}
              />
              <FieldTypingBadge typing={presence.typing["contract_end"]} />
            </div>
          </div>

          <SectionDivider label="Contato" />

          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <div className="min-w-0">
              <MaskedInput
                label={`Telefone / WhatsApp${req}`}
                mask="(00) 00000-0000"
                placeholder="(00) 00000-0000"
                value={form.phone}
                onValueChange={(raw) => {
                  set({ phone: raw });
                  clearError("phone");
                  presence.broadcastTyping("phone", raw);
                }}
                onBlur={() => presence.broadcastFieldBlur("phone")}
                error={errors.phone}
                hint={form.phone ? formatBRPhone(form.phone) : undefined}
              />
              <FieldTypingBadge typing={presence.typing["phone"]} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Mail className="size-3.5" /> E-mail{req}
              </Label>
              <Input
                type="email"
                maxLength={200}
                placeholder="email@exemplo.com"
                value={form.email}
                inputMode="email"
                autoComplete="email"
                onChange={(e) => {
                  const v = e.target.value.replace(/\s+/g, "").toLowerCase();
                  set({ email: v });
                  clearError("email");
                  presence.broadcastTyping("email", v);
                }}
                onBlur={() => presence.broadcastFieldBlur("email")}
                className={errors.email ? "border-destructive" : ""}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
              <FieldTypingBadge typing={presence.typing["email"]} />
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
                      : "Defina uma senha provisória abaixo (ou deixe em branco para enviar convite por e-mail). No primeiro acesso a pessoa cria a própria senha."}
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
            {systemAccess && emailValid && access?.status === "none" && (
              <div className="mt-3 space-y-1.5">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <KeyRound className="size-3.5" /> Senha provisória
                </Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showPwd ? "text" : "password"}
                      autoComplete="new-password"
                      maxLength={72}
                      placeholder="Mínimo 8 caracteres"
                      value={provisionalPwd}
                      onChange={(e) => setProvisionalPwd(e.target.value)}
                      className="pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((s) => !s)}
                      aria-label={showPwd ? "Ocultar senha" : "Mostrar senha"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const gen = Array.from(crypto.getRandomValues(new Uint32Array(3)))
                        .map((n) => n.toString(36))
                        .join("")
                        .slice(0, 12);
                      setProvisionalPwd(gen);
                      setShowPwd(true);
                    }}
                  >
                    Gerar
                  </Button>
                </div>
                {provisionalPwd && provisionalPwd.trim().length < 8 && (
                  <p className="text-xs text-destructive">A senha precisa ter pelo menos 8 caracteres.</p>
                )}
                <p className="ds-meta">
                  Passe essa senha à pessoa por WhatsApp. Em branco, enviamos convite por e-mail.
                </p>
              </div>
            )}

          </div>

          <SectionDivider label="Endereço" busy={loadingCep} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
            <div className="min-w-0">
              <MaskedInput
                className="min-w-0"
                label={`CEP${req}`}
                mask="00000-000"
                placeholder="00000-000"
                value={form.cep}
                onValueChange={(raw) => {
                  clearError("cep");
                  presence.broadcastTyping("cep", raw);
                  void handleCep(raw);
                }}
                onBlur={() => presence.broadcastFieldBlur("cep")}
                error={errors.cep}
              />
              <FieldTypingBadge typing={presence.typing["cep"]} />
            </div>
            <div className="col-span-2">
              <AddressAutocomplete
                label={`Logradouro${req}`}
                value={form.address}
                error={errors.address}
                cityHint={[form.city, form.state].filter(Boolean).join(" ")}
                onChange={(v) => {
                  set({ address: v });
                  clearError("address");
                }}
                onPick={(sug) => {
                  setForm((p) => ({
                    ...p,
                    address: sug.address || p.address,
                    district: sug.district || p.district,
                    city: sug.city || p.city,
                    state: sug.state || p.state,
                    cep: sug.cep || p.cep,
                  }));
                  setErrors((p) => {
                    const n = { ...p };
                    delete n.address;
                    delete n.district;
                    delete n.city;
                    delete n.state;
                    return n;
                  });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Bairro{req}</Label>
              <Input
                maxLength={120}
                placeholder="Bairro"
                value={form.district}
                onChange={(e) => {
                  set({ district: e.target.value });
                  clearError("district");
                  presence.broadcastTyping("district", e.target.value);
                }}
                onBlur={() => presence.broadcastFieldBlur("district")}
                className={errors.district ? "border-destructive" : ""}
              />
              {errors.district && <p className="text-xs text-destructive">{errors.district}</p>}
              <FieldTypingBadge typing={presence.typing["district"]} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <MapPin className="size-3.5" /> Cidade{req}
              </Label>
              <Input
                maxLength={120}
                placeholder="Cidade"
                value={form.city}
                onChange={(e) => {
                  set({ city: e.target.value });
                  clearError("city");
                  presence.broadcastTyping("city", e.target.value);
                }}
                onBlur={() => presence.broadcastFieldBlur("city")}
                className={errors.city ? "border-destructive" : ""}
              />
              {errors.city && <p className="text-xs text-destructive">{errors.city}</p>}
              <FieldTypingBadge typing={presence.typing["city"]} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Estado{req}</Label>
              <Input
                maxLength={2}
                placeholder="UF"
                value={form.state}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase();
                  set({ state: v });
                  clearError("state");
                  presence.broadcastTyping("state", v);
                }}
                onBlur={() => presence.broadcastFieldBlur("state")}
                className={errors.state ? "border-destructive" : ""}
              />
              {errors.state && <p className="text-xs text-destructive">{errors.state}</p>}
              <FieldTypingBadge typing={presence.typing["state"]} />
            </div>

          </div>

          <SectionDivider label="Extras" />

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Observações (opcional)</Label>
            <Textarea
              rows={3}
              maxLength={4000}
              placeholder={`Observações sobre o ${singular}...`}
              value={form.notes}
              onChange={(e) => {
                set({ notes: e.target.value });
                presence.broadcastTyping("notes", e.target.value);
              }}
              onBlur={() => presence.broadcastFieldBlur("notes")}
            />
            <FieldTypingBadge typing={presence.typing["notes"]} />
          </div>
        </div>

        <div className="ds-scroll-x justify-center gap-2 pt-3 border-t border-border/30">
          <Button variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground hover:opacity-90"
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
