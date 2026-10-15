import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Lock, Plus, RefreshCw, UserRound } from "lucide-react";
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
  const [initial, setInitial] = useState<UnsyncedProperty[]>([]);
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

  const pending = q.data?.properties ?? [];
  const blocking = perm.allowed && !!q.data?.blocking && pending.length > 0;

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
      <Dialog open={shouldBeOpen} onOpenChange={() => undefined}>
        <DialogContent
          hideClose
          onOpenAutoFocus={() => {
            // Janela montada: espera 2 quadros para o fundo desfocado pintar e só então solta a cobertura.
            requestAnimationFrame(() => requestAnimationFrame(() => setDialogPainted(true)));
          }}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          className="max-w-[380px] gap-2.5 p-[18px] sm:gap-3.5 sm:max-w-[560px] sm:p-[18px]"
        >
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <div className="grid min-w-0 gap-2.5">
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
                    <ClampName text={a.title} passThrough className="text-[13px] font-bold" />
                    {a.status === "active" ? (
                      <span className="truncate text-[11.5px] text-muted-foreground">
                        {free} {free === 1 ? "anúncio disponível" : "anúncios disponíveis"}
                      </span>
                    ) : (
                      <span className="truncate text-[11.5px] ds-atencao">Precisa reconectar</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Lado a lado (mockup H4/H5 aprovado, 14/10/2026): secundário à esquerda, principal à direita.
              No celular o texto do secundário é curto para caber em UMA linha. */}
          <div className="grid shrink-0 grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setFlow({ type: "connect" })}
              className="flex h-10 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--win-radius)] bg-foreground/[0.04] px-1.5 text-[12px] font-extrabold sm:px-2 sm:text-[12.5px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_18%,transparent)]"
            >
              <Plus className="size-3.5 shrink-0 sm:size-4" />
              <span className="min-w-0 truncate sm:hidden">Conectar conta</span>
              <span className="hidden min-w-0 truncate sm:inline">
                Conectar outra conta do Airbnb
              </span>
            </button>
            <button
              type="button"
              onClick={link}
              className="flex h-10 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--win-radius)] bg-gradient-to-br from-[#7c1ad8] to-[#e82dae] px-1.5 text-[12.5px] font-extrabold text-white sm:px-2 sm:text-[13.5px]"
            >
              <RefreshCw className="size-3.5 shrink-0 sm:size-4" />
              <span className="min-w-0 truncate">Vincular anúncios</span>
            </button>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
            <div className="flex items-center justify-between gap-2 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground/80">
              <span>Imóveis pendentes</span>
              <span className="font-semibold normal-case tracking-normal">
                {left}
              </span>
            </div>
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
        </DialogContent>
      </Dialog>
      <AirbnbAccountFlow request={flow} onClose={() => setFlow(null)} />
    </>
  );
}
