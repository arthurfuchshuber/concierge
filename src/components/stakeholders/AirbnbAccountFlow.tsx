import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Archive,
  Check,
  ExternalLink,
  Home,
  Link2,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  checkAirbnbReconnection,
  detectAirbnbConnection,
  disconnectAirbnbAccount,
  importAirbnbListings,
  listAirbnbAccountListings,
  listAirbnbAccounts,
  retryAirbnbChat,
  startAirbnbConnect,
} from "@/lib/airbnb-account.functions";
import {
  activateFullMode,
  chooseLightMode,
  getOperationMode,
  validatePricingFn,
} from "@/lib/channex-mode.functions";
import { listStakeholders } from "@/lib/stakeholders.functions";
import { useImpersonation } from "@/hooks/useImpersonation";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { StakeholderFormDialog, emptyStakeholderForm } from "./StakeholderFormDialog";

/**
 * FLUXO DAS CONTAS DO AIRBNB (mockups aprovados, 14/10/2026).
 *
 * Uma conta do sistema pode ter VÁRIAS contas do Airbnb; cada uma traz os
 * próprios anúncios. Etapas (cada uma é uma janela do padrão `ReimportWindow`
 * / confirmação da chavinha):
 *   Conectar:        início → autorizando → [modo Leve/Full, só 1ª conta do piloto] → escolher anúncios
 *                    → de quem são → importando → resultado (com pendências, se houver)
 *   Modo Full:       validar tarifas → (incompletas: validar de novo | continuar no Leve)
 *   ReSincronizar:   qual conta → escolher anúncios (já importados bloqueados; sumidos do Airbnb só sinalizados)
 *                    → de quem são → importando → resultado
 *   Reconectar:      renova a autorização do canal existente (sem criar canal duplicado)
 *   Desconectar:     confirmar → resultado (chat desligado, sincronização pausada, imóveis arquivados;
 *                    o canal na Channex NÃO é alterado)
 * O cadastro de proprietário usa a MESMA janela de Proprietários (`StakeholderFormDialog`).
 */
export type AirbnbFlowRequest =
  | { type: "connect" }
  | { type: "resync" }
  | { type: "reconnect"; channelId: string }
  | { type: "disconnect"; channelId: string }
  | null;

type Step =
  | "start"
  | "authorizing"
  | "timeout"
  | "already"
  | "pickAccount"
  | "expired"
  | "mode"
  | "fullValidate"
  | "fullIncomplete"
  | "listings"
  | "empty"
  | "owner"
  | "importing"
  | "result"
  | "confirmDisconnect"
  | "disconnected";

const CONTENT_A = "max-w-[380px] gap-3 p-4 sm:p-4";
const CONTENT_B = "max-w-[380px] gap-3.5 p-[18px] sm:p-[18px]";
const INSET = "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]";
const SEARCH_SHELL =
  "relative h-10 shrink-0 overflow-hidden rounded-[9px] bg-card shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_7%,transparent),inset_0_0_0_1px_var(--border)]";

