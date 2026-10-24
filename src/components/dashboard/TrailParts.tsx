import type { ReactNode } from "react";
import { CalendarDays, Check, MapPin, Search, User, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ClampName } from "@/components/ui/clamp-name";
import { CoverImage } from "@/components/ui/cover-image";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { PropertyMapsButton } from "@/components/dashboard/PropertyMapsButton";
import { cn } from "@/lib/utils";

/**
 * Peças da TRILHA DE PERGUNTAS do "+" (Nova limpeza e Novo registro): a
 * pergunta que recolhe com o check verde, o cartão de escolha e a lista em
 * poço com busca de uma linha. Ficam num arquivo próprio para o "+ Registro"
 * não precisar importar a Limpeza avulsa (e o servidor dela) só por isso.
 */

export function ddmm(iso: string | null) {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "";
}
export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Uma pergunta da trilha: respondida, ativa ou futura. */
export function Step({
  n,
  active,
  done,
  last,
  bleed,
  question,
  answer,
  answerNode,
  onReopen,
  children,
}: {
  n: number;
  active: boolean;
  done: boolean;
  last?: boolean;
  /** Lista de cartões que "sangra" para a esquerda, até a borda do corpo (mockups 1 e 2). */
  bleed?: boolean;
  question: string;
  answer?: string;
  /** Resposta estruturada (resumo de imóvel/reserva); tem prioridade sobre `answer`. */
  answerNode?: ReactNode;
  onReopen: () => void;
  children?: ReactNode;
}) {
  return (
    <li className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-2.5 pb-3">
      {!last && (
        <span
          aria-hidden
          className="absolute bottom-0.5 left-[10.5px] top-6 w-px bg-[var(--panel-div)]"
        />
      )}
      <span
        className={cn(
          "relative z-[1] grid size-[22px] place-items-center rounded-full text-[10.5px] font-extrabold",
          done
            ? "bg-[rgba(127,183,154,.16)] text-[#7fb79a]"
            : active
              ? "bg-accent/[0.14] text-accent"
              : "bg-foreground/[0.05] text-foreground/35",
        )}
      >
        {done ? <Check className="size-3" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 pt-[3px]">
        {done && !active ? (
          <div
            role="button"
            tabIndex={0}
            onClick={onReopen}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onReopen();
              }
            }}
            title="Alterar esta resposta"
            className="block w-full min-w-0 cursor-pointer text-left"
          >
            <span className="block truncate text-[10.5px] leading-tight text-muted-foreground">
              {question}
            </span>
            {answerNode ? (
              <span className="mt-1 block min-w-0">{answerNode}</span>
            ) : (
              <span className="mt-0.5 block break-words text-[13px] font-bold leading-snug text-foreground">
                {answer}
              </span>
            )}
          </div>
        ) : (
          <span
            className={cn(
              "block text-[13px] leading-snug",
              active ? "font-bold text-foreground" : "font-medium text-foreground/40",
            )}
          >
            {question}
          </span>
        )}
        {active && children ? <div className={cn("mt-2.5", bleed && "-ml-8")}>{children}</div> : null}
      </div>
    </li>
  );
}

/** Cartão de escolha (passos 1 e 5) — mesmo poço dos chips do quadrante "Acesso". */
export function Choice({
  icon: Icon,
  title,
  sub,
  selected,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  sub: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1 rounded-[10px] px-2.5 py-2.5 text-left transition-colors",
        selected
          ? "bg-accent/[0.12] ring-1 ring-inset ring-accent/60"
          : "bg-[var(--panel-well)] hover:bg-foreground/[0.07]",
      )}
    >
      <Icon
        className={cn("size-4", selected ? "text-accent" : "text-muted-foreground")}
        strokeWidth={2}
      />
      <span className="truncate text-[12.5px] font-bold text-foreground">{title}</span>
      <span className="text-[10.5px] leading-tight text-muted-foreground">{sub}</span>
    </button>
  );
}

