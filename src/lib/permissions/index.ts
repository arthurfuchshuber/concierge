/**
 * Permission Engine — ponto de entrada público da camada de permissões.
 *
 * FASE 1 (estrutural): nada aqui está conectado às telas, rotas, menus ou
 * regras de acesso atuais. O comportamento do ConciergeIA permanece idêntico.
 *
 * Regras estruturais já definidas:
 *  - OWNER sempre possui acesso total ao que estiver disponível para o tenant;
 *    suas permissões nunca podem ser editadas.
 *  - Nenhuma funcionalidade futura pode existir sem estar no Permission Registry.
 *
 * O repositório e o serviço são server-only e devem ser importados
 * diretamente de "./permission.repository.server" / "./permission.service.server".
 */
export * from "./permission.types";
export * from "./permission.registry";
export * from "./permission.engine";
export * from "./permission.guard";
export * from "./feature.access";
