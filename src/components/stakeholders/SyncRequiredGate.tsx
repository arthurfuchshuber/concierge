import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Lock, UserRound } from "lucide-react";
import { listAirbnbAccounts, type UnsyncedProperty } from "@/lib/airbnb-account.functions";
import { useUnsyncedProperties } from "./useUnsyncedProperties";
import { useAnyWindowOpen } from "@/lib/global-overlay-store";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ClampName } from "@/components/ui/clamp-name";
import { PropertyThumb } from "@/components/ui/property-thumb";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { AirbnbAccountFlow, type AirbnbFlowRequest } from "./AirbnbAccountFlow";

/**
 * AVISO OBRIGATÓRIO "SINCRONIZE SEUS IMÓVEIS" (mockups aprovados, 14/10/2026).
 *
 * Aparece em QUALQUER tela do painel, só para quem tem a permissão de vincular imóveis
 * (Imóveis vinculados, escrita), e segura a tela até todos os imóveis sem integração
 * estarem sincronizados com o Airbnb. Não tem "X" nem fecha com Esc/clique fora.
 *
 * Nunca prende ninguém sem saída: o servidor só marca `blocking` quando existe conta do Airbnb
 * ativa E anúncio livre para ligar (imóvel que não está no Airbnb não trava o sistema).
 * Se a consulta falhar, o aviso não aparece.
 */
