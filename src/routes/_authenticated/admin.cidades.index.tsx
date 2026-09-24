import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * PÁGINA DESATIVADA (limpeza das recomendações, 24/09/2026).
 *
 * "Na Cidade" listava as recomendações por CIDADE (linhas sem imóvel e sem
 * grupo), geradas por uma rotina semanal que foi desligada. Desde que cada
 * guia passou a ter só as próprias recomendações (isolamento por conta), essas
 * linhas não apareciam em guia nenhum — e a página não tinha link no menu.
 * O arquivo continua existindo só para quem tiver o endereço salvo cair em
 * Recomendações em vez de uma tela quebrada. Pode ser apagado no Lovable.
 */
export const Route = createFileRoute("/_authenticated/admin/cidades/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/recomendacoes-sigma" });
  },
});
