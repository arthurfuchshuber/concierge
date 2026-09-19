/**
 * O BOTÃO "PENDÊNCIAS" — autossuficiente, para qualquer tela do dashboard.
 *
 * Pedido explícito (18/09/2026): o botão sai do Kanban e passa a morar nos
 * REGISTROS. Faz sentido — a aba de Registros já é onde as pendências
 * aparecem ("Precisam de atenção"), então é lá que a mão vai procurar.
 *
 * POR QUE ESTE ARQUIVO EXISTE, E POR QUE ELE É PEQUENO
 *
 * O painel em si (`TasksDialog`) tem mais de mil linhas e mora no
 * `OperationWorkspace`. Mudá-lo de casa seria mover ~1500 linhas junto com
 * todas as pecinhas que ele usa lá dentro — muito risco para uma tela que o
 * cliente usa todo dia, e sem chance de eu clicar no fluxo para conferir.
 *
 * Então o que se move é só o CONTROLE: este componente traz o botão, o estado
 * de aberto/fechado, as consultas e as mutações que o painel precisa, e
 * IMPORTA os dois diálogos de lá. A dependência é de mão única
 * (Registros → aqui → OperationWorkspace), sem ciclo, e nenhuma linha do
 * painel foi tocada — o que já funcionava continua sendo exatamente o mesmo
 * código.
 *
 * O QUE FICOU NO `OperationWorkspace`
 *
 * O outro gatilho da tela de conclusão: marcar uma pendência no CHECKLIST do
 * card de limpeza (`kind: "cleaning"`). Aquele fluxo carrega um card da
 * esteira (`ArrivalRow`) — dado que só o Kanban tem — e por isso não vem
 * junto. São dois caminhos para a mesma tela de conclusão, cada um na tela
 * que tem os dados dele; nunca abrem ao mesmo tempo.
 *
 * `guestNameForTask` é OPCIONAL de propósito: o nome do hóspede de uma
 * pendência sai da cadeia de consultas de chegadas/saídas, que só o Kanban
 * carrega. Nos Registros não vale acordar essa cadeia inteira para uma linha
 * de apoio — sem ela o painel mostra "Hóspede", como já fazia para qualquer
 * pendência sem reserva vinculada.
 */

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ListChecks } from "lucide-react";
import { toast } from "sonner";
import { notifyAction } from "@/components/UndoActionBar";
import {
  ACTION_SEGMENT,
  ACTION_BUTTON_TONE,
  ACTION_ICON,
} from "@/components/dashboard/panel-chrome";
import { TasksDialog, TaskResolveDialog } from "@/components/dashboard/OperationWorkspace";
import {
  uploadPendingAttachments,
  type PendingAttachment,
} from "@/components/dashboard/TaskAttachments";
import { attachTaskRecord, deleteReservationRecord } from "@/lib/reservation-records.functions";
import {
  createTask,
  deleteTasks,
  listTaskLinkOptions,
  listTasks,
  restoreTask,
  setTaskStatus,
  skipTaskOccurrence,
  type TaskSnapshot,
} from "@/lib/tasks.functions";
import type { TaskCategory, TaskPriority, TaskRow } from "@/lib/tasks-types";

