import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PageDateRow, PAGE_BACK_CLASS } from "@/components/ds/PageDateRow";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, BookOpen, Check, ChevronDown, Copy, CopyPlus, Eye, EyeOff, Info, KeyRound, Lock, PencilLine, Plus, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { OwnerLine } from "@/components/dashboard/OwnerLine";
import { SearchActionRow } from "@/components/dashboard/SearchActionRow";
import { ACTION_BUTTON_TONE, ACTION_ICON, ACTION_SEGMENT } from "@/components/dashboard/panel-chrome";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  addPlaybookRow,
  deletePlaybookRow,
  getPlaybook,
  savePlaybookNote,
  savePlaybookRow,
} from "@/lib/playbook.functions";
import { buildPlaybook, matchesQuery, toggleRow, toggleSection, type PlaybookRow } from "@/lib/playbook-build";
import { AUDIENCE_LABEL, PLAYBOOK_SECTIONS, type Audience, type PlaybookSectionMeta } from "@/lib/playbook-catalog";
import { classifyBulkRow } from "@/lib/playbook-bulk";
import { ReplicateRowDialog } from "@/components/playbook/ReplicateRowDialog";

/**
 * PLAYBOOK DO IMÓVEL (mockup P01 aprovado, 21/10/2026).
 *
 * O Playbook é o registro do imóvel — a fonte da verdade, editada direto aqui.
 * Regras de tela (todas pedidas pelo usuário):
 *   · abre SEMPRE tudo recolhido; só uma seção aberta por vez; dentro dela,
 *     quantas linhas quiser (atualizar a página recolhe tudo);
 *   · "Modo leitura" (liga/desliga) abre tudo para ler; "Imprimir" abre tudo e imprime;
 *   · a busca filtra as linhas e abre as seções com resultado;
 *   · o botão de tema NÃO fica aqui (já mora no cabeçalho do sistema);
 *   · códigos e senhas aparecem mascarados e nunca entram na busca;
 *   · só tem lápis o que é cadastro manual; só tem lixeira o que pode ser
 *     apagado sem mexer no que vem do anúncio.
 */

const AUD_CHIP: Record<Audience, string> = {
  G: "text-success bg-[color-mix(in_oklab,var(--success)_14%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--success)_30%,transparent)]",
  P: "text-warning bg-[color-mix(in_oklab,var(--warning)_14%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--warning)_30%,transparent)]",
  I: "text-muted-foreground bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]",
};

function AudienceChip({ au, className = "", children }: { au: Audience; className?: string; children?: React.ReactNode }) {
  return (
    <span
      className={`inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[9.5px] font-bold uppercase leading-none tracking-[0.12em] ${AUD_CHIP[au]} ${className}`}
    >
      <i className="inline-block size-1.5 rounded-full bg-current" />
      {AUDIENCE_LABEL[au]}
      {children}
    </span>
  );
}

const WELL = "bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]";
// Tabela com rolagem lateral (22/10/2026): colunas A, B e D se ajustam ao maior dado (nada cortado;
// B quebra linha só a partir de 520px); C tem largura fixa de 440px; D recebe a sobra, com a etiqueta colada à C. As linhas usam subgrade
// para as colunas ficarem alinhadas entre si.
const TABLE_COLS =
  "grid w-max min-w-full grid-cols-[fit-content(320px)_fit-content(520px)_440px_minmax(max-content,1fr)]";
const ROW_GRID = "col-span-4 grid grid-cols-subgrid";
const CLAMP2 = "[display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden";
const ICON_BTN =
  "grid size-8 place-items-center rounded-lg border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground";
const CLAMP3 = "[display:-webkit-box] [-webkit-line-clamp:3] [-webkit-box-orient:vertical] overflow-hidden";

/** Explicação de cada audiência — a mesma no "i" da legenda (computador) e na palavra colorida de cada campo (celular). */
const AUDIENCE_HELP: Record<Audience, string> = {
  G: "Liberado só durante estadia confirmada.",
  P: "Liberado já na pré-reserva.",
  I: "Confidencial, nunca exibido ao hóspede.",
};
/**
 * CELULAR — "Nova Info" (mockup aprovado, 25/10/2026): nomes da audiência no seletor "Quem Pode Ver".
 * Público = liberado já na pré-reserva; Reserva Ativa = só durante estadia confirmada. O que chega
 * sozinho do Channex/scrap já vem com a audiência certa e NÃO tem seletor: só informação criada
 * à mão escolhe aqui.
 */
const NEW_INFO_AUD: Array<{ au: Audience; label: string; dot: string }> = [
  { au: "P", label: "Público", dot: "bg-success" },
  { au: "G", label: "Reserva Ativa", dot: "bg-warning" },
  { au: "I", label: "Equipe Interna", dot: "bg-muted-foreground" },
];
const PILL =
  "flex h-9 flex-1 items-center justify-center rounded-[9px] bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] text-[13px] font-semibold text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:text-foreground";
const FIELD_LABEL = "mb-1.5 text-[10px] font-bold uppercase leading-tight tracking-[0.08em] text-[var(--faint)]";

/**
 * CELULAR (mockup "Proposta 1 e 2" aprovado, 24/10/2026): a audiência deixa de ser uma etiqueta com
 * borda e vira só a palavra colorida, na linha da observação de cada campo. Tocar na palavra abre a
 * mesma explicação que o "i" da legenda abre no computador — a legenda sai da tela no celular.
 */
/** Nome da audiência no celular (mockup "Subcategorias D", 25/10/2026) e a cor do próprio nome. */
const AUD_NAME: Record<Audience, string> = { P: "Público", G: "Reserva Ativa", I: "Equipe Interna" };
const AUD_TEXT: Record<Audience, string> = { P: "text-success", G: "text-warning", I: "text-foreground/70" };

