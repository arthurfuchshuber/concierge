/**
 * Permission Catalog — catálogo central declarativo do ConciergeIA.
 *
 * FASE 2: catalogação. Todo módulo, página, subpágina, aba, seção, recurso e
 * informação relevante do produto está declarado aqui. Nada disto altera o
 * comportamento atual do sistema — as permissões em vigor continuam sendo as
 * antigas. Esta árvore apenas existe para as próximas fases.
 *
 * Convenção de slug: `pai.filho.neto`, sempre único, sempre em minúsculas.
 */
import type { PermissionNodeDefinition } from "./permission.types";

type Def = PermissionNodeDefinition;

const page = (
  slug: string,
  name: string,
  route: string | null,
  icon: string | null,
  order: number,
  description?: string,
): Def => ({
  slug,
  name,
  label: name,
  type: "PAGE",
  parentSlug: null,
  route,
  icon,
  order,
  displayOrder: order,
  description: description ?? null,
  source: "catalog",
});

const child = (
  type: Def["type"],
  slug: string,
  name: string,
  order: number,
  extra: Partial<Def> = {},
): Def => ({
  slug,
  name,
  label: name,
  type,
  order,
  displayOrder: order,
  source: "catalog",
  ...extra,
});

const sub = (slug: string, name: string, order: number, extra: Partial<Def> = {}) =>
  child("SUBPAGE", slug, name, order, extra);
const tab = (slug: string, name: string, order: number, extra: Partial<Def> = {}) =>
  child("TAB", slug, name, order, extra);
const section = (slug: string, name: string, order: number, extra: Partial<Def> = {}) =>
  child("SECTION", slug, name, order, extra);
const resource = (slug: string, name: string, order: number, extra: Partial<Def> = {}) =>
  child("RESOURCE", slug, name, order, extra);
const field = (slug: string, name: string, order: number, extra: Partial<Def> = {}) =>
  child("FIELD", slug, name, order, extra);

/* ------------------------------------------------------------------ páginas */

const DASHBOARD: Def[] = [
  page("dashboard", "Operação", "/admin/dashboard", "LayoutDashboard", 10, "Painel operacional com KPIs, engajamento e esteira de chegadas."),
  section("dashboard.kpis", "Indicadores", 10),
  resource("dashboard.kpis.checkins", "Check-ins do período", 10),
  resource("dashboard.kpis.checkouts", "Check-outs do período", 20),
  resource("dashboard.kpis.em-estadia", "Hóspedes em estadia", 30),
  section("dashboard.engajamento", "Barras de engajamento", 20),
  resource("dashboard.engajamento.instrucoes", "Instruções de check-in visualizadas", 10),
  resource("dashboard.engajamento.senha", "Senha de acesso revelada", 20),
  section("dashboard.kanban", "Esteira de chegadas", 30),
  resource("dashboard.kanban.card", "Card de chegada", 10),
  field("dashboard.kanban.card.horario", "Horário previsto", 10),
  field("dashboard.kanban.card.proprietario", "Proprietário do imóvel", 20),
  field("dashboard.kanban.card.codigo-reserva", "Código da reserva", 30),
  resource("dashboard.kanban.checkin", "Confirmar check-in", 20),
  resource("dashboard.kanban.checkout", "Confirmar check-out", 30),
  resource("dashboard.kanban.limpeza", "Controle de limpeza", 40),
];

const CONVERSAS: Def[] = [
  page("conversas", "Conversas", "/admin/atendimento", "MessagesSquare", 20, "Atendimento humano e acompanhamento das conversas da IA."),
  section("conversas.fila", "Filas de atendimento", 10),
  resource("conversas.fila.pendentes", "Fila pendente", 10),
  resource("conversas.fila.com-alguem", "Em atendimento", 20),
  resource("conversas.fila.resolvidas", "Resolvidas", 30),
  section("conversas.thread", "Janela da conversa", 20),
  resource("conversas.thread.assumir", "Assumir atendimento", 10),
  resource("conversas.thread.responder", "Responder ao hóspede", 20),
  resource("conversas.thread.editar-mensagem", "Editar mensagem", 30),
  resource("conversas.thread.excluir-mensagem", "Excluir mensagem", 40),
  resource("conversas.thread.traduzir", "Traduzir mensagem", 50),
  resource("conversas.thread.mencoes", "Menções à equipe", 60),
  resource("conversas.thread.audio", "Mensagem de áudio", 70),
  field("conversas.thread.dados-hospede", "Dados do hóspede", 80),
];

