/**
 * Ferramentas do Assistente do Painel (07/09/2026).
 *
 * Duas famílias, com garantias diferentes:
 *
 *   LEITURA — consultam os dados reais da conta. Todas usam o cliente Supabase
 *   DO USUÁRIO (nunca o admin), então o RLS decide o que cada pessoa enxerga.
 *   É isso que faz "prestador só recebe resposta sobre o que ele já podia ver"
 *   ser verdade por construção, e não por uma regra escrita no prompt — que o
 *   modelo poderia ignorar.
 *
 *   PREPARAÇÃO — resolvem uma intenção ("abre uma pendência no 105") em um
 *   payload pronto, mas NÃO gravam. Devolvem a ação e o texto do cartão de
 *   confirmação; quem grava é o clique da pessoa, na interface. Ver o comentário
 *   de `assistant-types.ts` para o porquê.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentTool } from "./gateway.server";
import type { AssistantAction, PendingAction } from "@/lib/assistant-types";
import { defaultShowInCleaning, type TaskCategory, type TaskPriority } from "@/lib/tasks-types";

type AnyClient = { from: (t: string) => any };

export type AssistantToolContext = {
  supabase: SupabaseClient;
  userId: string;
  /** Imóveis que este usuário pode ver — já resolvido pelo chamador. */
  propertyIds: string[];
  /** Preenchido pela ferramenta de preparação; lido depois pelo chamador. */
  prepared: { current: PendingAction | null };
};

/** JSON Schema estrito, como a Responses API exige. */
function schema(props: Record<string, unknown>, required: string[]) {
  return { type: "object", additionalProperties: false, properties: props, required };
}

const CATEGORIES: TaskCategory[] = [
  "maintenance",
  "financial",
  "guest_request",
  "purchase",
  "inspection",
  "cleaning",
  "other",
];
const CATEGORY_LABEL: Record<TaskCategory, string> = {
  maintenance: "Manutenção",
  financial: "Financeiro",
  guest_request: "Pedido do hóspede",
  purchase: "Compra",
  inspection: "Vistoria",
  cleaning: "Limpeza",
  other: "Outros",
};
const PRIORITY_LABEL: Record<TaskPriority, string> = { low: "Baixa", medium: "Média", high: "Alta" };

