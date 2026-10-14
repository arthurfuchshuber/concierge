import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Lock, RefreshCw } from "lucide-react";
import { listUnsyncedProperties, type UnsyncedProperty } from "@/lib/airbnb-account.functions";
import { usePermission } from "@/lib/permissions/usePermission";
import { useImpersonation } from "@/hooks/useImpersonation";
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
function Check2({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] ${
        on
          ? "bg-gradient-to-br from-[#7c1ad8] to-[#e82dae] text-white"
          : "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_30%,transparent)]"
      }`}
    >
      {on ? <Check className="size-3" strokeWidth={3.4} /> : null}
    </span>
  );
}

export function SyncRequiredGate() {
  const { impersonation } = useImpersonation();
  const accountOwnerId = impersonation?.userId ?? null;
  const perm = usePermission("tenant.stakeholders.proprietarios.imoveis", { required: "WRITE" });
  const listFn = useServerFn(listUnsyncedProperties);
  const q = useQuery({
    queryKey: ["unsynced-properties", accountOwnerId ?? "self"],
    queryFn: () => listFn({ data: { accountOwnerId } }),
    enabled: perm.allowed && !perm.loading,
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: true,
  });
  const [flow, setFlow] = useState<AirbnbFlowRequest>(null);
  const [visible, setVisible] = useState(false);
  const [initial, setInitial] = useState<UnsyncedProperty[]>([]);
  const otherWindowOpen = useAnyWindowOpen();
  const prevFlow = useRef<AirbnbFlowRequest>(null);

  // Segura uma tela neutra enquanto a primeira consulta responde, para o painel nunca "piscar"
  // por trás do aviso ao recarregar a página. Libera sozinha se algo demorar demais ou falhar.
  const booting = perm.loading || (perm.allowed && q.isLoading);
  const [bootGiveUp, setBootGiveUp] = useState(false);
  const [bootDone, setBootDone] = useState(false);
  useEffect(() => {
    if (!booting) setBootDone(true);
  }, [booting]);
  useEffect(() => {
    const t = window.setTimeout(() => setBootGiveUp(true), 2500);
    return () => window.clearTimeout(t);
  }, []);
  const showBootCover = booting && !bootDone && !bootGiveUp;

  const pending = q.data?.properties ?? [];
  const blocking = perm.allowed && !!q.data?.blocking && pending.length > 0;

  // Guarda a lista inicial para mostrar "Sincronizado ✓" nas que já foram (e a barra de progresso).
  useEffect(() => {
    if (!blocking) {
      if (initial.length > 0 && !q.isFetching) setInitial([]);
      return;
    }
    setInitial((cur) => {
      const ids = new Set(cur.map((p) => p.id));
      const added = pending.filter((p) => !ids.has(p.id));
      return added.length > 0 ? [...cur, ...added] : cur;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocking, q.data]);

  // Só abre quando não há outra janela na frente (ex.: o fluxo de conectar conta); depois de aberto, fica.
  useEffect(() => {
    if (!blocking || flow) setVisible(false);
    else if (!visible && !otherWindowOpen) setVisible(true);
  }, [blocking, flow, otherWindowOpen, visible]);

  // Ao fechar o fluxo de sincronizar, confere de novo.
  useEffect(() => {
    if (prevFlow.current && !flow) void q.refetch();
    prevFlow.current = flow;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  const pendingIds = new Set(pending.map((p) => p.id));
  const rows = initial.length > 0 ? initial : pending;
  const total = rows.length;
  const done = rows.filter((p) => !pendingIds.has(p.id)).length;
  const left = total - done;
  const pct = total > 0 ? Math.round((100 * done) / total) : 0;

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
  // Seleção: começa com todos os pendentes marcados; quem já foi sincronizado sai da seleção.
  const [sel, setSel] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    setSel((cur) => {
      const nextSel = new Set([...cur].filter((id) => pendingIds.has(id)));
      for (const p of pending)
        if (!seen.current.has(p.id)) {
          seen.current.add(p.id);
          nextSel.add(p.id);
        }
      return nextSel.size === cur.size && [...nextSel].every((id) => cur.has(id)) ? cur : nextSel;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);
  const chosen = pending.filter((p) => sel.has(p.id));
  const allOn = pending.length > 0 && chosen.length === pending.length;
  function toggle(id: string) {
    setSel((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function start() {
    if (chosen.length === 0) return;
    setFlow(
      chosen.length === 1
        ? { type: "syncProperty", property: info(chosen[0]) }
        : { type: "syncProperties", properties: chosen.map(info) },
    );
  }
  const btnLabel = `Sincronizar ${chosen.length} ${chosen.length === 1 ? "selecionado" : "selecionados"}`;
  const syncBtn = (cls: string) => (
    <button
      type="button"
      disabled={chosen.length === 0}
      onClick={start}
      className={`h-10 shrink-0 items-center justify-center gap-2 rounded-[var(--win-radius)] bg-gradient-to-br from-[#7c1ad8] to-[#e82dae] px-[18px] text-[13.5px] font-extrabold text-white disabled:opacity-40 ${cls}`}
    >
      <RefreshCw className="size-4" />
      {btnLabel}
    </button>
  );

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
      <Dialog open={visible} onOpenChange={() => undefined}>
        <DialogContent
          hideClose
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          className="max-w-[380px] gap-3.5 p-[18px] sm:max-w-[560px] sm:p-[18px]"
        >
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-4">
            <div className="grid min-w-0 gap-2.5">
              <DialogTitle className="flex items-center gap-2.5 font-display text-[19px] font-extrabold leading-[1.2] tracking-[-0.01em]">
                <span className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-secondary text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]">
                  <Lock className="size-4" />
                </span>
                {done === 0
                  ? "Sincronize seus imóveis"
                  : `Faltam ${left} ${left === 1 ? "imóvel" : "imóveis"}`}
              </DialogTitle>
              <DialogDescription className="text-[12.5px] leading-[1.55]">
                Sua empresa tem{" "}
                <b className="font-bold text-foreground">
                  {left} {left === 1 ? "imóvel" : "imóveis"}
                </b>{" "}
                sem integração com o Airbnb: eles não recebem reservas nem mensagens. Este aviso
                sumirá quando você sincronizá-los.
              </DialogDescription>
            </div>
            {/* Desktop: botão à direita, alinhado ao topo do título. */}
            {syncBtn("hidden sm:flex")}
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
              <span className="font-bold text-foreground/85">
                {done} de {total} sincronizados
              </span>
              <span>
                {left} {left === 1 ? "pendente" : "pendentes"}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#7c1ad8] to-[#e82dae] transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
            <button
              type="button"
              role="checkbox"
              aria-checked={allOn}
              disabled={pending.length === 0}
              onClick={() => setSel(allOn ? new Set() : new Set(pending.map((p) => p.id)))}
              className="flex items-center gap-3 px-3 py-1.5 text-left"
            >
              <Check2 on={allOn} />
              <b className="text-[12.5px] font-bold">Selecionar todos</b>
              <span className="ml-auto text-[11.5px] text-muted-foreground">
                {chosen.length} de {pending.length}
              </span>
            </button>
            {rows.map((p) => {
              const isDone = !pendingIds.has(p.id);
              const cur = pending.find((x) => x.id === p.id) ?? p;
              const on = sel.has(p.id);
              return (
                <div
                  key={p.id}
                  data-clip-row
                  className={`flex items-center gap-3 rounded-[14px] p-3 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)] ${
                    isDone
                      ? "bg-foreground/[0.025]"
                      : on
                        ? "bg-foreground/[0.06] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_20%,transparent)]"
                        : "bg-foreground/[0.03]"
                  }`}
                >
                  {isDone ? (
                    <Check className="size-4 shrink-0 ds-ok" strokeWidth={2.6} />
                  ) : (
                    // Só o quadradinho marca/desmarca (área de toque de 36px); o nome e os
                    // demais textos da linha nunca alteram a seleção.
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      aria-label={`Selecionar ${cur.name}`}
                      onClick={() => toggle(p.id)}
                      className="-mx-1.5 grid size-9 shrink-0 place-items-center rounded-[10px]"
                    >
                      <Check2 on={on} />
                    </button>
                  )}
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
                    {isDone ? (
                      <span className="flex items-center gap-1.5 text-[12px] font-bold ds-ok">
                        Sincronizado
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Celular: botão embaixo, depois da lista. */}
          {syncBtn("flex sm:hidden")}
        </DialogContent>
      </Dialog>
      <AirbnbAccountFlow request={flow} onClose={() => setFlow(null)} />
    </>
  );
}
