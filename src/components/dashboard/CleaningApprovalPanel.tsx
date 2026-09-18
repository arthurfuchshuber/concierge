import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock3 } from "lucide-react";
import { toast } from "sonner";
import { CARD_OWNER } from "@/components/dashboard/card-colors";
import { PANEL_SHELL, PanelHeading, CountPill } from "@/components/dashboard/panel-chrome";
import { notifyAction } from "@/components/UndoActionBar";
import {
  decideCleaningApproval,
  listCleaningApprovals,
  undoCleaningDecision,
  type CleaningApprovalItem,
} from "@/lib/cleaning-approval.functions";
import type { CleaningDayItem, CleaningDailyPoint } from "@/lib/dashboard.functions";

/**
 * "LIMPEZAS COMPLETAS PARA APROVAR" — aba Limpeza (mockup aprovado,
 * 17/09/2026: bloco com borda de luz, mesma linguagem do bloco de atenção dos
 * Registros, em âmbar porque aqui é espera e não problema).
 *
 * Aparece só quando existe completa pendente. Quem pode aprovar vê os dois
 * botões; os demais (ex.: o prestador que concluiu) veem a mesma lista com a
 * etiqueta "Aguardando aprovação", para saber que o pedido chegou.
 */

export const CLEANING_APPROVALS_KEY = "dash-cleaning-approvals";

function brl(cents: number | null): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "hoje, 14:20" / "ontem, 16:05" / "12/09, 09:30" — fuso de São Paulo. */
function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const tz = "America/Sao_Paulo";
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const d = new Date(iso);
  const time = d.toLocaleTimeString("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  const today = day(new Date());
  const yesterday = day(new Date(Date.now() - 86_400_000));
  const dd = day(d);
  if (dd === today) return `hoje, ${time}`;
  if (dd === yesterday) return `ontem, ${time}`;
  const short = d.toLocaleDateString("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit" });
  return `${short}, ${time}`;
}

export function CleaningApprovalPanel({
  ownerId,
  propertyIds,
  enabled,
}: {
  ownerId: string | null;
  propertyIds?: string[];
  enabled: boolean;
}) {
  const listFn = useServerFn(listCleaningApprovals);
  const decideFn = useServerFn(decideCleaningApproval);
  const undoFn = useServerFn(undoCleaningDecision);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: [CLEANING_APPROVALS_KEY, ownerId ?? "self", propertyIds?.join(",") ?? ""],
    queryFn: () => listFn({ data: { ownerId, propertyIds } }),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    enabled,
  });

  /**
   * RESPOSTA INSTANTÂNEA (pedido explícito, 17/09/2026, com print: "cliquei
   * em 'normal' e ele ficou carregando... as respostas de QUALQUER ação
   * precisam ser INSTANTÂNEAS").
   *
   * O clique já mexe na tela: o item sai do bloco e os cards de cima mudam
   * na hora (otimista). O servidor confirma em segundo plano; se ele falhar
   * — ou não responder em 15s — tudo volta como estava e aparece o erro.
   * Nada de botão girando: não existe mais estado de "carregando" aqui.
   * Os outros usuários recebem pelo canal ao vivo do dashboard.
   */
  function decide(it: CleaningApprovalItem, decision: "approve" | "normal") {
    const snapshots: Array<[QueryKey, unknown]> = [
      ...qc.getQueriesData({ queryKey: [CLEANING_APPROVALS_KEY] }),
      ...qc.getQueriesData({ queryKey: ["dash-cleaning-stats"] }),
    ];
    void qc.cancelQueries({ queryKey: [CLEANING_APPROVALS_KEY] });
    void qc.cancelQueries({ queryKey: ["dash-cleaning-stats"] });
    applyOptimistic(qc, it, decision);

    const request = withTimeout(decideFn({ data: { id: it.id, decision, ownerId } }), 15_000);
    request
      .catch((err) => {
        for (const [key, data] of snapshots) qc.setQueryData(key, data);
        toast.error(err instanceof Error ? err.message : "Não foi possível registrar a decisão.");
      })
      .finally(() => {
        void qc.invalidateQueries({ queryKey: [CLEANING_APPROVALS_KEY] });
        void qc.invalidateQueries({ queryKey: ["dash-cleaning-stats"] });
      });

    notifyAction(
      decision === "approve"
        ? "Limpeza completa aprovada — já entrou no custo."
        : "Registrada como limpeza normal.",
      () => {
        for (const [key, data] of snapshots) qc.setQueryData(key, data);
        void request
          .then(() => withTimeout(undoFn({ data: { id: it.id, ownerId } }), 15_000))
          .catch((err) => {
            toast.error(err instanceof Error ? err.message : "Não foi possível desfazer.");
          })
          .finally(() => {
            void qc.invalidateQueries({ queryKey: [CLEANING_APPROVALS_KEY] });
            void qc.invalidateQueries({ queryKey: ["dash-cleaning-stats"] });
          });
      },
    );
  }

  const items = q.data?.items ?? [];
  if (items.length === 0) return null;
  const canApprove = q.data?.canApprove === true;

  return (
    /* PADRÃO "PRESENÇA" (18/09/2026): era uma moldura âmbar inteira — borda,
       fundo tingido, ícone e contagem, tudo da mesma cor. Virou um card
       normal com um FIO âmbar na aresta de cima e o cabeçalho de bloco
       comum às três abas (`PanelHeading`). Continua sendo a primeira coisa
       que se vê depois dos números, sem ser a mais barulhenta. */
    <section
      aria-label="Limpezas completas para aprovar"
      className={`${PANEL_SHELL} mt-1.5 px-1.5 pb-1.5 pt-3`}
    >
      <span
        aria-hidden
        className="absolute inset-x-3 top-0 h-[2px] rounded-b-[3px] bg-gradient-to-r from-[#c9a962] to-transparent"
      />
      <PanelHeading
        title="Limpezas completas para aprovar"
        dot={
          <span className="ds-atencao grid size-[22px] shrink-0 place-items-center rounded-md bg-[#c9a962]/12">
            <Clock3 className="size-[13px]" strokeWidth={2.2} />
          </span>
        }
        right={<CountPill>{items.length}</CountPill>}
        className="mb-1 px-1.5"
      />
      <p className="px-1.5 pb-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
        {canApprove
          ? "Só entram no custo depois de aprovadas. “Foi normal” registra com o valor da limpeza normal."
          : "Só entram no custo depois que o gestor aprovar."}
      </p>
      <div className="grid gap-1.5 lg:grid-cols-2">
        {items.map((it) => (
          <ApprovalRow
            key={it.id}
            item={it}
            canApprove={canApprove}
            onDecide={(decision) => decide(it, decision)}
          />
        ))}
      </div>
    </section>
  );
}