function todayISO(tz = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

/**
 * Convenção da esteira: nem todo card tem log de verdade. Reserva vinda do
 * iCal sem formulário preenchido carrega um `logId` sintético ("ical:<id>"),
 * que só serve como chave de tela. Mandar isso para `markNoShow` — que valida
 * uuid — daria erro de validação; o identificador utilizável nesse caso é o
 * `reservationId`. Estas duas funções são o filtro.
 */
const UUID_RE = /^[0-9a-f-]{36}$/i;
function realLogId(logId: string | null | undefined): string | null {
  return logId && UUID_RE.test(logId) ? logId : null;
}

/**
 * Horário previsto de um card, e — igualmente importante — de ONDE ele veio
 * (pedido explícito, 07/09/2026).
 *
 * Duas armadilhas moram aqui:
 *
 *   1. `guestArrivalTime` é o horário que o hóspede informou para a CHEGADA.
 *      Num card de checkout ele não diz nada sobre a saída. Usá-lo ali foi
 *      exatamente o bug que fez o checkout automático confirmar na hora
 *      errada (06/09/2026) — por isso a saída só olha para o override do card
 *      e, na falta dele, para o padrão do imóvel.
 *
 *   2. "11h" pode significar duas coisas muito diferentes: alguém informou 11h,
 *      ou ninguém informou nada e 11h é só o padrão do imóvel. Dizer "todas às
 *      11h" no segundo caso afirma uma precisão que não existe — a resposta
 *      honesta é "a partir das 11h". Daí a origem viajar junto do valor, para
 *      o agente escolher a palavra certa em vez de adivinhar.
 */
type HoraPrevista = { hora: string | null; origem: "informado" | "padrao" | "desconhecido" };

function horaPrevista(
  r: { arrivalTimeOverride: string | null; guestArrivalTime: string | null; standardTime: string | null },
  kind: "checkin" | "checkout",
): HoraPrevista {
  const informado = kind === "checkin" ? (r.arrivalTimeOverride ?? r.guestArrivalTime) : r.arrivalTimeOverride;
  if (informado) return { hora: informado, origem: "informado" };
  if (r.standardTime) return { hora: r.standardTime, origem: "padrao" };
  return { hora: null, origem: "desconhecido" };
}

export function buildAssistantTools(ctx: AssistantToolContext): AgentTool[] {
  const db = ctx.supabase as unknown as AnyClient;

  /**
   * Casa o que a pessoa escreveu ("o 105", "studio 105", "cobertura") com um
   * imóvel de verdade. Devolve todos os candidatos em vez do primeiro: com dois
   * "Studio 10x" na conta, adivinhar em silêncio criaria a pendência no imóvel
   * errado — melhor o agente perguntar qual.
   */
  type PropRow = {
    id: string;
    name: string | null;
    city: string | null;
    address: string | null;
    address_note: string | null;
    maps_url: string | null;
  };
  const PROP_COLS = "id, name, city, address, address_note, maps_url";

  /**
   * Endereço já com o link do mapa pronto (pedido explícito, 07/09/2026):
   * quem pergunta o endereço de um imóvel quase sempre vai abrir o mapa em
   * seguida. Quando o imóvel não tem `maps_url` cadastrado, monta a busca pelo
   * próprio endereço — melhor um mapa pesquisado que nenhum.
   */
  function shape(r: PropRow) {
    const endereco = [r.address, r.address_note].filter(Boolean).join(" — ") || null;
    const mapa =
      r.maps_url ??
      (endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}` : null);
    return { id: r.id, nome: r.name ?? "(sem nome)", cidade: r.city, endereco, mapa };
  }

  /**
   * Reencontra na agenda REAL o card que o modelo indicou, e devolve a linha
   * inteira — nunca só um "ok".
   *
   * Existe porque nenhuma ferramenta de escrita deve confiar no id que o
   * modelo escreveu. Gravar no card errado aqui não é um erro de texto: move
   * o card de dia no quadro de todo mundo, cancela o checkout e a limpeza de
   * uma estadia, ou avança uma etapa que ninguém pediu. Conferir contra a
   * agenda custa uma consulta e transforma "o modelo alucinou um uuid" em uma
   * mensagem de erro em vez de uma gravação silenciosa.
   *
   * Os identificadores que seguem para a gravação são os DA LINHA ENCONTRADA.
   */
  type AgendaHit = {
    row: {
      logId: string | null;
      reservationId: string | null;
      guestName: string;
      propertyName: string | null;
      date: string;
    };
  };
  async function findAgendaRow(
    kind: "checkin" | "checkout",
    ids: { logId?: unknown; reservationId?: unknown },
  ): Promise<AgendaHit | { erro: string }> {
    const logId = typeof ids.logId === "string" && ids.logId ? ids.logId : null;
    const reservationId = typeof ids.reservationId === "string" && ids.reservationId ? ids.reservationId : null;
    if (!logId && !reservationId) return { erro: "Informe o card (logId ou reservationId)." };

    const { buildArrivalRows } = await import("@/lib/arrival-board.server");
    const { rows } = await buildArrivalRows(ctx.supabase as never, {
      kind,
      range: "7d",
      propIds: ctx.propertyIds,
    });
    const hit = rows.find(
      (r) => (logId && r.logId === logId) || (reservationId && r.reservationId === reservationId),
    );
    if (!hit) return { erro: "Não encontrei esse card na agenda dos próximos 7 dias." };
    if (!realLogId(hit.logId) && !hit.reservationId) {
      return { erro: "Esse card ainda não tem identificador gravável." };
    }
    return {
      row: {
        logId: hit.logId,
        reservationId: hit.reservationId,
        guestName: hit.guestName,
        propertyName: hit.propertyName,
        date: hit.date,
      },
    };
  }

  async function matchProperties(term: string) {
    if (!ctx.propertyIds.length) return [];
    const { data } = await db.from("properties").select(PROP_COLS).in("id", ctx.propertyIds).limit(200);
    const rows = (data ?? []) as PropRow[];
    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const needle = norm(term.trim());
    return rows.filter((r) => norm(r.name ?? "").includes(needle)).map(shape);
  }

  return [
    // ───────────────────────────── leitura ─────────────────────────────
    {
      name: "listar_imoveis",
      description:
        "Lista os imóveis que este usuário pode ver, com cidade, endereço e link do mapa. Use para descobrir o id de um imóvel citado pelo nome antes de qualquer outra ferramenta, e também quando perguntarem o endereço de um imóvel.",
      parameters: schema(
        {
          busca: {
            type: ["string", "null"],
            description: 'Parte do nome do imóvel, ex.: "105". Null lista todos.',
          },
        },
        ["busca"],
      ),
      execute: async (args) => {
        const term = typeof args.busca === "string" ? args.busca : "";
        if (term) {
          const hits = await matchProperties(term);
          return { imoveis: hits, total: hits.length };
        }
        const { data } = await db.from("properties").select(PROP_COLS).in("id", ctx.propertyIds).limit(200);
        const all = ((data ?? []) as PropRow[]).map(shape);
        return { imoveis: all, total: all.length };
      },
    },
    {
      name: "agenda",
      description:
        "Chegadas (check-in) ou saídas/limpezas (check-out) do período. Use para perguntas como 'quantas limpezas tenho amanhã' ou 'quem chega hoje'. Cada item traz `horario` e `horarioOrigem`: 'informado' quando alguém de fato definiu aquele horário, 'padrao' quando é apenas o horário padrão do imóvel e ninguém informou nada.",
      parameters: schema(
        {
          tipo: { type: "string", enum: ["chegadas", "saidas"] },
          periodo: { type: "string", enum: ["today", "tomorrow", "7d"] },
        },
        ["tipo", "periodo"],
      ),
      execute: async (args) => {
        const kind = args.tipo === "chegadas" ? "checkin" : "checkout";
        const range = String(args.periodo) as "today" | "tomorrow" | "7d";
        const { buildArrivalRows } = await import("@/lib/arrival-board.server");
        const { rows } = await buildArrivalRows(ctx.supabase as never, {
          kind: kind as "checkin" | "checkout",
          range,
          propIds: ctx.propertyIds,
        });
        return {
          total: rows.length,
          itens: rows.slice(0, 40).map((r) => {
            const h = horaPrevista(r, kind as "checkin" | "checkout");
            return {
              imovel: r.propertyName,
              propertyId: r.propertyId,
              hospede: r.guestName,
              data: r.date,
              horario: h.hora,
              horarioOrigem: h.origem,
              status: r.status,
              logId: realLogId(r.logId),
              reservationId: r.reservationId,
            };
          }),
        };
      },
    },
    {
      name: "listar_pendencias",
      description:
        "Pendências (o botão PENDÊNCIAS do Kanban). Filtra por imóvel e por situação. Use antes de concluir uma pendência, para achar o id certo.",
      parameters: schema(
        {
          propertyId: { type: ["string", "null"], description: "Id do imóvel, ou null para todos." },
          situacao: { type: "string", enum: ["pending", "done", "todas"] },
          busca: { type: ["string", "null"], description: "Parte do título da pendência." },
        },
        ["propertyId", "situacao", "busca"],
      ),
      execute: async (args) => {
        if (!ctx.propertyIds.length) return { total: 0, itens: [] };
        let q = db
          .from("tasks")
          .select("id, title, category, priority, status, due_date, property_id, show_in_cleaning")
          .order("created_at", { ascending: false })
          .limit(40);
        const propertyId = typeof args.propertyId === "string" ? args.propertyId : null;
        q = propertyId ? q.eq("property_id", propertyId) : q.in("property_id", ctx.propertyIds);
        if (args.situacao !== "todas") q = q.eq("status", String(args.situacao));
        if (typeof args.busca === "string" && args.busca.trim()) q = q.ilike("title", `%${args.busca.trim()}%`);
        const { data, error } = await q;
        if (error) return { erro: error.message };
        return { total: (data ?? []).length, itens: data ?? [] };
      },
    },

    // ─────────────────────────── preparação ───────────────────────────
    {
      name: "preparar_criar_pendencia",
      description:
        "Monta (SEM gravar) a criação de uma pendência, com TODOS os campos que a tela de Pendências oferece — inclusive RECORRÊNCIA (repetir a cada N dias) e a chave de mostrar/ocultar na limpeza. Chame só quando souber o imóvel e o título. A pessoa confirma na tela depois. Nunca diga que a pendência foi criada — diga que está pronta para confirmação.",
      parameters: schema(
        {
          propertyId: { type: "string", description: "Id do imóvel (use listar_imoveis antes)." },
          titulo: { type: "string" },
          descricao: { type: ["string", "null"] },
          categoria: { type: "string", enum: CATEGORIES },
          prioridade: { type: "string", enum: ["low", "medium", "high"] },
          prazo: { type: ["string", "null"], description: "Data YYYY-MM-DD ou null." },
          recorrenciaDias: {
            type: ["integer", "null"],
            description:
              'Repete a pendência a cada N dias. Ex.: "trocar filtro a cada 90 dias" → 90; "revisão mensal" → 30. Null quando é uma pendência única. Ao concluir, ela volta pendente sozinha com o prazo N dias à frente.',
          },
          mostrarNaLimpeza: {
            type: ["boolean", "null"],
            description:
              "Entra no checklist da próxima limpeza do imóvel. Null = padrão da categoria (manutenção nasce visível, o resto nasce oculto).",
          },
        },
        [
          "propertyId",
          "titulo",
          "descricao",
          "categoria",
          "prioridade",
          "prazo",
          "recorrenciaDias",
          "mostrarNaLimpeza",
        ],
      ),
      execute: async (args) => {
        const propertyId = String(args.propertyId);
        if (!ctx.propertyIds.includes(propertyId)) {
          return { erro: "Você não tem acesso a esse imóvel." };
        }
        const { data: prop } = await db.from("properties").select("name").eq("id", propertyId).maybeSingle();
        const category = (CATEGORIES.includes(args.categoria as TaskCategory) ? args.categoria : "other") as TaskCategory;
        const priority = (["low", "medium", "high"].includes(String(args.prioridade))
          ? args.prioridade
          : "medium") as TaskPriority;
        const padraoLimpeza = defaultShowInCleaning(category);
        const showInCleaning = typeof args.mostrarNaLimpeza === "boolean" ? args.mostrarNaLimpeza : padraoLimpeza;
        const title = String(args.titulo).trim();
        const description = typeof args.descricao === "string" && args.descricao.trim() ? args.descricao.trim() : null;
        const dueDate = typeof args.prazo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.prazo) ? args.prazo : null;
        // Recorrência: inteiro positivo ou nada. O `Math.floor` existe porque
        // o modelo às vezes manda 30.0 — que é um número válido em JSON e
        // seria rejeitado pelo `z.number().int()` do createTask lá na frente.
        const recurrenceDays =
          typeof args.recorrenciaDias === "number" && Number.isFinite(args.recorrenciaDias) && args.recorrenciaDias >= 1
            ? Math.floor(args.recorrenciaDias)
            : null;

        const action: AssistantAction = {
          kind: "create_task",
          payload: {
            title,
            description,
            category,
            priority,
            propertyId,
            ownerContactId: null,
            dueDate,
            showInCleaning,
            recurrenceDays,
          },
        };
        const preview = [
          { label: "Imóvel", value: (prop as { name?: string } | null)?.name ?? "—" },
          { label: "Título", value: title },
          { label: "Categoria", value: CATEGORY_LABEL[category] },
          { label: "Prioridade", value: PRIORITY_LABEL[priority] },
          {
            label: "Na limpeza",
            value: showInCleaning
              ? `Sim${showInCleaning === padraoLimpeza ? " — padrão da categoria" : ""}`
              : `Não${showInCleaning === padraoLimpeza ? " — padrão da categoria" : ""}`,
          },
        ];
        if (description) preview.push({ label: "Detalhe", value: description });
        if (dueDate) preview.push({ label: "Prazo", value: dueDate });
        if (recurrenceDays) preview.push({ label: "Repetição", value: `A cada ${recurrenceDays} dias` });

        ctx.prepared.current = { action, confirmLabel: "Criar pendência", preview };
        return { pronto: true, resumo: preview };
      },
    },
    {
      name: "preparar_arquivar_pendencia",
      description:
        "Monta (SEM gravar) o ARQUIVAMENTO de uma pendência (o mesmo botão da lixeira na lista de Pendências) ou a REABERTURA de uma já concluída. Use listar_pendencias antes para obter o id. A pessoa confirma na tela.",
      parameters: schema(
        {
          taskId: { type: "string" },
          acao: { type: "string", enum: ["arquivar", "reabrir"] },
        },
        ["taskId", "acao"],
      ),
      execute: async (args) => {
        const taskId = String(args.taskId);
        const { data: task } = await db.from("tasks").select("id, title, status").eq("id", taskId).maybeSingle();
        const row = task as { id: string; title: string; status: string } | null;
        if (!row) return { erro: "Pendência não encontrada ou sem acesso." };
        const arquivar = args.acao !== "reabrir";
        if (arquivar && row.status === "canceled") return { erro: "Essa pendência já está arquivada." };
        if (!arquivar && row.status === "pending") return { erro: "Essa pendência já está aberta." };

        const action: AssistantAction = {
          kind: "set_task_status",
          payload: { taskId, status: arquivar ? "canceled" : "pending" },
        };
        ctx.prepared.current = {
          action,
          confirmLabel: arquivar ? "Arquivar pendência" : "Reabrir pendência",
          preview: [
            { label: "Pendência", value: row.title },
            {
              label: "Efeito",
              value: arquivar
                ? "Sai da lista de Pendências e do checklist da limpeza"
                : "Volta para a lista de Pendências, sem a prestação de contas anterior",
            },
          ],
        };
        return { pronto: true, resumo: ctx.prepared.current.preview };
      },
    },
    {
      name: "preparar_definir_previsao",
      description:
        'Monta (SEM gravar) a DATA e/ou o HORÁRIO PREVISTOS de uma chegada ou saída — a mesma faixa "Previsto Check-in/Checkout" do card. Use para pedidos como "o hóspede do 105 avisou que chega às 22h" ou "o checkout do 302 vai ser amanhã". Use `agenda` antes para obter logId/reservationId. Passar null num campo LIMPA aquele campo. A pessoa confirma na tela.',
      parameters: schema(
        {
          logId: { type: ["string", "null"] },
          reservationId: { type: ["string", "null"] },
          tipo: { type: "string", enum: ["chegadas", "saidas"] },
          data: { type: ["string", "null"], description: "Data prevista YYYY-MM-DD, ou null para limpar." },
          horario: { type: ["string", "null"], description: "Horário previsto HH:MM, ou null para limpar." },
        },
        ["logId", "reservationId", "tipo", "data", "horario"],
      ),
      execute: async (args) => {
        const kind = args.tipo === "saidas" ? "checkout" : "checkin";
        const date =
          typeof args.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.data) ? args.data : null;
        const time = typeof args.horario === "string" && /^\d{2}:\d{2}$/.test(args.horario) ? args.horario : null;
        if (!date && !time && args.data !== null && args.horario !== null) {
          return { erro: "Informe a data (YYYY-MM-DD) e/ou o horário (HH:MM)." };
        }

        // Mesma conferência do "não compareceu": o card é reencontrado na
        // agenda real, e os identificadores gravados são os DELE — nunca os
        // que o modelo escreveu. Gravar previsão no hóspede errado move um
        // card de dia no quadro de todo mundo.
        const hit = await findAgendaRow(kind, { logId: args.logId, reservationId: args.reservationId });
        if ("erro" in hit) return hit;

        const action: AssistantAction = {
          kind: "set_prediction",
          payload: {
            logId: realLogId(hit.row.logId),
            reservationId: hit.row.reservationId,
            kind,
            arrivalDateOverride: date,
            arrivalTimeOverride: time,
          },
        };
        const preview = [
          { label: "Hóspede", value: hit.row.guestName },
          { label: "Imóvel", value: hit.row.propertyName ?? "—" },
          { label: kind === "checkout" ? "Saída" : "Chegada", value: hit.row.date },
        ];
        preview.push({ label: "Data prevista", value: date ?? "Em branco (limpar)" });
        preview.push({ label: "Horário previsto", value: time ?? "Em branco (limpar)" });

        ctx.prepared.current = { action, confirmLabel: "Salvar previsão", preview };
        return { pronto: true, resumo: preview };
      },
    },
    {
      name: "preparar_avancar_etapa",
      description:
        'Monta (SEM gravar) o AVANÇO de um card na esteira — os botões "Check-in realizado", "Confirmar checkout" e "Concluir limpeza" do Kanban. `de` diz de qual lista o card está saindo: checkin (vira Em Estadia), stay (vira Saída/Checkout), checkout (libera para a limpeza) e cleaning (conclui a limpeza). Use `agenda` antes para obter logId/reservationId. A pessoa confirma na tela.',
      parameters: schema(
        {
          logId: { type: ["string", "null"] },
          reservationId: { type: ["string", "null"] },
          de: { type: "string", enum: ["checkin", "stay", "checkout", "cleaning"] },
          tipoLimpeza: {
            type: ["string", "null"],
            enum: ["normal", "completa", null],
            description:
              'Só para de="cleaning": qual faxina foi feita. É o que define o preço gravado. Se a pessoa não disse, PERGUNTE antes de preparar — não chute.',
          },
        },
        ["logId", "reservationId", "de", "tipoLimpeza"],
      ),
      execute: async (args) => {
        const from = String(args.de) as "checkin" | "stay" | "checkout" | "cleaning";
        // Concluir limpeza sem dizer o tipo grava o preço da limpeza normal
        // em silêncio. Na tela essa pergunta é obrigatória (o clique abre o
        // seletor de tipo antes de qualquer coisa) — aqui vale o mesmo.
        const cleaningType =
          args.tipoLimpeza === "normal" || args.tipoLimpeza === "completa" ? args.tipoLimpeza : null;
        if (from === "cleaning" && !cleaningType) {
          return {
            erro: "Para concluir a limpeza eu preciso saber se foi limpeza normal ou completa — é isso que define o valor gravado.",
          };
        }
        // O card é procurado na agenda do tipo correspondente: quem avança a
        // partir de "checkin" está numa chegada; os outros três estão do lado
        // da saída/limpeza.
        const kind = from === "checkin" ? "checkin" : "checkout";
        const hit = await findAgendaRow(kind, { logId: args.logId, reservationId: args.reservationId });
        if ("erro" in hit) return hit;

        const EFEITO: Record<typeof from, string> = {
          checkin: "O hóspede passa para Em Estadia",
          stay: "Encerra a estadia e o card vai para Checkouts",
          checkout: "Libera o imóvel e entra na fila de limpeza (avisa os prestadores)",
          cleaning: "Conclui a limpeza e fecha a estadia",
        };
        const action: AssistantAction = {
          kind: "advance",
          payload: {
            logId: realLogId(hit.row.logId),
            reservationId: hit.row.reservationId,
            from,
            cleaningType,
          },
        };
        const preview = [
          { label: "Hóspede", value: hit.row.guestName },
          { label: "Imóvel", value: hit.row.propertyName ?? "—" },
          { label: "Data", value: hit.row.date },
          { label: "Efeito", value: EFEITO[from] },
        ];
        if (cleaningType) {
          preview.push({ label: "Tipo de limpeza", value: cleaningType === "completa" ? "Completa" : "Normal" });
        }
        ctx.prepared.current = {
          action,
          confirmLabel:
            from === "checkin"
              ? "Confirmar check-in"
              : from === "stay"
                ? "Encerrar estadia"
                : from === "checkout"
                  ? "Confirmar checkout"
                  : "Concluir limpeza",
          preview,
        };
        return { pronto: true, resumo: preview };
      },
    },
    {
      name: "preparar_concluir_pendencia",
      description:
        "Monta (SEM gravar) a conclusão de uma pendência existente. Use listar_pendencias antes para obter o id. A pessoa confirma na tela.",
      parameters: schema(
        {
          taskId: { type: "string" },
          comoFoiResolvido: { type: ["string", "null"] },
        },
        ["taskId", "comoFoiResolvido"],
      ),
      execute: async (args) => {
        const taskId = String(args.taskId);
        const { data: task } = await db
          .from("tasks")
          .select("id, title, status, property_id")
          .eq("id", taskId)
          .maybeSingle();
        const row = task as { id: string; title: string; status: string; property_id: string | null } | null;
        if (!row) return { erro: "Pendência não encontrada ou sem acesso." };
        if (row.status === "done") return { erro: "Essa pendência já está concluída." };

        const note =
          typeof args.comoFoiResolvido === "string" && args.comoFoiResolvido.trim()
            ? args.comoFoiResolvido.trim()
            : null;
        const action: AssistantAction = { kind: "complete_task", payload: { taskId, resolutionNote: note } };
        const preview = [{ label: "Pendência", value: row.title }];
        if (note) preview.push({ label: "Como foi resolvido", value: note });
        preview.push({ label: "Quem resolveu", value: "Em branco — dá para preencher na tela depois" });

        ctx.prepared.current = { action, confirmLabel: "Concluir pendência", preview };
        return { pronto: true, resumo: preview };
      },
    },
    {
      name: "preparar_nao_compareceu",
      description:
        "Monta (SEM gravar) a marcação de 'Não Compareceu' para uma chegada. Use agenda com tipo=chegadas antes, para obter logId/reservationId. A pessoa confirma na tela.",
      parameters: schema(
        {
          logId: { type: ["string", "null"] },
          reservationId: { type: ["string", "null"] },
        },
        ["logId", "reservationId"],
      ),
      execute: async (args) => {
        // Confere contra a agenda em vez de aceitar o id que o modelo mandou:
        // marcar não comparecimento no hóspede errado apaga o checkout e a
        // limpeza dele do quadro, e não há desfazer óbvio.
        const hit = await findAgendaRow("checkin", { logId: args.logId, reservationId: args.reservationId });
        if ("erro" in hit) return hit;

        const action: AssistantAction = {
          kind: "no_show",
          payload: { logId: realLogId(hit.row.logId), reservationId: hit.row.reservationId },
        };
        ctx.prepared.current = {
          action,
          confirmLabel: "Marcar não compareceu",
          preview: [
            { label: "Hóspede", value: hit.row.guestName },
            { label: "Imóvel", value: hit.row.propertyName ?? "—" },
            { label: "Chegada prevista", value: hit.row.date },
            { label: "Efeito", value: "Some da esteira e cancela o checkout e a limpeza desta estadia" },
          ],
        };
        return { pronto: true, resumo: ctx.prepared.current.preview };
      },
    },

    // ─────────────────────────── contexto ───────────────────────────
    {
      name: "data_de_hoje",
      description: "Data de hoje no fuso do Brasil (YYYY-MM-DD). Use antes de calcular prazos.",
      parameters: schema({}, []),
      execute: async () => ({ hoje: todayISO() }),
    },
  ];
}
