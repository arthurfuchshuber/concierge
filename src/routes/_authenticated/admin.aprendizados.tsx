import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CircleCheck, Check, Funnel, Hourglass, LoaderCircle, Pencil, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { PageShell } from "@/components/ds/PageShell";
import { Stepper } from "@/components/editor/Stepper";
import { SearchActionRow } from "@/components/dashboard/SearchActionRow";
import { Seg, AtdWindow, BTN_BRAND, BTN_SOFT } from "@/components/handoff/atd-window";
import { PropertyFilterWindow } from "@/components/handoff/PropertyFilterWindow";
import { useIsMobile } from "@/hooks/use-mobile";
import { useImpersonation } from "@/hooks/useImpersonation";
import {
  editLearning,
  listAtendimentoProperties,
  listLearnings,
  reviewLearning,
  setLearningScopeFn,
  type LearningItem,
} from "@/lib/atendimento.functions";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { LEARNING_AUDIENCE, type LearningCategory } from "@/lib/guest-ai/learning/learning";

export const Route = createFileRoute("/_authenticated/admin/aprendizados")({
  head: () => ({ meta: [{ title: "Aprendizados da IA | ConciergeIA" }] }),
  component: AprendizadosPage,
});

type Tab = "pending" | "approved" | "rejected";

const SOURCE_ORIGIN: Record<string, string> = {
  team_instruction: "Instrução da equipe",
  checkout_done: "Aprendido com uma estadia concluída",
  incident_resolved: "Aprendido com um atendimento resolvido",
  guest_confirmation: "Aprendido com a confirmação de um hóspede",
};


/**
 * APRENDIZADOS DA IA (mockups APR-D01/M01, aprovados em 25/11/2026). O que a IA aprendeu com a equipe e espera a
 * aprovação de quem pode decidir (titular, admin ou `ai_train`). Sem resposta, nada é ativado (12/11/2026).
 * Cada card: imóvel + proprietário, o aprendizado, a origem, "Vale Para" (Imóvel · Cidade · Conta), "Quem Vê"
 * e as ações Aprovar · Só Desta Vez · Editar.
 */
