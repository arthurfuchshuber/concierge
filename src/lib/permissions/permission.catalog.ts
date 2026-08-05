/**
 * Permission Catalog — árvore ÚNICA de permissões do ConciergeIA.
 *
 * REGRA ESTRUTURAL (definida pelo produto):
 *  1. CATEGORIA  = cada página do menu lateral esquerdo do SaaS
 *                  (menu da conta do cliente `tenant.*` e menu Admin SaaS `admin.*`).
 *  2. SUBCATEGORIA = cada aba existente dentro daquela página.
 *  3. ATIVIDADE  = cada ação possível dentro da aba (kanban, criar, editar,
 *                  excluir, sincronizar, etc.).
 *
 * Nada além disto entra na árvore. Rotas descobertas automaticamente pelo
 * scanner ficam ocultas (apenas diagnóstico).
 */
import { isSaasSlug, resolveSlug, SAAS_NAMESPACE, TENANT_NAMESPACE } from "./permission.slugs";
import type { PermissionNodeDefinition } from "./permission.types";

type Def = PermissionNodeDefinition;

const root = (slug: string, name: string, description: string): Def => ({
  slug,
  name,
  label: name,
  type: "PAGE",
  parentSlug: null,
  order: 0,
  displayOrder: 0,
  description,
  source: "catalog",
});

/** CATEGORIA — página do menu lateral. */
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

/** SUBCATEGORIA — aba da página. */
const tab = (slug: string, name: string, order: number, extra: Partial<Def> = {}) =>
  child("TAB", slug, name, order, extra);
/** SUBCATEGORIA — subpágina (tela aberta a partir da página). */
const sub = (slug: string, name: string, order: number, extra: Partial<Def> = {}) =>
  child("SUBPAGE", slug, name, order, extra);
/** ATIVIDADE — ação executável dentro da aba. */
const act = (slug: string, name: string, order: number, extra: Partial<Def> = {}) =>
  child("RESOURCE", slug, name, order, extra);

/* =========================================================== CONTA DO CLIENTE */

/** Dashboard — /admin/dashboard */
const DASHBOARD: Def[] = [
  page("tenant.dashboard", "Dashboard", "/admin/dashboard", "LayoutDashboard", 10,
    "Painel de operação: indicadores, engajamento e esteira de chegadas."),

  tab("tenant.dashboard.indicadores", "Indicadores", 10),
  act("tenant.dashboard.indicadores.kpis", "Ver KPIs do período", 10),
  act("tenant.dashboard.indicadores.engajamento", "Barras de engajamento", 20),
  act("tenant.dashboard.indicadores.periodo", "Alterar período", 30),

  tab("tenant.dashboard.chegadas", "Chegadas e saídas", 20),
  act("tenant.dashboard.chegadas.kanban", "Kanban de chegadas", 10),
  act("tenant.dashboard.chegadas.checkin", "Confirmar check-in", 20),
  act("tenant.dashboard.chegadas.checkout", "Confirmar check-out", 30),
  act("tenant.dashboard.chegadas.limpeza", "Controle de limpeza", 40),
  act("tenant.dashboard.chegadas.horario", "Editar horário previsto", 50),
  act("tenant.dashboard.chegadas.notas", "Notas da reserva", 60),
  act("tenant.dashboard.chegadas.reverter", "Reverter status", 70),
  act("tenant.dashboard.chegadas.ical", "Sincronizar iCal", 80),
];

/** Guias — /admin/guias */
const GUIAS: Def[] = [
  page("tenant.guias", "Guias", "/admin/guias", "Home", 20,
    "Residências, guias públicos e conteúdo do hóspede."),

  tab("tenant.guias.imoveis", "Imóveis", 10),
  act("tenant.guias.imoveis.criar", "Criar guia", 10),
  act("tenant.guias.imoveis.duplicar", "Duplicar guia", 20),
  act("tenant.guias.imoveis.publicar", "Publicar / despublicar", 30),
  act("tenant.guias.imoveis.excluir", "Excluir guia", 40),
  act("tenant.guias.imoveis.edicao-massa", "Edição em massa", 50),
  act("tenant.guias.imoveis.link", "Link público do guia", 60),
  act("tenant.guias.imoveis.ical", "Sincronização iCal", 70),
  act("tenant.guias.imoveis.acessos", "Acessos do guia", 80),
  act("tenant.guias.imoveis.conversas", "Conversas do imóvel", 90),

  sub("tenant.guias.editor", "Editor da residência", 20, { route: "/admin/properties/$id" }),
  act("tenant.guias.editor.identificacao", "Identificação", 10),
  act("tenant.guias.editor.acesso", "Acesso e chegada", 20),
  act("tenant.guias.editor.residencia", "Residência", 30),
  act("tenant.guias.editor.explorar", "Explorar", 40),
  act("tenant.guias.editor.captacao", "Captação", 50),
  act("tenant.guias.editor.publicacao", "Publicação", 60),

  tab("tenant.guias.destinos", "Destinos", 30),
  act("tenant.guias.destinos.gerenciar", "Gerenciar destinos", 10),
];

