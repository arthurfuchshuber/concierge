import { useMemo, useState } from "react";
import { PageDateRow, PAGE_BACK_CLASS } from "@/components/ds/PageDateRow";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, BookOpen, Copy, Info, Lock, PencilLine, Plus, Printer, Trash2 } from "lucide-react";
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
import { AUDIENCE_LABEL, PLAYBOOK_SECTIONS, type Audience } from "@/lib/playbook-catalog";

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

function Legend() {
  const items: Array<[Audience, string]> = [
    ["G", "Liberado só durante estadia confirmada."],
    ["P", "Liberado já na pré-reserva."],
    ["I", "Confidencial, nunca exibido ao hóspede."],
  ];
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
  const [adding, setAdding] = useState<{ section: number; label: string; value: string; au: Audience } | null>(null);

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
              <OwnerLine
                name={owner.name}
                phone={owner.phone}
                country={owner.country}
                phonePosition="adjacent"
                variant="neutral"
                label={`Proprietário(a): ${owner.name.trim().split(/\s+/)[0]}`}
              />
            ) : null}
          </div>
        </div>

        <SearchActionRow
          value={q}
          onChange={setQ}
          placeholder="Buscar campo, valor ou observação"
          className="print:hidden"
          actions={
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
          }
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

        <Legend />

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
          PLAYBOOK_SECTIONS.map((meta, idx) => {
            const sec = sections[idx];
            const all = sec?.rows ?? [];
            const rows = all.filter((r) => matchesQuery(r, qq));
            const isOpen = qq ? rows.length > 0 : read || openSection === meta.id;
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
                              <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
                                <EditField row={r} draft={edit!.draft} onChange={(v) => setEdit({ id: r.id, draft: v })} />
                                <div className="mt-2 flex gap-2">
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={async () => {
                                      const ok = await run(
                                        () => saveFn({ data: { propertyId, rowId: r.id, value: edit!.draft } }),
                                        "Salvo.",
                                      );
                                      if (ok) setEdit(null);
                                    }}
                                    className="h-8 rounded-lg bg-foreground px-3 text-xs font-bold text-background disabled:opacity-50"
                                  >
                                    Salvar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEdit(null)}
                                    className={`h-8 rounded-lg px-3 text-xs font-bold text-muted-foreground ${WELL}`}
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <span
                                className={`min-w-0 flex-1 whitespace-pre-line block ${r.empty ? "italic text-[var(--faint)]" : r.secret ? "font-mono tracking-[0.15em] text-muted-foreground" : "text-foreground"}`}
                              >
                                {r.value}
                              </span>
                            )}
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
                            {open ? (
                              <div className="mt-3" onClick={(e) => e.stopPropagation()}>
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
                                    void run(() => noteFn({ data: { propertyId, rowId: r.id, note: notes[r.id] ?? "" } }), "Nota salva.").then(
                                      (ok) => {
                                        if (ok) setNotes((p) => { const { [r.id]: _x, ...rest } = p; return rest; });
                                      },
                                    );
                                  }}
                                  placeholder="Contexto só deste imóvel, que a IA lê junto da instrução padrão."
                                  className={`block min-h-14 w-full resize-none rounded-lg border-0 px-3 py-2 text-[13px] font-medium leading-[1.45] text-foreground outline-none placeholder:text-[var(--faint)] focus:shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--accent)_60%,transparent)] ${WELL}`}
                                />
                              </div>
                            ) : null}
                          </div>

                          <div className="flex flex-col items-start gap-2 whitespace-nowrap px-4 py-3">
                            <AudienceChip au={r.au} />
                          </div>
                        </div>
                      );
                    })}
                    </div>
                   </div>

                    {rows.length === 0 ? (
                      <div className="px-5 py-6 text-[13px] font-medium text-muted-foreground">Nenhum campo corresponde à busca.</div>
                    ) : null}

                    <div className="px-4 py-3 print:hidden">
                      <button
                        type="button"
                        onClick={() => setAdding({ section: meta.num ? Number(meta.num) : idx + 1, label: "", value: "", au: "I" })}
                        className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-bold text-muted-foreground hover:text-foreground ${WELL}`}
                      >
                        <Plus className="size-[15px]" />
                        Adicionar linha / campo
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })
        )}
      </div>

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

      <Dialog open={!!adding} onOpenChange={(v) => !v && setAdding(null)}>
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
