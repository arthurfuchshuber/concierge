import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUpDown,
  Building2,
  Car,
  Check,
  Copy,
  Info,
  Layers,
  Eye,
  EyeOff,
  Fence,
  KeyRound,
  ListOrdered,
  Lock,
  Play,
  RotateCw,
  Send,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { OVERLAY_COLLISION_PADDING } from "@/components/ui/overlay-collision";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  FILTER_PANEL_CLASS_ELEVATED,
  FILTER_PANEL_COLLISION,
  FILTER_PANEL_OFFSET,
  FilterMenuRow,
  FilterScreenHeader,
  FilterSection,
} from "@/components/dashboard/filter-panel";
import { CARD_OWNER, CARD_PROPERTY, ownerLabel } from "@/components/dashboard/card-colors";
import { PropertyMapsButton, propertyMapsHref } from "@/components/dashboard/PropertyMapsButton";
import { useCleaningBoard } from "@/components/dashboard/CleaningProviderAvatar";
import {
  getPropertyAccessInfo,
  type AccessMedia,
  type PropertyAccessInfo,
} from "@/lib/property-access.functions";
import { useImpersonation } from "@/hooks/useImpersonation";
import { toWhatsappNumber } from "@/lib/masks";
import { tokenizeAll } from "@/lib/guide-tags";
import {
  complementItems,
  complementMessageLines,
  type ComplementKind,
} from "@/lib/property-location";
import { cn } from "@/lib/utils";

/**
 * CHAVE DE ACESSO NO CARD "EM LIMPEZA" (mockup "Chave de acesso no card de
 * limpeza · v2", aprovado 30/09/2026 — "eu quero o ícone da chave + 1 tooltip
 * estilo da opção C").
 *
 * Por que é assim:
 *  · A chave fica AO LADO do pino do Maps, nunca no lugar dele: a regra de
 *    23/09/2026 diz que o botão do Maps é sempre o mesmo, em todo lugar.
 *  · O quadrante é o mesmo do editor de Previsão do card: casca Grafite
 *    Quente (`FILTER_PANEL_CLASS_ELEVATED`, 300px), 16px de folga lateral
 *    (`FILTER_PANEL_COLLISION`) e 8px do botão. Véu com desfoque, limite de
 *    75% da altura, abrir para o lado oposto quando não cabe e "clicar fora
 *    só fecha a janela do topo" vêm do `PopoverContent` base — pedido do
 *    cliente nesta entrega: "TODO E QUALQUER AJUSTE EM LAYOUT precisa seguir
 *    as regras que já implantamos, anti corte, clique ao fundo retorna à
 *    página anterior, desfoque".
 *  · "Clique ao fundo retorna à página anterior": com a tela interna "Passo a
 *    passo" aberta, tocar fora VOLTA para "Acesso" em vez de fechar — mesmo
 *    padrão do editor de Previsão (`onOpenChange` intercepta o fechamento).
 *  · O quadrante mostra o nome do anúncio, então leva "Proprietário: <primeiro
 *    nome>" e o MESMO botão do Maps (`PropertyMapsButton`).
 *  · Senhas começam DESFOCADAS; "Mostrar" revela todas, e elas voltam a ficar
 *    ocultas sempre que o quadrante fecha. Copiar funciona oculto ou não.
 *  · Os códigos não vêm na lista do quadro: só são buscados ao abrir, por
 *    `getPropertyAccessInfo` (regra "senha só sai do servidor com prova").
 *  · "Enviar à <prestador>" abre o WhatsApp com tudo pronto para quem está no
 *    quadrado da limpeza. Sem prestador (ou sem telefone), vira "Enviar pelo
 *    WhatsApp" e a pessoa escolhe o contato.
 */

/** Prazo para o acesso responder antes de virar aviso (ver a consulta abaixo). */
const ACCESS_TIMEOUT_MS = 15_000;