/** Stakeholders — /admin/stakeholders */
const STAKEHOLDERS: Def[] = [
  page("tenant.stakeholders", "Stakeholders", "/admin/stakeholders", "Contact", 30,
    "Proprietários, hóspedes e prestadores de serviço."),

  tab("tenant.stakeholders.proprietarios", "Proprietários", 10),
  act("tenant.stakeholders.proprietarios.cadastrar", "Cadastrar proprietário", 10),
  act("tenant.stakeholders.proprietarios.editar", "Editar proprietário", 20),
  act("tenant.stakeholders.proprietarios.documentos", "Documentos", 30),
  act("tenant.stakeholders.proprietarios.financeiro", "Financeiro", 40),
  act("tenant.stakeholders.proprietarios.imoveis", "Imóveis vinculados", 50),
  act("tenant.stakeholders.proprietarios.timeline", "Timeline de eventos", 60),

  tab("tenant.stakeholders.hospedes", "Hóspedes", 20, { route: "/admin/hospedes" }),
  act("tenant.stakeholders.hospedes.ficha", "Ficha do hóspede", 10),
  act("tenant.stakeholders.hospedes.captacao", "Dados de captação", 20),
  act("tenant.stakeholders.hospedes.enviar-guia", "Enviar guia por e-mail", 30),

  tab("tenant.stakeholders.prestadores", "Prestadores", 30),
  act("tenant.stakeholders.prestadores.cadastrar", "Cadastrar prestador", 10),
  act("tenant.stakeholders.prestadores.editar", "Editar prestador", 20),
];

/** IA Concierge — /admin/ia */
const IA: Def[] = [
  page("tenant.ia", "IA Concierge", "/admin/ia", "BrainCircuit", 40,
    "Memória, conhecimento e aprendizados do concierge."),

  tab("tenant.ia.memoria", "Memória da Operação", 10),
  act("tenant.ia.memoria.consultar", "Consultar memórias", 10),
  act("tenant.ia.memoria.editar", "Editar memória", 20),

  tab("tenant.ia.conhecimento", "Conhecimento da Operação", 20),
  act("tenant.ia.conhecimento.criar", "Criar conhecimento", 10),
  act("tenant.ia.conhecimento.editar", "Editar conhecimento", 20),
  act("tenant.ia.conhecimento.excluir", "Excluir conhecimento", 30),

  tab("tenant.ia.aprendizados", "Aprendizados Pendentes", 30),
  act("tenant.ia.aprendizados.aprovar", "Aprovar aprendizado", 10),
  act("tenant.ia.aprendizados.rejeitar", "Rejeitar aprendizado", 20),
];

/** Atendimento — /admin/atendimento */
const ATENDIMENTO: Def[] = [
  page("tenant.atendimento", "Atendimento", "/admin/atendimento", "Headphones", 50,
    "Filas de atendimento humano e conversas da IA."),

  tab("tenant.atendimento.pendentes", "Pendentes", 10),
  tab("tenant.atendimento.em-atendimento", "Com alguém", 20),
  tab("tenant.atendimento.resolvidas", "Resolvidas", 30),

  tab("tenant.atendimento.conversa", "Janela da conversa", 40),
  act("tenant.atendimento.conversa.assumir", "Assumir atendimento", 10),
  act("tenant.atendimento.conversa.responder", "Responder ao hóspede", 20),
  act("tenant.atendimento.conversa.editar-mensagem", "Editar mensagem", 30),
  act("tenant.atendimento.conversa.excluir-mensagem", "Excluir mensagem", 40),
  act("tenant.atendimento.conversa.audio", "Enviar áudio", 50),
  act("tenant.atendimento.conversa.traduzir", "Traduzir mensagem", 60),
  act("tenant.atendimento.conversa.mencoes", "Mencionar a equipe", 70),
  act("tenant.atendimento.conversa.ensinar-ia", "Ensinar a IA", 80),
  act("tenant.atendimento.conversa.resolver", "Resolver conversa", 90),
];

