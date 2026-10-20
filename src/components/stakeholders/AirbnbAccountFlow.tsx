import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { linkTwin } from "@/lib/channex-twins.functions";
import {
  Archive,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Home,
  Link2,
  Loader2,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
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
  setPropertySyncDismissed,
  startAirbnbConnect,
  syncAirbnbPair,
  syncExistingProperty,
} from "@/lib/airbnb-account.functions";
import {
  activateFullMode,
  chooseLightMode,
  getOperationMode,
  validatePricingFn,
} from "@/lib/channex-mode.functions";
import { listStakeholders } from "@/lib/stakeholders.functions";
import { suggestPairs } from "@/lib/airbnb-pair-suggest";
import { useImpersonation } from "@/hooks/useImpersonation";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ClampName } from "@/components/ui/clamp-name";
import { PropertyThumb } from "@/components/ui/property-thumb";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { useUnsyncedProperties } from "./useUnsyncedProperties";
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
 *   De → para:       com 2+ anúncios escolhidos, cada um ganha o SEU proprietário (lista com seletor à direita);
 *                    com 1 só, segue a janela "de quem é" de sempre.
 *   Sincronizar imóvel existente (sem integração): escolher anúncio → confirmar → resultado.
 *   Sincronizar EM MASSA (vários imóveis sem integração): cada imóvel ao lado do anúncio dele (de → para);
 *                    anúncio que sobra escolhe o imóvel (ou vira imóvel novo + proprietário) → progresso → resultado.
 *   Desconectar:     confirmar → resultado (chat desligado, sincronização pausada, imóveis arquivados;
 *                    o canal na Channex NÃO é alterado)
 * O cadastro de proprietário usa a MESMA janela de Proprietários (`StakeholderFormDialog`).
 */
export type AirbnbFlowRequest =
  | { type: "connect" }
  | { type: "resync" }
  | { type: "reconnect"; channelId: string }
  | { type: "disconnect"; channelId: string }
  | { type: "syncProperty"; property: SyncPropertyInfo }
  | { type: "syncProperties"; properties: SyncPropertyInfo[] }
  | null;

/** Imóvel já existente (sem integração) que vai ser ligado a um anúncio do Airbnb. */
export type SyncPropertyInfo = {
  id: string;
  name: string;
  city?: string | null;
  ownerName: string | null;
  ownerPhone?: string | null;
  ownerPhoneCountry?: string | null;
  imageUrl?: string | null;
  imageUrls?: string[];
};

type Step =
  | "start"
  | "authorizing"
  | "timeout"
  | "noNew"
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
  | "disconnected"
  | "pairs"
  | "syncPick"
  | "syncConfirm"
  | "syncing"
  | "syncDone"
  | "syncEmpty"
  | "bulkPairs"
  | "bulkRunning"
  | "bulkDone";

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
    <DialogTitle className="min-w-0 pr-11 font-display text-[18px] font-extrabold leading-[1.2] tracking-[-0.01em]">
      {children}
    </DialogTitle>
  );
}
function Desc({ children }: { children: ReactNode }) {
  return (
    <DialogDescription className="col-span-full text-[12.5px] leading-[1.55]">
      {children}
    </DialogDescription>
  );
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
function Stepper({ step, label }: { step: 1 | 2 | 3; label: string }) {
  return (
    <div className="grid gap-2 pr-11">
      <div className="flex gap-1.5" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full ${
              i <= step ? "bg-gradient-to-r from-[#7c1ad8] to-[#e82dae]" : "bg-foreground/10"
            }`}
          />
        ))}
      </div>
      <span className="ds-eyebrow text-[10px] tracking-[0.2em]">{label}</span>
    </div>
  );
}
function ListHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5 pr-11">
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

function Radio({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid size-[18px] shrink-0 place-items-center rounded-full ${
        on
          ? "bg-gradient-to-br from-[#7c1ad8] to-[#e82dae]"
          : "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_25%,transparent)]"
      }`}
    >
      {on ? <span className="size-1.5 rounded-full bg-white" /> : null}
    </span>
  );
}

function AttentionBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-[12px] bg-[color-mix(in_oklab,#c9a962_7%,transparent)] px-[13px] py-3 text-[12px] leading-[1.45] text-foreground/85 shadow-[inset_0_0_0_1px_color-mix(in_oklab,#c9a962_30%,transparent)]">
      <TriangleAlert className="mt-0.5 size-[14px] shrink-0 ds-atencao" />
      <span>{children}</span>
    </div>
  );
}

type OwnerRow = {
  id: string;
  name?: string | null;
  trade_name?: string | null;
  phone?: string | null;
  phone_country?: string | null;
};
const ownerName = (o: OwnerRow) => String(o.trade_name || o.name || "");