const IMOVEIS: Def[] = [
  page("imoveis", "Imóveis", "/admin/guias", "Home", 30, "Residências, guias públicos e conteúdo do hóspede."),
  tab("imoveis.lista", "Imóveis", 10, { route: "/admin/guias" }),
  tab("imoveis.destinos", "Destinos", 20, { route: "/admin/guias" }),
  sub("imoveis.editor", "Editor da residência", 30, { route: "/admin/properties/$id" }),
  tab("imoveis.editor.identificacao", "Identificação", 10),
  tab("imoveis.editor.acesso", "Acesso & Chegada", 20),
  tab("imoveis.editor.residencia", "Residência", 30),
  tab("imoveis.editor.explorar", "Explorar", 40),
  tab("imoveis.editor.captacao", "Captação", 50),
  tab("imoveis.editor.publicacao", "Publicação", 60),
  section("imoveis.editor.wifi", "Wi-Fi e acesso", 70),
  field("imoveis.editor.wifi.senha", "Senha do Wi-Fi", 10),
  field("imoveis.editor.wifi.instrucoes", "Instruções de acesso", 20),
  resource("imoveis.editor.slug", "Link público do guia", 80),
  resource("imoveis.edicao-massa", "Edição em massa", 40),
  sub("imoveis.acessos", "Acessos do guia", 50, { route: "/admin/properties/$id/acessos" }),
  sub("imoveis.conversas", "Conversas do imóvel", 60, { route: "/admin/properties/$id/conversas" }),
  resource("imoveis.ical", "Sincronização iCal", 70),
];

const STAKEHOLDERS: Def[] = [
  page("stakeholders", "Stakeholders", "/admin/stakeholders", "Users", 40, "Proprietários, hóspedes e prestadores de serviço."),
  tab("stakeholders.proprietarios", "Proprietários", 10),
  resource("stakeholders.proprietarios.cadastro", "Cadastro de proprietário", 10),
  resource("stakeholders.proprietarios.documentos", "Documentos do proprietário", 20),
  resource("stakeholders.proprietarios.financeiro", "Financeiro do proprietário", 30),
  resource("stakeholders.proprietarios.imoveis", "Imóveis vinculados", 40),
  field("stakeholders.proprietarios.dados-sensiveis", "Documento (CPF/CNPJ) e endereço", 50),
  tab("stakeholders.hospedes", "Hóspedes", 20, { route: "/admin/hospedes" }),
  resource("stakeholders.hospedes.ficha", "Ficha do hóspede", 10),
  resource("stakeholders.hospedes.captacao", "Dados de captação", 20),
  tab("stakeholders.prestadores", "Prestadores", 30),
  resource("stakeholders.prestadores.cadastro", "Cadastro de prestador", 10),
  section("stakeholders.timeline", "Timeline unificada", 40),
  resource("stakeholders.timeline.eventos", "Eventos do stakeholder", 10),
];

const CRM: Def[] = [
  page("crm", "CRM", null, "Contact", 50, "Relacionamento comercial e carteira de clientes."),
  sub("crm.clientes", "Clientes", 10, { route: "/admin/clientes" }),
  resource("crm.clientes.status", "Alterar status do cliente", 10),
  resource("crm.clientes.whatsapp", "Contato por WhatsApp", 20),
  sub("crm.pipeline", "Pipeline", 20),
  tab("crm.pipeline.kanban", "Kanban comercial", 10),
  sub("crm.reservas", "Reservas", 30),
  resource("crm.reservas.importacao-ical", "Importação por iCal", 10),
  resource("crm.reservas.codigo", "Código da reserva", 20),
];

