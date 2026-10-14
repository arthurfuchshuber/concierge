import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, RefreshCw } from "lucide-react";
import type { UnsyncedProperty } from "@/lib/airbnb-account.functions";
import { useUnsyncedProperties } from "./useUnsyncedProperties";
import { AirbnbAccountFlow, type AirbnbFlowRequest } from "./AirbnbAccountFlow";

/**
 * FAIXA "IMÓVEIS SEM SINCRONIZAÇÃO COM O AIRBNB" (mockup aprovado, 14/10/2026).
 *
 * Fica no topo do Dashboard e só aparece quando o SERVIDOR marcou a conta para receber o
 * alerta (`alert`, hoje só a Anfitrião Sigma, lista em `sync-alert-accounts.ts`) e a pessoa
 * tem a permissão de vincular imóveis. Usa a mesma consulta do aviso obrigatório
 * (`useUnsyncedProperties`). Não tem botão de dispensar: some sozinha quando não há pendências.
 *
 * Sem piscada ao recarregar: não desenha nada até a consulta responder; falha de consulta
 * ou de permissão = não desenha (nunca "sem acesso" na tela).
 */
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

export function SyncAlertBanner() {
  const { perm, q } = useUnsyncedProperties();
  const qc = useQueryClient();
  const [flow, setFlow] = useState<AirbnbFlowRequest>(null);
  const prevFlow = useRef<AirbnbFlowRequest>(null);
  const pending = q.data?.properties ?? [];
  const show = perm.allowed && !perm.loading && !!q.data?.alert && pending.length > 0;

  // Total que a faixa viu (para "2 de 3 sincronizados" enquanto o usuário vai concluindo).
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (!q.data) return;
    if (pending.length === 0) setTotal(0);
    else setTotal((t) => Math.max(t, pending.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  // Ao fechar o fluxo, confere de novo (o aviso obrigatório faz o mesmo na consulta compartilhada).
  useEffect(() => {
    if (prevFlow.current && !flow) {
      void qc.invalidateQueries({ queryKey: ["unsynced-properties"] });
    }
    prevFlow.current = flow;
  }, [flow, qc]);

  function open() {
    if (pending.length === 1) setFlow({ type: "syncProperty", property: info(pending[0]) });
    else setFlow({ type: "syncProperties", properties: pending.map(info) });
  }

  const n = pending.length;
  const all = Math.max(total, n);
  const done = all - n;
  const pct = all > 0 ? Math.round((100 * done) / all) : 0;

  return (
    <>
      {show ? (
        <div className="w-full max-w-[1440px] px-3.5 pt-5 sm:px-5 lg:px-8 lg:pt-8">
          <div
            role="status"
            className="ds-atencao grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-[var(--win-radius)] bg-[color-mix(in_oklab,currentColor_9%,transparent)] px-3.5 py-3 shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_30%,transparent)] sm:grid-cols-[auto_minmax(0,1fr)_auto]"
          >
            <span className="grid size-[34px] place-items-center rounded-[var(--win-radius)] bg-[color-mix(in_oklab,currentColor_14%,transparent)]">
              <CircleAlert className="size-[18px]" aria-hidden />
            </span>
            <div className="grid min-w-0 gap-[3px]">
              <b className="text-[13px] font-extrabold leading-[1.3] text-foreground [text-wrap:pretty]">
                Imóveis sem sincronização com o Airbnb
              </b>
              <span className="text-[12px] leading-[1.5] text-muted-foreground [text-wrap:pretty]">
                {done > 0 ? (
                  <>
                    <b className="font-bold text-foreground">
                      {done} de {all} sincronizados.
                    </b>{" "}
                    Falta {n} {n === 1 ? "imóvel" : "imóveis"}.
                  </>
                ) : (
                  <>
                    <b className="font-bold text-foreground">
                      {n} {n === 1 ? "imóvel" : "imóveis"}
                    </b>{" "}
                    {n === 1
                      ? "cadastrado ainda não sincroniza"
                      : "cadastrados ainda não sincronizam"}
                    {" — "}
                    conecte para a IA e o calendário funcionarem.
                  </>
                )}
              </span>
              {done > 0 ? (
                <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-foreground/[0.08]">
                  <div
                    className="h-full rounded-full bg-[currentColor] transition-[width]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={open}
              className="col-span-2 inline-flex h-10 w-full items-center justify-center gap-2 whitespace-nowrap rounded-[var(--win-radius)] bg-[color-mix(in_oklab,currentColor_20%,transparent)] px-4 text-[12.5px] font-extrabold text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_42%,transparent)] sm:col-span-1 sm:w-auto"
            >
              <RefreshCw className="size-[15px]" aria-hidden />
              Sincronizar agora
            </button>
          </div>
        </div>
      ) : null}
      <AirbnbAccountFlow request={flow} onClose={() => setFlow(null)} />
    </>
  );
}
