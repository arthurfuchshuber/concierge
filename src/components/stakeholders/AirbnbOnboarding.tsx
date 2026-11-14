// Onboarding da conexão com o Airbnb (mockups abnbx-onb1, onb2 e onb3 de 13/11/2026).
// 5 etapas: autorizar a conta → escolher anúncios → vincular proprietários → importar e
// sincronizar → finalizar a ativação (só no modo Full). A etapa atual é a primeira não feita.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  AirbnbAccountFlow,
  type AirbnbFlowRequest,
} from "@/components/stakeholders/AirbnbAccountFlow";
import { useUnsyncedProperties } from "@/components/stakeholders/useUnsyncedProperties";
import { listAirbnbAccounts } from "@/lib/airbnb-account.functions";
import { getPendingFullConnections } from "@/lib/channex-full-connect.functions";
import { useAnyWindowOpen } from "@/lib/global-overlay-store";
import {
  ONB_SUBS,
  ONB_TITLES,
  OnbProgress,
  OnbStepRow,
  OnbSteps,
} from "@/components/stakeholders/AirbnbOnboardingSteps";

const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/**
 * Cartão no Dashboard (mockup abnbx-onb2): aparece quando há conta do Airbnb conectada e
 * alguma etapa ainda falta. "Continuar: …" abre o passo certo; ao fechar a última etapa,
 * mostra "Tudo conectado" (mockup abnbx-onb3).
 */