const ENGAJAMENTO: Def[] = [
  page("engajamento", "Engajamento", "/admin/engajamento", "Activity", 60, "Panorama de uso do guia pelos hóspedes."),
  tab("engajamento.panorama", "Panorama", 10),
  tab("engajamento.jornada", "Jornada", 20),
  tab("engajamento.conteudo", "Conteúdo", 30),
  tab("engajamento.hospedes", "Hóspedes", 40),
];

const IA: Def[] = [
  page("ia", "IA Concierge", "/admin/ia", "Bot", 70, "Base de conhecimento, memória e aprendizados do concierge."),
  tab("ia.conhecimento", "Conhecimento", 10),
  resource("ia.conhecimento.faq", "Perguntas e respostas", 10),
  resource("ia.conhecimento.documentos", "Documentos da base", 20),
  tab("ia.memoria", "Memória", 20),
  resource("ia.memoria.operacional", "Memória operacional", 10),
  resource("ia.memoria.hospede", "Memória do hóspede", 20),
  tab("ia.aprendizados", "Aprendizados", 30),
  resource("ia.aprendizados.candidatos", "Candidatos de aprendizado", 10),
  resource("ia.aprendizados.aprovacao", "Aprovar aprendizado", 20),
];

const INTELIGENCIA: Def[] = [
  page("inteligencia", "Inteligência", "/admin/inteligencia", "Brain", 80, "Observabilidade da IA, analytics e auditoria do SaaS."),
  tab("inteligencia.agentes", "Agentes", 10),
  tab("inteligencia.pipeline", "Pipeline", 20),
  tab("inteligencia.prompts", "Prompts", 30),
  tab("inteligencia.global", "Inteligência global", 40),
  tab("inteligencia.analytics", "Analytics", 50),
  resource("inteligencia.analytics.metricas", "Métricas de atendimento", 10),
  tab("inteligencia.eventos", "Auditoria do SaaS", 60),
  resource("inteligencia.eventos.logs", "Logs detalhados", 10),
  resource("inteligencia.eventos.exportar", "Exportar logs", 20),
];

const CIDADES: Def[] = [
  page("cidades", "Cidades", "/admin/cidades", "MapPin", 90, "Curadoria de conteúdo por cidade."),
  sub("cidades.detalhe", "Detalhe da cidade", 10, { route: "/admin/cidades/$cityKey" }),
  sub("cidades.recomendacoes", "Recomendações Sigma", 20, { route: "/admin/recomendacoes-sigma" }),
  tab("cidades.recomendacoes.recs", "Recomendações", 10),
  tab("cidades.recomendacoes.faqs", "FAQs", 20),
  tab("cidades.recomendacoes.mkt", "Marketplace", 30),
  sub("cidades.taxonomia", "Taxonomia", 30, { route: "/admin/taxonomia" }),
];

const ADMINISTRATIVO: Def[] = [
  page("administrativo", "Administrativo", "/admin/administrativo", "Settings", 100, "Perfil, equipe, assinatura e integrações da conta."),
  tab("administrativo.perfil", "Meu perfil", 10),
  field("administrativo.perfil.dados", "Dados do membro", 10),
  tab("administrativo.equipe", "Equipe", 20),
  resource("administrativo.equipe.convites", "Convites de membros", 10),
  resource("administrativo.equipe.permissoes", "Permissões do membro", 20),
  resource("administrativo.equipe.remover", "Remover membro", 30),
  tab("administrativo.assinatura", "Assinatura", 30, { route: "/admin/assinatura" }),
  resource("administrativo.assinatura.plano", "Plano contratado", 10),
  resource("administrativo.assinatura.pagamento", "Pagamento e faturas", 20),
  tab("administrativo.integracoes", "Integrações", 40, { route: "/admin/integracoes" }),
  section("administrativo.integracoes.google-agenda", "Google Agenda", 10),
  section("administrativo.integracoes.clicksign", "ClickSign", 20),
  resource("administrativo.integracoes.clicksign.api", "Chave de API", 10),
  resource("administrativo.integracoes.clicksign.webhook", "Webhook", 20),
  resource("administrativo.integracoes.clicksign.importar", "Importar documentos", 30),
  section("administrativo.integracoes.whatsapp", "WhatsApp", 30),
];

