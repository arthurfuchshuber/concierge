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
import { Camera, Check, Clock, Loader2, Trash2, Mail, Lock, CalendarDays, Info } from "lucide-react";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ActionButton } from "@/components/admin-pages/admin-mobile-ui";
import { toast } from "sonner";
import { formatCPF } from "@/lib/masks";
import { useImpersonation } from "@/hooks/useImpersonation";
import { useAutosave } from "@/hooks/useAutosave";


export function MeuPerfilPage() {
  const getFn = useServerFn(getMyProfile);
  const updateFn = useServerFn(updateMyProfile);
  const uploadFn = useServerFn(uploadMyAvatar);
  const removeFn = useServerFn(removeMyAvatar);
  const emailFn = useServerFn(requestEmailChange);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const birthRef = useRef<HTMLInputElement>(null);
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
  const cpfDigits = q.data?.profile?.cpf ?? "";

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

    {/* CELULAR — mockups "Meu Perfil" e "Meu Perfil · novo e-mail pendente" (aprovados 05/11/2026). */}
    <div className="ds-stack lg:max-w-[760px]">
      {/* Meu Perfil no celular — direção E (aprovada em 05/11/2026): tudo numa tela, campos sem caixa. */}
      <section className={`${PANEL_SHELL} px-4 pb-[18px] pt-4`}>
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

        <div className={`mb-1 mt-4 border-t ${UHAIR}`} />

        <div className="flex flex-col gap-3">
          <UField label="Nome Completo" required>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={120}
              className={UINPUT}
              placeholder="Como aparece nos documentos"
            />
          </UField>
          <UField label="Nome Fantasia" optional info="Se preenchido, substitui o nome completo no cabeçalho.">
            <input
              value={tradeName}
              onChange={(e) => setTradeName(e.target.value)}
              maxLength={120}
              className={UINPUT}
              placeholder="Ex.: Sigma Turismo"
            />
          </UField>
          <div className="grid grid-cols-1 gap-[18px]">
            <UField
              label="Número do CPF"
              badge={
                <span
                  role="button"
                  aria-label="Alteração apenas via suporte"
                  title="Alteração apenas via suporte"
                  className="flex cursor-help text-[var(--faint)]"
                >
                  <Lock className="size-3.5" />
                </span>
              }
            >
              <div aria-disabled="true" className={`${UROW} cursor-not-allowed text-muted-foreground`}>
                <span className="min-w-0 flex-1 truncate">{cpfDigits ? formatCPF(cpfDigits) : "—"}</span>
              </div>
            </UField>
            <UField
              label="Nascimento"
              required
              badge={
                <button
                  type="button"
                  aria-label="Abrir calendário"
                  onClick={() => birthRef.current?.showPicker?.()}
                  className="flex cursor-pointer text-[var(--faint)]"
                >
                  <CalendarDays className="size-3.5" />
                </button>
              }
            >
              <div className={`${UROW} relative`}>
                <input
                  ref={birthRef}
                  type="date"
                  value={birthDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className={`${UINPUT_BARE} [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0`}
                />
              </div>
            </UField>
          </div>
          <UField label="Cargo" optional>
            <input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              maxLength={80}
              className={UINPUT}
              placeholder="Ex.: Gerente de Reservas"
            />
          </UField>
        </div>

        <div className="mt-3 flex flex-col gap-3">
          <UField label="Telefone">
            <div className={UROW}>
              <input
                value={phoneCountry}
                onChange={(e) => setPhoneCountry(e.target.value)}
                maxLength={8}
                className={`${UINPUT_BARE} w-[58px] flex-none`}
                placeholder="BR +55"
                aria-label="País / DDI"
              />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={30}
                className={UINPUT_BARE}
                placeholder="(11) 98888-7766"
                aria-label="Telefone"
              />
            </div>
          </UField>
          <UField
            label="E-mail"
            badge={
              email !== emailOriginal ? (
                <span
                  title="Não Confirmado"
                  aria-label="Não Confirmado"
                  className="grid size-3.5 place-items-center rounded-full bg-[rgba(201,169,98,0.16)] text-[#c9a962]"
                >
                  <Clock className="size-[9px]" strokeWidth={2.8} />
                </span>
              ) : (
                <span
                  title="Verificado"
                  aria-label="Verificado"
                  className="grid size-3.5 place-items-center rounded-full bg-[rgba(127,183,154,0.16)] text-[#7fb79a]"
                >
                  <Check className="size-[9px]" strokeWidth={2.8} />
                </span>
              )
            }
          >
            <div className={UROW}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={UINPUT_BARE}
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
          </UField>
        </div>
      </section>

      {/* O "Salvo" saiu a pedido; só aparece o que exige atenção. */}
      {autosave.status === "saving" ? (
        <p className="inline-flex items-center justify-center gap-1 text-[11px] font-bold text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Salvando…
        </p>
      ) : autosave.status === "error" ? (
        <p className="text-center text-[11px] font-bold text-[#c98c8c]">Falha ao salvar</p>
      ) : null}

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

/** Campos "sem caixa" do celular (direção E): rótulo pequeno em cima, valor em texto e só um fio embaixo. */
const UHAIR = "border-foreground/[0.07]";
const UROW = `flex h-[34px] min-w-0 items-center gap-2 border-b ${UHAIR} text-[14px] text-foreground tabular-nums focus-within:border-foreground/40`;
const UINPUT_BARE =
  "h-full w-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[14px] text-foreground outline-none placeholder:text-[var(--faint)]";
const UINPUT = `${UINPUT_BARE} border-b ${UHAIR} focus:border-foreground/40`;

function UField({
  label,
  required,
  optional,
  info,
  badge,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  info?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-h-4 items-center gap-1.5">
        <label className="text-[11.5px] font-semibold text-[var(--faint)]">
          {label}
          {optional ? <span className="font-medium"> (Opcional)</span> : null}
          {required ? <span className="text-[#c98c8c]"> *</span> : null}
        </label>
        {badge}
        {info ? (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Mais informações" className="flex cursor-pointer text-[var(--faint)]">
                <Info className="size-[13px]" strokeWidth={2} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[260px] max-w-[calc(100vw-32px)] p-3 text-[12px] leading-[1.45] text-muted-foreground">
              {info}
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
      {children}
    </div>
  );
}
