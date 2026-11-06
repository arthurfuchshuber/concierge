import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getMyProfile,
  updateMyProfile,
  uploadMyAvatar,
  removeMyAvatar,
  requestEmailChange,
} from "@/lib/profile.functions";
import { Camera, Check, Clock, Loader2, Trash2, User as UserIcon, Mail, ShieldCheck, Lock, CalendarDays, ChevronDown } from "lucide-react";
import { PANEL_SHELL, PanelHeading } from "@/components/dashboard/panel-chrome";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ActionButton, DENSE_INPUT, DenseField, Tag } from "@/components/admin-pages/admin-mobile-ui";
import { toast } from "sonner";
import { formatCPF } from "@/lib/masks";
import { useImpersonation } from "@/hooks/useImpersonation";
import { PageHeader } from "@/components/ds/PageHeader";
import { useAutosave } from "@/hooks/useAutosave";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";


export function MeuPerfilPage() {
  const getFn = useServerFn(getMyProfile);
  const updateFn = useServerFn(updateMyProfile);
  const uploadFn = useServerFn(uploadMyAvatar);
  const removeFn = useServerFn(removeMyAvatar);
  const emailFn = useServerFn(requestEmailChange);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { impersonation } = useImpersonation();
  const accountOwnerId = impersonation?.userId ?? null;

  const q = useQuery({
    queryKey: ["account-profile", accountOwnerId],
    queryFn: () => getFn({ data: { ownerId: accountOwnerId } }),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const [fullName, setFullName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [email, setEmail] = useState("");
  const [emailOriginal, setEmailOriginal] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCountry, setPhoneCountry] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    const p = q.data.profile;
    setFullName(p?.full_name ?? "");
    setTradeName(p?.trade_name ?? "");
    setBirthDate(p?.birth_date ?? "");
    setJobTitle(p?.job_title ?? "");
    setEmail(q.data.email ?? "");
    setEmailOriginal(q.data.email ?? "");
    setPhone(p?.phone ?? "");
    setPhoneCountry(p?.phone_country ?? "");
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () =>
      updateFn({
        data: {
          full_name: fullName.trim(),
          trade_name: tradeName.trim() || null,
          birth_date: birthDate,
          job_title: jobTitle.trim() || null,
          phone: phone.trim() || null,
          phone_country: phoneCountry.trim() || null,
          ownerId: accountOwnerId,
        },
      }),
    onSuccess: async () => {
      toast.success("Perfil atualizado");
      if (email && email !== emailOriginal) {
        try {
          await emailFn({ data: { email, ownerId: accountOwnerId } });
          toast.info("Enviamos um link de confirmação para o novo e-mail.");
          setEmailOriginal(email);
        } catch (e) {
          toast.error("Perfil salvo, mas falhou ao alterar e-mail: " + (e as Error).message);
        }
      }
      qc.invalidateQueries({ queryKey: ["account-profile", accountOwnerId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.error("Use PNG, JPG ou WEBP.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error("Arquivo maior que 3MB.");
      return;
    }
    setUploading(true);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const s = (r.result as string) || "";
          resolve(s.split(",")[1] ?? "");
        };
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      await uploadFn({
        data: {
          fileBase64: b64,
          contentType: file.type as "image/png" | "image/jpeg" | "image/webp",
          ownerId: accountOwnerId,
        },
      });
      await qc.invalidateQueries({ queryKey: ["account-profile", accountOwnerId] });
      toast.success("Foto atualizada");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function onRemoveAvatar() {
    try {
      await removeFn({ data: { ownerId: accountOwnerId } });
      await qc.invalidateQueries({ queryKey: ["account-profile", accountOwnerId] });
      toast.success("Foto removida");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const avatar = q.data?.profile?.avatar_url ?? null;
  const initials = (fullName || email || "?").slice(0, 2).toUpperCase();
  const cpfDigits = q.data?.profile?.cpf ?? "";
  const createdAt = q.data?.profile?.created_at
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(q.data.profile.created_at))
    : "";
  const onboardingCompletedAt = q.data?.profile?.onboarding_completed_at
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(
        new Date(q.data.profile.onboarding_completed_at),
      )
    : "";

  const canSave =
    fullName.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(birthDate) &&
    new Date(birthDate) <= new Date();

  // Salvamento instantâneo (mesma regra do editor de guia): qualquer alteração
  // válida é persistida sozinha, sem depender do botão "Salvar".
  const autosave = useAutosave(
    { fullName, tradeName, birthDate, jobTitle, phone, phoneCountry },
    async (v) => {
      await updateFn({
        data: {
          full_name: v.fullName.trim(),
          trade_name: v.tradeName.trim() || null,
          birth_date: v.birthDate,
          job_title: v.jobTitle.trim() || null,
          phone: v.phone.trim() || null,
          phone_country: v.phoneCountry.trim() || null,
          ownerId: accountOwnerId,
        },
      });
      qc.invalidateQueries({ queryKey: ["account-profile", accountOwnerId] });
    },
    { enabled: canSave && !q.isLoading, delay: 300 },
  );


  if (q.isLoading) {
    return (
      <div className="p-8 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <>
    <div className="hidden w-full space-y-8 lg:block">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <UserIcon className="size-5 text-primary" />
            {impersonation ? "Perfil da conta" : "Meu perfil"}
          </span>
        }
      />

      {/* Avatar */}
      <section className="glass ds-surface p-4 lg:p-6 border border-border">
        <div className="flex items-center gap-4">
          <div className="relative">
            {avatar ? (
              <img
                src={avatar}
                alt="Foto de perfil"
                className="size-20 rounded-full object-cover border border-border"
              />
            ) : (
              <div className="size-20 rounded-full bg-accent text-accent-foreground grid place-items-center text-xl font-semibold border border-border">
                {initials}
              </div>
            )}
            {uploading && (
              <div className="absolute inset-0 rounded-full bg-black/40 grid place-items-center">
                <Loader2 className="size-5 animate-spin text-white" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="ds-card-title">Foto de perfil</div>
            <div className="ds-meta">PNG, JPG ou WEBP · até 3MB</div>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 hover:bg-secondary px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                <Camera className="size-3.5" /> {avatar ? "Trocar foto" : "Enviar foto"}
              </button>
              {avatar && (
                <button
                  type="button"
                  onClick={onRemoveAvatar}
                  disabled={uploading}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border hover:bg-secondary px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" /> Remover
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={onPickFile}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Dados */}
      <section className="glass ds-surface p-5 border border-border space-y-4">
        <h2 className="ds-section-title mb-0">Dados pessoais</h2>

        <Field label="Nome completo" required>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={120}
            className="input"
            placeholder="Como aparece nos documentos"
          />
        </Field>

        <Field
          label="Nome fantasia"
          hint="Opcional — se preenchido, aparece no lugar do nome completo no cabeçalho."
        >
          <input
            value={tradeName}
            onChange={(e) => setTradeName(e.target.value)}
            maxLength={120}
            className="input"
            placeholder="Ex.: Sigma Turismo"
          />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Data de nascimento" required>
            <input
              type="date"
              value={birthDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setBirthDate(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Cargo" hint="Opcional">
            <input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              maxLength={80}
              className="input"
              placeholder="Ex.: Gerente de reservas"
            />
          </Field>
        </div>

        <div className="grid sm:grid-cols-[8rem_1fr] gap-4">
          <Field label="País / DDI">
            <input
              value={phoneCountry}
              onChange={(e) => setPhoneCountry(e.target.value)}
              maxLength={8}
              className="input"
              placeholder="Ex.: BR / +55"
            />
          </Field>
          <Field label="Telefone">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={30}
              className="input"
              placeholder="Telefone cadastrado na conta"
            />
          </Field>
        </div>

        {(createdAt || onboardingCompletedAt) && (
          <div className="grid sm:grid-cols-2 gap-4">
            {createdAt && (
              <Field label="Conta criada em">
                <input value={createdAt} readOnly disabled className="input opacity-70 cursor-not-allowed" />
              </Field>
            )}
            {onboardingCompletedAt && (
              <Field label="Cadastro concluído em">
                <input value={onboardingCompletedAt} readOnly disabled className="input opacity-70 cursor-not-allowed" />
              </Field>
            )}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="CPF" hint="Alteração apenas via suporte">
            <div className="relative">
              <input
                value={cpfDigits ? formatCPF(cpfDigits) : "—"}
                readOnly
                disabled
                className="input pr-9 opacity-70 cursor-not-allowed"
              />
              <ShieldCheck className="size-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2" />
            </div>
          </Field>
          <Field
            label="E-mail"
            required
            hint={
              email !== emailOriginal
                ? "Enviaremos um link para confirmar o novo e-mail."
                : undefined
            }
          >
            <div className="relative">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input pr-9"
                placeholder="voce@exemplo.com"
              />
              <Mail className="size-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2" />
            </div>
          </Field>
        </div>

        <div className="pt-2 flex items-center justify-end gap-3">
          <AutosaveIndicator status={autosave.status} />
          {email !== emailOriginal && (
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={!canSave || save.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
              Confirmar novo e-mail
            </button>
          )}
        </div>

      </section>

      <style>{`
        .input { width: 100%; border-radius: 0.75rem; border: 1px solid hsl(var(--border)); background: hsl(var(--background)); padding: 0.55rem 0.75rem; font-size: 0.875rem; outline: none; }
        .input:focus { border-color: hsl(var(--primary) / 0.7); box-shadow: 0 0 0 3px hsl(var(--primary) / 0.15); }
      `}</style>
    </div>

    {/* CELULAR — mockups "Meu Perfil" e "Meu Perfil · novo e-mail pendente" (aprovados 05/11/2026). */}
    <div className="ds-stack lg:hidden">
      {/* Identidade: uma linha só. A câmera fica no centro da foto: tocar nela troca, remove ou adiciona. */}
      <section className={`${PANEL_SHELL} px-[14px] py-3`}>
        <div className="flex items-center gap-3">
          {avatar ? (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Alterar, remover ou adicionar foto (PNG, JPG ou WEBP · até 3MB)"
                  title="Foto: PNG, JPG ou WEBP · até 3MB"
                  disabled={uploading}
                  className="relative grid size-11 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full text-[#fbf6f1]"
                >
                  <img src={avatar} alt="Foto de perfil" className="absolute inset-0 size-full object-cover" />
                  <span className="absolute inset-0 bg-black/40" />
                  <span className="relative">
                    {uploading ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" strokeWidth={2} />}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto min-w-[10rem] p-1.5">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="ds-overlay-item flex w-full items-center gap-2 px-2.5 text-left hover:bg-foreground/[0.06]"
                >
                  <Camera className="size-3.5" /> Trocar foto
                </button>
                <button
                  type="button"
                  onClick={onRemoveAvatar}
                  className="ds-overlay-item flex w-full items-center gap-2 px-2.5 text-left text-[#c98c8c] hover:bg-foreground/[0.06]"
                >
                  <Trash2 className="size-3.5" /> Remover foto
                </button>
              </PopoverContent>
            </Popover>
          ) : (
            <button
              type="button"
              aria-label="Alterar, remover ou adicionar foto (PNG, JPG ou WEBP · até 3MB)"
              title="Foto: PNG, JPG ou WEBP · até 3MB"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-accent text-[#fbf6f1]"
            >
              {uploading ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" strokeWidth={2} />}
            </button>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 truncate font-display text-[14px] font-bold leading-[1.3]">
                {fullName || "—"}
              </div>
            </div>
            <div className="mt-px truncate text-[12px] text-muted-foreground">{emailOriginal || email}</div>
          </div>
        </div>
      </section>

      {/* Dados Cadastrais */}
      <section className={`${PANEL_SHELL} p-[14px]`}>
        <PanelHeading
          title="Dados Cadastrais"
          className="mb-3"
          titleClassName="text-[10px] tracking-[0.2em]"
          right={
            autosave.status === "saving" ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Salvando…
              </span>
            ) : autosave.status === "error" ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#c98c8c]">
                Falha ao salvar
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#7fb79a]">
                <Check className="size-3" strokeWidth={2.4} /> Alterações Salvas
              </span>
            )
          }
        />
        <div className="grid grid-cols-1 gap-3">
          <DenseField label="Nome Completo" required>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={120}
              className={DENSE_INPUT}
              placeholder="Como aparece nos documentos"
            />
          </DenseField>
          <DenseField
            label="Nome Fantasia"
            optional
            hint="Se preenchido, substitui o nome completo no cabeçalho."
          >
            <input
              value={tradeName}
              onChange={(e) => setTradeName(e.target.value)}
              maxLength={120}
              className={DENSE_INPUT}
              placeholder="Ex.: Sigma Turismo"
            />
          </DenseField>
          <DenseField label="CPF">
            <div
              aria-disabled="true"
              className={`${DENSE_INPUT} flex cursor-not-allowed items-center gap-2 bg-foreground/[0.03] text-muted-foreground tabular-nums`}
            >
              <span className="min-w-0 truncate">{cpfDigits ? formatCPF(cpfDigits) : "—"}</span>
              <span
                role="button"
                aria-label="Alteração apenas via suporte"
                title="Alteração apenas via suporte"
                className="ml-auto flex cursor-help text-muted-foreground"
              >
                <Lock className="size-3.5" />
              </span>
            </div>
          </DenseField>
          <DenseField label="Data de Nascimento" required>
            <div className="relative">
              <input
                type="date"
                value={birthDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setBirthDate(e.target.value)}
                className={`${DENSE_INPUT} pr-9 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0`}
              />
              <CalendarDays className="pointer-events-none absolute right-[11px] top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
          </DenseField>
          <DenseField label="Telefone">
            <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2">
              <div className="relative">
                <input
                  value={phoneCountry}
                  onChange={(e) => setPhoneCountry(e.target.value)}
                  maxLength={8}
                  className={`${DENSE_INPUT} pr-8`}
                  placeholder="BR +55"
                  aria-label="País / DDI"
                />
                <ChevronDown className="pointer-events-none absolute right-[11px] top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={30}
                className={DENSE_INPUT}
                placeholder="(11) 98888-7766"
                aria-label="Telefone"
              />
            </div>
          </DenseField>
          <DenseField label="Cargo" optional>
            <input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              maxLength={80}
              className={DENSE_INPUT}
              placeholder="Ex.: Gerente de Reservas"
            />
          </DenseField>
        </div>
      </section>

      {/* E-mail: quadrante isolado */}
      <section className={`${PANEL_SHELL} p-[14px]`}>
        <PanelHeading
          title="E-mail"
          className="mb-3"
          titleClassName="text-[10px] tracking-[0.2em]"
          right={
            email !== emailOriginal ? (
              <Tag tone="amber" icon={<Clock className="size-2.5" strokeWidth={2.4} />}>
                Não Confirmado
              </Tag>
            ) : (
              <Tag tone="sage" icon={<Check className="size-2.5" strokeWidth={2.4} />}>
                Verificado
              </Tag>
            )
          }
        />
        <div className="relative">
          <Mail className="pointer-events-none absolute left-[11px] top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground opacity-70" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${DENSE_INPUT} pl-[33px]`}
            placeholder="voce@exemplo.com"
            aria-label="E-mail"
          />
        </div>
        {email !== emailOriginal && (
          <>
            <p className="mt-2 text-[11.5px] font-medium leading-[1.45] text-[var(--faint)]">
              Enviaremos um link para confirmar o novo e-mail. Até lá, o atual continua valendo.
            </p>
            <div className="mt-2.5 flex min-w-0 items-center gap-1.5">
              <ActionButton
                kind="primary"
                full
                icon={save.isPending ? <Loader2 className="size-3 animate-spin" /> : <Mail className="size-3" strokeWidth={2.2} />}
                disabled={!canSave || save.isPending}
                onClick={() => save.mutate()}
              >
                Confirmar Novo E-mail
              </ActionButton>
              <ActionButton onClick={() => setEmail(emailOriginal)}>Descartar</ActionButton>
            </div>
          </>
        )}
      </section>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={onPickFile}
      />
    </div>
    </>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="ds-meta mb-1 block">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="ds-meta mt-1">{hint}</p>}
    </div>
  );
}
