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
import { Camera, Loader2, Trash2, User as UserIcon, Mail, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { formatCPF } from "@/lib/masks";
import { useImpersonation } from "@/hooks/useImpersonation";
import { PageHeader } from "@/components/ds/PageHeader";

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

  if (q.isLoading) {
    return (
      <div className="p-8 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <div className="w-full space-y-8">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <UserIcon className="size-5 text-primary" />
            {impersonation ? "Perfil da conta" : "Meu perfil"}
          </span>
        }
      />

      {/* Avatar */}
      <section className="glass rounded-2xl p-4 lg:p-6 border border-border">
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
      <section className="glass rounded-2xl p-5 border border-border space-y-4">
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

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!canSave || save.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Salvar alterações
          </button>
        </div>
      </section>

      <style>{`
        .input { width: 100%; border-radius: 0.75rem; border: 1px solid hsl(var(--border)); background: hsl(var(--background)); padding: 0.55rem 0.75rem; font-size: 0.875rem; outline: none; }
        .input:focus { border-color: hsl(var(--primary) / 0.7); box-shadow: 0 0 0 3px hsl(var(--primary) / 0.15); }
      `}</style>
    </div>
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