/** Administrativo — /admin/administrativo */
const ADMINISTRATIVO: Def[] = [
  page("tenant.administrativo", "Administrativo", "/admin/administrativo", "Settings2", 60,
    "Perfil, assinatura, permissões da equipe e integrações."),

  tab("tenant.administrativo.perfil", "Perfil", 10),
  act("tenant.administrativo.perfil.editar", "Editar meus dados", 10),

  tab("tenant.administrativo.assinatura", "Assinatura", 20, { route: "/admin/assinatura" }),
  act("tenant.administrativo.assinatura.plano", "Plano", 10),
  act("tenant.administrativo.assinatura.cartao", "Cartão de crédito", 20),
  act("tenant.administrativo.assinatura.pagamentos", "Pagamentos", 30),

  tab("tenant.administrativo.permissoes", "Permissões", 30),
  act("tenant.administrativo.permissoes.convidar", "Convidar membro", 10),
  act("tenant.administrativo.permissoes.definir", "Definir permissões", 20),
  act("tenant.administrativo.permissoes.imoveis", "Vincular imóveis ao membro", 30),
  act("tenant.administrativo.permissoes.remover", "Remover membro", 40),

  tab("tenant.administrativo.integracoes", "Integrações", 40, { route: "/admin/integracoes" }),
  act("tenant.administrativo.integracoes.google-agenda", "Google Agenda", 10),
  act("tenant.administrativo.integracoes.clicksign", "ClickSign", 20),
  act("tenant.administrativo.integracoes.whatsapp", "WhatsApp", 30),
];

/* ================================================================ ADMIN SAAS */

const SAAS_ENGAJAMENTO: Def[] = [
  page("admin.engajamento", "Engajamento", "/admin/engajamento", "Activity", 10,
    "Panorama de uso dos guias pelos hóspedes."),
  tab("admin.engajamento.panorama", "Panorama", 10),
  tab("admin.engajamento.jornada", "Jornada", 20),
  tab("admin.engajamento.conteudo", "Conteúdo", 30),
  tab("admin.engajamento.hospedes", "Hóspedes", 40),
];

const SAAS_CLIENTES: Def[] = [
  page("admin.clientes", "Clientes", "/admin/clientes", "Users", 20,
    "Carteira de clientes, assinaturas e planos."),
  tab("admin.clientes.lista", "Lista de clientes", 10),
  act("admin.clientes.lista.filtros", "Filtrar e buscar", 10),
  act("admin.clientes.lista.abrir-guias", "Abrir guias do cliente", 20),
  tab("admin.clientes.assinatura", "Assinatura do cliente", 20),
  act("admin.clientes.assinatura.editar", "Editar assinatura", 10),
  act("admin.clientes.assinatura.trial", "Aplicar trial personalizado", 20),
  act("admin.clientes.assinatura.enterprise", "Criar assinatura Enterprise", 30),
  act("admin.clientes.assinatura.cancelar", "Cancelar assinatura", 40),
];

const SAAS_RECOMENDACOES: Def[] = [
  page("admin.recomendacoes-sigma", "Recomendações", "/admin/recomendacoes-sigma", "Star", 30,
    "Curadoria Sigma de conteúdo por cidade."),
  tab("admin.recomendacoes-sigma.pacotes", "Pacotes por cidade", 10),
  act("admin.recomendacoes-sigma.pacotes.criar", "Criar cidade / pacote", 10),
  act("admin.recomendacoes-sigma.pacotes.publicar", "Publicar / despublicar", 20),
  act("admin.recomendacoes-sigma.pacotes.excluir", "Excluir pacote", 30),
  tab("admin.recomendacoes-sigma.recomendacoes", "Recomendações", 20),
  tab("admin.recomendacoes-sigma.faqs", "FAQs", 30),
  tab("admin.recomendacoes-sigma.marketplace", "Marketplace", 40),
  sub("admin.cidades", "Cidades", 50, { route: "/admin/cidades", parentSlug: "admin.recomendacoes-sigma" }),
  sub("admin.taxonomia", "Taxonomia", 60, { route: "/admin/taxonomia", parentSlug: "admin.recomendacoes-sigma" }),
  act("admin.taxonomia.categorias", "Categorias", 10, { parentSlug: "admin.taxonomia" }),
  act("admin.taxonomia.tags", "Etiquetas", 20, { parentSlug: "admin.taxonomia" }),
  act("admin.taxonomia.mesclar", "Mesclar categorias", 30, { parentSlug: "admin.taxonomia" }),
];