type Row = {
  propertyId: string;
  propertyName: string | null;
  ownerName: string | null;
  propertyAddress: string | null;
  mapsUrl: string | null;
  garageMapsUrl: string | null;
  logId: string;
  reservationId: string | null;
};

/** Mesmo cálculo de `CleaningProviderAvatar`: pontual da limpeza > padrão do imóvel. */
function useCurrentProvider(row: Row) {
  const board = useCleaningBoard();
  const b = board.data;
  const realLog = /^[0-9a-f-]{36}$/i.test(row.logId) ? row.logId : null;
  const resId = row.reservationId ?? (row.logId.startsWith("ical:") ? row.logId.slice(5) : null);
  const manualId = row.logId.startsWith("manual:") ? row.logId.slice(7) : null;
  const assignedId =
    (manualId && b?.assigned[`s:${manualId}`]) ||
    (resId && b?.assigned[`r:${resId}`]) ||
    (realLog && b?.assigned[`l:${realLog}`]) ||
    null;
  const currentId = assignedId ?? b?.defaults[row.propertyId] ?? null;
  return b?.providers.find((p) => p.id === currentId) ?? null;
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** "Uma etapa por linha" (mesma regra do cadastro) — sem numeração repetida. */
function splitSteps(text: string | null): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(\d+[.)-]|[-•*])\s*/, "").trim())
    .filter(Boolean);
}

function buildMessage(row: Row, info: PropertyAccessInfo): string {
  const lines: string[] = [`🧹 Limpeza · ${row.propertyName ?? "Imóvel"}`];
  const maps = propertyMapsHref(row);
  if (row.propertyAddress || maps) {
    lines.push("");
    if (row.propertyAddress) lines.push(`📍 ${row.propertyAddress}`);
    // "Local dentro do prédio" (01/10/2026): apto/andar/elevador e vagas.
    lines.push(...complementMessageLines(info.complement));
    if (maps) lines.push(maps);
  }
  const access: string[] = [];
  if (info.gateCode) access.push(`🚪 Portão: ${info.gateCode}`);
  if (info.lockCode) access.push(`🔒 Fechadura: ${info.lockCode}`);
  if (info.wifiSsid || info.wifiPassword) {
    access.push(
      `📶 Wi-Fi: ${[info.wifiSsid, info.wifiPassword ? `senha ${info.wifiPassword}` : null].filter(Boolean).join(" · ")}`,
    );
  }
  if (access.length) lines.push("", ...access);
  return lines.join("\n");
}

async function copy(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(ok);
    return true;
  } catch {
    toast.error("Não foi possível copiar.");
    return false;
  }
}

