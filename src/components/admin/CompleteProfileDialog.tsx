import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, ShieldCheck, UserCircle2 } from "lucide-react";
import { toast } from "sonner";
import { getMyProfile, updateMyProfile, setMissingCpf } from "@/lib/profile.functions";
import { formatCPF } from "@/lib/masks";

export function CompleteProfileDialog() {
  const getFn = useServerFn(getMyProfile);
  const updateFn = useServerFn(updateMyProfile);
  const cpfFn = useServerFn(setMissingCpf);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => getFn(),
    staleTime: 60_000,
    retry: false,
  });

  const missing = useMemo(() => {
    const p = q.data?.profile;
    if (!q.data) return { any: false, name: false, birth: false, cpf: false };
    const name = !p?.full_name || !p.full_name.trim();
    const birth = !p?.birth_date;
    const cpf = !p?.cpf || !p.cpf.trim();
    return { any: name || birth || cpf, name, birth, cpf };
  }, [q.data]);

  const [fullName, setFullName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [cpfMasked, setCpfMasked] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    const p = q.data.profile;
    setFullName(p?.full_name ?? "");
    setBirthDate(p?.birth_date ?? "");
    setCpfMasked(p?.cpf ? formatCPF(p.cpf) : "");
  }, [q.data]);

  const open = !!q.data && missing.any;

  const cpfDigits = cpfMasked.replace(/\D+/g, "");
  const canSave =
    (!missing.name || fullName.trim().length >= 3) &&
    (!missing.birth || (/^\d{4}-\d{2}-\d{2}$/.test(birthDate) && new Date(birthDate) <= new Date())) &&
    (!missing.cpf || cpfDigits.length === 11);

  async function onSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      if (missing.cpf) {
        await cpfFn({ data: { cpf: cpfDigits } });
      }
      if (missing.name || missing.birth) {
        // updateMyProfile exige full_name + birth_date; envie ambos usando valores atuais/novos.
        await updateFn({
          data: {
            full_name: (fullName || q.data?.profile?.full_name || "").trim(),
            trade_name: q.data?.profile?.trade_name ?? null,
            birth_date: birthDate || q.data?.profile?.birth_date || "",
            job_title: q.data?.profile?.job_title ?? null,
          },
        });
      }
      toast.success("Dados cadastrais atualizados");
      await qc.invalidateQueries({ queryKey: ["my-profile"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-lg [&>button]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="mx-auto mb-2 size-12 rounded-full bg-primary/10 grid place-items-center">
            <UserCircle2 className="size-6 text-primary" />
          </div>
          <DialogTitle className="text-center font-display text-xl">
            Complete seu cadastro
          </DialogTitle>
          <DialogDescription className="text-center">
            Precisamos de alguns dados obrigatórios para liberar o acesso ao painel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {missing.name && (
            <Field label="Nome completo" required>
              <input
                className="input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                maxLength={120}
                placeholder="Como aparece nos documentos"
                autoFocus
              />
            </Field>
          )}

          {missing.birth && (
            <Field label="Data de nascimento" required>
              <input
                type="date"
                className="input"
                value={birthDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setBirthDate(e.target.value)}
              />
            </Field>
          )}

          {missing.cpf && (
            <Field label="CPF" required hint="Usado apenas para identificação da conta.">
              <input
                inputMode="numeric"
                className="input"
                value={cpfMasked}
                onChange={(e) => setCpfMasked(formatCPF(e.target.value.replace(/\D+/g, "").slice(0, 11)))}
                placeholder="000.000.000-00"
              />
            </Field>
          )}

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground pt-1">
            <ShieldCheck className="size-3.5" />
            Seus dados ficam privados e são usados só para conformidade da conta.
          </div>

          <button
            type="button"
            onClick={onSave}
            disabled={!canSave || saving}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Salvar e continuar
          </button>
        </div>

        <style>{`
          .input { width: 100%; border-radius: 0.75rem; border: 1px solid hsl(var(--border)); background: hsl(var(--background)); padding: 0.55rem 0.75rem; font-size: 0.875rem; outline: none; }
          .input:focus { border-color: hsl(var(--primary) / 0.7); box-shadow: 0 0 0 3px hsl(var(--primary) / 0.15); }
        `}</style>
      </DialogContent>
    </Dialog>
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
      <label className="text-xs font-medium text-foreground/80 mb-1 block">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
