import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Check, MapPin, Search, User, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ClampName } from "@/components/ui/clamp-name";
import { CoverImage } from "@/components/ui/cover-image";
import { PropertyMapsButton } from "@/components/dashboard/PropertyMapsButton";
import { SELECTED_ITEM_BG_CLASS } from "@/components/ui/selection-bar";
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
      {/* Título AO LADO do ícone (14/11/2026); a descrição desce para a linha de baixo. */}
      <span className="flex min-w-0 items-center gap-2">
        <Icon
          className={cn("size-4 shrink-0", selected ? "text-accent" : "text-muted-foreground")}
          strokeWidth={2}
        />
        <span className="truncate text-[12.5px] font-bold text-foreground">{title}</span>
      </span>
      <span className="text-[10.5px] leading-tight text-muted-foreground">{sub}</span>
    </button>
  );
}

/** Lista em poço, com busca opcional em UMA linha (reticências, nunca quebra). */
/**
 * Área rolável das listas. No modo `cards` a barra nativa some e uma linha fina (3px) é desenhada POR CIMA
 * do conteúdo: a cor dos cartões vai até a borda direita, sem calha vazia (mockup Novo registro, 15/11/2026).
 */
export function ScrollArea({
  cards,
  overlay,
  listClassName,
  children,
}: {
  cards?: boolean;
  /**
   * Só a barra de rolagem por cima (3px, na borda direita, sem calha) — sem a grade de cartões. É a lista das
   * janelas de filtro (Imóvel, Proprietário…): a cor da linha selecionada vai até a borda da janela.
   */
  overlay?: boolean;
  listClassName?: string;
  children: ReactNode;
}) {
  const bare = !!cards || !!overlay;
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !bare) return;
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight <= clientHeight + 1) return setThumb(null);
      const track = clientHeight - 12;
      const height = Math.max(28, (clientHeight / scrollHeight) * track);
      const top = 6 + (scrollTop / (scrollHeight - clientHeight)) * (track - height);
      setThumb({ top, height });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [bare, children]);
  return (
    <div className="relative">
      <div
        ref={ref}
        className={cn(
          "sg-elegant-scroll max-h-[min(320px,46dvh)] overflow-y-auto overscroll-contain sm:max-h-[380px]",
          bare && "sg-card-list",
          cards && "grid auto-rows-max gap-1.5",
          listClassName,
        )}
      >
        {children}
      </div>
      {bare && thumb ? (
        <span
          aria-hidden
          className="pointer-events-none absolute right-0 w-[3px] rounded-full bg-[var(--scroll-thumb)]"
          style={{ top: thumb.top, height: thumb.height }}
        />
      ) : null}
    </div>
  );
}