/** Chip copiável do quadrante (estilo opção C do mockup). */
function AccessChip({
  icon: Icon,
  label,
  value,
  secret,
  revealed,
  copied,
  onCopy,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  secret?: boolean;
  revealed: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  const hidden = secret && !revealed;
  return (
    <button
      type="button"
      onClick={onCopy}
      title={`Copiar ${label.toLowerCase()}`}
      className={`relative flex min-w-0 flex-col gap-[3px] rounded-[10px] px-2.5 py-2 text-left transition-colors ${
        copied
          ? "bg-accent/[0.12] ring-1 ring-inset ring-accent/60"
          : "bg-[var(--panel-well)] hover:bg-foreground/[0.07]"
      }`}
    >
      <span className="flex items-center gap-[5px] pr-4 text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
        <Icon className="size-3 shrink-0" strokeWidth={2} />
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <span
        className={`min-w-0 truncate text-[13px] font-bold text-foreground ${secret ? "font-mono tracking-[0.06em]" : ""} ${
          hidden ? "select-none blur-[5px]" : ""
        }`}
        aria-hidden={hidden || undefined}
      >
        {value}
      </span>
      <span className={`absolute right-2 top-2 ${copied ? "text-accent" : "text-foreground/35"}`}>
        {copied ? <Check className="size-3" strokeWidth={3} /> : <Copy className="size-3" />}
      </span>
    </button>
  );
}

/** Caixa do código na tela "Passo a passo". */
function CodeBox({
  icon: Icon,
  value,
  revealed,
  onCopy,
}: {
  icon: LucideIcon;
  value: string;
  revealed: boolean;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      title="Copiar código"
      className="mx-3.5 mb-3 flex w-[calc(100%-1.75rem)] items-center gap-2.5 rounded-[10px] bg-[var(--panel-well)] px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.07]"
    >
      <Icon className="size-[15px] shrink-0 text-muted-foreground" strokeWidth={2} />
      <span
        className={`min-w-0 truncate font-mono text-[18px] font-bold tracking-[0.06em] text-foreground ${
          revealed ? "" : "select-none blur-[5px]"
        }`}
      >
        {value}
      </span>
      <Copy className="ml-auto size-3 shrink-0 text-foreground/35" />
    </button>
  );
}

/** Ícone de cada item do complemento (mesmos do mockup "Local dentro do prédio"). */
const COMPLEMENT_ICON: Record<ComplementKind, LucideIcon> = {
  apartment: Building2,
  floor: Layers,
  spots: Car,
  elevator: ArrowUpDown,
};

/** Linha de complemento sob o endereço (Opção 1 aprovada em 01/10/2026). */
function ComplementLine({ items }: { items: { kind: ComplementKind; text: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] font-bold text-foreground">
      {items.map((it) => {
        const Icon = COMPLEMENT_ICON[it.kind];
        return (
          <span key={it.kind} className="inline-flex items-center gap-1">
            <Icon className="size-3 shrink-0 text-muted-foreground" strokeWidth={2} />
            {it.text}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Texto de uma etapa de chegada: as tags `[[tag:senhas-acesso]]` viram um chip
 * (que leva à aba do código) e `[[info:...]]` sem valor conhecido aqui mostra só
 * o rótulo — o texto cru com colchetes nunca aparece.
 */
function StepText({ text, onTag }: { text: string; onTag?: () => void }) {
  return (
    <>
      {tokenizeAll(text).map((t, i) => {
        if (t.kind === "text") return <span key={i}>{t.value}</span>;
        if (t.kind === "tag") {
          return (
            <button
              key={i}
              type="button"
              onClick={onTag}
              disabled={!onTag}
              className="mx-0.5 inline-flex h-[19px] items-center gap-1 whitespace-nowrap rounded-full bg-foreground/[0.08] px-[7px] align-[1px] text-[11px] font-bold text-foreground shadow-[inset_0_0_0_1px_rgba(246,243,239,.1)]"
            >
              <Fence className="size-[11px] text-muted-foreground" strokeWidth={2} />
              {t.label}
            </button>
          );
        }
        return t.label ? <span key={i}>{t.label}</span> : null;
      })}
    </>
  );
}

/** Etapas numeradas com linha de ligação; `finish` marca a última com "check". */
function Timeline({
  steps,
  finish,
  onTag,
}: {
  steps: string[];
  finish?: boolean;
  onTag?: () => void;
}) {
  if (steps.length === 0) return null;
  return (
    <ol className="flex flex-col px-3.5 pb-1.5 pt-0.5">
      {steps.map((st, i) => {
        const last = i === steps.length - 1;
        const done = finish && last;
        return (
          <li
            key={i}
            className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-2.5 pb-3 text-[12.5px] leading-[1.45] text-foreground"
          >
            {!last && (
              <span
                aria-hidden
                className="absolute bottom-0.5 left-[10.5px] top-6 w-px bg-[var(--panel-div)]"
              />
            )}
            <span
              className={cn(
                "relative z-[1] grid size-[22px] place-items-center rounded-full text-[10.5px] font-extrabold",
                done ? "bg-[rgba(127,183,154,.16)] text-[#7fb79a]" : "bg-accent/[0.14] text-accent",
              )}
            >
              {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
            </span>
            <p className="m-0 min-w-0 break-words pt-0.5">
              <StepText text={st} onTag={onTag} />
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** Vídeo tutorial (link) e fotos/vídeos do passo a passo — os mesmos do guia. */
function AccessExtras({ videoUrl, media }: { videoUrl: string | null; media: AccessMedia[] }) {
  if (!videoUrl && media.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 px-3.5 pb-3.5">
      {videoUrl && (
        <a
          href={videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 self-start rounded-[10px] bg-foreground/[0.06] px-2.5 text-[12px] font-bold text-foreground transition-colors hover:bg-foreground/[0.1]"
        >
          <Play className="size-3 shrink-0" />
          Abrir vídeo tutorial
        </a>
      )}
      {media.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          {media.map((m, i) => (
            <a
              key={i}
              href={m.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Ampliar mídia"
              className="relative block aspect-square overflow-hidden rounded-[10px] bg-[var(--panel-well)]"
            >
              {m.type === "video" ? (
                <>
                  <video
                    src={m.url}
                    muted
                    preload="metadata"
                    className="pointer-events-none size-full object-cover"
                  />
                  <span className="absolute inset-0 grid place-items-center bg-black/30 text-white">
                    <Play className="size-4" />
                  </span>
                </>
              ) : (
                <img src={m.url} alt="" loading="lazy" className="size-full object-cover" />
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function PropertyAccessButton({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"root" | "steps">("root");
  const [stepsTab, setStepsTab] = useState<"arrival" | "gate" | "lock">("arrival");
  // Lado de abertura: o que tem MAIS espaço livre (já descontando o cabeçalho
  // e a barra fixa). O Radix só vira quando não cabe, e como o painel encolhe
  // para caber (altura máxima), ele nunca "não cabia" — ficava embaixo, cortado
  // e com rolagem. Escolhendo o lado maior, o painel abre inteiro sempre que
  // couber em algum dos dois (pedido de 01/10/2026).
  const [side, setSide] = useState<"bottom" | "top">("bottom");
  const [revealed, setRevealed] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const ownerId = useImpersonation().impersonation?.userId ?? null;
  const provider = useCurrentProvider(row);
  const fetchFn = useServerFn(getPropertyAccessInfo);
  const q = useQuery({
    queryKey: ["property-access", row.propertyId, ownerId, provider?.id ?? null],
    // O QUADRANTE NUNCA FICA PRESO NO "CARREGANDO" (correção de 02/10/2026,
    // print do cliente: a janela "Acesso" aberta no celular só com os quatro
    // blocos cinzas, sem código nenhum e sem aviso). Esta é a única consulta
    // do quadro que NÃO tem cópia guardada no aparelho (senha não é gravada),
    // então, quando o pedido não sai ou não volta, não há nada para mostrar no
    // lugar — e a tela ficava no esqueleto para sempre. Três travas:
    //  · prazo de 15 s: passou disso, vira erro com aviso, em vez de esperar
    //    indefinidamente;
    //  · `networkMode: "always"`: o pedido é disparado mesmo quando o
    //    navegador ACHA que está sem internet (no app instalado no iPhone esse
    //    aviso às vezes fica preso depois de voltar do segundo plano, e a
    //    consulta ficava em pausa, sem nunca tentar);
    //  · uma única nova tentativa automática; depois disso quem decide é a
    //    pessoa, no "Tentar de novo".
    queryFn: () =>
      new Promise<PropertyAccessInfo>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("O acesso não carregou a tempo. Confira a conexão.")),
          ACCESS_TIMEOUT_MS,
        );
        fetchFn({ data: { propertyId: row.propertyId, ownerId, providerId: provider?.id ?? null } })
          .then(resolve, reject)
          .finally(() => clearTimeout(timer));
      }),
    enabled: open,
    networkMode: "always",
    retry: 1,
    retryDelay: 800,
    // Senha não fica guardada no navegador além do necessário.
    staleTime: 30_000,
    gcTime: 60_000,
  });
  const info = q.data ?? null;

  const markCopied = (key: string) => {
    setCopiedKey(key);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedKey(null), 1500);
  };
  const copyChip = async (key: string, text: string, ok: string) => {
    if (await copy(text, ok)) markCopied(key);
  };

  const hasSecret = !!(info?.gateCode || info?.lockCode || info?.wifiPassword);
  const gateSteps = splitSteps(info?.gateInstructions ?? null);
  const lockSteps = splitSteps(info?.lockInstructions ?? null);
  const gateName = info?.gateLabel ?? "Portão";
  const lockName = info?.lockLabel ?? "Fechadura";
  // Mesmo critério do guia: instruções, vídeo ou fotos/vídeos do passo.
  const hasGateGuide = !!(gateSteps.length || info?.gateVideoUrl || info?.gateMedia.length);
  const hasLockGuide = !!(lockSteps.length || info?.lockVideoUrl || info?.lockMedia.length);
  // Passo a passo de CHEGADA (o mesmo do guia do hóspede) + cadeado/portão e
  // fechadura: cada um numa aba, abrindo em "Chegada" (decisão de 01/10/2026).
  const arrivalSteps = splitSteps(info?.checkinInstructions ?? null);
  const hasArrival = !!(arrivalSteps.length || info?.checkinNote || info?.checkinMedia.length);
  const showGateTab = !!(info?.gateCode || hasGateGuide);
  const showLockTab = !!(info?.lockCode || hasLockGuide);
  const tabs = [
    hasArrival ? { id: "arrival" as const, label: "Chegada", count: arrivalSteps.length } : null,
    showGateTab ? { id: "gate" as const, label: gateName, count: gateSteps.length } : null,
    showLockTab ? { id: "lock" as const, label: lockName, count: lockSteps.length } : null,
  ].filter((t): t is NonNullable<typeof t> => !!t);
  const activeTab = tabs.find((t) => t.id === stepsTab)?.id ?? tabs[0]?.id ?? "arrival";
  const stepsLabel = tabs.map((t) => t.label).join(" · ");
  const complement = complementItems(info?.complement);
  const goToCode = showGateTab
    ? () => setStepsTab("gate")
    : showLockTab
      ? () => setStepsTab("lock")
      : undefined;

  const sendLabel = info?.provider
    ? `Enviar à ${firstName(info.provider.name)}`
    : "Enviar pelo WhatsApp";
  const sendWhatsapp = () => {
    if (!info) return;
    const text = encodeURIComponent(buildMessage(row, info));
    const num = info.provider
      ? toWhatsappNumber(info.provider.phone, info.provider.phoneCountry)
      : "";
    window.open(
      num ? `https://wa.me/${num}?text=${text}` : `https://wa.me/?text=${text}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const owner = ownerLabel(row.ownerName);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setOpen(true);
          return;
        }
        // "Clique ao fundo retorna à página anterior": da tela interna, o
        // toque fora volta para "Acesso"; só de "Acesso" é que fecha.
        if (view !== "root") {
          setView("root");
          return;
        }
        setOpen(false);
        setRevealed(false);
        setCopiedKey(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Acesso do imóvel"
          title="Acesso: portão, fechadura e Wi-Fi"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const below = window.innerHeight - r.bottom - OVERLAY_COLLISION_PADDING.bottom;
            const above = r.top - OVERLAY_COLLISION_PADDING.top;
            setSide(below >= above ? "bottom" : "top");
          }}
          className={`grid place-items-center rounded-[0.3rem] border border-border/50 size-7 ${
            open ? "bg-primary/[0.08]" : "bg-background/60 hover:bg-primary/[0.08]"
          }`}
        >
          <KeyRound className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align="end"
        sideOffset={FILTER_PANEL_OFFSET}
        collisionPadding={FILTER_PANEL_COLLISION}
        className={`${FILTER_PANEL_CLASS_ELEVATED} w-[300px]`}
        onClick={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {view === "root" ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-[var(--panel-div)] px-3.5 py-3">
              <span className="ds-eyebrow text-muted-foreground">Acesso</span>
              {hasSecret && (
                <button
                  type="button"
                  onClick={() => setRevealed((v) => !v)}
                  className="inline-flex items-center gap-[5px] text-[11px] font-semibold text-foreground/70 transition-colors hover:text-foreground"
                >
                  {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  {revealed ? "Ocultar" : "Mostrar"}
                </button>
              )}
            </div>

            <div className="flex items-start gap-2.5 border-b border-[var(--panel-div)] px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <span className={`${CARD_PROPERTY} truncate`}>{row.propertyName ?? "Imóvel"}</span>
                {owner && <p className={`mt-0.5 truncate text-[11.5px] ${CARD_OWNER}`}>{owner}</p>}
                {row.propertyAddress && (
                  <p className="mt-0.5 break-words text-[11px] leading-snug text-muted-foreground">
                    {row.propertyAddress}
                  </p>
                )}
                <ComplementLine items={complement} />
              </div>
              <PropertyMapsButton
                propertyName={row.propertyName}
                propertyAddress={row.propertyAddress}
                mapsUrl={row.mapsUrl}
                garageMapsUrl={row.garageMapsUrl}
                complement={info?.complement ?? null}
              />
            </div>

            {q.isFetching && !info ? (
              <div className="grid grid-cols-2 gap-1.5 px-3.5 py-3">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-[52px] animate-pulse rounded-[10px] bg-[var(--panel-well)]"
                  />
                ))}
              </div>
            ) : q.isError || !info ? (
              <div className="flex flex-col items-start gap-2 px-3.5 py-3">
                <p className="text-[12px] text-muted-foreground">
                  {q.error instanceof Error
                    ? q.error.message
                    : "Não foi possível carregar o acesso."}
                </p>
                {/* Mesmo botão de texto do "Mostrar/Ocultar" do cabeçalho. */}
                <button
                  type="button"
                  onClick={() => void q.refetch()}
                  className="inline-flex items-center gap-[5px] text-[11px] font-semibold text-foreground/70 transition-colors hover:text-foreground"
                >
                  <RotateCw className="size-3.5" />
                  Tentar de novo
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-1.5 px-3.5 py-3">
                  {info.gateCode && (
                    <AccessChip
                      icon={Fence}
                      label={gateName}
                      value={info.gateCode}
                      secret
                      revealed={revealed}
                      copied={copiedKey === "gate"}
                      onCopy={() => copyChip("gate", info.gateCode as string, "Código copiado.")}
                    />
                  )}
                  {info.lockCode && (
                    <AccessChip
                      icon={Lock}
                      label={lockName}
                      value={info.lockCode}
                      secret
                      revealed={revealed}
                      copied={copiedKey === "lock"}
                      onCopy={() => copyChip("lock", info.lockCode as string, "Código copiado.")}
                    />
                  )}
                  {info.wifiSsid && (
                    <AccessChip
                      icon={Wifi}
                      label="Rede"
                      value={info.wifiSsid}
                      revealed={revealed}
                      copied={copiedKey === "ssid"}
                      onCopy={() => copyChip("ssid", info.wifiSsid as string, "Rede copiada.")}
                    />
                  )}
                  {info.wifiPassword && (
                    <AccessChip
                      icon={Wifi}
                      label="Senha"
                      value={info.wifiPassword}
                      secret
                      revealed={revealed}
                      copied={copiedKey === "wifi"}
                      onCopy={() => copyChip("wifi", info.wifiPassword as string, "Senha copiada.")}
                    />
                  )}
                </div>

                {stepsLabel && (
                  <FilterSection>
                    <FilterMenuRow
                      icon={ListOrdered}
                      label="Passo a passo"
                      value={stepsLabel}
                      onClick={() => {
                        setStepsTab(tabs[0]?.id ?? "arrival");
                        setView("steps");
                      }}
                      last
                    />
                  </FilterSection>
                )}

                <div className="flex gap-2 border-t border-[var(--panel-div)] px-3.5 py-3">
                  <button
                    type="button"
                    onClick={() => void copy(buildMessage(row, info), "Acesso copiado.")}
                    className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-foreground/[0.06] px-2 text-[12px] font-bold text-foreground transition-colors hover:bg-foreground/[0.1]"
                  >
                    <Copy className="size-3 shrink-0" />
                    <span className="truncate">Copiar tudo</span>
                  </button>
                  <button
                    type="button"
                    onClick={sendWhatsapp}
                    className="ds-surface inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-2 text-[12px] font-bold text-white"
                  >
                    <Send className="size-3 shrink-0" />
                    <span className="truncate">{sendLabel}</span>
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <FilterScreenHeader
              icon={ListOrdered}
              title="Passo a passo"
              onBack={() => setView("root")}
              right={
                hasSecret ? (
                  <button
                    type="button"
                    onClick={() => setRevealed((v) => !v)}
                    className="inline-flex items-center gap-[5px] text-[11px] font-semibold text-foreground/70 transition-colors hover:text-foreground"
                  >
                    {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    {revealed ? "Ocultar" : "Mostrar"}
                  </button>
                ) : null
              }
            />
            {tabs.length > 1 && (
              <div role="tablist" className="flex border-b border-[var(--panel-div)] px-2.5">
                {tabs.map((t) => {
                  const on = activeTab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setStepsTab(t.id)}
                      className={cn(
                        "relative flex h-[38px] min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap text-[12px] transition-colors",
                        on
                          ? "font-bold text-foreground"
                          : "font-semibold text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="min-w-0 truncate">{t.label}</span>
                      {t.count > 0 && (
                        <i className="rounded-full bg-foreground/[0.07] px-1.5 py-px text-[9.5px] font-extrabold not-italic text-muted-foreground">
                          {t.count}
                        </i>
                      )}
                      {on && (
                        <span
                          aria-hidden
                          className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-sm bg-gradient-to-r from-[#7C1AD8] to-[#E82DAE]"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {info && activeTab === "arrival" && hasArrival && (
              <div className="pt-3">
                <Timeline steps={arrivalSteps} finish onTag={goToCode} />
                {info.checkinNote && (
                  <div className="mx-3.5 mb-3.5 flex gap-2 rounded-[10px] bg-[rgba(201,169,98,.07)] px-3 py-2.5 text-[11.5px] leading-[1.45] text-foreground/85 shadow-[inset_0_0_0_1px_rgba(201,169,98,.2)]">
                    <Info className="mt-px size-3.5 shrink-0 text-[#c9a962]" />
                    <span className="min-w-0 break-words">{info.checkinNote}</span>
                  </div>
                )}
                <AccessExtras videoUrl={null} media={info.checkinMedia} />
              </div>
            )}
            {info && activeTab === "gate" && showGateTab && (
              <div className="pt-3">
                {info.gateCode && (
                  <CodeBox
                    icon={Fence}
                    value={info.gateCode}
                    revealed={revealed}
                    onCopy={() => void copy(info.gateCode as string, "Código copiado.")}
                  />
                )}
                <Timeline steps={gateSteps} />
                <AccessExtras videoUrl={info.gateVideoUrl} media={info.gateMedia} />
              </div>
            )}
            {info && activeTab === "lock" && showLockTab && (
              <div className="pt-3">
                {info.lockCode && (
                  <CodeBox
                    icon={Lock}
                    value={info.lockCode}
                    revealed={revealed}
                    onCopy={() => void copy(info.lockCode as string, "Código copiado.")}
                  />
                )}
                <Timeline steps={lockSteps} />
                <AccessExtras videoUrl={info.lockVideoUrl} media={info.lockMedia} />
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
