// Tipos compartilhados de Tarefas/Pendências (botão "PENDÊNCIAS" do Kanban +
// checklist do card de Limpeza).
export type TaskCategory =
  | "maintenance"
  | "financial"
  | "guest_request"
  | "purchase"
  | "inspection"
  | "cleaning"
  | "other";

export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "pending" | "done" | "canceled";

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  category: TaskCategory;
  priority: TaskPriority;
  dueDate: string | null; // YYYY-MM-DD
  showInCleaning: boolean;
  status: TaskStatus;
  completedAt: string | null;
  createdAt: string;
  propertyId: string | null;
  propertyName: string | null;
  ownerContactId: string | null;
  ownerName: string | null;
  /** Vínculo pontual com uma estadia específica — quando presente, a
   * pendência é "pontual" (some quando a estadia termina). Sem nenhum dos
   * dois, é "recorrente" (permanente do imóvel/proprietário). */
  logId: string | null;
  reservationId: string | null;
  /** Gasto (em centavos) da pendência — pontuais e as com recurrenceDays
   * guardam aqui; recorrentes-por-limpeza guardam por ocorrência em
   * TaskCompletion.amountSpentCents. */
  amountSpentCents: number | null;
  /** Repetição por tempo (independente do modelo "recorrente por limpeza"):
   * ao concluir, a pendência volta pendente com um novo prazo N dias à
   * frente, em vez de ficar marcada como feita pra sempre. */
  recurrenceDays: number | null;
};

/** Uma marca de "feito" pra uma pendência RECORRENTE numa limpeza
 * específica — não fecha a pendência, só registra que aquela ocorrência já
 * foi resolvida (ela volta pendente na próxima). */
export type TaskCompletion = {
  taskId: string;
  logId: string | null;
  reservationId: string | null;
  amountSpentCents: number | null;
};

export type TaskLinkProperty = {
  id: string;
  name: string;
  ownerContactId: string | null;
  ownerName: string | null;
};

export type TaskLinkOwner = {
  id: string;
  name: string;
};