function AprendizadosPage() {
  const isMobile = useIsMobile();
  const { impersonation } = useImpersonation();
  const accountOwnerId = impersonation?.userId ?? null;
  const listFn = useServerFn(listLearnings);
  const propsFn = useServerFn(listAtendimentoProperties);
  const [tab, setTab] = useState<Tab>("pending");
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [propFilter, setPropFilter] = useState<string[]>([]);
  const q = useQuery({
    queryKey: ["learnings", tab, accountOwnerId ?? "self"],
    queryFn: () => listFn({ data: { status: tab, accountOwnerId } }),
    refetchInterval: 30_000,
  });
  const props = useQuery({
    queryKey: ["atendimento-properties", accountOwnerId ?? "self"],
    queryFn: () => propsFn({ data: { accountOwnerId } }),
    enabled: filterOpen,
    staleTime: 60_000,
  });
  const counts = q.data?.counts;
  const items = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (q.data?.items ?? []).filter(
      (i) =>
        (!propFilter.length || propFilter.includes(i.propertyId)) &&
        (!term || `${i.statement} ${i.propertyName} ${i.owner ?? ""}`.toLowerCase().includes(term)),
    );
  }, [q.data, search, propFilter]);

  const steps = [
    { value: "pending", label: "Pendentes", icon: Hourglass, count: counts?.pending ?? 0 },
    { value: "approved", label: "Aprovados", icon: CircleCheck, count: counts?.approved ?? 0 },
    { value: "rejected", label: "Recusados", icon: X, count: counts?.rejected ?? 0 },
  ];

  return (
    <div className="ds-page w-full max-w-none px-3.5 py-5 sm:px-5 lg:px-8 lg:pl-4 lg:py-8">
      <PageShell title="Aprendizados" subtitle="O que a IA aprendeu com a equipe e espera a sua aprovação. Sem resposta, nada é ativado." />
      <Stepper steps={steps} current={tab} onChange={(v) => setTab(v as Tab)} withIcons={!isMobile} compact={isMobile} />
      <SearchActionRow
        value={search}
        onChange={setSearch}
        placeholder="Buscar aprendizado, imóvel…"
        actions={
          <button type="button" aria-label="Filtrar por imóvel" onClick={() => setFilterOpen(true)} className="relative flex w-12 flex-none items-center justify-center text-muted-foreground lg:w-[52px]">
            <Funnel className="size-[15px]" />
            {propFilter.length ? (
              <span className="absolute right-2 top-2 grid h-4 min-w-4 place-items-center rounded-full bg-[#c9a962]/30 px-1 text-[9.5px] font-extrabold text-[#6b5214]">{propFilter.length}</span>
            ) : null}
          </button>
        }
      />
      {q.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" /> Carregando…
        </div>
      ) : items.length === 0 ? (
        <div className="ds-3d rounded-[14px] bg-card px-4 py-8 text-center">
          <p className="text-[13px] font-semibold">
            {tab === "pending" ? "Nenhum aprendizado esperando aprovação." : tab === "approved" ? "Nenhum aprendizado aprovado." : "Nenhum aprendizado recusado."}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">Os aprendizados da IA com a equipe aparecem aqui.</p>
        </div>
      ) : (
        <div className={isMobile ? "ds-card-grid grid-cols-[minmax(0,1fr)]" : "ds-card-grid grid-cols-3 items-start"}>
          {items.map((i) => (
            <LearnCard key={i.id} item={i} tab={tab} />
          ))}
        </div>
      )}
      <PropertyFilterWindow
        open={filterOpen}
        onOpenChange={setFilterOpen}
        loading={props.isLoading}
        options={props.data ?? []}
        value={propFilter}
        subtitle="Mostrar só os aprendizados destes imóveis"
        onApply={(v) => {
          setPropFilter(v);
          setFilterOpen(false);
        }}
      />
    </div>
  );
}