/** Seletor de proprietário (busca + "Cadastrar novo proprietário"), usado em cada linha do de → para. */
function OwnerPicker({
  value,
  owners,
  onChange,
  onCreate,
  missing,
  row,
}: {
  value: string | null;
  owners: OwnerRow[];
  onChange: (id: string) => void;
  onCreate: () => void;
  missing?: boolean;
  /** Layout do passo "Vincular proprietários": altura 36px, placeholder próprio e realce âmbar quando falta. */
  row?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const sel = owners.find((o) => o.id === value) ?? null;
  const t = term.trim().toLowerCase();
  const list = owners
    .filter((o) => !t || `${ownerName(o)} ${o.phone ?? ""}`.toLowerCase().includes(t))
    .sort((a, b) => ownerName(a).localeCompare(ownerName(b), "pt-BR"));
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setTerm("");
      }}
    >
      <div
        className={`flex min-w-0 items-center rounded-[9px] bg-card pr-2 ${row ? "h-9" : "h-10"} ${
          missing
            ? row
              ? "shadow-[inset_0_0_0_1px_color-mix(in_oklab,#c9a24a_60%,transparent)]"
              : "shadow-[inset_0_0_0_1px_color-mix(in_oklab,#c98c8c_55%,transparent)]"
            : "shadow-[inset_0_0_0_1px_var(--border)]"
        }`}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2.5 text-left text-[12.5px]"
          >
            <span
              className={`min-w-0 flex-1 truncate ${sel ? "font-semibold text-foreground" : "text-muted-foreground"}`}
            >
              {sel ? ownerName(sel) : row ? "Escolher proprietário" : "Escolher…"}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        {sel ? (
          <PhoneActionButton
            phone={sel.phone}
            country={sel.phone_country}
            size={12}
            alwaysShow
            className="ml-1 shrink-0 !p-0"
          />
        ) : null}
      </div>
      <PopoverContent
        align="end"
        className="w-[260px] p-1.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="relative mb-1.5 h-9 overflow-hidden rounded-[8px] bg-card shadow-[inset_0_0_0_1px_var(--border)]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground opacity-60" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar proprietário…"
            className="h-full w-full bg-transparent pl-8 pr-2 text-[12.5px] placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <div className="max-h-[220px] overflow-y-auto">
          {list.length === 0 ? (
            <p className="px-2.5 py-3 text-center text-[12px] text-muted-foreground">
              Nenhum proprietário encontrado.
            </p>
          ) : null}
          {list.map((o) => (
            <button
              key={o.id}
              type="button"
              data-clip-row
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors hover:bg-secondary ${o.id === value ? "bg-secondary" : ""}`}
            >
              <b className="min-w-0 flex-1 truncate font-semibold">{ownerName(o)}</b>
              {o.id === value ? <Check className="size-3.5 shrink-0 text-accent" /> : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onCreate();
          }}
          className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-border px-2.5 pb-2 pt-2.5 text-left text-[12.5px] font-bold text-accent transition-colors hover:bg-secondary"
        >
          <Plus className="size-3.5" /> Cadastrar novo proprietário
        </button>
      </PopoverContent>
    </Popover>
  );
}

type PickOpt = {
  id: string;
  title: string;
  sub?: string | null;
  /** Opção bloqueada (ex.: já escolhida em outra linha) + motivo curto. */
  note?: string;
  suggested?: boolean;
  /** Conta do Airbnb do anúncio (só aparece quando há mais de uma conta ativa). */
  account?: { name: string; idx: number } | null;
};

/** Cores discretas só para diferenciar as contas entre si (a etiqueta em si é neutra). */
const ACCOUNT_DOTS = ["#9b6fd6", "#d9849f", "#5fa8a0", "#c9a45e"];

/** Etiqueta com o nome da conta do Airbnb. */
function AccountTag({ name, idx }: { name: string; idx: number }) {
  return (
    <span
      title={name}
      className="inline-flex max-w-full shrink-0 items-center gap-1 rounded-full bg-foreground/[0.07] px-1.5 py-[1px] text-[9.5px] font-bold text-foreground/80"
    >
      <i
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: ACCOUNT_DOTS[idx % ACCOUNT_DOTS.length] }}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Seletor genérico (busca + lista) das linhas do em massa: anúncio do Airbnb ou imóvel. */
function PairPicker({
  valueLabel,
  valueAccount,
  options,
  value,
  placeholder,
  searchPlaceholder,
  onChange,
  missing,
  footer,
}: {
  valueLabel: string | null;
  valueAccount?: { name: string; idx: number } | null;
  options: PickOpt[];
  value: string | null;
  placeholder: string;
  searchPlaceholder: string;
  onChange: (id: string) => void;
  missing?: boolean;
  footer?: { label: string; onClick: () => void };
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const t = term.trim().toLowerCase();
  const list = options.filter((o) => !t || `${o.title} ${o.sub ?? ""}`.toLowerCase().includes(t));
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setTerm("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={valueLabel ?? undefined}
          className={`flex min-h-10 w-full min-w-0 items-center gap-1.5 rounded-[9px] bg-card px-2.5 py-1 text-left text-[12.5px] ${
            missing
              ? "shadow-[inset_0_0_0_1px_color-mix(in_oklab,#c98c8c_55%,transparent)]"
              : "shadow-[inset_0_0_0_1px_var(--border)]"
          }`}
        >
          <span className="grid min-w-0 flex-1 justify-items-start gap-0.5">
            <span
              className={`w-full truncate ${valueLabel ? "font-semibold text-foreground" : "text-muted-foreground"}`}
            >
              {valueLabel ?? placeholder}
            </span>
            {valueLabel && valueAccount ? (
              <AccountTag name={valueAccount.name} idx={valueAccount.idx} />
            ) : null}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(380px,calc(100vw-2rem))] p-1.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="relative mb-1.5 h-9 overflow-hidden rounded-[8px] bg-card shadow-[inset_0_0_0_1px_var(--border)]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground opacity-60" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-full w-full bg-transparent pl-8 pr-2 text-[12.5px] placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <div className="max-h-[220px] overflow-y-auto">
          {list.length === 0 ? (
            <p className="px-2.5 py-3 text-center text-[12px] text-muted-foreground">
              Nada encontrado.
            </p>
          ) : null}
          {list.map((o) => (
            <button
              key={o.id}
              type="button"
              data-clip-row
              disabled={!!o.note}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-x-2 gap-y-[3px] rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors disabled:opacity-45 ${
                o.id === value
                  ? "bg-accent/15 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_35%,transparent)]"
                  : "enabled:hover:bg-secondary"
              }`}
            >
              <b className="col-span-2 min-w-0 truncate font-semibold leading-[1.3]" title={o.title}>
                {o.title}
              </b>
              <small className="min-w-0 text-[10.5px] leading-[1.3] text-muted-foreground">
                {o.note ?? o.sub}
              </small>
              {o.account ? (
                <span className="col-start-2 row-start-2 flex max-w-[140px] shrink-0">
                  <AccountTag name={o.account.name} idx={o.account.idx} />
                </span>
              ) : o.suggested ? (
                <span className="col-start-2 row-start-2 text-[10px] font-extrabold text-accent">
                  Sugerido
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {footer ? (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              footer.onClick();
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-border px-2.5 pb-2 pt-2.5 text-left text-[12.5px] font-bold text-accent transition-colors hover:bg-secondary"
          >
            <Plus className="size-3.5 shrink-0" /> <span className="min-w-0">{footer.label}</span>
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

type BulkJob = {
  key: string;
  kind: "link" | "new";
  listingId: string;
  propertyId?: string;
  ownerId?: string;
  label: string;
  /** Nome da conta do Airbnb do anúncio (só quando há mais de uma conta ativa). */
  account?: string | null;
  status: "wait" | "run" | "ok" | "err";
  error?: string;
  pending: Array<{ propertyId: string; title: string; kind: "chat" | "config" }>;
};

/**
 * Migração guiada (transitória, sai quando 100% dos imóveis estiverem sincronizados): se ainda
 * houver imóveis do sistema sem anúncio, importar anúncios abre SEMPRE o "De → Para" com esses
 * imóveis primeiro; só anúncio que sobrar vira imóvel novo (com proprietário). Evita duplicatas.
 */
export function AirbnbAccountFlow({
  request,
  onClose,
}: {
  request: AirbnbFlowRequest;
  onClose: () => void;
}) {
  const [override, setOverride] = useState<AirbnbFlowRequest>(null);
  useEffect(() => {
    if (request === null) setOverride(null);
  }, [request]);
  return (
    <AirbnbAccountFlowInner
      request={request === null ? null : (override ?? request)}
      onSwitch={setOverride}
      onClose={() => {
        setOverride(null);
        onClose();
      }}
    />
  );
}

function AirbnbAccountFlowInner({
  request,
  onClose,
  onSwitch,
}: {
  request: AirbnbFlowRequest;
  onClose: () => void;
  onSwitch: (r: AirbnbFlowRequest) => void;
}) {
  const unsynced = useUnsyncedProperties();
  const unsyncedProps = unsynced.q.data?.properties ?? [];
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
  const syncFn = useServerFn(syncExistingProperty);
  const pairFn = useServerFn(syncAirbnbPair);
  const dismissFn = useServerFn(setPropertySyncDismissed);
  const linkTwinFn = useServerFn(linkTwin);

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
  /** De → para: proprietário de cada anúncio escolhido (2 ou mais). */
  const [pairOwners, setPairOwners] = useState<Record<string, string>>({});
  // Gêmeos escolhidos no import: anúncio gêmeo → anúncio principal (mesmo imóvel físico).
  const [twinOf, setTwinOf] = useState<Record<string, string>>({});
  /** Quem recebe o proprietário recém-cadastrado: um anúncio ou o fluxo de 1 anúncio. */
  const [createFor, setCreateFor] = useState<string | null>(null);
  /** Sincronizar imóvel existente. */
  const [syncListing, setSyncListing] = useState<string | null>(null);
  const [syncRes, setSyncRes] = useState<{
    title: string;
    pending: Array<{ propertyId: string; title: string; kind: "chat" | "config" }>;
    channexPropertyId?: string | null;
  } | null>(null);
  /** Em massa: anúncio escolhido para cada imóvel (imóvel → anúncio). */
  const [propListing, setPropListing] = useState<Record<string, string>>({});
  /** Em massa: anúncio sem imóvel que vai virar imóvel novo → proprietário(a) ("" = ainda não escolhido). */
  const [looseNew, setLooseNew] = useState<Record<string, string>>({});
  /** Em massa: imóveis marcados como "Não sincronizar" nesta janela (saem do aviso; dá para desfazer). */
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  /** Em massa: imóveis cujo anúncio veio do "Sugerir" (mostra a etiqueta até a pessoa trocar). */
  const [sugIds, setSugIds] = useState<Set<string>>(new Set());
  /** Em massa: lista de "anúncios sem imóvel" aberta. */
  const [bulkJobs, setBulkJobs] = useState<BulkJob[]>([]);
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
    enabled: open && (step === "owner" || step === "pairs" || step === "bulkPairs" || formOpen),
    staleTime: 15_000,
  });
  const inv = useQuery({
    queryKey: ["airbnb-account-listings", accountOwnerId ?? "self", channelId, liveCatalog],
    queryFn: () => listingsFn({ data: { accountOwnerId, channelId, live: liveCatalog } }),
    enabled:
      open &&
      // Em massa (lista única) busca os anúncios de TODAS as contas ativas, sem escolher conta.
      (!!channelId || step === "bulkPairs" || step === "bulkRunning") &&
      (step === "listings" ||
        step === "owner" ||
        step === "pairs" ||
        step === "importing" ||
        step === "syncPick" ||
        step === "syncConfirm" ||
        step === "bulkPairs" ||
        step === "bulkRunning"),
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
    setPairOwners({});
    setTwinOf({});
    setCreateFor(null);
    setSyncListing(null);
    setSyncRes(null);
    setPropListing({});
    setLooseNew({});
    setDismissedIds(new Set());
    setSugIds(new Set());
    setBulkJobs([]);
    setLiveCatalog(request.type !== "connect");
    if (request.type === "syncProperties") {
      setChannelId(null);
      setStep("bulkPairs");
    } else if (request.type === "syncProperty") {
      // A conta é escolhida sozinha (a 1ª ativa) quando as contas chegam; "Trocar" volta à lista de contas.
      setChannelId(null);
      setStep("syncPick");
    } else if (request.type === "connect") {
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
    // O Airbnb devolve o cliente ao painel (outra aba) e avisa por aqui.
    let returnedAt = 0;
    const onStorage = (e: StorageEvent) => {
      if (e.key === "airbnb-oauth-return" && e.newValue) returnedAt = Date.now();
    };
    window.addEventListener("storage", onStorage);
    let id = 0;
    const tick = async () => {
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
        if (!r.found) {
          // Airbnb já voltou e, após ~10 s, nenhuma conta nova apareceu: para de esperar.
          if (returnedAt && Date.now() - returnedAt > 10_000) {
            window.clearInterval(id);
            setStep("noNew");
          }
          return;
        }
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
    };
    id = window.setInterval(tick, 4000);
    // Voltou para esta aba (ex.: autorizou numa janela anônima): confere na hora, sem F5.
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      qc.invalidateQueries({ queryKey: ["airbnb-accounts"] });
      void tick();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, baseline, reauthId]);

  // Conta sem anúncios disponíveis.
  useEffect(() => {
    if (step === "listings" && inv.data && inv.data.listings.length === 0) setStep("empty");
  }, [step, inv.data]);

  // Sincronizar imóvel: escolhe a conta ativa sozinha e avisa quando não há anúncio livre.
  const activeAccounts = accList.filter((a) => a.status === "active");
  useEffect(() => {
    const bulkReq = request?.type === "syncProperties";
    if (
      (request?.type !== "syncProperty" || step !== "syncPick") &&
      !(bulkReq && step === "bulkPairs")
    )
      return;
    if (bulkReq) {
      // Lista única: não escolhe conta; os anúncios de todas as contas ativas entram juntos.
      if (accounts.data && activeAccounts.length === 0) setStep("syncEmpty");
      else if (inv.data && !inv.data.listings.some((l) => !l.imported && !l.notFound))
        setStep("syncEmpty");
      return;
    }
    if (!channelId) {
      if (activeAccounts[0]) setChannelId(activeAccounts[0].channelId);
      else if (accounts.data) setStep("syncEmpty");
      return;
    }
    if (inv.data && !inv.data.listings.some((l) => !l.imported && !l.notFound))
      setStep("syncEmpty");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, step, channelId, accounts.data, inv.data]);

  function close() {
    onClose();
  }
  // "Já conectei" aprovado: fecha a conclusão empilhada e volta direto à lista de contas.
  useEffect(() => {
    const done = new Set<Step>(["bulkDone", "syncDone", "result"]);
    const onDone = () => {
      if (done.has(step)) {
        refreshAll();
        onClose();
      }
    };
    window.addEventListener("full-connect-done", onDone);
    return () => window.removeEventListener("full-connect-done", onDone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
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
  /** Descarta tudo da tentativa anterior antes de tentar de novo. */
  function resetConnect() {
    setBaseline([]);
    setConnectUrl(null);
    setReauthId(null);
    try {
      localStorage.removeItem("airbnb-oauth-return");
    } catch {
      /* sem armazenamento */
    }
    qc.invalidateQueries({ queryKey: ["airbnb-accounts"] });
    setStep("start");
  }
  async function begin(reauthArg: unknown = null, copyOnly = false) {
    // Nunca repassa o evento do clique como ID de conta.
    const reauth = typeof reauthArg === "string" && reauthArg.length >= 8 ? reauthArg : null;
    setReauthId(reauth);
    setBusy(true);
    try {
      localStorage.removeItem("airbnb-oauth-return");
    } catch {
      /* sem armazenamento */
    }
    try {
      const r = await startFn({ data: { accountOwnerId, reauthChannelId: reauth } });
      setBaseline(r.baseline);
      setConnectUrl(r.url);
      if (copyOnly) {
        try {
          await navigator.clipboard.writeText(r.url);
          toast.success("Link copiado. Abra numa janela anônima ou envie ao proprietário.");
        } catch {
          toast.error("Não foi possível copiar. Use “Abrir o Airbnb de novo”.");
        }
      } else {
        window.open(r.url, "_blank", "noopener,noreferrer");
      }
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
    if (!channelId) return;
    const twins = picked.length > 1 ? Object.entries(twinOf).filter(([t, p]) => picked.includes(t) && picked.includes(p)) : [];
    const twinIds = new Set(twins.map(([t]) => t));
    const items =
      picked.length > 1
        ? picked
            .filter((id) => !twinIds.has(id))
            .map((listingId) => ({ listingId, ownerId: pairOwners[listingId] }))
        : ownerId
          ? picked.map((listingId) => ({ listingId, ownerId }))
          : [];
    if (items.length === 0 || items.some((i) => !i.ownerId)) return;
    setStep("importing");
    try {
      const res = await importFn({ data: { accountOwnerId, items } });
      // Gêmeos marcados pelo usuário: amarra cada um ao anúncio principal já importado (unidade própria no PriceLabs).
      const twinErrors: string[] = [];
      for (const [twinListingId, primaryListingId] of twins) {
        try {
          await linkTwinFn({ data: { channelId, primaryListingId, twinListingId } });
        } catch (e) {
          twinErrors.push(e instanceof Error ? e.message : "falha ao unir gêmeo");
        }
      }
      if (twinErrors.length)
        toast.error(`Não foi possível unir ${twinErrors.length} anúncio(s) gêmeo(s). Una pela aba de gêmeos. ${twinErrors[0]}`);
      setResult(res);
      refreshAll();
      qc.invalidateQueries({ queryKey: ["twin-suggestions"] });
      setStep("result");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível importar.");
      setStep(picked.length > 1 ? "pairs" : "owner");
    }
  }
  /** Tira o imóvel já vinculado da lista em memória na hora (a 1ª tela não mostra o velho). */
  function dropFromUnsynced(propertyId: string) {
    qc.setQueriesData<{ properties?: Array<{ id: string }>; blocking?: boolean } | undefined>(
      { queryKey: ["unsynced-properties"] },
      (old) => {
        if (!old?.properties) return old;
        const properties = old.properties.filter((p) => p.id !== propertyId);
        return { ...old, properties, blocking: old.blocking && properties.length > 0 };
      },
    );
  }
  async function doSyncProperty() {
    if (request?.type !== "syncProperty" || !syncListing) return;
    setStep("syncing");
    try {
      const r = await syncFn({
        data: { accountOwnerId, propertyId: request.property.id, listingId: syncListing },
      });
      setSyncRes({ title: r.title, pending: r.pending, channexPropertyId: r.channexPropertyId });
      dropFromUnsynced(request.property.id);
      refreshAll();
      qc.invalidateQueries({ queryKey: ["unsynced-properties"] });
      setStep("syncDone");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível sincronizar o imóvel.");
      setStep("syncConfirm");
    }
  }
  async function runBulk(jobs: BulkJob[]) {
    setBulkJobs(jobs);
    setStep("bulkRunning");
    const next = [...jobs];
    for (let i = 0; i < next.length; i += 1) {
      if (next[i].status === "ok") continue;
      next[i] = { ...next[i], status: "run", error: undefined };
      setBulkJobs([...next]);
      try {
        const r = await pairFn({
          data: {
            accountOwnerId,
            listingId: next[i].listingId,
            ...(next[i].kind === "link"
              ? { propertyId: next[i].propertyId }
              : { ownerId: next[i].ownerId }),
          },
        });
        next[i] = { ...next[i], status: "ok", pending: r.pending };
        if (r.kind === "linked") dropFromUnsynced(r.propertyId);
      } catch (e) {
        next[i] = {
          ...next[i],
          status: "err",
          error: e instanceof Error ? e.message : "Não foi possível sincronizar.",
        };
      }
      setBulkJobs([...next]);
    }
    refreshAll();
    qc.invalidateQueries({ queryKey: ["unsynced-properties"] });
    qc.invalidateQueries({ queryKey: ["twin-suggestions"] });
    setStep("bulkDone");
  }
  /** "Não sincronizar este imóvel" / "Desfazer": o servidor guarda; a lista local acompanha. */
  async function dismissProp(id: string, dismissed: boolean) {
    try {
      await dismissFn({ data: { accountOwnerId, propertyId: id, dismissed } });
      setDismissedIds((cur) => {
        const next = new Set(cur);
        if (dismissed) next.add(id);
        else next.delete(id);
        return next;
      });
      if (dismissed) {
        setPropListing((c) => {
          const { [id]: _drop, ...rest } = c;
          void _drop;
          return rest;
        });
        setSugIds((cur) => {
          const next = new Set(cur);
          next.delete(id);
          return next;
        });
      }
      void qc.invalidateQueries({ queryKey: ["unsynced-properties"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    }
  }
  function startBulk() {
    const jobs: BulkJob[] = [
      ...Object.entries(propListing).map(([propertyId, listingId]) => ({
        key: `p:${propertyId}`,
        kind: "link" as const,
        listingId,
        propertyId,
        label: bulkProps.find((p) => p.id === propertyId)?.name ?? "Imóvel",
        account: accTag(bulkFree.find((x) => x.listingId === listingId)?.channelId ?? "")?.name,
        status: "wait" as const,
        pending: [],
      })),
      ...bulkLoose
        .filter((l) => looseIsNew(l.listingId) && looseOwner(l.listingId))
        .map((l) => ({
          key: `l:${l.listingId}`,
          kind: "new" as const,
          listingId: l.listingId,
          ownerId: looseOwner(l.listingId),
          label: l.title,
          account: accTag(l.channelId)?.name,
          status: "wait" as const,
          pending: [],
        })),
    ];
    if (jobs.length > 0) void runBulk(jobs);
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

  const isListStep =
    step === "pickAccount" ||
    step === "listings" ||
    step === "owner" ||
    step === "pairs" ||
    step === "syncPick" ||
    step === "bulkPairs";
  const syncProp = request?.type === "syncProperty" ? request.property : null;
  const isSyncReq = request?.type === "syncProperty" || request?.type === "syncProperties";
  const bulkAll = request?.type === "syncProperties" ? request.properties : [];
  const bulkProps = bulkAll.filter((p) => !dismissedIds.has(p.id));
  const bulkDismissed = bulkAll.filter((p) => dismissedIds.has(p.id));
  // Com mais de uma conta ativa, cada anúncio mostra o nome da conta dele.
  const multiAcc = activeAccounts.length > 1;
  const accTag = (cid: string) => {
    if (!multiAcc) return null;
    const i = activeAccounts.findIndex((a) => a.channelId === cid);
    return i < 0 ? null : { name: activeAccounts[i].title, idx: i };
  };
  const expiredAccounts = accList.filter((a) => a.status !== "active");
  const bulkFree = (inv.data?.listings ?? [])
    .filter((l) => !l.imported && !l.notFound)
    .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
  const usedListings = new Set(Object.values(propListing));
  const bulkUnchosen = bulkFree.filter((l) => !usedListings.has(l.listingId));
  // Sem imóvel livre para escolher, o anúncio que sobrou só pode virar imóvel novo.
  const bulkFreeProps = bulkProps.filter((p) => !propListing[p.id]);
  // "Anúncio sem imóvel": só aparece quando TODOS os imóveis já têm anúncio (ou foram dispensados).
  // Antes disso os anúncios livres já estão nas opções de cada imóvel — repetir era duplicação.
  const bulkLoose = bulkFreeProps.length === 0 ? bulkUnchosen : [];
  const looseIsNew = (lid: string) => looseNew[lid] !== undefined || bulkFreeProps.length === 0;
  const looseOwner = (lid: string) => looseNew[lid] ?? "";
  const bulkPairsN =
    Object.keys(propListing).length + bulkLoose.filter((l) => looseOwner(l.listingId)).length;
  const bulkMissingOwner = bulkLoose.filter(
    (l) => looseIsNew(l.listingId) && !looseOwner(l.listingId),
  ).length;
  const bulkRowsN = bulkProps.length + bulkLoose.length;
  const syncChip = syncProp ? (
    <div className="flex min-w-0 items-center gap-2.5 rounded-[12px] bg-foreground/[0.04] px-[11px] py-[9px] text-[12.5px] font-bold">
      <PropertyThumb
        src={syncProp.imageUrl}
        fallbacks={syncProp.imageUrls}
        className="size-[34px] rounded-[9px]"
        iconClassName="size-4"
      />
      <span className="grid min-w-0 flex-1 gap-[3px]">
        <ClampName text={syncProp.name} />
        {syncProp.ownerName ? (
          <small className="flex items-center gap-[5px] text-[11px] font-medium text-muted-foreground">
            Proprietário(a):{" "}
            <b className="truncate font-semibold text-foreground">{syncProp.ownerName}</b>
            <PhoneActionButton
              phone={syncProp.ownerPhone}
              country={syncProp.ownerPhoneCountry}
              size={11}
              alwaysShow
              className="shrink-0 !p-0"
            />
          </small>
        ) : null}
      </span>
    </div>
  ) : null;
  const freeListings = listings.filter((l) => !l.imported && !l.notFound);
  const chosenSync =
    (inv.data?.listings ?? []).find((l) => l.listingId === syncListing && !l.imported) ?? null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) =>
          !o &&
          !busy &&
          step !== "importing" &&
          step !== "syncing" &&
          step !== "bulkRunning" &&
          close()
        }
      >
        <DialogContent
          className={
            step === "bulkPairs"
              ? // Título e botões FIXOS; só a lista rola (o anticorte da base corta no último cartão inteiro).
                "max-w-[380px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px] sm:p-0 flex"
              : isListStep
                ? CONTENT_A
                : CONTENT_B
          }
        >
          {/* ---------- Conectar: início ---------- */}
          {step === "start" ? (
            <>
              <Stepper step={1} label="Passo 1 de 3 · Conectar" />
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                <IconBox kind="ok">
                  <Link2 className="size-[22px]" />
                </IconBox>
                <Title>Conectar conta do Airbnb</Title>
                <Desc>
                  Você entra no Airbnb em uma janela segura e autoriza o acesso. O ConciergeIA nunca
                  vê a sua senha.
                </Desc>
              </div>
              <InfoBox
                kind="ok"
                lines={[
                  [Check, "Anúncios, fotos e regras da casa"],
                  [Check, "Endereço, horários e capacidade"],
                  [Check, "Calendário e reservas sempre atualizados"],
                ]}
              />
              <p className="flex items-start gap-2 text-[12px] leading-[1.5] text-muted-foreground">
                <Lock className="mt-[2px] size-3.5 shrink-0" />
                Tudo que vem do Airbnb fica bloqueado aqui. Para alterar, edite direto no anúncio.
              </p>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                <PrimaryBtn onClick={() => void begin()} disabled={busy}>
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ExternalLink className="size-4" />
                  )}
                  Continuar com o Airbnb
                </PrimaryBtn>
                <SecondaryBtn onClick={() => !busy && void begin(null, true)}>
                  <Link2 className="size-[15px]" />
                  Copiar link de conexão
                </SecondaryBtn>
                <SecondaryBtn onClick={close}>Cancelar</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Conectar: aguardando autorização ---------- */}
          {step === "authorizing" ? (
            <>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                <IconBox kind="ok">
                  <RefreshCw className="size-[22px] animate-spin" />
                </IconBox>
                <Title>Aguardando autorização</Title>
                <Desc>
                  Conclua a autorização na janela do Airbnb. Esta janela continua sozinha quando
                  você terminar.
                </Desc>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                <SecondaryBtn
                  onClick={() =>
                    connectUrl && window.open(connectUrl, "_blank", "noopener,noreferrer")
                  }
                >
                  <ExternalLink className="size-[15px]" />
                  Abrir o Airbnb de novo
                </SecondaryBtn>
                <SecondaryBtn
                  onClick={() =>
                    connectUrl &&
                    navigator.clipboard
                      .writeText(connectUrl)
                      .then(() => toast.success("Link copiado."))
                      .catch(() => toast.error("Não foi possível copiar o link."))
                  }
                >
                  <Link2 className="size-[15px]" />
                  Copiar link de conexão
                </SecondaryBtn>
                <SecondaryBtn onClick={close}>Fechar (o link continua válido)</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Conectar: Airbnb voltou sem conta nova ---------- */}
          {step === "noNew" ? (
            <>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                <IconBox kind="falta">
                  <TriangleAlert className="size-[22px]" />
                </IconBox>
                <Title>Nenhuma conta nova encontrada</Title>
                <Desc>
                  Copie o link abaixo, abra numa janela anônima e entre com a conta nova que deseja
                  sincronizar.
                </Desc>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                <PrimaryBtn
                  onClick={() => {
                    resetConnect();
                    void begin(null, true);
                  }}
                >
                  Copiar link para janela anônima
                </PrimaryBtn>
                <SecondaryBtn onClick={resetConnect}>Tentar de novo</SecondaryBtn>
                <SecondaryBtn onClick={close}>Fechar</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Conectar: não concluída ---------- */}
          {step === "timeout" ? (
            <>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                <IconBox kind="falta">
                  <TriangleAlert className="size-[22px]" />
                </IconBox>
                <Title>Autorização não concluída</Title>
                <Desc>
                  Não recebemos a autorização do Airbnb.{" "}
                  <b className="font-bold text-foreground">Nenhum anúncio foi importado.</b>
                </Desc>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                <PrimaryBtn onClick={() => (reauthId ? void begin(reauthId) : setStep("start"))}>
                  Tentar de novo
                </PrimaryBtn>
                <SecondaryBtn onClick={close}>Fechar</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Conta já conectada ---------- */}
          {step === "already" ? (
            <>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                <IconBox kind="ok">
                  <Link2 className="size-[22px]" />
                </IconBox>
                <Title>Conta já conectada</Title>
                <Desc>
                  A conta <b className="font-bold text-foreground">{alreadyTitle}</b> já está
                  conectada. Para trazer anúncios novos dela, use o botão ReSincronizar.
                </Desc>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
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
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                <IconBox kind="falta">
                  <TriangleAlert className="size-[22px]" />
                </IconBox>
                <Title>Autorização expirou</Title>
                <Desc>
                  A conta{" "}
                  <b className="font-bold text-foreground">{account?.title ?? "do Airbnb"}</b>{" "}
                  precisa ser autorizada de novo para sincronizar. Os imóveis dela continuam no
                  sistema.
                </Desc>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                <PrimaryBtn disabled={busy || !channelId} onClick={() => void begin(channelId)}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
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
                title={isSyncReq ? "Qual conta do Airbnb?" : "ReSincronizar conta"}
                description={
                  request?.type === "syncProperties"
                    ? "Escolha a conta onde estão os anúncios destes imóveis."
                    : request?.type === "syncProperty"
                      ? "Escolha a conta onde está o anúncio deste imóvel."
                      : "Escolha a conta que você quer atualizar. Uma de cada vez."
                }
              />
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
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
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2 pt-1">
                <PrimaryBtn
                  disabled={!channelId || account?.status !== "active"}
                  onClick={() => {
                    if (request?.type === "syncProperties") {
                      setPropListing({});
                      setLooseNew({});
                      setStep("bulkPairs");
                    } else if (request?.type === "syncProperty") {
                      setSyncListing(null);
                      setStep("syncPick");
                    } else setStep("listings");
                  }}
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
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                {(
                  [
                    [
                      "light",
                      "Leve",
                      "Você gerencia calendário e preços direto na plataforma. O ConciergeIA recebe reservas, financeiro e mensagens, sem mexer em datas ou preços.",
                    ],
                    [
                      "full",
                      "Full",
                      "ConciergeIA assume o controle de disponibilidade do seu calendário como bloqueios manuais, enquanto sua ferramenta de precificação gerencia o preço do calendário por completo.",
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
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2 pt-1">
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
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                <IconBox kind="ok">
                  <Link2 className="size-6" />
                </IconBox>
                <Title>Validar tarifas para o modo Full do Concierge</Title>
                <Desc>
                  O ConciergeIA assume só a{" "}
                  <b className="font-bold text-foreground">disponibilidade</b>; ele não define
                  preços. Antes de ativar, sua ferramenta de precificação precisa ter sincronizado
                  as diárias.
                </Desc>
              </div>
              <InfoBox
                kind="ok"
                lines={[
                  [Check, "Importe os anúncios na sua ferramenta de precificação"],
                  [Check, "Envie as diárias por lá"],
                  [Check, "Volte aqui e valide. Até lá, a conta fica em Leve"],
                ]}
              />
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
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
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                <IconBox kind="falta">
                  <TriangleAlert className="size-[22px]" />
                </IconBox>
                <Title>Tarifas incompletas</Title>
                <Desc>
                  {valRes.checked === 0 ? (
                    <>Ainda não há anúncios ativos com tarifa para conferir.</>
                  ) : (
                    <>
                      Faltam tarifas em{" "}
                      <b className="font-bold text-foreground">
                        {plural(valRes.missing, "anúncio", "anúncios")}
                      </b>
                      .
                    </>
                  )}{" "}
                  Sincronize as diárias na sua ferramenta de precificação e valide novamente. Sua
                  conta do Concierge segue em modo <b className="font-bold text-foreground">Leve</b>
                  .
                </Desc>
              </div>
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
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
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
              <Stepper step={2} label="Passo 2 de 3 · Escolher anúncios" />
              <ListHeader
                title={account?.title ?? "Conta do Airbnb"}
                description="Marque os anúncios que entram no sistema. No próximo passo, cada um recebe um proprietário."
              />
              <SearchBox value={q} onChange={setQ} placeholder="Buscar anúncio…" />
              <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
                <span className="font-bold text-foreground/85">
                  {plural(inv.data?.listings.length ?? 0, "anúncio", "anúncios")} na conta
                </span>
                <span>{plural(importedN, "já importado", "já importados")}</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
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
                          <ClampName
                            as="b"
                            text={l.title}
                            passThrough
                            className={`flex-1 text-[13px] font-bold ${locked ? "opacity-60" : ""}`}
                          />
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
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2 pt-1">
                <PrimaryBtn
                  disabled={n === 0}
                  onClick={() => {
                    setQ("");
                    if (unsyncedProps.length > 0) {
                      toast.message("Primeiro, ligue os anúncios aos imóveis que você já tem", {
                        description: "Só os anúncios que sobrarem viram imóveis novos.",
                      });
                      onSwitch({
                        type: "syncProperties",
                        properties: unsyncedProps.map((p) => ({
                          id: p.id,
                          name: p.name,
                          city: p.city,
                          ownerName: p.ownerName,
                          ownerPhone: p.ownerPhone,
                          ownerPhoneCountry: p.ownerPhoneCountry,
                          imageUrl: p.imageUrl,
                          imageUrls: p.imageUrls,
                        })),
                      });
                      return;
                    }
                    setStep(n > 1 ? "pairs" : "owner");
                  }}
                >
                  {n === 0 ? "Continuar" : `Continuar com ${plural(n, "anúncio", "anúncios")}`}
                </PrimaryBtn>
                <SecondaryBtn onClick={close}>Cancelar</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Sem anúncios ---------- */}
          {step === "empty" ? (
            <>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                <IconBox kind="neutral">
                  <Home className="size-5" />
                </IconBox>
                <Title>Nenhum anúncio disponível</Title>
                <Desc>
                  A conta{" "}
                  <b className="font-bold text-foreground">{account?.title ?? "do Airbnb"}</b> foi
                  conectada, mas não tem anúncios para importar agora.
                </Desc>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                <SecondaryBtn onClick={close}>Fechar</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Passo 3 de 3: vincular proprietários (1 ou mais anúncios) ---------- */}
          {step === "owner" || step === "pairs" ? (
            <>
              <Stepper step={3} label="Passo 3 de 3 · Vincular proprietários" />
              <ListHeader
                title="Quem é o proprietário de cada imóvel?"
                description="Só dá para concluir com todos vinculados. Escolha entre os proprietários já cadastrados."
              />
              {(() => {
                const multi = step === "pairs";
                const ownerOf = (id: string): string | null =>
                  multi ? (pairOwners[twinOf[id] ?? id] ?? null) : ownerId;
                const linked = picked.filter((id) => ownerOf(id)).length;
                const missingN = n - linked;
                const ready = n > 0 && missingN === 0;
                return (
                  <>
                    {owners.isLoading ? (
                      <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                        Buscando proprietários…
                      </p>
                    ) : null}
                    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                      {picked.map((id) => {
                        const l = (inv.data?.listings ?? []).find((x) => x.listingId === id);
                        if (!l) return null;
                        return (
                          <div
                            key={id}
                            data-clip-row
                            className={`grid gap-2.5 rounded-[14px] bg-foreground/[0.03] p-2.5 ${INSET}`}
                          >
                            <span className="flex min-w-0 items-center gap-2.5">
                              <span className="grid size-[46px] shrink-0 place-items-center rounded-[11px] bg-foreground/[0.05] text-muted-foreground">
                                <Home className="size-[18px]" />
                              </span>
                              <span className="grid min-w-0 flex-1 gap-0.5">
                                <ClampName
                                  as="b"
                                  text={l.title}
                                  className="text-[12.5px] font-bold"
                                />
                                {l.city ? (
                                  <small className="truncate text-[10.5px] text-muted-foreground">
                                    {l.city}
                                  </small>
                                ) : null}
                              </span>
                            </span>
                            {multi ? (
                              <label className="flex min-w-0 items-center gap-2 text-[11.5px] text-muted-foreground">
                                <span className="shrink-0">Gêmeo de:</span>
                                <select
                                  value={twinOf[id] ?? ""}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setTwinOf((c) => {
                                      const next = { ...c };
                                      if (v) next[id] = v;
                                      else delete next[id];
                                      // Um anúncio principal nunca é gêmeo de outro (evita cadeia).
                                      for (const k of Object.keys(next)) if (next[k] === id) delete next[k];
                                      return next;
                                    });
                                  }}
                                  className="min-w-0 flex-1 truncate rounded-[9px] bg-foreground/[0.04] px-2 py-1.5 text-[12px] text-foreground"
                                >
                                  <option value="">Nenhum (imóvel próprio)</option>
                                  {picked
                                    .filter((o) => o !== id && !twinOf[o])
                                    .map((o) => {
                                      const ol = (inv.data?.listings ?? []).find((x) => x.listingId === o);
                                      return (
                                        <option key={o} value={o}>
                                          {ol?.title ?? o}
                                        </option>
                                      );
                                    })}
                                </select>
                              </label>
                            ) : null}
                            {multi && twinOf[id] ? (
                              <small className="text-[11px] text-muted-foreground">
                                Mesmo imóvel físico: usa o proprietário do anúncio principal.
                              </small>
                            ) : (
                            <OwnerPicker
                              row
                              value={ownerOf(id)}
                              owners={(owners.data?.rows ?? []) as OwnerRow[]}
                              missing={!ownerOf(id)}
                              onChange={(oid) =>
                                multi
                                  ? setPairOwners((c) => ({ ...c, [id]: oid }))
                                  : setOwnerId(oid)
                              }
                              onCreate={() => {
                                setCreateFor(multi ? id : null);
                                setFormOpen(true);
                              }}
                            />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCreateFor(multi ? (picked.find((id) => !pairOwners[id]) ?? null) : null);
                        setFormOpen(true);
                      }}
                      className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-bold text-accent"
                    >
                      <Plus className="size-3.5" />
                      Cadastrar novo proprietário
                    </button>
                    <div
                      className={`rounded-[12px] px-[13px] py-3 text-[12px] leading-[1.5] ${
                        ready
                          ? "bg-[color-mix(in_oklab,#7fb79a_9%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,#7fb79a_28%,transparent)]"
                          : "bg-[color-mix(in_oklab,#c9a24a_9%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,#c9a24a_32%,transparent)]"
                      }`}
                    >
                      {ready ? (
                        "Pronto para importar. Todos os imóveis têm proprietário vinculado em sistema."
                      ) : (
                        <>
                          Importação bloqueada. Vincule os{" "}
                          <b className="font-bold text-foreground">{n} imóveis</b> a um proprietário
                          cadastrado no Concierge.
                        </>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
                      <span className="font-bold text-foreground/85">
                        {linked} de {n} vinculados
                      </span>
                      <span>{ready ? "Tudo certo" : "Falta vincular"}</span>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)] gap-2 pt-1">
                      <PrimaryBtn disabled={!ready} onClick={doImport}>
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
                );
              })()}
            </>
          ) : null}

          {/* ---------- Sincronizar imóvel existente: escolher o anúncio ---------- */}
          {step === "syncPick" && syncProp ? (
            <>
              <ListHeader
                title="Sincronizar com o Airbnb"
                description="Escolha o anúncio que é este imóvel. O proprietário(a) continua o mesmo."
              />
              {syncChip}
              <SearchBox value={q} onChange={setQ} placeholder="Buscar anúncio…" />
              <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
                <span className="font-bold text-foreground/85">
                  {plural(freeListings.length, "anúncio disponível", "anúncios disponíveis")}
                </span>
                <span className="flex min-w-0 items-center gap-1">
                  <span className="truncate">{account?.title ?? "Conta do Airbnb"}</span>
                  {activeAccounts.length > 1 ? (
                    <>
                      <span>·</span>
                      <button
                        type="button"
                        onClick={() => setStep("pickAccount")}
                        className="shrink-0 font-bold text-accent"
                      >
                        Trocar
                      </button>
                    </>
                  ) : null}
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                {inv.isLoading ? (
                  <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                    Buscando anúncios no Airbnb…
                  </p>
                ) : inv.isError ? (
                  <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                    Não foi possível consultar o Airbnb agora. Tente de novo em instantes.
                  </p>
                ) : null}
                {freeListings.map((l) => {
                  const on = syncListing === l.listingId;
                  return (
                    <button
                      key={l.listingId}
                      type="button"
                      data-clip-row
                      onClick={() => setSyncListing(l.listingId)}
                      className={rowCls(on ? "on" : "off")}
                    >
                      <Radio on={on} />
                      <span className="grid size-[46px] shrink-0 place-items-center rounded-[11px] bg-foreground/[0.05] text-muted-foreground">
                        <Home className="size-[18px]" />
                      </span>
                      <span className="grid min-w-0 flex-1 gap-[3px]">
                        <ClampName
                          as="b"
                          text={l.title}
                          passThrough
                          className="text-[13px] font-bold"
                        />
                        {l.city ? (
                          <small className="truncate text-[11px] text-muted-foreground">
                            {l.city}
                          </small>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2 pt-1">
                <PrimaryBtn disabled={!syncListing} onClick={() => setStep("syncConfirm")}>
                  <ArrowRight className="size-4" />
                  Continuar
                </PrimaryBtn>
                <SecondaryBtn onClick={close}>Cancelar</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Sincronizar imóvel existente: confirmar o par ---------- */}
          {step === "syncConfirm" && syncProp && chosenSync ? (
            <>
              <ListHeader
                title="Confirmar sincronização"
                description="Confira o par antes de sincronizar."
              />
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                <div
                  className={`grid min-w-0 gap-1 rounded-[12px] bg-foreground/[0.04] px-3 py-2.5 ${INSET}`}
                >
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    Imóvel no sistema
                  </span>
                  <ClampName as="b" text={syncProp.name} className="text-[12.5px] font-bold" />
                  {syncProp.ownerName ? (
                    <small className="flex items-center gap-[5px] text-[11px] text-muted-foreground">
                      Proprietário(a):{" "}
                      <b className="truncate font-semibold text-foreground">{syncProp.ownerName}</b>
                      <PhoneActionButton
                        phone={syncProp.ownerPhone}
                        country={syncProp.ownerPhoneCountry}
                        size={11}
                        alwaysShow
                        className="shrink-0 !p-0"
                      />
                    </small>
                  ) : null}
                </div>
                <ArrowRight className="mx-auto size-4 rotate-90 text-muted-foreground" />
                <div
                  className={`grid min-w-0 gap-1 rounded-[12px] bg-foreground/[0.04] px-3 py-2.5 ${INSET}`}
                >
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    Anúncio no Airbnb
                  </span>
                  <ClampName as="b" text={chosenSync.title} className="text-[12.5px] font-bold" />
                  {chosenSync.city ? (
                    <small className="truncate text-[11px] text-muted-foreground">
                      {chosenSync.city}
                    </small>
                  ) : null}
                </div>
              </div>
              <AttentionBox>
                Os dados do anúncio (descrição, comodidades, regras) passam a ser lidos do Airbnb e
                ficam bloqueados aqui.
              </AttentionBox>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                <PrimaryBtn onClick={() => void doSyncProperty()}>
                  <RefreshCw className="size-4" />
                  Sincronizar imóvel
                </PrimaryBtn>
                <SecondaryBtn onClick={() => setStep("syncPick")}>Voltar</SecondaryBtn>
              </div>
            </>
          ) : null}

          {step === "syncing" ? (
            <>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                <IconBox kind="ok">
                  <RefreshCw className="size-[22px] animate-spin" />
                </IconBox>
                <Title>Sincronizando imóvel</Title>
                <Desc>
                  Lendo o anúncio no Airbnb e ligando o chat. Pode levar alguns instantes.
                </Desc>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-[#7c1ad8] to-[#e82dae]" />
              </div>
            </>
          ) : null}

          {step === "syncDone" && syncRes && syncProp ? (
            <>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                <IconBox kind={syncRes.pending.length === 0 ? "ok" : "falta"}>
                  {syncRes.pending.length === 0 ? (
                    <Check className="size-[22px]" />
                  ) : (
                    <TriangleAlert className="size-[22px]" />
                  )}
                </IconBox>
                <Title>Imóvel sincronizado</Title>
                <Desc>
                  <b className="font-bold text-foreground">{syncProp.name}</b> agora lê os dados
                  direto do Airbnb.
                  {syncRes.pending.length === 0 ? "" : " Mas ainda não está totalmente ativo."}
                </Desc>
              </div>
              {syncRes.pending.length === 0 ? (
                <InfoBox kind="ok" lines={[[Check, "Anúncio ligado e chat ativo"]]} />
              ) : (
                <InfoBox
                  kind="falta"
                  lines={syncRes.pending.map(
                    (p) =>
                      [
                        TriangleAlert,
                        p.kind === "chat"
                          ? "Chat pendente de ativação"
                          : "Pendente de configuração na Channex",
                      ] as [typeof Check, string],
                  )}
                />
              )}
              {syncRes.channexPropertyId ? (
                <div className="grid gap-1.5 rounded-[12px] bg-foreground/[0.03] p-2.5 text-[12px] leading-[1.5] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]">
                  <span className="text-muted-foreground">
                    Para importar este anúncio na sua ferramenta de precificação, conecte-a à
                    Channex e use o código do imóvel abaixo. O calendário do Airbnb continua livre.
                  </span>
                  <div className="flex min-w-0 items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-[8px] bg-background px-2 py-1.5 text-[11.5px]">
                      {syncRes.channexPropertyId}
                    </code>
                    <button
                      type="button"
                      aria-label="Copiar"
                      className="grid size-8 shrink-0 place-items-center rounded-[8px] shadow-[inset_0_0_0_1px_var(--border)]"
                      onClick={() => {
                        void navigator.clipboard?.writeText(syncRes.channexPropertyId ?? "");
                        toast.success("Código copiado");
                      }}
                    >
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                <PrimaryBtn onClick={close}>Concluir</PrimaryBtn>
              </div>
            </>
          ) : null}

          {step === "syncEmpty" ? (
            <>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                <IconBox kind="neutral">
                  <Home className="size-5" />
                </IconBox>
                <Title>Nenhum anúncio disponível</Title>
                <Desc>
                  {account
                    ? "Todos os anúncios desta conta já estão vinculados a um imóvel."
                    : "Não há conta do Airbnb conectada e ativa."}{" "}
                  Conecte outra conta do Airbnb para ver mais anúncios.
                </Desc>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                <SecondaryBtn onClick={close}>Fechar</SecondaryBtn>
              </div>
            </>
          ) : null}

          {/* ---------- Em massa: vincular anúncios (mockups J1–J4 aprovados, 14/10/2026) ----------
              Título e botões fixos; só a lista rola. Textos mínimos. */}
          {step === "bulkPairs" ? (
            <>
              <div className="grid shrink-0 grid-cols-[minmax(0,1fr)] gap-2.5 px-4 pb-2.5 pt-4">
                <div className="grid grid-cols-[minmax(0,1fr)] gap-1 pr-11">
                  <DialogTitle className="truncate font-display text-[18px] font-extrabold leading-[1.2] tracking-[-0.01em]">
                    Vincular anúncios
                  </DialogTitle>
                  <DialogDescription className="truncate text-[12.5px] leading-[1.5]">
                    Escolha o anúncio de cada imóvel.
                  </DialogDescription>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <b className="min-w-0 truncate text-[12.5px] font-extrabold">
                    {bulkPairsN} de {bulkRowsN} escolhidos
                    {bulkRowsN - bulkPairsN > 0 ? (
                      <span className="ml-2 font-semibold text-muted-foreground">
                        Faltam {bulkRowsN - bulkPairsN}
                      </span>
                    ) : null}
                  </b>
                  <button
                    type="button"
                    className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--win-radius)] bg-foreground/[0.05] px-3 text-[12px] font-bold text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]"
                    onClick={() => {
                      const free = bulkFree.filter(
                        (l) => !Object.values(propListing).includes(l.listingId),
                      );
                      const todo = bulkProps.filter((p) => !propListing[p.id]);
                      const sug = suggestPairs(todo, free);
                      if (Object.keys(sug).length === 0)
                        toast.info("Não achei nomes parecidos. Escolha na mão.");
                      else {
                        setPropListing((c) => ({ ...c, ...sug }));
                        setSugIds((c) => new Set([...c, ...Object.keys(sug)]));
                      }
                    }}
                  >
                    <Sparkles className="size-3.5" />
                    Sugerir
                  </button>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#7c1ad8] to-[#e82dae] transition-all"
                    style={{
                      width: `${bulkRowsN > 0 ? Math.round((100 * bulkPairsN) / bulkRowsN) : 0}%`,
                    }}
                  />
                </div>
              </div>
              <div className="sg-elegant-scroll grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-2 overflow-y-auto overscroll-contain border-t border-border/50 px-4 pb-3 pt-2.5">
                {expiredAccounts.length > 0 ? (
                  <p className="text-[11.5px] leading-snug ds-atencao">
                    {expiredAccounts.length === 1
                      ? `Reconecte a conta ${expiredAccounts[0].title}.`
                      : "Há contas para reconectar."}
                  </p>
                ) : null}
                {inv.isLoading || owners.isLoading ? (
                  <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                    Buscando anúncios…
                  </p>
                ) : inv.isError ? (
                  <div className="flex items-center gap-2 rounded-[10px] bg-foreground/[0.04] px-3 py-2 text-[12px]">
                    <span className="min-w-0 flex-1 ds-atencao">
                      Não consegui consultar o Airbnb.
                    </span>
                    <button
                      type="button"
                      onClick={() => void inv.refetch()}
                      className="shrink-0 font-extrabold text-foreground"
                    >
                      Tentar de novo
                    </button>
                  </div>
                ) : null}
                {inv.data
                  ? bulkProps.map((p) => {
                      const chosen = propListing[p.id] ?? null;
                      const l = bulkFree.find((x) => x.listingId === chosen);
                      return (
                        <div
                          key={p.id}
                          data-clip-row
                          className={`grid min-w-0 gap-2 rounded-[14px] bg-foreground/[0.03] p-2.5 ${INSET}`}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <ClampName
                              as="b"
                              text={p.name}
                              className="min-w-0 flex-1 text-[13px] font-bold"
                            />
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  aria-label="Mais ações"
                                  className="-mr-1 grid size-7 shrink-0 place-items-center rounded-[8px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                                >
                                  <MoreHorizontal className="size-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-[230px] p-1.5">
                                <DropdownMenuItem
                                  onSelect={() => void dismissProp(p.id, true)}
                                  className="items-start gap-2.5 px-2.5 py-2"
                                >
                                  <X className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                                  <span className="grid gap-0.5">
                                    <b className="text-[12.5px] font-bold">Não sincronizar</b>
                                    <small className="text-[11px] leading-snug text-muted-foreground">
                                      Sai do aviso. Dá para desfazer.
                                    </small>
                                  </span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          {p.ownerName ? (
                            <small className="flex min-w-0 items-center gap-[5px] text-[11.5px] text-muted-foreground">
                              <span className="shrink-0">Proprietário(a):</span>
                              <b className="truncate font-semibold text-foreground">
                                {p.ownerName}
                              </b>
                              <PhoneActionButton
                                phone={p.ownerPhone}
                                country={p.ownerPhoneCountry}
                                size={11}
                                alwaysShow
                                className="shrink-0 !p-0"
                              />
                            </small>
                          ) : null}
                          <PairPicker
                            value={chosen}
                            valueLabel={l?.title ?? null}
                            valueAccount={l ? accTag(l.channelId) : null}
                            placeholder={
                              bulkFree.length === 0 ? "Sem anúncio livre" : "Escolher anúncio…"
                            }
                            searchPlaceholder="Buscar anúncio…"
                            options={bulkFree.map((x) => {
                              const by = Object.entries(propListing).find(
                                ([pid, lid]) => lid === x.listingId && pid !== p.id,
                              );
                              return {
                                id: x.listingId,
                                title: x.title,
                                sub: x.city,
                                account: accTag(x.channelId),
                                note: by ? "Já escolhido em outra linha" : undefined,
                              };
                            })}
                            onChange={(lid) => {
                              setPropListing((c) => ({ ...c, [p.id]: lid }));
                              setSugIds((c) => {
                                const next = new Set(c);
                                next.delete(p.id);
                                return next;
                              });
                              setLooseNew((c) => {
                                const { [lid]: _drop, ...rest } = c;
                                void _drop;
                                return rest;
                              });
                            }}
                          />
                          {chosen && sugIds.has(p.id) ? (
                            <span className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-[0.04em] text-accent">
                              <Sparkles className="size-2.5" />
                              Sugerido
                            </span>
                          ) : null}
                        </div>
                      );
                    })
                  : null}
                {inv.data && bulkLoose.length > 0 ? (
                  <div className="flex items-center justify-between pt-1 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground/80">
                    <span>
                      {bulkLoose.length === 1 ? "Anúncio sem imóvel" : "Anúncios sem imóvel"}
                    </span>
                    <span className="font-semibold normal-case tracking-normal">
                      {bulkLoose.length}
                    </span>
                  </div>
                ) : null}
                {inv.data
                  ? bulkLoose.map((l) => {
                      const isNew = looseIsNew(l.listingId);
                      const tag = accTag(l.channelId);
                      return (
                        <div
                          key={l.listingId}
                          data-clip-row
                          className={`grid min-w-0 gap-2 rounded-[14px] p-2.5 ${INSET} ${
                            isNew && !looseOwner(l.listingId)
                              ? "bg-[color-mix(in_oklab,#c98c8c_7%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,#c98c8c_40%,transparent)]"
                              : "bg-foreground/[0.03]"
                          }`}
                        >
                          <b className="min-w-0 truncate text-[13px] font-bold leading-[1.3]" title={l.title}>
                            {l.title}
                          </b>
                          {l.city || tag ? (
                            <div className="flex min-w-0 items-end justify-between gap-2">
                              <small className="min-w-0 text-[11.5px] text-muted-foreground">
                                {l.city}
                              </small>
                              {tag ? (
                                <span className="flex max-w-[140px] shrink-0">
                                  <AccountTag name={tag.name} idx={tag.idx} />
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                          <OwnerPicker
                            value={looseOwner(l.listingId) || null}
                            owners={(owners.data?.rows ?? []) as OwnerRow[]}
                            missing={!looseOwner(l.listingId)}
                            onChange={(oid) => setLooseNew((c) => ({ ...c, [l.listingId]: oid }))}
                            onCreate={() => {
                              setCreateFor(`loose:${l.listingId}`);
                              setFormOpen(true);
                            }}
                          />
                        </div>
                      );
                    })
                  : null}
                {bulkDismissed.length > 0 ? (
                  <div className="pt-1 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground/80">
                    Não sincronizar
                  </div>
                ) : null}
                {bulkDismissed.map((p) => (
                  <div
                    key={p.id}
                    data-clip-row
                    className={`flex min-w-0 items-center gap-2.5 rounded-[14px] bg-foreground/[0.02] p-2.5 opacity-85 ${INSET}`}
                  >
                    <ClampName
                      as="b"
                      text={p.name}
                      className="min-w-0 flex-1 text-[12.5px] font-bold"
                    />
                    <button
                      type="button"
                      onClick={() => void dismissProp(p.id, false)}
                      className="shrink-0 text-[12px] font-extrabold text-accent"
                    >
                      Desfazer
                    </button>
                  </div>
                ))}
              </div>
              <div className="grid shrink-0 grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-2 border-t border-border/50 px-4 pb-4 pt-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={close}
                  className="flex h-10 min-w-0 items-center justify-center rounded-[var(--win-radius)] bg-foreground/[0.04] text-[12.5px] font-bold text-foreground/85 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_12%,transparent)]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={bulkPairsN === 0}
                  onClick={startBulk}
                  className="flex h-10 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--win-radius)] bg-gradient-to-br from-[#7c1ad8] to-[#e82dae] px-1.5 text-[12.5px] font-extrabold text-white disabled:opacity-40 sm:text-[13.5px]"
                >
                  <RefreshCw className="size-3.5 shrink-0 sm:size-4" />
                  <span className="min-w-0 truncate">
                    {bulkPairsN === 0
                      ? "Escolha ao menos 1"
                      : `Sincronizar ${plural(bulkPairsN, "imóvel", "imóveis")}`}
                  </span>
                </button>
              </div>
            </>
          ) : null}

          {step === "bulkRunning" || step === "bulkDone" ? (
            <>
              {(() => {
                const done = bulkJobs.filter((j) => j.status === "ok").length;
                const failed = bulkJobs.filter((j) => j.status === "err").length;
                const total = bulkJobs.length;
                const running = step === "bulkRunning";
                const pendIds = new Set(
                  bulkJobs.flatMap((j) => j.pending.map((x) => x.propertyId)),
                );
                return (
                  <>
                    {running ? (
                      <>
                        <Title>Sincronizando…</Title>
                        <Desc>Não feche esta janela. Cada imóvel é ligado ao anúncio dele.</Desc>
                        <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
                          <b className="font-bold text-foreground/85">
                            {done + failed} de {total} concluídos
                          </b>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#7c1ad8] to-[#e82dae] transition-[width]"
                            style={{
                              width: `${Math.round((100 * (done + failed)) / (total || 1))}%`,
                            }}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                          <IconBox kind={failed === 0 ? "ok" : "neutral"}>
                            {failed === 0 ? (
                              <Check className="size-[22px]" />
                            ) : (
                              <RefreshCw className="size-[22px]" />
                            )}
                          </IconBox>
                          <Title>
                            {done} de {total} sincronizados
                          </Title>
                          <Desc>
                            {failed > 0
                              ? failed === 1
                                ? "Um imóvel não foi sincronizado. Veja em Pendências."
                                : `${failed} imóveis não foram sincronizados. Veja em Pendências.`
                              : "Reservas e mensagens passam a chegar sozinhas."}
                          </Desc>
                        </div>
                      </>
                    )}
                    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                      {bulkJobs.map((j) => (
                        <div
                          key={j.key}
                          data-clip-row
                          className={`flex items-start gap-2.5 rounded-[14px] px-3 py-2.5 ${INSET} ${
                            j.status === "err"
                              ? "bg-[color-mix(in_oklab,#c98c8c_7%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,#c98c8c_40%,transparent)]"
                              : j.status === "wait"
                                ? "bg-foreground/[0.025]"
                                : "bg-foreground/[0.03]"
                          }`}
                        >
                          <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
                            {j.status === "ok" ? (
                              <Check className="size-4 ds-ok" strokeWidth={2.6} />
                            ) : j.status === "err" ? (
                              <X className="size-4 ds-falta" strokeWidth={2.6} />
                            ) : j.status === "run" ? (
                              <Loader2 className="size-3.5 animate-spin text-accent" />
                            ) : (
                              <span className="size-3.5 rounded-full shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_20%,transparent)]" />
                            )}
                          </span>
                          <span className="grid min-w-0 flex-1 gap-0.5">
                            <ClampName as="b" text={j.label} className="text-[12.5px] font-bold" />
                            {j.account ? (
                              <small className="truncate text-[10.5px] text-muted-foreground">
                                {j.account}
                              </small>
                            ) : null}
                            {j.status === "err" ? (
                              <small className="text-[11px] text-muted-foreground">{j.error}</small>
                            ) : null}
                          </span>
                        </div>
                      ))}
                    </div>
                    {!running && pendIds.size > 0 ? (
                      <AttentionBox>
                        {plural(pendIds.size, "imóvel sincronizado", "imóveis sincronizados")} ainda{" "}
                        {pendIds.size === 1 ? "precisa" : "precisam"} de ajuste (chat ou tarifa no
                        Airbnb). Veja em Pendências.
                      </AttentionBox>
                    ) : null}
                    {!running ? (
                      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
                        {failed > 0 ? (
                          <>
                            <PrimaryBtn onClick={() => void runBulk(bulkJobs)}>
                              <RefreshCw className="size-4" />
                              Tentar o que faltou
                            </PrimaryBtn>
                            <SecondaryBtn onClick={close}>Fechar</SecondaryBtn>
                          </>
                        ) : (
                          <PrimaryBtn onClick={close}>Concluir</PrimaryBtn>
                        )}
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </>
          ) : null}

          {/* ---------- Importando ---------- */}
          {step === "importing" ? (
            <>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                <IconBox kind="ok">
                  <RefreshCw className="size-[22px] animate-spin" />
                </IconBox>
                <Title>Importando anúncios</Title>
                <Desc>
                  Vinculando{" "}
                  <b className="font-bold text-foreground">{plural(n, "anúncio", "anúncios")}</b> a{" "}
                  <b className="font-bold text-foreground">
                    {n > 1
                      ? "seus proprietários"
                      : chosenOwner
                        ? ownerName(chosenOwner)
                        : "proprietário"}
                  </b>
                  . Pode levar alguns instantes. Por favor, aguarde!
                </Desc>
              </div>
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
                const ownerLabel =
                  n > 1
                    ? "seus proprietários"
                    : chosenOwner
                      ? ownerName(chosenOwner)
                      : "proprietário";
                return (
                  <>
                    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
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
                    </div>
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
                                `${p.title}: ${p.kind === "chat" ? "chat da plataforma ainda pendente de ativação" : "pendente de configuração na Channex"}`,
                              ] as [typeof Check, string],
                          ),
                        ]}
                      />
                    ) : null}
                    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
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
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
                <IconBox kind="falta">
                  <TriangleAlert className="size-[22px]" />
                </IconBox>
                <Title>Desconectar conta</Title>
              </div>
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
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
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
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
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
                      {plural(disc.chatFailures, "imóvel", "imóveis")}. Confira o app de mensagens
                      no painel da Channex.
                    </>
                  )}
                </Desc>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
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
        onOpenChange={(o) => {
          setFormOpen(o);
          if (!o) setCreateFor(null);
        }}
        initial={emptyStakeholderForm}
        accountOwnerId={accountOwnerId}
        newLayout
        onSaved={(id) => {
          qc.invalidateQueries({ queryKey: ["stakeholders"] });
          qc.invalidateQueries({ queryKey: ["property-owners-count"] });
          if (createFor?.startsWith("loose:"))
            setLooseNew((c) => ({ ...c, [createFor.slice(6)]: id }));
          else if (createFor) setPairOwners((c) => ({ ...c, [createFor]: id }));
          else setOwnerId(id);
          setCreateFor(null);
          setFormOpen(false);
        }}
      />
    </>
  );
}