function ApprovalRow({
  item,
  canApprove,
  onDecide,
}: {
  item: CleaningApprovalItem;
  canApprove: boolean;
  onDecide: (decision: "approve" | "normal") => void;
}) {
  const meta = [whenLabel(item.concludedAt), item.doneByName ? `por ${item.doneByName}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={`${PANEL_SHELL} flex flex-col gap-2.5 p-3`}>
      <div className="flex justify-between gap-2.5">
        <div className="min-w-0">
          <span className="ds-card-title block">{item.propertyName}</span>
          {item.ownerName && (
            <span className={`mt-0.5 block truncate text-[10.5px] ${CARD_OWNER}`}>
              {item.ownerName}
            </span>
          )}
          {meta && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{meta}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-[15px] font-bold tabular-nums">{brl(item.priceCents)}</p>
          {item.normalPriceCents != null && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              normal: {brl(item.normalPriceCents)}
            </p>
          )}
        </div>
      </div>
      {canApprove ? (
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => onDecide("normal")}
            className="h-10 rounded-md border border-border text-[12.5px] font-bold transition-colors hover:bg-secondary/50 active:scale-[0.98]"
          >
            Foi normal
          </button>
          <button
            type="button"
            onClick={() => onDecide("approve")}
            className="flex h-10 items-center justify-center rounded-md bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-[12.5px] font-bold text-white transition-opacity hover:opacity-90 active:scale-[0.98]"
          >
            Aprovar completa
          </button>
        </div>
      ) : (
        <p className="ds-atencao text-[10.5px] font-extrabold uppercase tracking-[0.1em]">
          Aguardando aprovação
        </p>
      )}
    </div>
  );
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("O servidor demorou para responder. Tente de novo.")),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Dia local (São Paulo, UTC-3 fixo) de um instante — mesma regra do servidor. */
function spDate(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

type StatsData = {
  cleaningsDone: number;
  totalCents: number;
  daily: CleaningDailyPoint[];
  pendingApproval: { count: number; totalCents: number };
  items: CleaningDayItem[];
};

/** O efeito da decisão, aplicado direto no cache — o que o servidor vai
 * devolver na próxima leitura. */
function applyOptimistic(
  qc: ReturnType<typeof useQueryClient>,
  it: CleaningApprovalItem,
  decision: "approve" | "normal",
) {
  qc.setQueriesData<{ canApprove: boolean; items: CleaningApprovalItem[] }>(
    { queryKey: [CLEANING_APPROVALS_KEY] },
    (old) => (old ? { ...old, items: old.items.filter((x) => x.id !== it.id) } : old),
  );
  const cents = (decision === "approve" ? it.priceCents : it.normalPriceCents) ?? 0;
  const day = it.concludedAt ? spDate(it.concludedAt) : null;
  for (const [key, data] of qc.getQueriesData<StatsData>({ queryKey: ["dash-cleaning-stats"] })) {
    if (!data) continue;
    const start = String(key[2] ?? "");
    const end = String(key[3] ?? "");
    const inRange = !!day && day >= start && day <= end;
    if (!inRange) continue;
    qc.setQueryData<StatsData>(key, {
      ...data,
      cleaningsDone: data.cleaningsDone + 1,
      totalCents: data.totalCents + cents,
      pendingApproval: {
        count: Math.max(0, data.pendingApproval.count - 1),
        totalCents: Math.max(0, data.pendingApproval.totalCents - (it.priceCents ?? 0)),
      },
      daily: data.daily.map((p) =>
        p.date === day ? { ...p, count: p.count + 1, totalCents: p.totalCents + cents } : p,
      ),
      items: (data.items ?? []).map((x) =>
        x.id === it.id
          ? {
              ...x,
              pending: false,
              cleaningType: decision === "approve" ? "completa" : "normal",
              priceCents: cents,
            }
          : x,
      ),
    });
  }
}
