import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  getPendingFullConnections,
  confirmFullConnectionFn,
  importIcalBlocksFn,
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
  const importFn = useServerFn(importIcalBlocksFn);
  // Bloqueios manuais: escolher anúncios → link obrigatório em cada um → "Importar agora!".
  const [picking, setPicking] = useState(false);
  const [draftPick, setDraftPick] = useState<Set<string>>(new Set());
  const [blockIds, setBlockIds] = useState<Set<string>>(new Set());
  const [icalUrl, setIcalUrl] = useState<Record<string, string>>({});
  const [icalErr, setIcalErr] = useState<Record<string, string>>({});
  const [icalDone, setIcalDone] = useState<Record<string, number>>({});
  const [importing, setImporting] = useState(false);

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
  const [pickSearch, setPickSearch] = useState("");
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const pickItems = pickSearch.trim()
    ? items.filter((i) => norm(i.propertyName ?? "").includes(norm(pickSearch.trim())))
    : items;

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
  const mainRef = useRef<HTMLDivElement>(null);
  function closeError() {
    setBulkError(null);
    requestAnimationFrame(() => mainRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
  }

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
              [it.propertyId]: "",
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
        if (done)
          parts.push(
            `${done} ${done === 1 ? "anúncio já foi conectado" : "anúncios já foram conectados"} com sucesso.`,
          );
        if (missing.length)
          parts.push(
            `Motivo: as diárias de ${missing.join(", ")} ainda não chegaram da sua ferramenta de precificação (são necessários pelo menos os próximos 30 dias com preço definido por ela).\n\nO que fazer: abra a ferramenta de precificação, confira se esses anúncios estão ativos e com a sincronização das diárias ligada, clique em sincronizar e aguarde alguns minutos antes de tentar de novo.`,
          );
        if (failed.length)
          parts.push(
            `Motivo: não conseguimos conferir ${failed.join(", ")} agora (falha temporária de conexão).\n\nO que fazer: aguarde 1 minuto e toque novamente em "Já conectei".`,
          );
        setBulkError(parts.join("\n\n"));
      }
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const apiKey = q.data?.apiKey ?? null;
  const steps = [
    "Se você possui bloqueios manuais no calendário, importe-os usando o link do iCal de cada anúncio.",
    'Depois de finalizar a importação, conecte sua ferramenta de precificação ao fornecedor "Channex" com o código abaixo, importe os anúncios e sincronize as diárias. As reservas confirmadas na plataforma serão importadas automaticamente.',
    `Volte aqui e toque em "${items.length > 1 ? "Já conectei todos" : "Já conectei"}".`,
  ];
  const isIcs = (u: string) =>
    /^https:\/\/([a-z0-9-]+\.)*airbnb\.[a-z.]+\/.+\.ics(\?.*)?$/i.test(u.trim());
  const pendingIcal = items.filter(
    (i) => blockIds.has(i.propertyId) && icalDone[i.propertyId] === undefined,
  );
  const icalReady =
    pendingIcal.length > 0 && pendingIcal.every((i) => isIcs(icalUrl[i.propertyId] ?? ""));

  async function importIcal() {
    setImporting(true);
    for (const it of pendingIcal) {
      setIcalErr((e) => ({ ...e, [it.propertyId]: "" }));
      try {
        const r = await importFn({
          data: { propertyId: it.propertyId, url: (icalUrl[it.propertyId] ?? "").trim() },
        });
        setIcalDone((d) => ({ ...d, [it.propertyId]: r.imported }));
      } catch (e) {
        setIcalErr((x) => ({
          ...x,
          [it.propertyId]: e instanceof Error ? e.message : "Não foi possível importar.",
        }));
      }
    }
    setImporting(false);
  }
  const eyebrow = "ds-eyebrow text-[10px] tracking-[0.2em] text-muted-foreground";
  const card =
    "rounded-md bg-foreground/[0.03] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]";

  return (
    <Dialog open={open}>
      <DialogContent
        ref={mainRef}
        hideClose
        style={{ width: "min(calc(100% - 2rem), 380px)", maxWidth: 380 }}
        className="max-h-[90dvh] gap-3.5 overflow-y-auto p-[18px] sm:p-[18px]"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="grid gap-2">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-sm bg-[color-mix(in_oklab,#c9a24a_14%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,#c9a24a_35%,transparent)] ds-atencao">
              <Lock className="size-[18px]" />
            </span>
            <DialogTitle className="min-w-0 font-display text-[18px] font-extrabold leading-[1.2] tracking-[-0.01em]">
              Finalize a ativação
            </DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            Passos para ativar os anúncios no Airbnb.
          </DialogDescription>
        </div>

        <Dialog
          open={!!bulkError}
          onOpenChange={(v) => {
            if (!v) closeError();
          }}
        >
          <DialogContent
            hideClose
            style={{ width: "min(calc(100% - 2rem), 340px)", maxWidth: 340 }}
            className="max-h-[90dvh] gap-3.5 overflow-y-auto p-[18px] sm:p-[18px]"
          >
            <DialogTitle className="font-display text-[16px] font-extrabold leading-[1.25]">
              Ainda não foi possível ativar
            </DialogTitle>
            <DialogDescription className="whitespace-pre-line text-[12.5px] leading-[1.5] text-foreground/85">
              {bulkError}
            </DialogDescription>
            <button
              type="button"
              onClick={closeError}
              className="h-10 rounded-sm bg-gradient-to-br from-brand-purple to-brand-magenta text-[13px] font-extrabold text-white"
            >
              Ok!
            </button>
          </DialogContent>
        </Dialog>

        <ol
          id="full-connect-steps"
          className="grid scroll-mt-4 gap-2 rounded-sm bg-foreground/[0.03] px-[13px] py-3 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]"
        >
          {steps.map((s, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5 text-[12px] leading-[1.45] text-foreground/85"
            >
              <b className="grid size-[18px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-purple to-brand-magenta text-[10px] text-white">
                {i + 1}
              </b>
              {s}
            </li>
          ))}
        </ol>

        <div className="grid gap-1.5">
          <span className={eyebrow}>Chave de API · uma só para todos</span>
          {apiKey ? (
            <div className="flex min-w-0 items-center gap-2 rounded-sm bg-foreground/[0.04] px-3 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]">
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
                  <PropertyThumb src={it.imageUrl} className="size-[46px] shrink-0 rounded-sm" />
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
                {blockIds.has(it.propertyId) ? (
                  icalDone[it.propertyId] !== undefined ? (
                    <p className="flex items-center gap-1.5 text-[11.5px] text-foreground/85">
                      <CheckCircle2 className="size-3.5 shrink-0 text-primary" />
                      {icalDone[it.propertyId] === 1
                        ? "1 bloqueio importado."
                        : `${icalDone[it.propertyId]} bloqueios importados.`}
                    </p>
                  ) : (
                    <div className="grid gap-1">
                      <input
                        type="url"
                        required
                        inputMode="url"
                        placeholder="Link do iCal (https://www.airbnb.com.br/calendar/ical/….ics)"
                        value={icalUrl[it.propertyId] ?? ""}
                        onChange={(e) =>
                          setIcalUrl((u) => ({ ...u, [it.propertyId]: e.target.value }))
                        }
                        className={`h-9 w-full min-w-0 rounded-[10px] px-2.5 text-[12px] text-foreground outline-none ${isIcs(icalUrl[it.propertyId] ?? "") ? "bg-background/60 shadow-[inset_0_0_0_1px_var(--primary)]" : "bg-destructive/10 shadow-[inset_0_0_0_1.5px_var(--destructive)]"}`}
                      />
                      {icalUrl[it.propertyId] && !isIcs(icalUrl[it.propertyId]) ? (
                        <p className="text-[11px] text-destructive">
                          Use o link de exportação do Airbnb (termina em .ics).
                        </p>
                      ) : null}
                      {icalErr[it.propertyId] ? (
                        <p className="text-[11px] text-destructive">{icalErr[it.propertyId]}</p>
                      ) : null}
                    </div>
                  )
                ) : null}
                {it.error ? <p className="text-xs text-destructive">{it.error}</p> : null}
              </div>
            ))}
          </div>
        </div>

        <Dialog open={picking} onOpenChange={(v) => !v && setPicking(false)}>
          <DialogContent
            hideClose
            style={{ width: "min(calc(100% - 2rem), 360px)", maxWidth: 360 }}
            className="max-h-[90dvh] gap-3.5 overflow-y-auto p-[18px] sm:p-[18px]"
          >
            <DialogTitle className="font-display text-[16px] font-extrabold leading-[1.25]">
              Quais anúncios possuem bloqueios manuais para importar?
            </DialogTitle>
            <DialogDescription className="text-[12px] text-muted-foreground">
              Selecione os anúncios. Em seguida, cole o link do iCal de cada um.
            </DialogDescription>
            <input
              type="search"
              value={pickSearch}
              onChange={(e) => setPickSearch(e.target.value)}
              placeholder="Buscar anúncio…"
              className="h-9 w-full min-w-0 rounded-[10px] bg-background/60 px-2.5 text-[12.5px] text-foreground outline-none shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)] focus:shadow-[inset_0_0_0_1px_var(--primary)]"
            />
            <div className="grid gap-2">
              {pickItems.length === 0 ? (
                <p className="py-2 text-center text-[12px] text-muted-foreground">
                  Nenhum anúncio encontrado.
                </p>
              ) : null}
              {pickItems.map((it) => (
                <label
                  key={it.propertyId}
                  className={`${card} flex min-w-0 cursor-pointer items-center gap-2.5 px-3 py-2.5 text-[12.5px]`}
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-[var(--primary)]"
                    checked={draftPick.has(it.propertyId)}
                    onChange={(e) =>
                      setDraftPick((cur) => {
                        const next = new Set(cur);
                        if (e.target.checked) next.add(it.propertyId);
                        else next.delete(it.propertyId);
                        return next;
                      })
                    }
                  />
                  <PropertyThumb src={it.imageUrl} className="size-8 shrink-0 rounded-[8px]" />
                  <ClampName text={it.propertyName} passThrough className="flex-1 font-semibold" />
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPicking(false)}
                className="h-10 rounded-sm text-[13px] font-semibold text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setBlockIds(new Set([...draftPick, ...Object.keys(icalDone)]));
                  setPicking(false);
                }}
                className="h-10 rounded-sm bg-gradient-to-br from-brand-purple to-brand-magenta text-[13px] font-extrabold text-white"
              >
                Confirmar
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {items.length > 0 ? (
          pendingIcal.length > 0 ? (
            <button
              type="button"
              disabled={!icalReady || importing}
              onClick={importIcal}
              className="flex h-[42px] items-center justify-center gap-2 rounded-md bg-foreground/[0.06] text-[13px] font-extrabold text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)] disabled:opacity-40"
            >
              {importing ? <Loader2 className="size-4 animate-spin" /> : null}
              {importing ? "Importando bloqueios…" : "Importar agora!"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraftPick(new Set([...blockIds].filter((id) => icalDone[id] === undefined)));
                if (items.length === 1) {
                  setBlockIds(new Set([items[0].propertyId]));
                } else {
                  setPickSearch("");
                  setPicking(true);
                }
              }}
              className="flex h-[42px] items-center justify-center rounded-md text-[13px] font-extrabold text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]"
            >
              Importar bloqueios manuais
            </button>
          )
        ) : null}
        {pendingIcal.length > 0 && !picking ? (
          <p className="text-[11.5px] leading-[1.45] text-muted-foreground">
            Finalize a importação dos bloqueios manuais dos anúncios selecionados para continuar.{" "}
            <button
              type="button"
              disabled={importing}
              onClick={() => {
                setDraftPick(new Set(pendingIcal.map((i) => i.propertyId)));
                setPicking(true);
              }}
              className="font-semibold text-foreground underline underline-offset-2"
            >
              Alterar seleção
            </button>
          </p>
        ) : null}

        {items.length > 0 ? (
          <button
            type="button"
            disabled={
              busy !== null || pendingIcal.length > 0 || picking || !items.some((i) => i.unitCode)
            }
            onClick={confirmAll}
            className="flex h-[46px] items-center justify-center gap-2 rounded-md bg-gradient-to-br from-brand-purple to-brand-magenta text-[13.5px] font-extrabold text-white disabled:opacity-40"
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