export function SyncRequiredGate() {
  const { perm, q, accountOwnerId } = useUnsyncedProperties();
  const [flow, setFlow] = useState<AirbnbFlowRequest>(null);
  const [showPending, setShowPending] = useState(false);
  const otherWindowOpen = useAnyWindowOpen();
  const prevFlow = useRef<AirbnbFlowRequest>(null);

  // Segura uma tela neutra enquanto a 1ª consulta responde E até a janela estar pintada, para o
  // painel nunca "piscar" por trás do aviso ao recarregar (F5). Libera sozinha (5 s) se algo demorar
  // demais ou falhar. A cobertura só sai quando: (a) não há aviso a mostrar (libera na hora) ou
  // (b) o aviso está aberto e o fundo desfocado dele já cobriu a tela (ver `onOpenAutoFocus`).
  const booting = perm.loading || (perm.allowed && q.isLoading);
  const [bootGiveUp, setBootGiveUp] = useState(false);
  const [coverDone, setCoverDone] = useState(false);
  const [dialogPainted, setDialogPainted] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setBootGiveUp(true), 5000);
    return () => window.clearTimeout(t);
  }, []);

  // Fechar no "X" adia o aviso por 1 hora (por conta, neste navegador); depois reabre sozinho.
  const snoozeKey = `sync-gate-snooze:${accountOwnerId ?? "self"}`;
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  useEffect(() => {
    const v = Number(window.localStorage.getItem(snoozeKey) || 0);
    setSnoozedUntil(v > Date.now() ? v : 0);
  }, [snoozeKey]);
  useEffect(() => {
    if (!snoozedUntil) return;
    const t = window.setTimeout(() => setSnoozedUntil(0), Math.max(0, snoozedUntil - Date.now()));
    return () => window.clearTimeout(t);
  }, [snoozedUntil]);
  function snooze() {
    const until = Date.now() + 60 * 60 * 1000;
    window.localStorage.setItem(snoozeKey, String(until));
    setSnoozedUntil(until);
  }

  const pending = q.data?.properties ?? [];
  const previewFull = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("verConexao");
  const blocking = !previewFull && !snoozedUntil && perm.allowed && !!q.data?.blocking && pending.length > 0;

  // Abertura SÍNCRONA (sem estado nem efeito no meio): no mesmo quadro em que a consulta confirma
  // o bloqueio, o <Dialog> já recebe open=true. Só abre quando não há outra janela na frente
  // (ex.: o fluxo de conectar conta); depois de aberto, fica (a própria janela do aviso conta como
  // "janela aberta", por isso `wasOpen`).
  const [wasOpen, setWasOpen] = useState(false);
  const shouldBeOpen = blocking && !flow && (wasOpen || !otherWindowOpen);
  useEffect(() => {
    setWasOpen(shouldBeOpen);
  }, [shouldBeOpen]);
  useEffect(() => {
    if (!booting && (!shouldBeOpen || dialogPainted)) setCoverDone(true);
  }, [booting, shouldBeOpen, dialogPainted]);
  const showBootCover = !bootGiveUp && !coverDone;

  // Ao fechar o fluxo de sincronizar, confere de novo.
  useEffect(() => {
    if (prevFlow.current && !flow) void q.refetch();
    prevFlow.current = flow;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  // Só os imóveis que ainda faltam: o que já foi vinculado sai da tela na hora.
  const rows = pending;
  const left = rows.length;

  const info = (p: UnsyncedProperty) => ({
    id: p.id,
    name: p.name,
    city: p.city,
    ownerName: p.ownerName,
    ownerPhone: p.ownerPhone,
    ownerPhoneCountry: p.ownerPhoneCountry,
    imageUrl: p.imageUrl,
    imageUrls: p.imageUrls,
  });
  // Contas do Airbnb conectadas (informativo). Mesma chave de cache do fluxo de sincronização.
  const qc = useQueryClient();
  const accountsFn = useServerFn(listAirbnbAccounts);
  const accounts = useQuery({
    queryKey: ["airbnb-accounts", accountOwnerId ?? "self"],
    refetchOnWindowFocus: true,
    queryFn: () => accountsFn({ data: { accountOwnerId } }),
    enabled: shouldBeOpen,
    staleTime: 0,
    retry: false,
  });
  const accList = accounts.data ?? [];
  // Ao voltar de qualquer fluxo (ex.: conectar outra conta), atualiza a lista de contas.
  useEffect(() => {
    if (!flow) void qc.invalidateQueries({ queryKey: ["airbnb-accounts"] });
  }, [flow, qc]);

  // TODOS os imóveis pendentes entram sempre: não há seleção. Um só imóvel abre o fluxo individual.
  function link() {
    setFlow(
      pending.length === 1
        ? { type: "syncProperty", property: info(pending[0]) }
        : { type: "syncProperties", properties: pending.map(info) },
    );
  }

  return (
    <>
      {showBootCover ? (
        <div
          aria-hidden
          className="fixed inset-0 z-[60] grid place-items-center bg-background text-muted-foreground"
        >
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : null}
      {/* Fundo fixo enquanto houver bloqueio: na troca entre esta janela e a de vincular (ou no
          "Voltar") as janelas fecham/abrem e somem por alguns quadros; este fundo nunca sai. */}
      {blocking || flow ? (
        <div aria-hidden className="fixed inset-0 z-[49] bg-background/85 backdrop-blur-md" />
      ) : null}
      <Dialog open={shouldBeOpen} onOpenChange={(o) => { if (!o) snooze(); }}>
        <DialogContent
          onOpenAutoFocus={() => {
            // Janela montada: espera 2 quadros para o fundo desfocado pintar e só então solta a cobertura.
            requestAnimationFrame(() => requestAnimationFrame(() => setDialogPainted(true)));
          }}
          onInteractOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          className="max-w-[380px] gap-2.5 p-[18px] pt-[22px] sm:gap-3.5 sm:p-[18px]"
        >
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <div className="grid min-w-0 gap-2.5 pr-11">
              <DialogTitle className="flex items-center gap-2.5 font-display text-[19px] font-extrabold leading-[1.2] tracking-[-0.01em]">
                <span className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-secondary text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]">
                  <Lock className="size-4" />
                </span>
                <span className="min-w-0 truncate">
                  Sincronize seus imóveis
                </span>
              </DialogTitle>
              <DialogDescription className="text-[12.5px] leading-[1.55]">
                <b className="font-bold text-foreground">
                  {left} {left === 1 ? "imóvel" : "imóveis"}
                </b>{" "}
                sem integração com o Airbnb. Vincule para liberar o painel.
              </DialogDescription>
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
            <div className="text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground/80">
              Contas do Airbnb
            </div>
            {accList.map((a) => {
              const free = Math.max(0, (a.listings ?? 0) - a.imported);
              return (
                <div
                  key={a.channelId}
                  data-clip-row
                  className="flex items-center gap-3 rounded-[14px] bg-foreground/[0.03] p-2.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]"
                >
                  <span className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-secondary text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]">
                    <UserRound className="size-4" />
                  </span>
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <ClampName text={a.title} passThrough className="min-w-0 flex-1 text-[13px] font-bold" />
                      {a.status === "active" && free === 0 && (a.listings ?? 0) > 0 && (
                        <span className="ds-ok shrink-0 whitespace-nowrap rounded-full bg-[color-mix(in_oklab,currentColor_14%,transparent)] px-2 py-0.5 text-[10.5px] font-bold">
                          Todos vinculados
                        </span>
                      )}
                    </div>
                    {a.status === "active" ? (
                      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-muted-foreground">
                        <span className="whitespace-nowrap"><b className="font-bold text-foreground">{a.listings ?? 0}</b> no Airbnb</span>
                        <span aria-hidden>·</span>
                        <span className="whitespace-nowrap"><b className="font-bold text-foreground">{a.imported}</b> {a.imported === 1 ? "sincronizado" : "sincronizados"}</span>
                      </span>
                    ) : (
                      <span className="truncate text-[11.5px] ds-atencao">Precisa reconectar</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Botões empilhados (mockup G1 aprovado): principal em cima; "Imóveis pendentes" abre a lista. */}
          <div className="grid shrink-0 grid-cols-[minmax(0,1fr)] gap-2 pt-1">
            <button
              type="button"
              onClick={link}
              className="flex h-[46px] items-center justify-center gap-2 rounded-[13px] bg-gradient-to-br from-[#7c1ad8] to-[#e82dae] text-[13.5px] font-extrabold text-white"
            >
              Vincular anúncios
            </button>
            <button
              type="button"
              onClick={() => setFlow({ type: "connect" })}
              className="flex h-11 items-center justify-center gap-2 rounded-[13px] bg-foreground/[0.04] text-[12.5px] font-bold text-foreground/85 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_12%,transparent)]"
            >
              Conectar conta
            </button>
            <button
              type="button"
              aria-expanded={showPending}
              onClick={() => setShowPending((v) => !v)}
              className="flex h-11 items-center justify-center gap-2 rounded-[13px] bg-foreground/[0.04] text-[12.5px] font-bold text-foreground/85 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_12%,transparent)]"
            >
              Imóveis pendentes
              <span className="font-semibold text-muted-foreground">{left}</span>
            </button>
          </div>
          {showPending ? (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {rows.map((p) => {
              const cur = p;
              return (
                <div
                  key={p.id}
                  data-clip-row
                  className="flex items-center gap-3 rounded-[14px] bg-foreground/[0.03] p-2.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]"
                >
                  <PropertyThumb
                    src={cur.imageUrl}
                    fallbacks={cur.imageUrls}
                    className="size-[34px] rounded-[9px]"
                  />
                  <div className="grid min-w-0 flex-1 gap-1">
                    <ClampName text={cur.name} passThrough className="text-[13px] font-bold" />
                    <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
                      {cur.ownerName ? (
                        <>
                          <span className="truncate">
                            Proprietário(a):{" "}
                            <b className="font-semibold text-foreground">{cur.ownerName}</b>
                          </span>
                          <PhoneActionButton
                            phone={cur.ownerPhone}
                            country={cur.ownerPhoneCountry}
                            size={11}
                            alwaysShow
                            className="shrink-0 !p-0"
                          />
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <AirbnbAccountFlow request={flow} onClose={() => setFlow(null)} />
    </>
  );
}