/** "08/09/2026" — mesma forma usada no aviso de ocorrência pulada. */
function fmtDataBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function PendenciasButton({
  ownerId,
  enabled,
  guestNameForTask,
}: {
  /** Conta em uso (impersonação), igual ao resto do dashboard. */
  ownerId: string | null;
  /** Só consulta com sessão pronta — mesma regra das outras queries. */
  enabled: boolean;
  /** Ver o comentário de abertura: sem ela, o painel mostra "Hóspede". */
  guestNameForTask?: (t: TaskRow) => string;
}) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);

  const listFn = useServerFn(listTasks);
  const linkOptionsFn = useServerFn(listTaskLinkOptions);
  const createFn = useServerFn(createTask);
  const setStatusFn = useServerFn(setTaskStatus);
  const skipFn = useServerFn(skipTaskOccurrence);
  const deleteTasksFn = useServerFn(deleteTasks);
  const restoreTaskFn = useServerFn(restoreTask);
  const deleteRecordFn = useServerFn(deleteReservationRecord);
  const attachTaskRecordFn = useServerFn(attachTaskRecord);

  /* MESMAS CHAVES de consulta do `OperationWorkspace`. Não é coincidência: é
     o que faz as duas telas dividirem o mesmo cache do React Query — nenhuma
     requisição a mais, e concluir uma pendência aqui atualiza o checklist do
     card de limpeza lá sem nenhum aviso entre as duas. */
  const tasksQ = useQuery({
    queryKey: ["dash-tasks", ownerId ?? "self"],
    queryFn: () => listFn({ data: { ownerId } }),
    staleTime: 15_000,
    enabled,
  });
  const linkOptionsQ = useQuery({
    queryKey: ["dash-task-link-options", ownerId ?? "self"],
    queryFn: () => linkOptionsFn({ data: { ownerId } }),
    staleTime: 60_000,
    enabled: enabled && aberto,
  });

  const emAberto = (tasksQ.data?.tasks ?? []).filter((t) => t.status === "pending").length;

  const invalidar = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["dash-tasks", ownerId ?? "self"] });
  }, [qc, ownerId]);

  const desfazerFalhou = useCallback(
    (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível desfazer."),
    [],
  );

  /* DESFAZER EM QUALQUER AÇÃO, por 5 segundos (regra de 17/09/2026). O
     servidor devolve a foto de ANTES; desfazer é gravar a foto de volta. Na
     conclusão com comprovação, os anexos que subiram junto também saem. */
  const avisarComDesfazer = useCallback(
    (mensagem: string, desfazer: () => Promise<unknown>, anexos: string[] = []) => {
      notifyAction(mensagem, () => {
        void Promise.all([desfazer(), ...anexos.map((id) => deleteRecordFn({ data: { id } }))])
          .catch(desfazerFalhou)
          .finally(invalidar);
      });
    },
    [deleteRecordFn, desfazerFalhou, invalidar],
  );

  const restaurar = useCallback(
    (before: TaskSnapshot) => () => restoreTaskFn({ data: { before } }),
    [restoreTaskFn],
  );

  /** Resposta instantânea: a pendência muda de estado na tela no clique. */
  const pintarStatus = useCallback(
    (taskId: string, status: "pending" | "done" | "canceled") => {
      void qc.cancelQueries({ queryKey: ["dash-tasks"] });
      qc.setQueriesData<{ tasks: TaskRow[] } & Record<string, unknown>>(
        { queryKey: ["dash-tasks"] },
        (old) =>
          old?.tasks
            ? { ...old, tasks: old.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)) }
            : old,
      );
    },
    [qc],
  );

  const criar = useMutation({
    mutationFn: (v: {
      title: string;
      description?: string | null;
      category: TaskCategory;
      priority: TaskPriority;
      dueDate?: string | null;
      showInCleaning: boolean;
      propertyId?: string | null;
      ownerContactId?: string | null;
      amountSpentCents?: number | null;
      recurrenceDays?: number | null;
    }) => createFn({ data: { ownerId, ...v } }),
    onSuccess: (res) => {
      invalidar();
      avisarComDesfazer("Pendência criada.", () => deleteTasksFn({ data: { taskIds: [res.id] } }));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao criar pendência."),
  });

  const mudarStatus = useMutation({
    mutationFn: (v: {
      taskId: string;
      status: "pending" | "done" | "canceled";
      amountSpentCents?: number | null;
      resolvedByProviderId?: string | null;
      resolutionNote?: string | null;
    }) => setStatusFn({ data: v }),
    onMutate: (v) => pintarStatus(v.taskId, v.status),
    onSuccess: invalidar,
    onError: (e) => {
      invalidar();
      toast.error(e instanceof Error ? e.message : "Falha ao atualizar pendência.");
    },
  });

  const pularOcorrencia = useMutation({
    mutationFn: (v: { taskId: string }) => skipFn({ data: v }),
    onSuccess: (res) => {
      invalidar();
      avisarComDesfazer(
        `Ocorrência pulada. Próximo prazo: ${fmtDataBR(res.dueDate)}.`,
        restaurar(res.before),
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao pular a ocorrência."),
  });

  /* A TELA DE CONCLUSÃO abre SEMPRE ao concluir (não só quando falta valor):
     ela não pergunta o gasto, pergunta a prestação de contas inteira —
     quem resolveu, quanto custou e a comprovação. Tudo opcional. */
  const [conclusao, setConclusao] = useState<{ kind: "status"; task: TaskRow } | null>(null);

  function pedirStatus(taskId: string, status: "pending" | "done" | "canceled") {
    if (status === "done") {
      const task = (tasksQ.data?.tasks ?? []).find((t) => t.id === taskId);
      if (task) {
        setConclusao({ kind: "status", task });
        return;
      }
    }
    mudarStatus.mutate(
      { taskId, status },
      {
        onSuccess: (res) =>
          avisarComDesfazer(
            status === "pending" ? "Pendência reaberta." : "Pendência arquivada.",
            restaurar(res.before),
          ),
      },
    );
  }

  async function confirmarConclusao(v: {
    amountSpentCents: number | null;
    providerId: string | null;
    note: string | null;
    files: PendingAttachment[];
  }) {
    if (!conclusao) return;
    const task = conclusao.task;
    /* Anexo precisa de um imóvel — é ele que define a pasta e a permissão do
       arquivo. Sem imóvel os arquivos sumiriam em silêncio; melhor barrar
       ANTES de gravar a conclusão e explicar o que fazer. */
    if (v.files.length > 0 && !task.propertyId) {
      toast.error(
        "Para anexar fotos, vídeos ou áudios, a pendência precisa estar vinculada a um imóvel. Remova os anexos ou vincule um imóvel à pendência.",
      );
      return;
    }
    const res = await mudarStatus.mutateAsync({
      taskId: task.id,
      status: "done",
      amountSpentCents: v.amountSpentCents,
      resolvedByProviderId: v.providerId,
      resolutionNote: v.note,
    });
    /* Comprovação sobe DEPOIS da conclusão gravada — se a pessoa desistir no
       meio, nada de arquivo órfão no storage. Falha de anexo não desfaz a
       conclusão, só avisa. MESMO helper usado no outro gatilho. */
    let anexos: string[] = [];
    if (v.files.length > 0 && task.propertyId) {
      const envio = await uploadPendingAttachments(attachTaskRecordFn, v.files, {
        propertyId: task.propertyId,
        taskId: task.id,
        logId: task.logId ?? undefined,
        reservationId: task.reservationId ?? undefined,
        isResolution: true,
      });
      anexos = envio.ids;
      if (envio.failed > 0) {
        toast.error(`${envio.failed} anexo(s) não subiram. A conclusão foi salva.`);
      }
    }
    setConclusao(null);
    avisarComDesfazer("Pendência concluída.", restaurar(res.before), anexos);
  }

  return (
    <>
      {/* Pendências NÃO entra no menu de filtros: o número dela é um alerta, e
          alerta dentro de menu fechado deixa de alertar. */}
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="Pendências"
        aria-label={`Pendências (${emAberto})`}
        className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE}`}
      >
        <ListChecks className={ACTION_ICON} />
        <span className="lg:hidden">Pendências</span>
        {/* O SELO FICA DENTRO do segmento: pendurado no canto, ele era cortado
            pela borda da barra (que precisa de `overflow-hidden` para os
            cantos arredondados valerem nos segmentos). */}
        {emAberto > 0 && (
          <span className="grid h-[15px] min-w-[15px] shrink-0 place-items-center rounded-full bg-[#c9a962] px-1 text-[9px] font-extrabold leading-none text-[#1a1408]">
            {emAberto > 99 ? "99+" : emAberto}
          </span>
        )}
      </button>

      <TasksDialog
        open={aberto}
        onOpenChange={setAberto}
        tasks={tasksQ.data?.tasks ?? []}
        loading={tasksQ.isLoading}
        linkProperties={linkOptionsQ.data?.properties ?? []}
        linkOwners={linkOptionsQ.data?.owners ?? []}
        guestNameForTask={guestNameForTask ?? (() => "Hóspede")}
        onCreate={(v) => criar.mutateAsync(v)}
        creating={criar.isPending}
        onSetStatus={pedirStatus}
        onSkipOccurrence={(taskId) => pularOcorrencia.mutate({ taskId })}
      />

      <TaskResolveDialog
        state={conclusao}
        onOpenChange={(v) => !v && setConclusao(null)}
        providers={linkOptionsQ.data?.providers ?? []}
        onConfirm={confirmarConclusao}
      />
    </>
  );
}