const SAAS_INTELIGENCIA: Def[] = [
  page("admin.inteligencia", "Inteligência", "/admin/inteligencia", "Sparkles", 40,
    "Observabilidade da IA, auditoria e analytics do SaaS."),
  tab("admin.inteligencia.global", "Global Intelligence", 10),
  tab("admin.inteligencia.pipeline", "Pipeline de Aprendizado", 20),
  tab("admin.inteligencia.agentes", "Evolução dos Agentes", 30),
  tab("admin.inteligencia.prompts", "Evolução dos Prompts", 40),
  tab("admin.inteligencia.eventos", "Eventos", 50),
  act("admin.inteligencia.eventos.exportar", "Exportar eventos", 10),
  tab("admin.inteligencia.analytics", "Analytics de Logs", 60),
];

const SAAS_ADMINS: Def[] = [
  page("admin.admins", "Administradores", "/admin/admins", "ShieldCheck", 50,
    "Administração interna da plataforma."),
  tab("admin.admins.admins", "Administradores", 10),
  act("admin.admins.admins.conceder", "Conceder acesso admin", 10),
  act("admin.admins.admins.revogar", "Revogar acesso admin", 20),
  tab("admin.admins.invites", "Convites", 20),
  act("admin.admins.invites.criar", "Criar convite", 10),
  act("admin.admins.invites.cancelar", "Cancelar convite", 20),
  tab("admin.admins.permissoes", "Permissões", 30),
  act("admin.admins.permissoes.definir", "Definir permissões do admin", 10),
  act("admin.admins.permissoes.sincronizar", "Sincronizar árvore", 20),
  tab("admin.admins.logs", "Log de atividades", 40),
];

/* ------------------------------------------------------------- raízes/planos */

const ROOTS: Def[] = [
  root(TENANT_NAMESPACE, "Conta do Cliente", "Raiz dos recursos do anfitrião e sua equipe."),
  root(SAAS_NAMESPACE, "Admin SaaS", "Raiz dos recursos internos da plataforma."),
];

/** Funcionalidade de plano exigida por categoria (herdada pela subárvore). */
const FEATURE_BY_SLUG: Record<string, string> = {
  "tenant.atendimento": "humanHandoff",
  "tenant.ia": "ai",
  "tenant.guias.imoveis.edicao-massa": "team",
  "tenant.guias.editor.captacao": "advancedIntake",
  "tenant.administrativo.permissoes": "team",
  "tenant.administrativo.integracoes": "externalIntegration",
};

const RAW_CATALOG: Def[] = [
  ...ROOTS,
  ...DASHBOARD,
  ...GUIAS,
  ...STAKEHOLDERS,
  ...IA,
  ...ATENDIMENTO,
  ...ADMINISTRATIVO,
  ...SAAS_ENGAJAMENTO,
  ...SAAS_CLIENTES,
  ...SAAS_RECOMENDACOES,
  ...SAAS_INTELIGENCIA,
  ...SAAS_ADMINS,
];

/**
 * Deriva o pai de um slug quando ele não foi informado explicitamente:
 * `tenant.guias.imoveis.criar` → `tenant.guias.imoveis`.
 */
function parentFromSlug(slug: string): string | null {
  const parts = slug.split(".");
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join(".");
}

/** Catálogo normalizado — todo nó já com pai resolvido e slug canônico. */
export const PERMISSION_CATALOG: Def[] = RAW_CATALOG.map((node) => {
  const slug = resolveSlug(node.slug);
  const isRoot = slug === TENANT_NAMESPACE || slug === SAAS_NAMESPACE;

  const parentSlug = isRoot
    ? null
    : node.parentSlug !== undefined && node.parentSlug !== null
      ? resolveSlug(node.parentSlug)
      : node.type === "PAGE"
        ? isSaasSlug(slug)
          ? SAAS_NAMESPACE
          : TENANT_NAMESPACE
        : parentFromSlug(slug);

  return {
    ...node,
    slug,
    parentSlug,
    isPermissionable: true,
    ...(FEATURE_BY_SLUG[node.slug] ? { feature: FEATURE_BY_SLUG[node.slug] } : {}),
  } as Def;
});

/** Mapa rota → slug do nó, usado pela rotina de consistência e pelo scanner. */
export const CATALOG_ROUTE_MAP: Record<string, string> = PERMISSION_CATALOG.reduce(
  (acc, node) => {
    if (node.route) acc[node.route] = node.slug;
    return acc;
  },
  {} as Record<string, string>,
);

/** Slugs das categorias (páginas do menu) por contexto. */
export const CATALOG_PAGES = PERMISSION_CATALOG.filter(
  (n) => n.type === "PAGE" && n.slug !== TENANT_NAMESPACE && n.slug !== SAAS_NAMESPACE,
);
