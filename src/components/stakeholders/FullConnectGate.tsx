import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  getPendingFullConnections,
  confirmFullConnectionFn,
} from "@/lib/channex-full-connect.functions";
import { useUnsyncedProperties } from "./useUnsyncedProperties";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ClampName } from "@/components/ui/clamp-name";
import { PropertyThumb } from "@/components/ui/property-thumb";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { CopyButton } from "@/components/CopyButton";

/**
 * AVISO FIXO DO MODO FULL: anúncio vinculado que ainda não está "Conectado" no Airbnb.
 * Mostra o código da unidade para importar na ferramenta de preços e só sai quando o
 * "Já conectei" confirma as diárias e o anúncio é ligado (calendário nunca travado).
 * Não tem "X" nem fecha com Esc/clique fora. Só aparece depois do aviso de sincronização.
 */
export function FullConnectGate() {
  const { perm, q: unsynced } = useUnsyncedProperties();
  const listFn = useServerFn(getPendingFullConnections);
  const confirmFn = useServerFn(confirmFullConnectionFn);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Record<string, string>>({});

  // Prioridade: o aviso de conexão aparece por cima da janela de sincronização (montado depois dela).
  void unsynced;
  const force = true;
  const syncBlocking = false;
  const q = useQuery({
    queryKey: ["full-connect-pending"],
    queryFn: () => listFn(),
    enabled: perm.allowed && (force || !unsynced.isLoading) && !syncBlocking,
    staleTime: 30_000,
    retry: 1,
  });
  const items = q.data?.items ?? [];
  const open = perm.allowed && !syncBlocking && items.length > 0;

  async function confirm(propertyId: string) {
    setBusy(propertyId);
    setNotice((n) => ({ ...n, [propertyId]: "" }));
    try {
      const r = await confirmFn({ data: { propertyId } });
      if (r.ok) {
        toast.success("Anúncio conectado ao Airbnb com o calendário aberto.");
        await qc.refetchQueries({ queryKey: ["full-connect-pending"] });
        window.dispatchEvent(new Event("full-connect-done"));
      } else {
        setNotice((n) => ({
          ...n,
          [propertyId]:
            "Ainda não recebemos as diárias desta unidade. Confira se a importação na sua ferramenta de precificação terminou e clique de novo.",
        }));
      }
    } catch {
      setNotice((n) => ({
        ...n,
        [propertyId]: "Não foi possível confirmar agora. Tente novamente em 1 minuto.",
      }));
    } finally {
      setBusy(null);
    }
  }

  const [bulkError, setBulkError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  /** "Já conectei" global: confere cada anúncio; liga os que têm diárias e explica os que faltam. */
  async function confirmAll() {
    const list = (q.data?.items ?? []).filter((i) => i.unitCode);
    setBusy("__all__");
    setBulkError(null);
    const missing: string[] = [];
    const failed: string[] = [];
    let done = 0;
    try {
      const stages = [
        "Conferindo diárias",
        "Lendo reservas do Airbnb",
        "Protegendo o calendário",
        "Ligando o anúncio ao Airbnb",
        "Importando reservas futuras",
      ];
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const suffix = list.length > 1 ? ` (${i + 1} de ${list.length})` : "";
        let s = 0;
        setProgress(`${stages[0]}${suffix}…`);
        const timer = window.setInterval(() => {
          s = Math.min(s + 1, stages.length - 1);
          setProgress(`${stages[s]}${suffix}…`);
        }, 2500);
        try {
          const r = await confirmFn({ data: { propertyId: it.propertyId } });
          if (r.ok) {
            done++;
            setNotice((n) => ({ ...n, [it.propertyId]: "" }));
          } else {
            missing.push(it.propertyName);
            setNotice((n) => ({
              ...n,
              [it.propertyId]: "Faltam as diárias deste anúncio na sua ferramenta de precificação.",
            }));
          }
        } catch {
          failed.push(it.propertyName);
        } finally {
          window.clearInterval(timer);
        }
      }
      if (!missing.length && !failed.length) setProgress("Concluído!");
      await qc.refetchQueries({ queryKey: ["full-connect-pending"] });
      if (!missing.length && !failed.length) {
        window.dispatchEvent(new Event("full-connect-done"));
        toast.success("Todos os anúncios foram conectados ao Airbnb com o calendário aberto.");
      } else {
        const parts: string[] = [];
        if (missing.length)
          parts.push(
            `Ainda não recebemos as diárias de: ${missing.join(", ")}. Confira na sua ferramenta de precificação se esses anúncios foram ativados e se a sincronização das diárias está ligada, seguindo os passos acima.`,
          );
        if (failed.length)
          parts.push(
            `Não foi possível conferir agora: ${failed.join(", ")}. Tente de novo em 1 minuto.`,
          );
        if (done)
          parts.unshift(`${done} ${done === 1 ? "anúncio conectado" : "anúncios conectados"}.`);
        setBulkError(parts.join(" "));
        requestAnimationFrame(() =>
          document
            .getElementById("full-connect-steps")
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        );
      }
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const apiKey = q.data?.apiKey ?? null;
  const steps = [
    'Na sua ferramenta de precificação, conecte ao fornecedor "Channex" usando o código abaixo.',
    "Importe os anúncios e sincronize as diárias.",
    'Volte aqui e toque em "Já conectei".',
  ];
  const eyebrow = "ds-eyebrow text-[10px] tracking-[0.2em] text-muted-foreground";
  const card =
    "rounded-[14px] bg-foreground/[0.03] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]";

  return (
    <Dialog open={open}>
      <DialogContent
        hideClose
        className="max-h-[90dvh] max-w-[380px] gap-3 overflow-y-auto p-4 sm:p-4"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="grid gap-2">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[color-mix(in_oklab,#c9a24a_14%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,#c9a24a_35%,transparent)] ds-atencao">
              <Lock className="size-[18px]" />
            </span>
            <DialogTitle className="min-w-0 font-display text-[18px] font-extrabold leading-[1.2] tracking-[-0.01em]">
              Finalize a ativação
            </DialogTitle>
          </div>
          <DialogDescription className="text-[12.5px] leading-[1.5]">
            Os anúncios ficam "Conectados" ao Airbnb e não travam o calendário depois de sua
            ferramenta de precificação for sincronizado novamente.
          </DialogDescription>
        </div>

        {bulkError ? (
          <div
            role="alert"
            className="rounded-[14px] bg-destructive/10 p-2.5 text-[12.5px] leading-[1.5] text-destructive shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--destructive)_25%,transparent)]"
          >
            {bulkError}
          </div>
        ) : null}

        <ol
          id="full-connect-steps"
          className="grid scroll-mt-4 gap-2 rounded-[12px] bg-foreground/[0.03] px-[13px] py-3 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]"
        >
          {steps.map((s, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5 text-[12px] leading-[1.45] text-foreground/85"
            >
              <b className="grid size-[18px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#7c1ad8] to-[#e82dae] text-[10px] text-white">
                {i + 1}
              </b>
              {s}
            </li>
          ))}
        </ol>

        <div className="grid gap-1.5">
          <span className={eyebrow}>Chave de API · uma só para todos</span>
          {apiKey ? (
            <div className="flex min-w-0 items-center gap-2 rounded-[12px] bg-foreground/[0.04] px-3 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]">
              <code className="min-w-0 flex-1 truncate text-[12px] text-foreground">{apiKey}</code>
              <CopyButton value={apiKey} size={14} className="size-7 text-foreground/85" />
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">Preparando a chave de acesso…</p>
          )}
        </div>

        <div className="grid gap-1.5">
          <span className={eyebrow}>Anúncios para ativar</span>
          <div className="grid gap-2">
            {items.map((it) => (
              <div key={it.propertyId} className={`${card} grid gap-1.5 px-3 py-2.5`}>
                <div className="flex items-center gap-[11px]">
                  <PropertyThumb
                    src={it.imageUrl}
                    className="size-[46px] shrink-0 rounded-[11px]"
                  />
                  <span className="grid min-w-0 flex-1 gap-[3px]">
                    <ClampName
                      text={it.propertyName}
                      passThrough
                      className="text-[13px] font-bold"
                    />
                    {it.ownerName ? (
                      <small className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="shrink-0">Proprietário(a):</span>
                        <b className="min-w-0 truncate font-semibold text-foreground">
                          {it.ownerName}
                        </b>
                        <PhoneActionButton
                          phone={it.ownerPhone}
                          country={it.ownerPhoneCountry}
                          size={11}
                          alwaysShow
                          className="shrink-0 !p-0"
                        />
                      </small>
                    ) : null}
                  </span>
                </div>
                {it.error ? <p className="text-xs text-destructive">{it.error}</p> : null}
                {notice[it.propertyId] ? (
                  <p className="text-xs text-destructive">{notice[it.propertyId]}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {items.length > 0 ? (
          <button
            type="button"
            disabled={busy !== null || !items.some((i) => i.unitCode)}
            onClick={confirmAll}
            className="flex h-[46px] items-center justify-center gap-2 rounded-[13px] bg-gradient-to-br from-[#7c1ad8] to-[#e82dae] text-[13.5px] font-extrabold text-white disabled:opacity-40"
          >
            {busy === "__all__" ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy === "__all__"
              ? (progress ?? "Conferindo diárias…")
              : items.length > 1
                ? `Já conectei todos (${items.length})`
                : "Já conectei"}
          </button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