const FINANCEIRO: Def[] = [
  page("financeiro", "Financeiro", null, "Wallet", 110, "Cobranças, repasses e faturamento."),
  sub("financeiro.billing", "Billing", 10),
  resource("financeiro.billing.faturas", "Faturas", 10),
  resource("financeiro.billing.metodo-pagamento", "Método de pagamento", 20),
  sub("financeiro.repasses", "Repasses a proprietários", 20),
];

const ADMIN_SAAS: Def[] = [
  page("admin", "Admin SaaS", "/admin/admins", "ShieldCheck", 900, "Administração interna da plataforma.", ),
  tab("admin.admins", "Administradores", 10),
  tab("admin.invites", "Convites", 20),
  tab("admin.logs", "Logs", 30),
  sub("admin.permissions", "Permissões", 40, {
    description: "Árvore de permissões, atribuições e auditoria (arquitetura nova).",
  }),
  resource("admin.permissions.arvore", "Árvore de permissões", 10),
  resource("admin.permissions.atribuicoes", "Atribuições", 20),
  resource("admin.permissions.auditoria", "Auditoria de permissões", 30),
  resource("admin.permissions.consistencia", "Relatório de consistência", 40),
];

const GUIA_PUBLICO: Def[] = [
  page("guia", "Guia do Hóspede", "/g/$slug", "BookOpen", 950, "Experiência pública acessada pelo hóspede."),
  sub("guia.home", "Home do guia", 10, { route: "/g/$slug" }),
  sub("guia.explorar", "Explorar", 20, { route: "/g/$slug/explorar" }),
  section("guia.chegada", "Chegada", 30),
  section("guia.saida", "Saída", 40),
  section("guia.residencia", "Residência", 50),
  resource("guia.chat", "Chat com o concierge", 60),
  field("guia.senha-acesso", "Senha de acesso", 70),
];

/**
 * Funcionalidade de plano exigida por módulo. A exigência é herdada por toda
 * a subárvore (o Registry resolve o ancestral mais próximo).
 */
const FEATURE_BY_SLUG: Record<string, string> = {
  conversas: "humanHandoff",
  ia: "ai",
  inteligencia: "ai",
  "imoveis.edicao-massa": "team",
  "imoveis.editor.captacao": "advancedIntake",
  "administrativo.equipe": "team",
  "administrativo.integracoes": "externalIntegration",
  "guia.chat": "guestChat",
  financeiro: "team",
};

const RAW_CATALOG: Def[] = [
  ...DASHBOARD,
  ...CONVERSAS,
  ...IMOVEIS,
  ...STAKEHOLDERS,
  ...CRM,
  ...ENGAJAMENTO,
  ...IA,
  ...INTELIGENCIA,
  ...CIDADES,
  ...ADMINISTRATIVO,
  ...FINANCEIRO,
  ...ADMIN_SAAS,
  ...GUIA_PUBLICO,
];

/** Catálogo completo — ordem de declaração define a ordem de exibição. */
export const PERMISSION_CATALOG: Def[] = RAW_CATALOG.map((node) =>
  FEATURE_BY_SLUG[node.slug] ? { ...node, feature: FEATURE_BY_SLUG[node.slug] } : node,
);


/** Mapa rota → slug do nó, usado pela rotina de consistência. */
export const CATALOG_ROUTE_MAP: Record<string, string> = PERMISSION_CATALOG.reduce(
  (acc, node) => {
    if (node.route) acc[node.route] = node.slug;
    return acc;
  },
  {} as Record<string, string>,
);