export function PickList({
  search,
  onSearch,
  placeholder,
  empty,
  listClassName,
  cards,
  bar,
  children,
}: {
  search?: string;
  onSearch?: (v: string) => void;
  placeholder?: string;
  empty: string | null;
  /** Altura máxima da lista quando a tela pede outra (ex.: seleção em massa de imóveis, mockup e = 430px). */
  listClassName?: string;
  /**
   * Lista de cartões de imóvel (mockup Novo registro, 15/11/2026): SEM fundo de lista (só os cartões),
   * cada imóvel é um cartão separado (6px de respiro); a busca não tem preenchimento (só ícone, texto e
   * filete); a barra de rolagem fina (3px) é desenhada por cima, na borda direita, sem deixar calha
   * vazia sob a cor da seleção.
   */
  cards?: boolean;
  /**
   * Linha de seleção em massa (`SelectionBar`): fica ABAIXO da busca e acima da lista (a busca vem
   * sempre primeiro), alinhada à direita.
   */
  bar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn(!cards && "overflow-hidden rounded-[10px] bg-[var(--panel-well)]")}>
      {onSearch && (
        <label
          className={cn(
            "flex h-8 min-w-0 items-center gap-2 border-b border-[var(--panel-div)]",
            // Busca reta e ALINHADA à esquerda do título da janela (16/11/2026): nos cartões não há recuo.
            cards ? "mb-1.5 px-0" : "px-2.5",
          )}
        >
          <Search className="size-3.5 shrink-0 text-foreground/40" />
          <input
            value={search ?? ""}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={placeholder}
            className="min-w-0 flex-1 truncate bg-transparent text-[12px] text-foreground outline-none placeholder:text-foreground/40"
          />
        </label>
      )}
      {bar}
      <ScrollArea cards={cards} listClassName={listClassName}>
        {empty ? (
          <p className="px-3.5 py-3 text-[12px] text-muted-foreground">{empty}</p>
        ) : (
          children
        )}
      </ScrollArea>
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
        onBack={onBack}
        className="sg-vv-center flex h-auto max-h-[90dvh] w-[min(560px,calc(100vw-24px))] max-w-none flex-col gap-0 overflow-hidden border-[var(--panel-border)] bg-[var(--panel)] p-0 sm:max-w-none"
      >
        {/* CABEÇALHO PADRÃO DAS JANELAS (Regra 5, 14/11/2026): faixa de 48px, título Manrope 14px
            bold, margem esquerda de 16px e filete embaixo. A "X" (e o voltar) ficam à direita. */}
        <div className="flex min-h-12 shrink-0 items-center gap-2.5 border-b border-[var(--panel-div)] py-1.5 pl-4 pr-14 data-[back=true]:pr-24" data-back={onBack ? "true" : "false"}>
          <div className="min-w-0 flex-1">
            <DialogTitle className="block truncate font-display text-[14px] font-bold leading-tight text-foreground">
              {title}
            </DialogTitle>
            {subtitle ? (
              <span className="mt-0.5 block truncate text-[12px] leading-tight text-muted-foreground">{subtitle}</span>
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
          <div data-window-foot className="flex shrink-0 items-center gap-2 border-t border-[var(--panel-div)] px-4 py-3 sm:px-5">
            {onBack ? null : (
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-[10px] border border-border px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-foreground/[0.05]"
              >
                Cancelar
              </button>
            )}
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

/**
 * TOQUE LONGO (≈0,45 s) sem biblioteca: arma um temporizador no pressionar e o cancela se o dedo
 * andar mais de 8px (rolagem da lista), soltar ou sair. Depois de disparar, o clique que o navegador
 * ainda emite ao soltar é descartado por `consumeClick`.
 */
function useLongPress(onLongPress?: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cb = useRef(onLongPress);
  cb.current = onLongPress;
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };
  useEffect(() => clear, []);
  const enabled = !!onLongPress;
  return {
    consumeClick: () => {
      const was = fired.current;
      fired.current = false;
      return was;
    },
    handlers: enabled
      ? {
          onPointerDown: (e: React.PointerEvent) => {
            if (e.button !== undefined && e.button > 0) return;
            fired.current = false;
            origin.current = { x: e.clientX, y: e.clientY };
            timer.current = setTimeout(() => {
              timer.current = null;
              fired.current = true;
              try {
                navigator.vibrate?.(12);
              } catch {
                /* sem vibração: tudo bem */
              }
              cb.current?.();
            }, ms);
          },
          onPointerMove: (e: React.PointerEvent) => {
            const o = origin.current;
            if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > 8) clear();
          },
          onPointerUp: clear,
          onPointerLeave: clear,
          onPointerCancel: clear,
          onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        }
      : {},
  };
}

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
 *  · só o nome (sem rótulo) com o ícone verde de chat colado ao nome;
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
  multi,
  onLongPress,
  onClick,
}: {
  name: string;
  photoUrl?: string | null;
  ownerName?: string | null;
  ownerPhone?: string | null;
  ownerPhoneCountry?: string | null;
  /**
   * Lista de VÁRIOS imóveis (14/11/2026): sem caixinhas. Segurar o cartão uma vez liga o modo de
   * seleção (`onLongPress`); com ele ligado, o toque marca/desmarca. O cartão marcado ganha o tom neutro padrão (SELECTED_ITEM_BG_CLASS).
   */
  multi?: boolean;
  /** Segurar o cartão (≈0,45 s). */
  onLongPress?: () => void;
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
  const hold = useLongPress(onLongPress);
  return (
    <div
      role={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      aria-label={`Selecionar ${name}`}
      tabIndex={0}
      data-clip-row
      {...hold.handlers}
      onClick={(e) => {
        // O clique que sucede um toque longo não pode selecionar/avançar.
        if (hold.consumeClick()) {
          e.preventDefault();
          return;
        }
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "relative flex cursor-pointer select-none items-stretch gap-2.5 overflow-hidden rounded-l-[9px] pr-3 outline-none transition-colors [-webkit-touch-callout:none]",
        selected
          ? SELECTED_ITEM_BG_CLASS
          : "bg-foreground/[0.035] hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05]",
      )}
    >
      <span className="relative w-[76px] shrink-0 self-stretch overflow-hidden bg-foreground/[0.05] text-muted-foreground">
        <CoverImage urls={[photoUrl]} />
      </span>
      <span className="grid min-w-0 flex-1 gap-[3px] py-2.5">
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
      {name ? (
        <span className="min-w-0 truncate font-semibold text-foreground">{name}</span>
      ) : (
        <span className="min-w-0 truncate font-semibold ds-atencao">sem proprietário</span>
      )}
    </span>
  );
}

/**
 * RESPOSTA ESTRUTURADA de "Qual imóvel?" / "Qual reserva?" (mockup 0m): em vez de
 * uma frase única que quebra, uma informação por linha — nome do imóvel (+ Maps,
 * só no imóvel), hóspede "- período" (reserva) e o proprietário (só o nome) com chat.
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