/** Lista em poço, com busca opcional em UMA linha (reticências, nunca quebra). */
export function PickList({
  search,
  onSearch,
  placeholder,
  empty,
  children,
}: {
  search?: string;
  onSearch?: (v: string) => void;
  placeholder?: string;
  empty: string | null;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[10px] bg-[var(--panel-well)]">
      {onSearch && (
        <label className="flex h-8 min-w-0 items-center gap-2 border-b border-[var(--panel-div)] px-2.5">
          <Search className="size-3.5 shrink-0 text-foreground/40" />
          <input
            value={search ?? ""}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={placeholder}
            className="min-w-0 flex-1 truncate bg-transparent text-[12px] text-foreground outline-none placeholder:text-foreground/40"
          />
        </label>
      )}
      <div className="sg-elegant-scroll max-h-[min(320px,46dvh)] overflow-y-auto overscroll-contain sm:max-h-[380px]">
        {empty ? (
          <p className="px-3.5 py-3 text-[12px] text-muted-foreground">{empty}</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}


/**
 * JANELA DA TRILHA. A versão de 20/10/2026 tinha altura FIXA e deixava um vão
 * vazio abaixo dos botões nos passos curtos (print de 23/10/2026). Agora (mockups
 * 0m–0o, aprovados em 23/10/2026) a altura ACOMPANHA O CONTEÚDO, com teto de 90%
 * da tela (`max-h-[90dvh]`); só o miolo rola, e quando rola vale a regra
 * ANTICORTE (aplicada pela base `Dialog` + `data-clip-row` nas linhas das
 * listas). Cabeçalho (título em 1 linha + subtítulo) e botões ficam fixos.
 */
export function TrailDialog({
  open,
  onOpenChange,
  title,
  subtitle,
  progress,
  footer,
  onBack,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  /** Segunda linha do cabeçalho (ex.: o tipo de situação). O título fica sempre em 1 linha. */
  subtitle?: string | null;
  progress: string;
  footer: ReactNode;
  /** Passo anterior. Sem ele (1º passo), o botão secundário vira "Cancelar". */
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex h-auto max-h-[90dvh] w-[min(560px,calc(100vw-24px))] max-w-none flex-col gap-0 overflow-hidden border-[var(--panel-border)] bg-[var(--panel)] p-0 sm:max-w-none"
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-[var(--panel-div)] py-2.5 pl-4 pr-14">
          <div className="min-w-0 flex-1">
            <DialogTitle className="block truncate font-display text-[16px] font-bold leading-tight text-foreground">
              {title}
            </DialogTitle>
            {subtitle ? (
              <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-muted-foreground">{subtitle}</span>
            ) : null}
          </div>
          {progress ? (
            <span className="shrink-0 font-display text-[12px] font-semibold tabular-nums text-foreground/55">{progress}</span>
          ) : null}
        </div>
        <DialogDescription className="sr-only">Responda as perguntas, uma de cada vez.</DialogDescription>
        <div className="sg-elegant-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3.5 sm:px-5">
          {children}
        </div>
        {footer ? (
          <div className="flex shrink-0 items-center gap-2 border-t border-[var(--panel-div)] px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={() => (onBack ? onBack() : onOpenChange(false))}
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-[10px] border border-border px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-foreground/[0.05]"
            >
              {onBack ? "Voltar" : "Cancelar"}
            </button>
            <div className="min-w-0 flex-1">{footer}</div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** "Hóspede: Ana" → "Ana" (o ícone de pessoa já diz que é o hóspede). */
export function guestShort(label: string | null | undefined) {
  return String(label ?? "").replace(/^Hóspede:\s*/i, "").trim() || "Reserva";
}

type PickLine = {
  icon: "user" | "calendar";
  text: string;
  /** Texto colado ao lado do principal, separado por hífen (reserva: o período). */
  suffix?: string;
};

function LineIcon({ icon }: { icon: PickLine["icon"] }) {
  return icon === "user" ? <User className="size-3 shrink-0" /> : <CalendarDays className="size-3 shrink-0" />;
}

/**
 * CARTÃO DE IMÓVEL / RESERVA DA TRILHA — versão COMPACTA (mockups 0n e 0o,
 * aprovados em 23/10/2026; substitui o cartão alto dos mockups 1 e 2, que o
 * cliente achou "grosseiro", com poluição visual):
 *  · foto vira miniatura quadrada de 52px com cantos arredondados;
 *  · título do imóvel em UMA linha (toque mostra o nome inteiro) e, à direita, o
 *    Maps de sempre — exceto na RESERVA (`hideMaps`, pedido explícito);
 *  · uma informação por linha, 11,5px: imóvel → cidade; reserva → hóspede
 *    "- 22/10 → 25/10" (período colado ao nome, mesma fonte e cor, sem ícone);
 *  · "Proprietário(a): nome" com o ícone verde de chat colado ao nome;
 *  · SEM bolinha de seleção: o cartão marcado ganha fundo rosa suave.
 * Cada cartão é uma `data-clip-row` (unidade da regra anticorte da lista).
 */
export function PropertyPickRow({
  name,
  photoUrl,
  ownerName,
  ownerPhone,
  ownerPhoneCountry,
  city,
  address,
  mapsUrl,
  garageMapsUrl,
  hideMaps,
  lines,
  selected,
  last,
  onClick,
}: {
  name: string;
  photoUrl?: string | null;
  ownerName?: string | null;
  ownerPhone?: string | null;
  ownerPhoneCountry?: string | null;
  city?: string | null;
  address?: string | null;
  mapsUrl?: string | null;
  garageMapsUrl?: string | null;
  /** Reserva: sem o botão do Maps. */
  hideMaps?: boolean;
  /** Linhas acima da cidade (reserva: hóspede + período). */
  lines?: PickLine[];
  selected: boolean;
  last?: boolean;
  onClick: () => void;
}) {
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <div
      role="radio"
      aria-checked={selected}
      aria-label={`Selecionar ${name}`}
      tabIndex={0}
      data-clip-row
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "relative flex cursor-pointer items-start gap-2.5 px-3 py-2.5 outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05]",
        !last && "border-b border-[var(--panel-div)]",
        selected && "bg-accent/10 hover:bg-accent/10",
      )}
    >
      <span className="relative size-[52px] shrink-0 overflow-hidden rounded-lg bg-foreground/[0.05] text-muted-foreground">
        <CoverImage urls={[photoUrl]} />
      </span>
      <span className="grid min-w-0 flex-1 gap-[3px]">
        <span className="flex min-w-0 items-center gap-1.5">
          <ClampName
            text={name}
            passThrough
            className="min-w-0 flex-1 text-[13px] font-extrabold leading-[1.3] text-foreground"
          />
          {/* O Maps é o botão de sempre (menu: copiar link / copiar endereço /
              abrir app). Os cliques dele NÃO selecionam o cartão. */}
          {hideMaps ? null : (
            <span className="-my-1 shrink-0" onClick={stop} onKeyDown={stop}>
              <PropertyMapsButton
                propertyName={name}
                propertyAddress={address ?? null}
                mapsUrl={mapsUrl ?? null}
                garageMapsUrl={garageMapsUrl ?? null}
              />
            </span>
          )}
        </span>
        {(lines ?? []).map((l) => (
          <span
            key={`${l.icon}:${l.text}`}
            className="flex min-w-0 items-center gap-1.5 text-[11.5px] leading-[1.35] text-muted-foreground"
          >
            <LineIcon icon={l.icon} />
            <span className="min-w-0 truncate">{l.text}</span>
            {l.suffix ? <span className="shrink-0 -ml-0.5 tabular-nums">- {l.suffix}</span> : null}
          </span>
        ))}
        {city ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] leading-[1.35] text-muted-foreground">
            <MapPin className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{city}</span>
          </span>
        ) : null}
        <OwnerLine name={ownerName} phone={ownerPhone} country={ownerPhoneCountry} onStop={stop} />
      </span>
    </div>
  );
}

function OwnerLine({
  name,
  phone,
  country,
  onStop,
}: {
  name?: string | null;
  phone?: string | null;
  country?: string | null;
  onStop?: (e: { stopPropagation: () => void }) => void;
}) {
  return (
    <span className="flex min-w-0 items-center gap-[5px] text-[11.5px] leading-[1.35]">
      <span className="shrink-0 text-muted-foreground">Proprietário(a):</span>
      {name ? (
        <span className="min-w-0 truncate font-semibold text-foreground">{name}</span>
      ) : (
        <span className="min-w-0 truncate font-semibold ds-atencao">sem proprietário</span>
      )}
      {name ? (
        <span className="-my-1.5 shrink-0" onClick={onStop} onKeyDown={onStop}>
          <PhoneActionButton phone={phone} country={country} size={13} alwaysShow />
        </span>
      ) : null}
    </span>
  );
}

/**
 * RESPOSTA ESTRUTURADA de "Qual imóvel?" / "Qual reserva?" (mockup 0m): em vez de
 * uma frase única que quebra, uma informação por linha — nome do imóvel (+ Maps,
 * só no imóvel), hóspede "- período" (reserva) e Proprietário(a) com chat.
 */
export function PropertySummary({
  name,
  ownerName,
  ownerPhone,
  ownerPhoneCountry,
  guest,
  period,
  address,
  mapsUrl,
  garageMapsUrl,
  showMaps,
}: {
  name: string;
  ownerName?: string | null;
  ownerPhone?: string | null;
  ownerPhoneCountry?: string | null;
  guest?: string | null;
  period?: string | null;
  address?: string | null;
  mapsUrl?: string | null;
  garageMapsUrl?: string | null;
  showMaps?: boolean;
}) {
  return (
    <span className="grid min-w-0 gap-[3px]">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold leading-snug text-foreground">{name}</span>
        {showMaps ? (
          <span className="-my-1 shrink-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <PropertyMapsButton
              propertyName={name}
              propertyAddress={address ?? null}
              mapsUrl={mapsUrl ?? null}
              garageMapsUrl={garageMapsUrl ?? null}
            />
          </span>
        ) : null}
      </span>
      {guest ? (
        <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] leading-[1.35] text-muted-foreground">
          <User className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{guest}</span>
          {period ? <span className="shrink-0 -ml-0.5 tabular-nums">- {period}</span> : null}
        </span>
      ) : null}
      <OwnerLine
        name={ownerName}
        phone={ownerPhone}
        country={ownerPhoneCountry}
        onStop={(e) => e.stopPropagation()}
      />
    </span>
  );
}

/**
 * Linha de PRESTADOR (mockup 3): "Nome · Atividade" — a atividade principal em
 * cinza, mais leve — e, no marcado, o ✓ rosa à esquerda. Saiu o antigo
 * "padrão deste imóvel": o prestador do imóvel só vem pré-marcado.
 */
export function ProviderPickRow({
  name,
  activity,
  selected,
  last,
  onClick,
}: {
  name: string;
  activity?: string | null;
  selected: boolean;
  last?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-clip-row
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-[9px] px-3.5 py-2.5 text-left text-foreground transition-colors hover:bg-foreground/[0.04]",
        !last && "border-b border-[var(--panel-div)]",
      )}
    >
      <span className="grid size-3.5 shrink-0 place-items-center text-accent">
        {selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0 truncate text-[12.5px] font-bold">
        {name}
        {activity ? <span className="font-medium text-muted-foreground"> · {activity}</span> : null}
      </span>
    </button>
  );
}