export function AirbnbOnboardingCard() {
  const { perm, q: unsynced, accountOwnerId } = useUnsyncedProperties();
  const accountsFn = useServerFn(listAirbnbAccounts);
  const fullFn = useServerFn(getPendingFullConnections);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const windowOpen = useAnyWindowOpen();
  const [flow, setFlow] = useState<AirbnbFlowRequest>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const wasIncomplete = useRef(false);

  const accounts = useQuery({
    queryKey: ["airbnb-accounts", accountOwnerId ?? "self"],
    queryFn: () => accountsFn({ data: { accountOwnerId } }),
    enabled: perm.allowed,
    staleTime: 30_000,
    retry: false,
  });
  const full = useQuery({
    queryKey: ["full-connect-pending"],
    queryFn: () => fullFn(),
    enabled: perm.allowed,
    staleTime: 30_000,
    retry: 1,
  });

  const accList = accounts.data ?? [];
  const active = accList.filter((a) => a.status === "active");
  const imported = accList.reduce((n, a) => n + (a.imported ?? 0), 0);
  const available = accList.reduce(
    (n, a) => n + Math.max(0, (a.listings ?? 0) - (a.imported ?? 0)),
    0,
  );
  const pending = unsynced.data?.properties ?? [];
  const fullPending = full.data?.items ?? [];
  const ready = accounts.isSuccess && unsynced.isSuccess && full.isSuccess;

  const done = [
    active.length > 0,
    imported > 0,
    imported > 0,
    imported > 0 && pending.length === 0,
    imported > 0 && pending.length === 0 && fullPending.length === 0,
  ];
  const doneCount = done.filter(Boolean).length;
  const current = done.findIndex((d) => !d);
  const subs = [
    active.length === 1
      ? `${active[0].title} conectada`
      : active.length > 1
        ? `${active.length} contas conectadas`
        : "",
    plural(available, "anúncio disponível", "anúncios disponíveis"),
    "",
    pending.length > 0
      ? plural(pending.length, "imóvel sem sincronizar", "imóveis sem sincronizar")
      : "",
    fullPending.length > 0
      ? plural(fullPending.length, "anúncio para ativar", "anúncios para ativar")
      : "",
  ];

  // "Tudo conectado" só quando a última etapa fecha com o cartão já visto nesta sessão.
  useEffect(() => {
    if (!ready || !done[0]) return;
    if (current >= 0) wasIncomplete.current = true;
    else if (wasIncomplete.current) {
      wasIncomplete.current = false;
      setDoneOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, current, done[0]]);

  // Ao fechar um fluxo, confere tudo de novo.
  const prevFlow = useRef<AirbnbFlowRequest>(null);
  useEffect(() => {
    if (prevFlow.current && !flow) {
      void qc.invalidateQueries({ queryKey: ["airbnb-accounts"] });
      void qc.invalidateQueries({ queryKey: ["unsynced-properties"] });
      void qc.invalidateQueries({ queryKey: ["full-connect-pending"] });
    }
    prevFlow.current = flow;
  }, [flow, qc]);

  function continueStep() {
    setAllOpen(false);
    if (current === 1 || current === 2) setFlow({ type: "resync" });
    else if (current === 3) {
      const info = (p: (typeof pending)[number]) => ({
        id: p.id,
        name: p.name,
        city: p.city,
        address: p.address,
        ownerName: p.ownerName,
        ownerPhone: p.ownerPhone,
        ownerPhoneCountry: p.ownerPhoneCountry,
        imageUrl: p.imageUrl,
        imageUrls: p.imageUrls,
      });
      if (pending.length === 1) setFlow({ type: "syncProperty", property: info(pending[0]) });
      else setFlow({ type: "syncProperties", properties: pending.map(info) });
    } else if (current === 4) void qc.refetchQueries({ queryKey: ["full-connect-pending"] });
  }

  const show = perm.allowed && ready && done[0] && current >= 0 && !windowOpen;
  const nextTitle = current >= 0 ? ONB_TITLES[current] : "";

  return (
    <>
      {show ? (
        <div className="w-full max-w-none px-3.5 pt-5 sm:px-5 lg:px-8 lg:pl-4 lg:pt-8">
          <div className="grid gap-3 rounded-2xl bg-foreground/[0.03] p-3.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent)]">
            <div className="grid gap-[3px]">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Conexão com o Airbnb
              </span>
              <b className="font-display text-[15px] font-extrabold leading-[1.25]">
                Conclua a conexão dos seus anúncios
              </b>
            </div>
            <OnbProgress doneCount={doneCount} />
            <OnbStepRow
              n={current + 1}
              title={nextTitle}
              sub={subs[current] || ONB_SUBS[current]}
              state="current"
            />
            <button
              type="button"
              onClick={continueStep}
              className="flex h-11 items-center justify-center rounded-lg bg-gradient-to-br from-brand-purple to-brand-magenta text-[13px] font-extrabold text-white"
            >
              Continuar: {nextTitle}
            </button>
            <button
              type="button"
              onClick={() => setAllOpen(true)}
              className="text-center text-[11.5px] text-muted-foreground hover:text-foreground"
            >
              Ver todas as etapas
            </button>
          </div>
        </div>
      ) : null}

      {/* "Ver todas as etapas": a mesma janela do onboarding (mockup abnbx-onb1). */}
      <Dialog open={allOpen} onOpenChange={setAllOpen}>
        <DialogContent className="max-w-[360px] gap-3.5 p-[18px]">
          <div className="grid gap-3 pr-10">
            <DialogTitle className="font-display text-[18px] font-extrabold leading-[1.2] tracking-[-0.01em]">
              Conclua a conexão dos seus anúncios
            </DialogTitle>
            <DialogDescription className="text-[12.5px] leading-[1.55]">
              Siga as etapas para os anúncios funcionarem no ConciergeIA.
            </DialogDescription>
          </div>
          <OnbProgress doneCount={doneCount} />
          <OnbSteps done={done} subs={subs} />
          <div className="grid gap-2">
            {current >= 0 ? (
              <button
                type="button"
                onClick={continueStep}
                className="flex h-[46px] items-center justify-center rounded-lg bg-gradient-to-br from-brand-purple to-brand-magenta text-[13.5px] font-extrabold text-white"
              >
                {nextTitle}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setAllOpen(false)}
              className="flex h-11 items-center justify-center rounded-lg bg-foreground/[0.04] text-[12.5px] font-bold text-foreground/85 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_12%,transparent)]"
            >
              Continuar depois
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mockup abnbx-onb3: "Tudo conectado". */}
      <Dialog open={doneOpen} onOpenChange={setDoneOpen}>
        <DialogContent className="max-w-[360px] gap-3.5 p-[18px]">
          <div className="grid gap-3 pr-10">
            <DialogTitle className="font-display text-[18px] font-extrabold leading-[1.2] tracking-[-0.01em]">
              Tudo conectado
            </DialogTitle>
            <DialogDescription className="text-[12.5px] leading-[1.55]">
              Seus anúncios estão importados, vinculados e sincronizados.
            </DialogDescription>
          </div>
          <OnbProgress doneCount={ONB_TITLES.length} />
          <OnbSteps done={[true, true, true, true, true]} subs={subs} />
          <button
            type="button"
            onClick={() => {
              setDoneOpen(false);
              void navigate({ to: "/admin/proprietarios" });
            }}
            className="flex h-[46px] items-center justify-center rounded-lg bg-gradient-to-br from-brand-purple to-brand-magenta text-[13.5px] font-extrabold text-white"
          >
            Ver imóveis
          </button>
        </DialogContent>
      </Dialog>

      <AirbnbAccountFlow request={flow} onClose={() => setFlow(null)} />
    </>
  );
}