function PrimaryBtn({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-[46px] shrink-0 items-center justify-center gap-2 rounded-[13px] text-[13.5px] font-extrabold text-white disabled:opacity-40 ${
        danger ? "bg-[#b24a4a]" : "bg-gradient-to-br from-[#7c1ad8] to-[#e82dae]"
      }`}
    >
      {children}
    </button>
  );
}
function SecondaryBtn({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-[13px] bg-foreground/[0.04] text-[12.5px] font-bold text-foreground/85 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_12%,transparent)]"
    >
      {children}
    </button>
  );
}
function IconBox({ kind, children }: { kind: "ok" | "falta" | "neutral"; children: ReactNode }) {
  const cls =
    kind === "ok"
      ? "ds-ok rounded-[15px] bg-[color-mix(in_oklab,#7fb79a_14%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,#7fb79a_35%,transparent)]"
      : kind === "falta"
        ? "ds-falta rounded-[15px] bg-[color-mix(in_oklab,#c98c8c_14%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,#c98c8c_35%,transparent)]"
        : "ds-surface bg-secondary text-muted-foreground";
  return <span className={`grid size-12 place-items-center ${cls}`}>{children}</span>;
}
function Title({ children }: { children: ReactNode }) {
  return (
    <DialogTitle className="font-display text-[19px] font-extrabold leading-[1.2] tracking-[-0.01em]">
      {children}
    </DialogTitle>
  );
}
function Desc({ children }: { children: ReactNode }) {
  return <DialogDescription className="text-[12.5px] leading-[1.55]">{children}</DialogDescription>;
}
function InfoBox({ kind, lines }: { kind: "ok" | "falta"; lines: Array<[typeof Check, string]> }) {
  return (
    <div
      className={`grid gap-2 rounded-[12px] px-[13px] py-3 ${
        kind === "ok"
          ? "bg-[color-mix(in_oklab,#7fb79a_7%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,#7fb79a_25%,transparent)]"
          : "bg-[color-mix(in_oklab,#c98c8c_7%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,#c98c8c_25%,transparent)]"
      }`}
    >
      {lines.map(([Ico, t]) => (
        <div key={t} className="flex items-center gap-[9px] text-[12px] text-foreground/85">
          <Ico className={`size-[13px] shrink-0 ${kind === "ok" ? "ds-ok" : "ds-falta"}`} />
          {t}
        </div>
      ))}
    </div>
  );
}
function ListHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid gap-1.5 pr-9">
      <DialogTitle className="font-display text-[18px] font-extrabold leading-[1.2] tracking-[-0.01em]">
        {title}
      </DialogTitle>
      <DialogDescription className="text-[12.5px] leading-[1.5]">{description}</DialogDescription>
    </div>
  );
}
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className={SEARCH_SHELL}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground opacity-60" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-full w-full bg-transparent pl-9 pr-9 text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Limpar busca"
          className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
function Box({ state }: { state: "off" | "on" | "locked" }) {
  return (
    <span
      aria-hidden
      className={`grid size-4 shrink-0 place-items-center rounded-[5px] ${
        state === "locked"
          ? "bg-foreground/20 text-white"
          : state === "on"
            ? "bg-gradient-to-br from-[#7c1ad8] to-[#e82dae] text-white"
            : "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_25%,transparent)]"
      }`}
    >
      {state !== "off" ? <Check className="size-2.5" strokeWidth={3} /> : null}
    </span>
  );
}
const rowCls = (state: "off" | "on" | "locked") =>
  `flex w-full items-center gap-[11px] rounded-[14px] px-3 py-2.5 text-left ${INSET} ${
    state === "locked"
      ? "bg-foreground/[0.025]"
      : state === "on"
        ? "bg-foreground/[0.06] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_20%,transparent)]"
        : "bg-foreground/[0.03] hover:bg-foreground/[0.05]"
  }`;

type OwnerRow = {
  id: string;
  name?: string | null;
  trade_name?: string | null;
  phone?: string | null;
  phone_country?: string | null;
};
const ownerName = (o: OwnerRow) => String(o.trade_name || o.name || "");

export function AirbnbAccountFlow({
  request,
  onClose,
}: {
  request: AirbnbFlowRequest;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { impersonation } = useImpersonation();
  const accountOwnerId = impersonation?.userId ?? null;
  const open = request !== null;

  const accountsFn = useServerFn(listAirbnbAccounts);
  const listingsFn = useServerFn(listAirbnbAccountListings);
  const importFn = useServerFn(importAirbnbListings);
  const startFn = useServerFn(startAirbnbConnect);
  const detectFn = useServerFn(detectAirbnbConnection);
  const disconnectFn = useServerFn(disconnectAirbnbAccount);
  const ownersFn = useServerFn(listStakeholders);
  const modeFn = useServerFn(getOperationMode);
  const lightFn = useServerFn(chooseLightMode);
  const validateFn = useServerFn(validatePricingFn);
  const activateFn = useServerFn(activateFullMode);
  const retryChatFn = useServerFn(retryAirbnbChat);
  const reconnectFn = useServerFn(checkAirbnbReconnection);

  const [step, setStep] = useState<Step>("start");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string[]>([]);
  const [alreadyTitle, setAlreadyTitle] = useState("");
  const [result, setResult] = useState<{
    imported: number;
    failed: Array<{ title: string; error: string }>;
    pending: Array<{ propertyId: string; title: string; kind: "chat" | "config" }>;
  } | null>(null);
  const [disc, setDisc] = useState<{ archived: number; chatFailures: number } | null>(null);
  const [modeChoice, setModeChoice] = useState<"light" | "full">("light");
  const [valRes, setValRes] = useState<{ checked: number; missing: number } | null>(null);
  /** Conta existente que está renovando a autorização (null = conta nova). */
  const [reauthId, setReauthId] = useState<string | null>(null);
  /** ReSincronizar: consulta a Channex ao vivo; no Conectar o catálogo vem do cache local. */
  const [liveCatalog, setLiveCatalog] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const startedAt = useRef(0);

  const accounts = useQuery({
    queryKey: ["airbnb-accounts", accountOwnerId ?? "self"],
    queryFn: () => accountsFn({ data: { accountOwnerId } }),
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  const owners = useQuery({
    queryKey: ["stakeholders", accountOwnerId ?? "self", "owner"],
    queryFn: () => ownersFn({ data: { kind: "owner", accountOwnerId } }),
    enabled: open && (step === "owner" || formOpen),
    staleTime: 15_000,
  });
  const inv = useQuery({
    queryKey: ["airbnb-account-listings", accountOwnerId ?? "self", channelId, liveCatalog],
    queryFn: () => listingsFn({ data: { accountOwnerId, channelId, live: liveCatalog } }),
    enabled:
      open && !!channelId && (step === "listings" || step === "owner" || step === "importing"),
    staleTime: 0,
    retry: false,
  });

  // Ao abrir (ou trocar de pedido), volta ao primeiro passo daquele fluxo.
  useEffect(() => {
    if (!request) return;
    setQ("");
    setPicked([]);
    setOwnerId(null);
    setResult(null);
    setDisc(null);
    setConnectUrl(null);
    setReauthId(null);
    setValRes(null);
    setModeChoice("light");
    setLiveCatalog(request.type !== "connect");
    if (request.type === "connect") {
      setChannelId(null);
      setStep("start");
    } else if (request.type === "resync") {
      setChannelId(null);
      setStep("pickAccount");
    } else if (request.type === "reconnect") {
      // Se a autorização ainda vale, só retoma; senão pede para autorizar de novo.
      setChannelId(request.channelId);
      setStep("expired");
      void tryReconnect(request.channelId);
    } else {
      setChannelId(request.channelId);
      setStep("confirmDisconnect");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // Sem esperar clique: se só existe uma conta conectada, "qual conta" continua perguntando (regra aprovada).
  const accList = accounts.data ?? [];
  const account = accList.find((a) => a.channelId === channelId) ?? null;

  // Espera a autorização: consulta a Channex a cada 4 s por até 10 min.
  useEffect(() => {
    if (step !== "authorizing") return;
    startedAt.current = Date.now();
    const id = window.setInterval(async () => {
      if (Date.now() - startedAt.current > 10 * 60_000) {
        window.clearInterval(id);
        setStep("timeout");
        return;
      }
      try {
        if (reauthId) {
          const r = await reconnectFn({ data: { accountOwnerId, channelId: reauthId } });
          if (!r.authorized) return;
          window.clearInterval(id);
          qc.invalidateQueries({ queryKey: ["airbnb-accounts"] });
          refreshAll();
          setChannelId(reauthId);
          setStep("listings");
          return;
        }
        const r = await detectFn({ data: { accountOwnerId, baseline } });
        if (!r.found) return;
        window.clearInterval(id);
        qc.invalidateQueries({ queryKey: ["airbnb-accounts"] });
        if (r.found.duplicate) {
          setAlreadyTitle(r.found.title);
          setChannelId(r.found.channelId);
          setLiveCatalog(true);
          setStep("already");
        } else {
          setChannelId(r.found.channelId);
          // Passo do modo: só na primeira conta e só para contas liberadas no piloto.
          const m = await qc
            .fetchQuery({
              queryKey: ["operation-mode", accountOwnerId],
              queryFn: () => modeFn({ data: { ownerId: accountOwnerId } }),
              staleTime: 0,
            })
            .catch(() => null);
          setStep(m && !m.modeChangedAt && m.mode === "light" ? "mode" : "listings");
        }
      } catch {
        /* tenta de novo no próximo ciclo */
      }
    }, 4000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, baseline, reauthId]);

  // Conta sem anúncios disponíveis.
  useEffect(() => {
    if (step === "listings" && inv.data && inv.data.listings.length === 0) setStep("empty");
  }, [step, inv.data]);

  function close() {
    onClose();
  }
  function refreshAll() {
    qc.invalidateQueries({ queryKey: ["stakeholders"] });
    qc.invalidateQueries({ queryKey: ["airbnb-accounts"] });
    qc.invalidateQueries({ queryKey: ["airbnb-account-listings"] });
    qc.invalidateQueries({ queryKey: ["connected-listings-inventory"] });
    qc.invalidateQueries({ queryKey: ["properties"] });
  }

  /** Renova a autorização só se já não valer; devolve true quando seguiu para a lista de anúncios. */
  async function tryReconnect(id: string) {
    try {
      const r = await reconnectFn({ data: { accountOwnerId, channelId: id } });
      if (!r.authorized) return false;
      qc.invalidateQueries({ queryKey: ["airbnb-accounts"] });
      refreshAll();
      setChannelId(id);
      setLiveCatalog(true);
      setStep("listings");
      return true;
    } catch {
      return false;
    }
  }
  async function begin(reauth: string | null = null) {
    setReauthId(reauth);
    setBusy(true);
    try {
      const r = await startFn({ data: { accountOwnerId, reauthChannelId: reauth } });
      setBaseline(r.baseline);
      setConnectUrl(r.url);
      window.open(r.url, "_blank", "noopener,noreferrer");
      setStep("authorizing");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível abrir a conexão com o Airbnb.",
      );
    } finally {
      setBusy(false);
    }
  }
  /** Modo Leve escolhido (ou mantido): grava e segue para a escolha de anúncios. */
  async function keepLight() {
    setBusy(true);
    try {
      await lightFn({ data: { ownerId: accountOwnerId } });
      qc.invalidateQueries({ queryKey: ["operation-mode"] });
      setStep("listings");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar o modo.");
    } finally {
      setBusy(false);
    }
  }
  /** Full só é salvo depois que a validação de tarifas passa (checked > 0 e nada faltando). */
  async function validateAndActivate() {
    setBusy(true);
    try {
      const r = await validateFn({ data: { ownerId: accountOwnerId } });
      if (r.ok) {
        await activateFn({ data: { ownerId: accountOwnerId } });
        qc.invalidateQueries({ queryKey: ["operation-mode"] });
        toast.success("Modo Full ativado para toda a conta.");
        setStep("listings");
      } else {
        setValRes({ checked: r.checked, missing: r.missing });
        setStep("fullIncomplete");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível validar as tarifas.");
    } finally {
      setBusy(false);
    }
  }
  async function retryChats() {
    if (!result) return;
    setBusy(true);
    try {
      const remaining: typeof result.pending = [];
      for (const p of result.pending) {
        if (p.kind !== "chat") {
          remaining.push(p);
          continue;
        }
        const r = await retryChatFn({ data: { accountOwnerId, propertyId: p.propertyId } }).catch(
          () => ({ ok: false as const }),
        );
        if (!r.ok) remaining.push(p);
      }
      setResult({ ...result, pending: remaining });
      refreshAll();
      if (remaining.some((p) => p.kind === "chat"))
        toast.error("A Channex ainda não ativou o chat de todos. Tente de novo em instantes.");
      else toast.success("Chat ativado.");
    } finally {
      setBusy(false);
    }
  }
  async function doImport() {
    if (!channelId || !ownerId) return;
    setStep("importing");
    try {
      const res = await importFn({ data: { accountOwnerId, ownerId, listingIds: picked } });
      setResult(res);
      refreshAll();
      // Gêmeos: só sugestões (nunca unimos sozinhos); atualiza as sugestões já exibidas no painel.
      qc.invalidateQueries({ queryKey: ["twin-suggestions"] });
      setStep("result");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível importar.");
      setStep("owner");
    }
  }
  async function doDisconnect() {
    if (!channelId) return;
    setBusy(true);
    try {
      setDisc(await disconnectFn({ data: { accountOwnerId, channelId } }));
      refreshAll();
      setStep("disconnected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível desconectar.");
    } finally {
      setBusy(false);
    }
  }

  const term = q.trim().toLowerCase();
  const listings = useMemo(
    () =>
      (inv.data?.listings ?? [])
        .filter((l) => !term || `${l.title} ${l.city ?? ""}`.toLowerCase().includes(term))
        .sort((a, b) => a.title.localeCompare(b.title, "pt-BR")),
    [inv.data, term],
  );
  const importedN = (inv.data?.listings ?? []).filter((l) => l.imported).length;
  const ownerRows = ((owners.data?.rows ?? []) as OwnerRow[])
    .filter((o) => !term || `${ownerName(o)} ${o.phone ?? ""}`.toLowerCase().includes(term))
    .sort((a, b) => ownerName(a).localeCompare(ownerName(b), "pt-BR"));
  const chosenOwner =
    ((owners.data?.rows ?? []) as OwnerRow[]).find((o) => o.id === ownerId) ?? null;
  const n = picked.length;
  const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

  const isListStep = step === "pickAccount" || step === "listings" || step === "owner";

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && step !== "importing" && close()}>
        <DialogContent className={isListStep ? CONTENT_A : CONTENT_B}>
          {/* ---------- Conectar: início ---------- */}
          {step === "start" ? (
            <>
              <IconBox kind="ok">
                <Link2 className="size-[22px]" />
              </IconBox>
              <Title>Conectar conta do Airbnb</Title>
              <Desc>
                Você será levado ao Airbnb para autorizar o acesso. Dá para conectar{" "}
                <b className="font-bold text-foreground">quantas contas precisar</b>, cada uma com
                os próprios anúncios.
              </Desc>
              <InfoBox
                kind="ok"
                lines={[
                  [Check, "Você escolhe quais anúncios importar"],
                  [Check, "Antes de importar, informa de qual proprietário são"],
                ]}
              />
              <div className="grid gap-2">
                <PrimaryBtn onClick={begin} disabled={busy}>
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Link2 className="size-4" />
                  )}
                  Continuar no Airbnb
                </PrimaryBtn>
                <SecondaryBtn onClick={close}>Cancelar</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Conectar: aguardando autorização ---------- */}
          {step === "authorizing" ? (
            <>
              <IconBox kind="ok">
                <RefreshCw className="size-[22px] animate-spin" />
              </IconBox>
              <Title>Aguardando autorização</Title>
              <Desc>
                Conclua a autorização na janela do Airbnb. Esta janela continua sozinha quando você
                terminar.
              </Desc>
              <div className="grid gap-2">
                <SecondaryBtn
                  onClick={() =>
                    connectUrl && window.open(connectUrl, "_blank", "noopener,noreferrer")
                  }
                >
                  <ExternalLink className="size-[15px]" />
                  Abrir o Airbnb de novo
                </SecondaryBtn>
                <SecondaryBtn onClick={close}>Cancelar</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Conectar: não concluída ---------- */}
          {step === "timeout" ? (
            <>
              <IconBox kind="falta">
                <TriangleAlert className="size-[22px]" />
              </IconBox>
              <Title>Autorização não concluída</Title>
              <Desc>
                Não recebemos a autorização do Airbnb.{" "}
                <b className="font-bold text-foreground">Nenhum anúncio foi importado.</b>
              </Desc>
              <div className="grid gap-2">
                <PrimaryBtn onClick={() => (reauthId ? void begin(reauthId) : setStep("start"))}>
                  <Link2 className="size-4" />
                  Tentar de novo
                </PrimaryBtn>
                <SecondaryBtn onClick={close}>Fechar</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Conta já conectada ---------- */}
          {step === "already" ? (
            <>
              <IconBox kind="ok">
                <Link2 className="size-[22px]" />
              </IconBox>
              <Title>Conta já conectada</Title>
              <Desc>
                A conta <b className="font-bold text-foreground">{alreadyTitle}</b> já está
                conectada. Para trazer anúncios novos dela, use ReSincronizar.
              </Desc>
              <div className="grid gap-2">
                <PrimaryBtn onClick={() => setStep("listings")}>
                  <RefreshCw className="size-4" />
                  ReSincronizar esta conta
                </PrimaryBtn>
                <SecondaryBtn onClick={close}>Fechar</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Autorização expirou ---------- */}
          {step === "expired" ? (
            <>
              <IconBox kind="falta">
                <TriangleAlert className="size-[22px]" />
              </IconBox>
              <Title>Autorização expirou</Title>
              <Desc>
                A conta <b className="font-bold text-foreground">{account?.title ?? "do Airbnb"}</b>{" "}
                precisa ser autorizada de novo para sincronizar. Os imóveis dela continuam no
                sistema.
              </Desc>
              <div className="grid gap-2">
                <PrimaryBtn disabled={busy || !channelId} onClick={() => void begin(channelId)}>
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Link2 className="size-4" />
                  )}
                  Reconectar conta
                </PrimaryBtn>
                <SecondaryBtn onClick={close}>Agora não</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- ReSincronizar: qual conta ---------- */}
          {step === "pickAccount" ? (
            <>
              <ListHeader
                title="ReSincronizar conta"
                description="Escolha a conta que você quer atualizar. Uma de cada vez."
              />
              <div className="grid gap-2">
                {accounts.isLoading ? (
                  <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                    Buscando contas do Airbnb…
                  </p>
                ) : accounts.isError ? (
                  <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                    Não foi possível consultar as contas agora. Tente de novo em instantes.
                  </p>
                ) : accList.length === 0 ? (
                  <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                    Nenhuma conta do Airbnb conectada ainda.
                  </p>
                ) : null}
                {accList.map((a) => {
                  const blocked = a.status !== "active";
                  const on = channelId === a.channelId;
                  return (
                    <button
                      key={a.channelId}
                      type="button"
                      onClick={() => {
                        setChannelId(a.channelId);
                        if (blocked) setStep("expired");
                      }}
                      className={rowCls(blocked ? "locked" : on ? "on" : "off")}
                    >
                      <Box state={blocked ? "locked" : on ? "on" : "off"} />
                      <span className="grid size-[46px] shrink-0 place-items-center rounded-[11px] bg-foreground/[0.05] text-[13px] font-extrabold">
                        {a.title
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((w) => w[0]?.toUpperCase())
                          .join("")}
                      </span>
                      <span className="grid min-w-0 flex-1 gap-[3px]">
                        <span className="flex items-center gap-2">
                          <b className="min-w-0 flex-1 truncate text-[13px] font-bold">{a.title}</b>
                          {blocked ? (
                            <span className="shrink-0 text-[10.5px] font-bold ds-atencao">
                              Reconectar
                            </span>
                          ) : null}
                        </span>
                        <small className="truncate text-[11px] text-muted-foreground">
                          {a.listings === null
                            ? "Sem acesso aos anúncios"
                            : plural(a.listings, "anúncio", "anúncios")}{" "}
                          · {plural(a.imported, "importado", "importados")}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-2 pt-1">
                <PrimaryBtn
                  disabled={!channelId || account?.status !== "active"}
                  onClick={() => setStep("listings")}
                >
                  Continuar
                </PrimaryBtn>
                <SecondaryBtn onClick={close}>Cancelar</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Modo de operação (1ª conta do piloto) ---------- */}
          {step === "mode" ? (
            <>
              <ListHeader
                title="Como o ConciergeIA vai trabalhar?"
                description="O modo vale para a conta inteira, nunca para só alguns imóveis. Você pode mudar depois em Integrações."
              />
              <div className="grid gap-2">
                {(
                  [
                    [
                      "light",
                      "Leve",
                      "Você gerencia calendário e preços direto na plataforma. O ConciergeIA recebe reservas, financeiro e mensagens, sem mexer em datas nem preços.",
                    ],
                    [
                      "full",
                      "Full",
                      "ConciergeIA assume o controle de disponibilidade na Channex (com validação prévia de tarifas da sua ferramenta de precificação)",
                    ],
                  ] as const
                ).map(([key, name, text]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setModeChoice(key)}
                    className={`${rowCls(modeChoice === key ? "on" : "off")} !items-start !p-3`}
                  >
                    <Box state={modeChoice === key ? "on" : "off"} />
                    <span className="grid min-w-0 flex-1 gap-1">
                      <b className="text-[13px] font-bold">{name}</b>
                      <small className="text-[11.5px] leading-[1.45] text-muted-foreground">
                        {text}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
              <div className="grid gap-2 pt-1">
                <PrimaryBtn
                  disabled={busy}
                  onClick={() =>
                    modeChoice === "full" ? setStep("fullValidate") : void keepLight()
                  }
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  Continuar
                </PrimaryBtn>
                <SecondaryBtn onClick={close}>Voltar</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Full: validar tarifas ---------- */}
          {step === "fullValidate" ? (
            <>
              <IconBox kind="ok">
                <Link2 className="size-6" />
              </IconBox>
              <Title>Validar tarifas para o Full</Title>
              <Desc>
                O ConciergeIA assume só a{" "}
                <b className="font-bold text-foreground">disponibilidade</b>; ele não define preços.
                Antes de ativar, sua ferramenta de precificação precisa ter enviado as diárias.
              </Desc>
              <InfoBox
                kind="ok"
                lines={[
                  [Check, "Importe os anúncios na sua ferramenta de precificação"],
                  [Check, "Envie as diárias por lá"],
                  [Check, "Volte aqui e valide. Até lá, a conta fica em Leve"],
                ]}
              />
              <div className="grid gap-2">
                <PrimaryBtn disabled={busy} onClick={() => void validateAndActivate()}>
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  Validar envio de tarifas
                </PrimaryBtn>
                <SecondaryBtn onClick={() => void keepLight()}>Continuar no modo Leve</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Full: tarifas incompletas ---------- */}
          {step === "fullIncomplete" && valRes ? (
            <>
              <IconBox kind="falta">
                <TriangleAlert className="size-[22px]" />
              </IconBox>
              <Title>Tarifas incompletas</Title>
              <Desc>
                {valRes.checked === 0 ? (
                  <>Ainda não há anúncios ativos com tarifa para conferir.</>
                ) : (
                  <>
                    Ainda faltam tarifas em{" "}
                    <b className="font-bold text-foreground">
                      {plural(valRes.missing, "anúncio", "anúncios")}
                    </b>
                    .
                  </>
                )}{" "}
                Envie as diárias na sua ferramenta de precificação e valide de novo. A conta segue
                em <b className="font-bold text-foreground">Leve</b>.
              </Desc>
              {valRes.checked > 0 ? (
                <InfoBox
                  kind="falta"
                  lines={[
                    [
                      TriangleAlert,
                      `${valRes.missing} de ${valRes.checked} anúncios sem tarifas nos próximos 30 dias`,
                    ],
                  ]}
                />
              ) : null}
              <div className="grid gap-2">
                <PrimaryBtn disabled={busy} onClick={() => void validateAndActivate()}>
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  Validar de novo
                </PrimaryBtn>
                <SecondaryBtn onClick={() => void keepLight()}>Continuar no modo Leve</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Escolher anúncios ---------- */}
          {step === "listings" ? (
            <>
              <ListHeader
                title="Escolher anúncios"
                description={`Conta ${account?.title ?? "do Airbnb"}. ${
                  importedN > 0
                    ? "Os anúncios já importados ficam bloqueados."
                    : "Selecione os anúncios que você quer importar."
                }`}
              />
              <SearchBox value={q} onChange={setQ} placeholder="Buscar anúncio…" />
              <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
                <span className="font-bold text-foreground/85">
                  {plural(inv.data?.listings.length ?? 0, "anúncio", "anúncios")} na conta
                </span>
                <span>{plural(importedN, "já importado", "já importados")}</span>
              </div>
              <div className="grid gap-2">
                {inv.isLoading ? (
                  <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                    Buscando anúncios no Airbnb…
                  </p>
                ) : inv.isError ? (
                  <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                    Não foi possível consultar o Airbnb agora. Tente de novo em instantes.
                  </p>
                ) : null}
                {listings.map((l) => {
                  const locked = l.imported;
                  const on = locked || picked.includes(l.listingId);
                  const inner = (
                    <>
                      <Box state={locked ? "locked" : on ? "on" : "off"} />
                      <span
                        className={`grid size-[46px] shrink-0 place-items-center rounded-[11px] bg-foreground/[0.05] text-muted-foreground ${locked ? "opacity-60" : ""}`}
                      >
                        <Home className="size-[18px]" />
                      </span>
                      <span className="grid min-w-0 flex-1 gap-[3px]">
                        <span className="flex items-center gap-2">
                          <b
                            className={`min-w-0 flex-1 truncate text-[13px] font-bold ${locked ? "opacity-60" : ""}`}
                          >
                            {l.title}
                          </b>
                          {l.notFound ? (
                            <span className="flex shrink-0 items-center gap-[5px] text-[10.5px] font-bold ds-atencao">
                              <TriangleAlert className="size-3" />
                              Não encontrado no Airbnb
                            </span>
                          ) : locked ? (
                            <span className="flex shrink-0 items-center gap-[5px] text-[10.5px] font-bold text-[color:var(--faint)]">
                              <Lock className="size-3" />
                              Importado
                            </span>
                          ) : null}
                        </span>
                        {locked && l.ownerName ? (
                          <small className="flex items-center gap-[5px] text-[11px] text-muted-foreground">
                            Proprietário(a):{" "}
                            <b className="truncate font-semibold text-foreground/85">
                              {l.ownerName}
                            </b>
                            <PhoneActionButton
                              phone={l.ownerPhone}
                              country={l.ownerPhoneCountry}
                              size={11}
                              alwaysShow
                              className="shrink-0 !p-0"
                            />
                          </small>
                        ) : l.city ? (
                          <small className="truncate text-[11px] text-muted-foreground">
                            {l.city}
                          </small>
                        ) : null}
                      </span>
                    </>
                  );
                  // Importado fica bloqueado: linha não clicável (o telefone do proprietário continua clicável).
                  return locked ? (
                    <div key={l.listingId} data-clip-row className={rowCls("locked")}>
                      {inner}
                    </div>
                  ) : (
                    <button
                      key={l.listingId}
                      type="button"
                      data-clip-row
                      onClick={() =>
                        setPicked((c) =>
                          c.includes(l.listingId)
                            ? c.filter((x) => x !== l.listingId)
                            : [...c, l.listingId],
                        )
                      }
                      className={rowCls(on ? "on" : "off")}
                    >
                      {inner}
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-2 pt-1">
                <PrimaryBtn
                  disabled={n === 0}
                  onClick={() => {
                    setQ("");
                    setStep("owner");
                  }}
                >
                  <RefreshCw className="size-4" />
                  {n === 0 ? "Importar anúncios" : `Importar ${plural(n, "anúncio", "anúncios")}`}
                </PrimaryBtn>
                <SecondaryBtn onClick={close}>Cancelar</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Sem anúncios ---------- */}
          {step === "empty" ? (
            <>
              <IconBox kind="neutral">
                <Home className="size-5" />
              </IconBox>
              <Title>Nenhum anúncio disponível</Title>
              <Desc>
                A conta <b className="font-bold text-foreground">{account?.title ?? "do Airbnb"}</b>{" "}
                foi conectada, mas não tem anúncios para importar agora.
              </Desc>
              <div className="grid gap-2">
                <SecondaryBtn onClick={close}>Fechar</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- De quem são os anúncios ---------- */}
          {step === "owner" ? (
            <>
              <ListHeader
                title="De quem são os anúncios?"
                description={`Escolha o proprietário cadastrado ${n === 1 ? "do anúncio selecionado" : `dos ${n} anúncios selecionados`}. A importação só começa depois que você confirmar.`}
              />
              <button type="button" onClick={() => setFormOpen(true)} className={rowCls("off")}>
                <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-foreground/[0.06]">
                  <Plus className="size-4" />
                </span>
                <b className="text-[13px] font-bold">Cadastrar novo proprietário</b>
              </button>
              <SearchBox value={q} onChange={setQ} placeholder="Buscar proprietário…" />
              <div className="grid gap-2">
                {owners.isLoading ? (
                  <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                    Buscando proprietários…
                  </p>
                ) : null}
                {!owners.isLoading && ownerRows.length === 0 ? (
                  <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                    Nenhum proprietário encontrado.
                  </p>
                ) : null}
                {ownerRows.map((o) => {
                  const on = ownerId === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setOwnerId(o.id)}
                      className={rowCls(on ? "on" : "off")}
                    >
                      <Box state={on ? "on" : "off"} />
                      <span className="grid min-w-0 flex-1 gap-[3px]">
                        <b className="truncate text-[13px] font-bold">{ownerName(o)}</b>
                        <small className="flex items-center gap-[5px] text-[11px] text-muted-foreground">
                          <PhoneActionButton
                            phone={o.phone}
                            country={o.phone_country}
                            size={11}
                            alwaysShow
                            className="shrink-0 !p-0"
                          />
                          {o.phone ?? "Sem telefone"}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-2 pt-1">
                <PrimaryBtn disabled={!ownerId} onClick={doImport}>
                  <RefreshCw className="size-4" />
                  Importar {plural(n, "anúncio", "anúncios")}
                </PrimaryBtn>
                <SecondaryBtn
                  onClick={() => {
                    setQ("");
                    setStep("listings");
                  }}
                >
                  Voltar
                </SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Importando ---------- */}
          {step === "importing" ? (
            <>
              <IconBox kind="ok">
                <RefreshCw className="size-[22px] animate-spin" />
              </IconBox>
              <Title>Importando anúncios</Title>
              <Desc>
                Vinculando{" "}
                <b className="font-bold text-foreground">{plural(n, "anúncio", "anúncios")}</b> a{" "}
                <b className="font-bold text-foreground">
                  {chosenOwner ? ownerName(chosenOwner) : "proprietário"}
                </b>
                . Pode levar alguns instantes.
              </Desc>
              <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-[#7c1ad8] to-[#e82dae]" />
              </div>
            </>
          ) : null}

          {/* ---------- Resultado ---------- */}
          {step === "result" && result ? (
            <>
              {(() => {
                const pendIds = new Set(result.pending.map((p) => p.propertyId));
                const k = pendIds.size;
                const chatPending = result.pending.filter((p) => p.kind === "chat");
                const ownerLabel = chosenOwner ? ownerName(chosenOwner) : "proprietário";
                return (
                  <>
                    <IconBox kind={result.imported > 0 && k === 0 ? "ok" : "falta"}>
                      {result.imported > 0 && k === 0 ? (
                        <Check className="size-[22px]" />
                      ) : (
                        <TriangleAlert className="size-[22px]" />
                      )}
                    </IconBox>
                    <Title>
                      {result.imported === 0
                        ? "Nada foi importado"
                        : k > 0
                          ? `${plural(result.imported, "anúncio importado", "anúncios importados")}, ${k} com pendência`
                          : plural(result.imported, "anúncio importado", "anúncios importados")}
                    </Title>
                    <Desc>
                      {result.imported > 0 ? (
                        <>
                          Vinculados a <b className="font-bold text-foreground">{ownerLabel}</b>.{" "}
                          {k === 0
                            ? "Eles já aparecem na aba Imóveis."
                            : k === 1
                              ? "Um deles ainda não está totalmente ativo."
                              : `${k} deles ainda não estão totalmente ativos.`}
                        </>
                      ) : (
                        "Nenhum anúncio foi criado. Veja o motivo abaixo e tente de novo."
                      )}
                    </Desc>
                    {result.failed.length > 0 || result.pending.length > 0 ? (
                      <InfoBox
                        kind="falta"
                        lines={[
                          ...result.failed.map(
                            (f) =>
                              [TriangleAlert, `${f.title}: ${f.error}`] as [typeof Check, string],
                          ),
                          ...result.pending.map(
                            (p) =>
                              [
                                TriangleAlert,
                                `${p.title}: ${p.kind === "chat" ? "chat pendente de ativação" : "pendente de configuração na Channex"}`,
                              ] as [typeof Check, string],
                          ),
                        ]}
                      />
                    ) : null}
                    <div className="grid gap-2">
                      {chatPending.length > 0 ? (
                        <>
                          <PrimaryBtn disabled={busy} onClick={() => void retryChats()}>
                            {busy ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <RefreshCw className="size-4" />
                            )}
                            Tentar ativar o chat de novo
                          </PrimaryBtn>
                          <SecondaryBtn onClick={close}>Concluir</SecondaryBtn>
                        </>
                      ) : (
                        <PrimaryBtn onClick={close}>Concluir</PrimaryBtn>
                      )}
                    </div>
                  </>
                );
              })()}
            </>
          ) : null}

          {/* ---------- Desconectar ---------- */}
          {step === "confirmDisconnect" ? (
            <>
              <IconBox kind="falta">
                <TriangleAlert className="size-[22px]" />
              </IconBox>
              <Title>Desconectar conta</Title>
              <div className="flex items-center gap-2.5 rounded-[12px] bg-foreground/[0.04] px-[11px] py-[9px] text-[12.5px] font-bold shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_9%,transparent)]">
                <span className="grid size-[34px] shrink-0 place-items-center rounded-[9px] bg-foreground/[0.05] text-[12px] font-extrabold">
                  {(account?.title ?? "?")
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((w) => w[0]?.toUpperCase())
                    .join("")}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{account?.title ?? "Conta do Airbnb"}</span>
                  <small className="block text-[11px] font-medium text-muted-foreground">
                    {plural(account?.imported ?? 0, "imóvel", "imóveis")}
                  </small>
                </span>
              </div>
              <Desc>
                Ao desconectar{" "}
                <b className="font-bold text-foreground">{account?.title ?? "esta conta"}</b>, os{" "}
                <b className="font-bold text-foreground">
                  {plural(account?.imported ?? 0, "imóvel", "imóveis")}
                </b>{" "}
                dela serão arquivados, o chat será desligado e a sincronização pausada. O canal na
                Channex não é alterado.
              </Desc>
              <InfoBox
                kind="falta"
                lines={[
                  [
                    Archive,
                    `${plural(account?.imported ?? 0, "imóvel arquivado", "imóveis arquivados")}`,
                  ],
                  [RefreshCw, "Chat desligado e sincronização pausada"],
                ]}
              />
              <div className="grid gap-2">
                <PrimaryBtn danger disabled={busy} onClick={doDisconnect}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  Desconectar conta
                </PrimaryBtn>
                <SecondaryBtn onClick={close}>Cancelar</SecondaryBtn>
              </div>
            </>
          ) : null}

          {step === "disconnected" && disc ? (
            <>
              <IconBox kind={disc.chatFailures === 0 ? "ok" : "falta"}>
                {disc.chatFailures === 0 ? (
                  <Check className="size-[22px]" />
                ) : (
                  <TriangleAlert className="size-[22px]" />
                )}
              </IconBox>
              <Title>Conta desconectada</Title>
              <Desc>
                <b className="font-bold text-foreground">
                  {plural(disc.archived, "imóvel arquivado", "imóveis arquivados")}
                </b>
                {disc.chatFailures === 0 ? (
                  <> e sincronização pausada. Se reconectar a conta, a sincronização volta.</>
                ) : (
                  <>
                    , mas a Channex não confirmou o desligamento do chat de{" "}
                    {plural(disc.chatFailures, "imóvel", "imóveis")}. Confira o app de mensagens no
                    painel da Channex.
                  </>
                )}
              </Desc>
              <div className="grid gap-2">
                <PrimaryBtn onClick={close}>Concluir</PrimaryBtn>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Cadastro de proprietário: a MESMA janela de Proprietários. */}
      <StakeholderFormDialog
        kind="owner"
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={{ ...emptyStakeholderForm }}
        accountOwnerId={accountOwnerId}
        newLayout
        onSaved={(id) => {
          qc.invalidateQueries({ queryKey: ["stakeholders"] });
          qc.invalidateQueries({ queryKey: ["property-owners-count"] });
          setOwnerId(id);
          setFormOpen(false);
        }}
      />
    </>
  );
}