function LearnCard({ item, tab }: { item: LearningItem; tab: Tab }) {
  const qc = useQueryClient();
  const reviewFn = useServerFn(reviewLearning);
  const scopeFn = useServerFn(setLearningScopeFn);
  const editFn = useServerFn(editLearning);
  const [scope, setScope] = useState(item.scope);
  const [editOpen, setEditOpen] = useState(false);
  const [text, setText] = useState(item.statement);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["learnings"] });
  const review = useMutation({
    mutationFn: (action: "approve" | "reject" | "revoke") => reviewFn({ data: { id: item.id, action } }),
    onSuccess: async (_r, action) => {
      // escopo escolhido antes de aprovar passa a valer na hora
      if (action === "approve" && scope !== "property") await scopeFn({ data: { id: item.id, scope } }).catch(() => undefined);
      toast(action === "approve" ? "Aprendizado aprovado." : action === "reject" ? "Valeu só desta vez." : "Aprendizado desfeito.");
      refresh();
    },
    onError: (e) => toast.error(friendlyErrorMessage(e, "Não foi possível concluir.")),
  });
  const changeScope = useMutation({
    mutationFn: (s: "property" | "city" | "account") => scopeFn({ data: { id: item.id, scope: s } }),
    onSuccess: refresh,
    onError: (e) => toast.error(friendlyErrorMessage(e, "Não foi possível ajustar.")),
  });
  const edit = useMutation({
    mutationFn: () => editFn({ data: { id: item.id, statement: text.trim() } }),
    onSuccess: () => {
      setEditOpen(false);
      toast("Aprendizado atualizado.");
      refresh();
    },
    onError: (e) => toast.error(friendlyErrorMessage(e, "Não foi possível salvar.")),
  });
  const audience = LEARNING_AUDIENCE[item.category as LearningCategory] === "P" ? "Público" : "Reserva Ativa";
  const origin = `${SOURCE_ORIGIN[item.source] ?? "Aprendido com a equipe"} · ${format(new Date(item.createdAt), "dd/MM · HH:mm")}`;
  return (
    <div className="ds-3d relative flex flex-col gap-2.5 overflow-hidden rounded-[14px] bg-card p-3.5">
      <div className="ds-card-lines min-w-0">
        <span className="ds-card-title leading-tight">{item.propertyName}</span>
        {item.owner ? (
          <div className="flex min-w-0 items-center text-xs">
            <span className="min-w-0 truncate font-semibold">{item.owner}</span>
          </div>
        ) : null}
      </div>
      <p className="text-[13.5px] leading-[1.45]">{item.statement}</p>
      <p className="text-[11.5px] text-muted-foreground">{origin}</p>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Vale Para</span>
        <Seg
          options={[
            { value: "property", label: "Imóvel" },
            { value: "city", label: "Cidade" },
            { value: "account", label: "Conta" },
          ]}
          value={scope}
          onChange={(v) => {
            setScope(v);
            if (tab === "approved") changeScope.mutate(v);
          }}
        />
        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Quem Vê</span>
        <span>
          <span className="inline-flex items-center rounded-[5px] bg-[#7fb79a]/18 px-2 py-[3px] text-[10.5px] font-bold text-[#3f7a5c]">{audience}</span>
        </span>
      </div>
      {item.canApprove ? (
        <div className="flex items-center gap-1.5">
          {tab === "pending" ? (
            <>
              <button
                type="button"
                disabled={review.isPending}
                onClick={() => review.mutate("approve")}
                className="inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-2 rounded-[7px] bg-emerald-600 px-2.5 text-[11px] font-semibold text-white disabled:opacity-50"
              >
                <Check className="size-3.5" />
                Aprovar
              </button>
              <button
                type="button"
                disabled={review.isPending}
                onClick={() => review.mutate("reject")}
                className="inline-flex h-7 items-center rounded-[7px] bg-[var(--action-sq-bg)] px-2.5 text-[11px] font-semibold disabled:opacity-50"
              >
                Só Desta Vez
              </button>
              <button type="button" aria-label="Editar" onClick={() => setEditOpen(true)} className="grid size-7 place-items-center rounded-[7px] bg-[var(--action-sq-bg)] text-muted-foreground">
                <Pencil className="size-3.5" />
              </button>
            </>
          ) : tab === "approved" ? (
            <button
              type="button"
              disabled={review.isPending}
              onClick={() => review.mutate("revoke")}
              className="inline-flex h-7 items-center rounded-[7px] bg-[var(--action-sq-bg)] px-2.5 text-[11px] font-semibold disabled:opacity-50"
            >
              Desfazer
            </button>
          ) : null}
        </div>
      ) : tab === "pending" ? (
        <p className="text-[11px] text-muted-foreground">Esperando o titular ou quem treina a IA.</p>
      ) : null}
      <AtdWindow open={editOpen} onOpenChange={setEditOpen} title="Editar Aprendizado" subtitle={item.propertyName} width={340}>
        <div className="px-4 pt-3.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={400}
            className="min-h-[78px] w-full resize-none rounded-[9px] bg-[var(--panel-well)] px-2.5 py-[9px] text-[12.5px] font-medium leading-[1.45] text-foreground focus:outline-none"
          />
        </div>
        <div className="flex gap-2 px-4 pb-4 pt-3.5">
          <button type="button" className={BTN_SOFT} onClick={() => setEditOpen(false)}>
            Cancelar
          </button>
          <button type="button" disabled={text.trim().length < 15 || edit.isPending} onClick={() => edit.mutate()} className={BTN_BRAND}>
            Salvar
          </button>
        </div>
      </AtdWindow>
    </div>
  );
}