function AudienceText({ au }: { au: Audience }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Explicação: ${AUD_NAME[au]}`}
          className={AUD_TEXT[au]}
        >
          {AUD_NAME[au]}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        onClick={(e) => e.stopPropagation()}
        className="w-64 p-3 text-xs font-medium text-muted-foreground"
      >
        {AUDIENCE_HELP[au]}
      </PopoverContent>
    </Popover>
  );
}

/**
 * CELULAR (pedido explícito, 25/10/2026): valor em até 3 linhas; se não couber, o texto termina em
 * "…" e o "Ver tudo" fica colado no FIM da última linha (não numa linha separada). Mede com um
 * espelho invisível e acha, por busca binária, o maior trecho que ainda cabe junto de "… Ver tudo".
 */
const CLAMP_LINES = 3;
const LINE_PX = 20;
function ClampedValue({ text, full, className }: { text: string; full: boolean; className: string }) {
  const probe = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = probe.current;
    const wrap = box.current;
    if (!el || !wrap || full) return;
    const limit = CLAMP_LINES * LINE_PX + 2;
    const measure = () => {
      el.textContent = text;
      if (el.offsetHeight <= limit) {
        setCut(null);
        return;
      }
      let lo = 0;
      let hi = text.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        el.textContent = `${text.slice(0, mid).trimEnd()}… Ver tudo`;
        if (el.offsetHeight <= limit) lo = mid;
        else hi = mid - 1;
      }
      setCut(lo);
    };
    measure();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(wrap);
    }
    void document.fonts?.ready?.then(measure);
    return () => ro?.disconnect();
  }, [text, full]);

  if (full) return <span className={`min-w-0 flex-1 whitespace-pre-line ${className}`}>{text}</span>;
  return (
    <span ref={box} className={`relative min-w-0 flex-1 ${className}`}>
      <span
        ref={probe}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 w-full whitespace-normal break-words text-sm leading-5"
      />
      {cut === null ? (
        text
      ) : (
        <>
          {text.slice(0, cut).trimEnd()}…{" "}
          <span className="text-muted-foreground underline underline-offset-2">Ver tudo</span>
        </>
      )}
    </span>
  );
}

/** Mesmo ponto de corte do restante da página (`max-[900px]:`). Sem `matchMedia` (testes) vale o desenho do computador. */
function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(max-width: 900px)");
    const sync = () => setNarrow(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);
  return narrow;
}

function Legend() {
  const items: Array<[Audience, string]> = (["G", "P", "I"] as Audience[]).map((au) => [au, AUDIENCE_HELP[au]]);
  return (
    <div className="print:hidden">
      {/* Etiqueta + botão "i" (22/10/2026): a explicação de cada audiência abre no "i", não fica
          escrita ao lado. Mesma peça no computador e no celular; quebra linha sem cortar item. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="ds-eyebrow text-[10px] tracking-[0.2em] text-muted-foreground">Audiência</span>
        <span className="h-px min-w-6 flex-1 bg-gradient-to-r from-[color-mix(in_oklab,var(--foreground)_9%,transparent)] to-transparent max-[900px]:hidden" />
        {items.map(([au, long]) => (
          <span key={au} className="inline-flex items-center">
            <AudienceChip au={au} className="pr-1">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`Explicação: ${AUDIENCE_LABEL[au]}`}
                  title="Ver explicação"
                  className="grid size-4 place-items-center rounded-full opacity-70 transition-opacity hover:opacity-100 data-[state=open]:opacity-100"
                >
                  <Info className="size-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-3 text-xs font-medium text-muted-foreground">
                {long}
              </PopoverContent>
            </Popover>
            </AudienceChip>
          </span>
        ))}
      </div>
    </div>
  );
}

type EditState = { id: string; draft: string } | null;

/**
 * DOSSIÊ SEM CAMPOS VAZIOS (24/10/2026): campo manual opcional sem valor não aparece.
 * Só os campos-padrão abaixo ficam sempre visíveis; os demais entram pelo
 * "Adicionar campo" da seção e somem de novo quando o valor é excluído.
 */
const STANDARD_MANUAL_FIELDS = new Set(["f:modo_de_acesso"]);
// Vazio = oculto, venha do anúncio ou do cadastro manual: nenhuma linha mostra "não cadastrado".
const isOptionalEmpty = (r: PlaybookRow) => r.empty && !STANDARD_MANUAL_FIELDS.has(r.id);
/** Campos vazios que não existiam no antigo "Editar guia" nunca aparecem (nem no menu). */
const isAddable = (r: PlaybookRow) => r.guideField === true;

export function PlaybookPage({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const fetchFn = useServerFn(getPlaybook);
  const saveFn = useServerFn(savePlaybookRow);
  const deleteFn = useServerFn(deletePlaybookRow);
  const noteFn = useServerFn(savePlaybookNote);
  const addFn = useServerFn(addPlaybookRow);

  // Falha de leitura não zera nada: o react-query mantém o último dado bom.
  const query = useQuery({
    queryKey: ["playbook", propertyId],
    queryFn: () => fetchFn({ data: { propertyId } }),
    staleTime: 15_000,
  });

  // SEMPRE abre recolhido: estado só em memória, nada é lembrado entre visitas.
  const [q, setQ] = useState("");
  const [read, setRead] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [openRows, setOpenRows] = useState<string[]>([]);
  const [edit, setEdit] = useState<EditState>(null);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<PlaybookRow | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<{ section: number; label: string; value: string; note: string; au: Audience } | null>(null);
  /** CELULAR: janela "Campos Vazios" (índice da categoria) e alerta de campo que só se edita no anúncio. */
  const [pick, setPick] = useState<number | null>(null);
  const [locked, setLocked] = useState<PlaybookRow | null>(null);
  const [audOpen, setAudOpen] = useState(false);
  const [replicating, setReplicating] = useState<PlaybookRow | null>(null);
  const [revealed, setRevealed] = useState<string[]>([]);
  const [shown, setShown] = useState<string[]>([]);

  const sections = useMemo(() => (query.data ? buildPlaybook(query.data.source) : []), [query.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["playbook", propertyId] });

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await action();
      await refresh();
      toast.success(ok);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function copy(row: PlaybookRow) {
    try {
      await navigator.clipboard.writeText(row.raw);
      toast.success("Copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  function startEdit(row: PlaybookRow) {
    if (!row.edit) return;
    setOpenRows((cur) => (cur.includes(row.id) ? cur : toggleRow(cur, row.id)));
    let draft = row.raw;
    if (row.edit === "bool") draft = /^Sim/.test(row.value) ? "true" : "false";
    if (row.edit === "access") draft = /^Com código/.test(row.value) ? "pin" : "public";
    if (row.edit === "int") draft = row.raw.replace(/\D/g, "");
    setEdit({ id: row.id, draft });
  }

  // Modo leitura e impressão são controles separados: entrar/sair do modo
  // leitura é explícito; imprimir sempre abre tudo e chama a impressão.
  const printNow = () => {
    setRead(true);
    window.setTimeout(() => window.print(), 250);
  };

  const owner = query.data?.owner ?? null;
  const qq = q.trim();
  const narrow = useNarrow();
  /** CELULAR (mockup "Ver tudo B" aprovado, 25/10/2026): janela do campo com abas Texto / Nota / IA. */
  const [view, setView] = useState<{ idx: number; id: string; tab: "texto" | "nota" | "ia" } | null>(null);
  const viewRow = view ? (sections[view.idx]?.rows ?? []).find((x) => x.id === view.id) ?? null : null;

  /** Editor de valor (mesmo no computador e no celular). */
  const renderEditor = (r: PlaybookRow) => (
    <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
      <EditField row={r} draft={edit!.draft} onChange={(v) => setEdit({ id: r.id, draft: v })} />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            const ok = await run(() => saveFn({ data: { propertyId, rowId: r.id, value: edit!.draft } }), "Salvo.");
            if (ok) setEdit(null);
          }}
          className="h-8 rounded-lg bg-foreground px-3 text-xs font-bold text-background disabled:opacity-50"
        >
          Salvar
        </button>
        <button
          type="button"
          onClick={() => {
            setEdit(null);
            setRevealed((cur) => cur.filter((x) => x !== r.id));
          }}
          className={`h-8 rounded-lg px-3 text-xs font-bold text-muted-foreground ${WELL}`}
        >
          Cancelar
        </button>
      </div>
    </div>
  );

  /** "Nota do anfitrião" (mesmo no computador e no celular). */
  const renderNote = (r: PlaybookRow, noteVal: string, className = "mt-3") => (
    <div className={className} onClick={(e) => e.stopPropagation()}>
      <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase leading-tight tracking-[0.08em] text-muted-foreground">
        <PencilLine className="size-[11px]" />
        Nota do anfitrião
      </span>
      <textarea
        rows={2}
        value={noteVal}
        onChange={(e) => setNotes((p) => ({ ...p, [r.id]: e.target.value }))}
        onBlur={() => {
          if ((notes[r.id] ?? r.note) === r.note) return;
          void run(() => noteFn({ data: { propertyId, rowId: r.id, note: notes[r.id] ?? "" } }), "Nota salva.").then((ok) => {
            if (ok) setNotes((p) => { const { [r.id]: _x, ...rest } = p; return rest; });
          });
        }}
        placeholder="Contexto só deste imóvel, que a IA lê junto da instrução padrão."
        className={`block min-h-14 w-full resize-none rounded-lg border-0 px-3 py-2 text-[13px] font-medium leading-[1.45] text-foreground outline-none placeholder:text-[var(--faint)] focus:shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--accent)_60%,transparent)] ${WELL}`}
      />
    </div>
  );

  /** Botões "Adicionar campo" / "Adicionar linha / campo" de cada seção. */
  const renderAddButtons = (meta: PlaybookSectionMeta, idx: number, hidden: PlaybookRow[], plain = false) => {
    const btn = plain
      ? "inline-flex h-5 items-center text-sm leading-5 text-muted-foreground hover:text-foreground"
      : `inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-bold text-muted-foreground hover:text-foreground ${WELL}`;
    return (
    <>
      {hidden.length > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={btn}
            >
              {plain ? "+ " : <KeyRound className="size-[15px]" />}
              Adicionar campo
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 max-h-[60vh] overflow-y-auto overscroll-contain p-1.5">
            {hidden.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  setRevealed((cur) => [...cur, r.id]);
                  startEdit(r);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-foreground hover:bg-secondary/60"
              >
                {r.secret ? <KeyRound className="size-3.5 flex-none text-muted-foreground" /> : <Plus className="size-3.5 flex-none text-muted-foreground" />}
                <span className="min-w-0 break-words">{r.label}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
      <button
        type="button"
        onClick={() => setAdding({ section: meta.num ? Number(meta.num) : idx + 1, label: "", value: "", note: "", au: "I" })}
        className={btn}
      >
        {plain ? "+ " : <Plus className="size-[15px]" />}
        Adicionar linha / campo
      </button>
    </>
    );
  };

  return (
    <div className="ds-dense-fields w-full max-w-[1440px] px-2.5 py-5 sm:px-5 lg:px-8 lg:py-8">
      <div className="flex flex-col gap-6">
        {/* CABEÇALHO NO MOLDE DO DASHBOARD: data, título numa linha, imóvel e
            "Proprietário(a): nome" + ícone de mensagem (regra de todo lugar
            que cita um imóvel). O botão de tema fica no cabeçalho do sistema. */}
        <div className="ds-page-heading">
          <PageDateRow
            back={
              <Link to="/admin/proprietarios" className={PAGE_BACK_CLASS}>
                <ArrowLeft className="size-3.5" />
                Voltar
              </Link>
            }
          />
          <div className="ds-page-heading min-w-0">
            <h1 className="ds-page-title !text-lg truncate">Playbook do imóvel</h1>
            <p className="ds-page-subtitle">{query.data?.propertyName ?? "Carregando…"}</p>
            {owner?.name ? (
              <OwnerLine name={owner.name} phone={owner.phone} country={owner.country} phonePosition="adjacent" size={13} />
            ) : null}
          </div>
        </div>

        <SearchActionRow
          value={q}
          onChange={setQ}
          placeholder="Buscar campo, valor ou observação"
          className="print:hidden"
          actions={narrow ? undefined : (
            <>
              <button
                type="button"
                onClick={() => setRead((v) => !v)}
                aria-label={read ? "Sair do modo leitura" : "Entrar no modo leitura"}
                title={read ? "Sair do modo leitura" : "Entrar no modo leitura"}
                aria-pressed={read}
                className={`${ACTION_SEGMENT} ${read ? "text-accent" : ACTION_BUTTON_TONE}`}
              >
                <BookOpen className={ACTION_ICON} />
              </button>
              <button
                type="button"
                onClick={printNow}
                aria-label="Imprimir"
                title="Imprimir"
                className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE}`}
              >
                <Printer className={ACTION_ICON} />
              </button>
            </>
          )}
        />

        {read ? (
          <div className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-[12.5px] font-bold text-foreground print:hidden ${WELL}`}>
            <span className="inline-flex items-center gap-2">
              <BookOpen className="size-3.5 text-accent" />
              Modo leitura: tudo aberto
            </span>
            <button type="button" onClick={() => setRead(false)} className="underline underline-offset-2 hover:text-accent">
              Sair do modo leitura
            </button>
          </div>
        ) : null}

        {narrow ? null : <Legend />}

        {qq && query.data && sections.every((sec) => sec.rows.every((r) => !matchesQuery(r, qq))) ? (
          <div className="py-6 text-center text-[13px] font-medium text-muted-foreground">Nenhum campo corresponde à busca.</div>
        ) : null}

        {query.isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Carregando o Playbook…</div>
        ) : query.isError && !query.data ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            Não foi possível carregar o Playbook agora.{" "}
            <button type="button" className="font-bold text-foreground underline" onClick={() => void query.refetch()}>
              Tentar de novo
            </button>
          </div>
        ) : (
          <div className={narrow ? "ds-3d -mt-2.5 flex flex-col overflow-hidden rounded-[14px] border-0 bg-card" : "contents"}>
          {PLAYBOOK_SECTIONS.map((meta, idx) => {
            const sec = sections[idx];
            const all = (sec?.rows ?? []).filter((r) => !isOptionalEmpty(r) || revealed.includes(r.id) || edit?.id === r.id);
            const hidden = (sec?.rows ?? []).filter(
              (r) => isOptionalEmpty(r) && isAddable(r) && !revealed.includes(r.id) && edit?.id !== r.id,
            );
            const rows = all.filter((r) => matchesQuery(r, qq));
            const isOpen = qq ? rows.length > 0 : read || openSection === meta.id;
            if (narrow) {
              const toggleSec = () => {
                setOpenSection((cur) => toggleSection(cur, meta.id));
                setOpenRows([]);
              };
              return (
                <section key={meta.id} id={meta.id} className="print:break-inside-avoid-page">
                  {/* CELULAR (mockup aprovado 24/10/2026): lista plana, sem cartão, sem seta, sem borda.
                      Número, título numa linha só (reticências) e (quantidade) centralizada na linha do título. */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    aria-label={`${meta.title}, ${all.length} campos`}
                    onClick={toggleSec}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleSec();
                      }
                    }}
                    className={`flex cursor-pointer gap-3 px-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring h-14 items-center`}
                  >
                    <span
                      className={`grid size-6 flex-none place-items-center rounded-lg bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] font-display text-xs font-bold ${isOpen ? "text-foreground" : "text-muted-foreground"}`}
                    >
                      {meta.num}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate whitespace-nowrap font-display text-[15px] font-semibold leading-[19px] text-foreground">
                        {meta.title}
                      </div>
                    </div>
                    <span className="flex-none font-display text-[13px] font-medium leading-[19px] tabular-nums text-muted-foreground">
                      ({qq ? `${rows.length} de ${all.length}` : all.length})
                    </span>
                  </div>

                  {isOpen ? (
                    <div className="pb-[18px] pl-[50px] pr-3.5">
                      {rows.map((r, i) => {
                        const open = read;
                        const editing = edit?.id === r.id;
                        return (
                          <div
                            key={r.id}
                            onClick={() => !editing && setView({ idx, id: r.id, tab: "texto" })}
                            className={`cursor-pointer ${i > 0 ? "mt-[18px]" : ""}`}
                          >
                            <div className="text-sm leading-5 text-muted-foreground">
                              {r.label}
                            </div>
                            <div className="flex items-start gap-2">
                              {editing ? (
                                renderEditor(r)
                              ) : (
                                <ClampedValue
                                  text={r.secret && shown.includes(r.id) ? r.raw : r.value}
                                  full={open}
                                  className={`break-words text-sm leading-5 ${r.empty ? "italic text-[var(--faint)]" : r.secret ? "font-mono tracking-[0.15em] text-muted-foreground" : "text-foreground"}`}
                                />
                              )}
                              {r.secret && !r.empty && !editing ? (
                                <button
                                  type="button"
                                  aria-label={shown.includes(r.id) ? "Ocultar" : "Mostrar"}
                                  title={shown.includes(r.id) ? "Ocultar" : "Mostrar"}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShown((cur) => (cur.includes(r.id) ? cur.filter((x) => x !== r.id) : [...cur, r.id]));
                                  }}
                                  className={`${ICON_BTN} -my-1 size-7 flex-none print:hidden`}
                                >
                                  {shown.includes(r.id) ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                </button>
                              ) : null}
                            </div>
                            <div className="text-sm leading-5 text-muted-foreground">
                              Quem Pode Ver: <AudienceText au={r.au} />
                            </div>
                          </div>
                        );
                      })}
                      {rows.length === 0 ? (
                        <div className="text-[13px] font-medium text-muted-foreground">Nenhum campo corresponde à busca.</div>
                      ) : null}
                      {(() => {
                        // "+ Campo" lista TODO campo vazio da categoria (os que só existem no anúncio vão com cadeado).
                        const empties = (sec?.rows ?? []).filter(
                          (r) => isOptionalEmpty(r) && !revealed.includes(r.id) && edit?.id !== r.id,
                        );
                        return (
                          <div className="mt-5 flex gap-2 print:hidden">
                            {empties.length > 0 ? (
                              <button type="button" onClick={() => setPick(idx)} className={PILL}>
                                + Campo
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() =>
                                setAdding({ section: meta.num ? Number(meta.num) : idx + 1, label: "", value: "", note: "", au: "P" })
                              }
                              className={PILL}
                            >
                              + Nova Info
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  ) : null}

                  {idx < PLAYBOOK_SECTIONS.length - 1 ? (
                    <div className="ml-[50px] h-px bg-[var(--panel-div)]" />
                  ) : null}
                </section>
              );
            }
            return (
              <section
                key={meta.id}
                id={meta.id}
                className="ds-3d relative overflow-hidden rounded-[14px] border-0 bg-card print:break-inside-avoid-page"
              >
                {/* Cabeçalho inteiro é o botão da categoria (22/10/2026): tocar em qualquer ponto
                    abre/fecha a lista de campos daquela categoria. */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  onClick={() => {
                    setOpenSection((cur) => toggleSection(cur, meta.id));
                    setOpenRows([]);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenSection((cur) => toggleSection(cur, meta.id));
                      setOpenRows([]);
                    }
                  }}
                  className={`flex cursor-pointer items-start gap-3 py-4 pl-5 pr-4 transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_2.5%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[900px]:px-4 ${isOpen ? "border-b border-[var(--panel-div)]" : ""}`}
                >
                  <span className="grid size-6 flex-none place-items-center self-center rounded-lg bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] font-display text-xs font-bold text-muted-foreground">
                    {meta.num}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className={`font-display text-[15px] font-bold leading-tight text-foreground ${isOpen ? "" : "max-[900px]:truncate max-[900px]:whitespace-nowrap"}`}
                    >
                      {meta.title}
                    </div>
                    <div className={`mt-0.5 text-xs font-medium leading-[1.45] text-muted-foreground ${isOpen ? "" : "max-[900px]:truncate max-[900px]:whitespace-nowrap"}`}>
                      {meta.desc}
                    </div>
                  </div>
                  <span className="mt-px inline-grid h-4 min-w-4 flex-none place-items-center rounded-full bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)] px-[5px] text-[9.5px] font-extrabold leading-none tabular-nums text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]">
                    {qq ? `${rows.length} de ${all.length}` : `${all.length} campos`}
                  </span>
                </div>

                {isOpen ? (
                  <div>
                   <div className="overflow-x-auto">
                    <div className={TABLE_COLS}>
                    <div
                      className={`${ROW_GRID} border-b border-[var(--panel-div)] bg-[var(--panel-well)] text-muted-foreground`}
                    >
                      {["Campo", "Valor / Instrução", "Observação da IA", "Audiência"].map((h, i) => (
                        <div key={h} className={`ds-eyebrow whitespace-nowrap px-4 py-2.5 `}>
                          {h}
                        </div>
                      ))}
                    </div>

                    {rows.map((r) => {
                      const open = read || openRows.includes(r.id);
                      const editing = edit?.id === r.id;
                      const noteVal = notes[r.id] ?? r.note;
                      return (
                        <div
                          key={r.id}
                          onClick={() => setOpenRows((cur) => toggleRow(cur, r.id))}
                          className={`relative cursor-pointer border-b border-[var(--panel-div)] text-[13px] font-medium leading-normal transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_2.5%,transparent)] ${ROW_GRID} ${open ? "bg-[var(--panel-well)]" : ""}`}
                        >
                          <div className="min-w-0 break-words px-4 py-3 font-extrabold text-foreground">
                            {r.label}
                          </div>

                          <div className="flex min-w-0 items-start gap-2 break-words px-4 py-3">
                            {editing ? (
                              renderEditor(r)
                            ) : (
                              <span
                                className={`min-w-0 flex-1 whitespace-pre-line block ${r.value.length > 600 ? "max-h-[min(60vh,28rem)] overflow-y-auto overscroll-contain pr-1" : ""} ${r.empty ? "italic text-[var(--faint)]" : r.secret ? "font-mono tracking-[0.15em] text-muted-foreground" : "text-foreground"}`}
                              >
                                {r.secret && shown.includes(r.id) ? r.raw : r.value}
                              </span>
                            )}
                            {r.secret && !r.empty && !editing ? (
                              <button
                                type="button"
                                aria-label={shown.includes(r.id) ? "Ocultar" : "Mostrar"}
                                title={shown.includes(r.id) ? "Ocultar" : "Mostrar"}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShown((cur) => (cur.includes(r.id) ? cur.filter((x) => x !== r.id) : [...cur, r.id]));
                                }}
                                className={`${ICON_BTN} size-7 flex-none print:hidden`}
                              >
                                {shown.includes(r.id) ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                              </button>
                            ) : null}
                            {/* Botões copiar/editar/excluir ocultos por ora (pedido 22/10/2026). */}
                          </div>

                          <div
                            className={`min-w-0 break-words px-4 py-3 text-xs leading-[1.45] text-muted-foreground`}
                          >
                            {open ? (
                              <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase leading-tight tracking-[0.08em] text-[var(--faint)]">
                                <Lock className="size-[11px]" />
                                Observação da IA · padrão do sistema
                              </span>
                            ) : null}
                            <span className={open ? "block" : CLAMP2}>{r.obs}</span>
                            {open ? renderNote(r, noteVal) : null}
                          </div>

                          <div className="flex flex-col items-start gap-2 whitespace-nowrap px-4 py-3">
                            <AudienceChip au={r.au} />
                            {!r.empty && !!r.edit && classifyBulkRow(r.id).ok ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReplicating(r);
                                }}
                                className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground hover:text-foreground print:hidden"
                              >
                                <CopyPlus className="size-[13px]" />
                                Replicar
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                    </div>
                   </div>

                    {rows.length === 0 ? (
                      <div className="px-5 py-6 text-[13px] font-medium text-muted-foreground">Nenhum campo corresponde à busca.</div>
                    ) : null}

                    <div className="flex flex-wrap gap-2 px-4 py-3 print:hidden">
                      {renderAddButtons(meta, idx, hidden)}
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
        )}
      </div>

      <ReplicateRowDialog
        propertyId={propertyId}
        row={replicating ? { id: replicating.id, label: replicating.label, value: replicating.value } : null}
        onClose={() => setReplicating(null)}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{toDelete?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.removesRow
                ? "A linha sai do Playbook e a IA deixa de usá-la."
                : "O valor é apagado e a linha volta a “não cadastrado”. O que vem do anúncio não é alterado."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const row = toDelete;
                if (!row) return;
                await run(() => deleteFn({ data: { propertyId, rowId: row.id } }), "Excluído.");
                setToDelete(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={narrow && !!viewRow} onOpenChange={(v) => !v && setView(null)}>
        <DialogContent aria-describedby={undefined} className="flex max-w-lg flex-col gap-0 overflow-hidden p-0">
          {viewRow && view ? (
            <>
              <div className="min-w-0 shrink-0 pb-4 pl-5 pr-11 pt-5">
                <div className="mb-0.5 truncate text-xs font-semibold leading-[18px] text-warning/80">
                  {PLAYBOOK_SECTIONS[view.idx]?.title}
                </div>
                <DialogTitle className="font-display text-base font-semibold leading-[22px] text-foreground">
                  {viewRow.label}
                </DialogTitle>
              </div>
              <div className="sg-elegant-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4">
                {view.tab === "texto" ? (
                  <div className={viewRow.empty ? "italic text-[var(--faint)]" : viewRow.secret ? "font-mono tracking-[0.15em] text-muted-foreground" : "text-foreground"}>
                    {(viewRow.secret && shown.includes(viewRow.id) ? viewRow.raw : viewRow.value).split("\n").map((line, i) => (
                      <p key={i} data-clip-row className={`break-words text-sm leading-5 ${i > 0 ? "mt-3.5" : ""}`}>
                        {line}
                      </p>
                    ))}
                  </div>
                ) : null}
                {view.tab === "nota" ? renderNote(viewRow, notes[viewRow.id] ?? viewRow.note, "") : null}
                {view.tab === "ia" ? (
                  <div className="text-sm leading-5 text-muted-foreground">
                    <span className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase leading-tight tracking-[0.08em] text-[var(--faint)]">
                      <Lock className="size-[11px]" />
                      Observação da IA · padrão do sistema
                    </span>
                    {viewRow.obs ? <>{viewRow.obs}<br /></> : null}
                    {AUD_NAME[viewRow.au]}: {AUDIENCE_HELP[viewRow.au].toLowerCase()}
                  </div>
                ) : null}
                <div className="h-px bg-[var(--panel-div)]" />
                <div className="flex items-center justify-between gap-3 text-[13px] leading-[18px] text-muted-foreground">
                  <span className="min-w-0 flex-1">
                    {AUD_NAME[viewRow.au]} · {AUDIENCE_HELP[viewRow.au].charAt(0).toLowerCase() + AUDIENCE_HELP[viewRow.au].slice(1)}
                  </span>
                  {!viewRow.empty && !!viewRow.edit && classifyBulkRow(viewRow.id).ok ? (
                    <button
                      type="button"
                      onClick={() => {
                        setReplicating(viewRow);
                        setView(null);
                      }}
                      className="inline-flex flex-none items-center gap-1 font-bold hover:text-foreground print:hidden"
                    >
                      <CopyPlus className="size-[13px]" />
                      Replicar
                    </button>
                  ) : null}
                </div>
              </div>
              {/* ABAS NO RODAPÉ FIXO (mockup "A · Abas no rodapé", 26/10/2026): o miolo rola e as abas ficam sempre
                  visíveis na base da janela. */}
              <div role="tablist" className="flex shrink-0 border-t border-[var(--panel-div)]">
                {(
                  [
                    ["texto", "Texto"],
                    ["nota", "Nota"],
                    ["ia", "IA"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={view.tab === key}
                    onClick={() => setView({ ...view, tab: key })}
                    className={`relative h-11 flex-1 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                      view.tab === key
                        ? "text-foreground after:absolute after:inset-x-[13px] after:top-0 after:h-0.5 after:rounded-sm after:bg-[linear-gradient(120deg,#7c1ad8,#e82dae)] after:content-['']"
                        : "text-muted-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* CELULAR — "+ Campo": todos os campos vazios da categoria (mockup "Campo-Lista"). */}
      <Dialog open={narrow && pick !== null} onOpenChange={(v) => !v && setPick(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-lg gap-3.5 p-5">
          {pick !== null ? (
            <>
              <div className="min-w-0 pr-6">
                <DialogTitle className="font-display text-base font-semibold leading-[22px] text-foreground">Campos Vazios</DialogTitle>
                <div className="mt-0.5 truncate text-xs leading-[18px] text-muted-foreground">
                  Categoria {PLAYBOOK_SECTIONS[pick]?.num} · {PLAYBOOK_SECTIONS[pick]?.title}
                </div>
              </div>
              <p className="-mt-1 text-[13px] leading-[18px] text-muted-foreground">
                Escolha um campo para preencher. Os marcados com cadeado só podem ser editados no anúncio da plataforma.
              </p>
              <div>
                {(sections[pick]?.rows ?? [])
                  .filter((r) => isOptionalEmpty(r) && !revealed.includes(r.id) && edit?.id !== r.id)
                  .map((r) => {
                    const isLocked = !r.edit;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        data-clip-row
                        onClick={() => {
                          setPick(null);
                          if (isLocked) {
                            setLocked(r);
                            return;
                          }
                          setOpenSection(PLAYBOOK_SECTIONS[pick]?.id ?? null);
                          setRevealed((cur) => [...cur, r.id]);
                          startEdit(r);
                        }}
                        className="flex min-h-11 w-full items-center gap-2.5 border-t border-[var(--panel-div)] px-1 text-left"
                      >
                        <span className="grid w-4 flex-none place-items-center text-muted-foreground">
                          {isLocked ? <Lock className="size-[13px]" strokeWidth={1.8} /> : <Plus className="size-3.5" strokeWidth={1.8} />}
                        </span>
                        <span className={`min-w-0 flex-1 text-sm leading-5 ${isLocked ? "text-muted-foreground" : "text-foreground"}`}>{r.label}</span>
                        {isLocked ? (
                          <span className="flex-none text-[11px] font-semibold tracking-[0.04em] text-[var(--faint)]">Só no Airbnb</span>
                        ) : null}
                      </button>
                    );
                  })}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* CELULAR — alerta de campo que só se edita no anúncio (mockup "Campo-Alerta"). */}
      <Dialog open={narrow && !!locked} onOpenChange={(v) => !v && setLocked(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-lg gap-4 p-5">
          <div className="flex items-center gap-2.5 pr-6">
            <Lock className="size-[22px] flex-none text-warning" strokeWidth={1.8} />
            <DialogTitle className="font-display text-base font-semibold leading-[22px] text-foreground">Edite no Airbnb</DialogTitle>
          </div>
          <p className="text-sm leading-5 text-foreground">
            O campo <b className="font-semibold">{locked?.label}</b> vem do anúncio na plataforma e só pode ser alterado lá. Depois de
            salvar no Airbnb, a sincronização atualiza o Playbook sozinha.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setLocked(null)}
              className="inline-flex h-9 items-center rounded-[9px] bg-foreground px-[18px] text-[13px] font-bold text-background"
            >
              Entendi
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* CELULAR — "+ Nova Info" (mockups "Nova-Info" e "Nova-Info-Aberto"). */}
      <Dialog open={narrow && !!adding} onOpenChange={(v) => !v && setAdding(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-lg gap-3.5 p-5">
          {adding ? (
            <>
              <div className="min-w-0 pr-6">
                <DialogTitle className="font-display text-base font-semibold leading-[22px] text-foreground">Nova Info</DialogTitle>
                <div className="mt-0.5 truncate text-xs leading-[18px] text-muted-foreground">
                  Categoria {adding.section} · {PLAYBOOK_SECTIONS[adding.section - 1]?.title}
                </div>
              </div>
              <div>
                <div className={FIELD_LABEL}>
                  Título<span className="font-semibold normal-case tracking-[0.04em] text-warning"> · Obrigatório</span>
                </div>
                <input
                  value={adding.label}
                  onChange={(e) => setAdding({ ...adding, label: e.target.value })}
                  maxLength={120}
                  placeholder="Ex.: Horário da coleta de lixo"
                  className={`h-10 w-full rounded-[9px] border-0 px-3 text-sm text-foreground outline-none placeholder:text-[var(--faint)] ${WELL}`}
                />
              </div>
              <div>
                <div className={FIELD_LABEL}>
                  Texto<span className="font-semibold normal-case tracking-[0.04em] text-warning"> · Obrigatório</span>
                </div>
                <textarea
                  rows={2}
                  value={adding.value}
                  onChange={(e) => setAdding({ ...adding, value: e.target.value })}
                  placeholder="O que o hóspede precisa saber"
                  className={`block h-[60px] w-full resize-none rounded-[9px] border-0 px-3 py-2.5 text-sm leading-5 text-foreground outline-none placeholder:text-[var(--faint)] ${WELL}`}
                />
              </div>
              <div>
                <div className={FIELD_LABEL}>
                  Nota do Anfitrião<span className="font-semibold normal-case tracking-[0.04em] text-muted-foreground"> · Opcional</span>
                </div>
                <textarea
                  rows={1}
                  value={adding.note}
                  onChange={(e) => setAdding({ ...adding, note: e.target.value })}
                  placeholder="Contexto só deste imóvel, que a IA lê junto"
                  className={`block h-10 w-full resize-none rounded-[9px] border-0 px-3 py-2.5 text-sm leading-5 text-foreground outline-none placeholder:text-[var(--faint)] ${WELL}`}
                />
              </div>
              <div>
                <div className={FIELD_LABEL}>Quem Pode Ver</div>
                <Popover open={audOpen} onOpenChange={setAudOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={`flex h-10 w-full items-center justify-between rounded-[9px] px-3 text-sm text-foreground ${WELL}`}
                    >
                      <span className="flex items-center gap-2">
                        <i className={`size-2 rounded-full ${NEW_INFO_AUD.find((o) => o.au === adding.au)?.dot}`} />
                        {NEW_INFO_AUD.find((o) => o.au === adding.au)?.label}
                      </span>
                      <ChevronDown className="size-3.5 text-muted-foreground" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] rounded-xl p-1.5">
                    {NEW_INFO_AUD.map((o) => (
                      <button
                        key={o.au}
                        type="button"
                        onClick={() => {
                          setAdding({ ...adding, au: o.au });
                          setAudOpen(false);
                        }}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${adding.au === o.au ? "bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)]" : ""}`}
                      >
                        <i className={`size-2 flex-none rounded-full ${o.dot}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm leading-5 text-foreground">{o.label}</span>
                          <span className="block text-xs leading-4 text-muted-foreground">{AUDIENCE_HELP[o.au].replace(/\.$/, "")}</span>
                        </span>
                        {adding.au === o.au ? <Check className="size-3.5 flex-none text-foreground" /> : null}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
                <div className="mt-1.5 text-xs leading-4 text-muted-foreground">{AUDIENCE_HELP[adding.au]}</div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAdding(null)}
                  className="inline-flex h-9 items-center rounded-[9px] bg-[color-mix(in_oklab,var(--foreground)_4.5%,transparent)] px-4 text-[13px] font-bold text-muted-foreground"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={busy || !adding.label.trim() || !adding.value.trim()}
                  onClick={async () => {
                    let rowId = "";
                    const ok = await run(async () => {
                      const r = (await addFn({
                        data: { propertyId, section: adding.section, label: adding.label, value: adding.value, audience: adding.au },
                      })) as { rowId?: string };
                      rowId = r?.rowId ?? "";
                      if (rowId && adding.note.trim()) await noteFn({ data: { propertyId, rowId, note: adding.note } });
                    }, "Info adicionada.");
                    if (ok) setAdding(null);
                  }}
                  className="inline-flex h-9 items-center rounded-[9px] bg-foreground px-[18px] text-[13px] font-bold text-background disabled:opacity-50"
                >
                  Adicionar
                </button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!narrow && !!adding} onOpenChange={(v) => !v && setAdding(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar linha / campo</DialogTitle>
          </DialogHeader>
          {adding ? (
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className="ds-eyebrow text-muted-foreground">Campo</span>
                <input
                  value={adding.label}
                  onChange={(e) => setAdding({ ...adding, label: e.target.value })}
                  maxLength={120}
                  placeholder="Ex.: Horário da coleta de lixo"
                  className={`h-10 w-full rounded-lg border-0 px-3 text-[13px] text-foreground outline-none ${WELL}`}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="ds-eyebrow text-muted-foreground">Valor / Instrução</span>
                <textarea
                  rows={3}
                  value={adding.value}
                  onChange={(e) => setAdding({ ...adding, value: e.target.value })}
                  className={`block w-full resize-none rounded-lg border-0 px-3 py-2 text-[13px] text-foreground outline-none ${WELL}`}
                />
              </label>
              <div className="space-y-1.5">
                <span className="ds-eyebrow text-muted-foreground">Audiência</span>
                <div className="flex flex-wrap gap-2">
                  {(["G", "P", "I"] as Audience[]).map((au) => (
                    <button
                      key={au}
                      type="button"
                      onClick={() => setAdding({ ...adding, au })}
                      aria-pressed={adding.au === au}
                      className={`rounded-full ${adding.au === au ? "ring-2 ring-foreground/40" : "opacity-60"}`}
                    >
                      <AudienceChip au={au} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <button
              type="button"
              onClick={() => setAdding(null)}
              className={`h-9 rounded-lg px-4 text-xs font-bold text-muted-foreground ${WELL}`}
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy || !adding?.label.trim()}
              onClick={async () => {
                if (!adding) return;
                const ok = await run(
                  () =>
                    addFn({
                      data: { propertyId, section: adding.section, label: adding.label, value: adding.value, audience: adding.au },
                    }),
                  "Linha adicionada.",
                );
                if (ok) setAdding(null);
              }}
              className="h-9 rounded-lg bg-foreground px-4 text-xs font-bold text-background disabled:opacity-50"
            >
              Adicionar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditField({ row, draft, onChange }: { row: PlaybookRow; draft: string; onChange: (v: string) => void }) {
  const base = `w-full rounded-lg border-0 px-3 text-[13px] font-medium text-foreground outline-none ${WELL}`;
  if (row.edit === "bool") {
    return (
      <select value={draft} onChange={(e) => onChange(e.target.value)} className={`h-10 ${base}`}>
        <option value="false">Não · casa independente, sem portaria</option>
        <option value="true">Sim · em condomínio</option>
      </select>
    );
  }
  if (row.edit === "access") {
    return (
      <select value={draft} onChange={(e) => onChange(e.target.value)} className={`h-10 ${base}`}>
        <option value="public">Público · sem fechadura eletrônica</option>
        <option value="pin">Com código (PIN)</option>
      </select>
    );
  }
  if (row.edit === "int") {
    return <input inputMode="numeric" value={draft} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))} className={`h-10 ${base}`} />;
  }
  if (row.edit === "text") {
    return <input value={draft} onChange={(e) => onChange(e.target.value)} className={`h-10 ${base}`} />;
  }
  return <textarea rows={4} value={draft} onChange={(e) => onChange(e.target.value)} className={`block resize-y py-2 ${base}`} />;
}
