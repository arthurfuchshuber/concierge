import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * O GUARDIÃO DA ÁREA LOGADA — e por que ele parou de deslogar sozinho
 * (11/09/2026).
 *
 * O QUE HAVIA AQUI: além de olhar a sessão guardada no navegador, o guardião
 * chamava `supabase.auth.getUser()` a cada entrada na área logada. Essa
 * chamada VAI À REDE. E qualquer falha dela caía no mesmo ramo do token
 * revogado: `signOut()` — que APAGA uma sessão perfeitamente válida — e
 * redirect para /auth.
 *
 * Quem trabalha no imóvel sai do navegador o tempo todo: abre a câmera, grava
 * um vídeo de dois minutos, volta. Nesse retorno o Android acabou de religar a
 * conexão e a primeira requisição falha com frequência. O guardião lia isso
 * como "esta pessoa não está mais logada".
 *
 * O ESTRAGO, MEDIDO EM 11/09/2026:
 *  · a prestadora entrou de novo QUATRO vezes no mesmo dia (08:19, 10:13,
 *    12:17, 13:40). Nos dois dias anteriores foram ZERO — uma sessão só,
 *    contínua, renovada normalmente;
 *  · às 13:43:27 e de novo às 13:45:00 o aplicativo reiniciou inteiro
 *    (/ → /auth → /admin → /admin/dashboard no mesmo segundo). Na segunda vez
 *    a folha da situação estava aberta com o vídeo dentro: o rascunho evaporou
 *    e ela teve que recomeçar;
 *  · às 13:44:03, quatorze chamadas ao servidor saíram sem cabeçalho de
 *    autorização ("No authorization header provided");
 *  · e o upload do vídeo, cuja política no armazenamento exige
 *    `user_can_access_property(auth.uid(), …)`, foi negado com `auth.uid()`
 *    nulo. Resultado: ZERO arquivos no bucket o dia inteiro, nenhum registro
 *    criado, e o botão girando sem nunca liberar.
 *
 * AGORA:
 *  · a sessão é lida do armazenamento local, sem rede;
 *  · token vencido tenta renovar — e só desloga se o servidor disser, com
 *    todas as letras, que a sessão não vale mais (401/403, sessão/usuário
 *    inexistente, refresh já usado). Falha de rede não é resposta do servidor;
 *  · `getUser()` não é mais chamado aqui. Quem valida o token de verdade é o
 *    servidor, a cada server function, e lá a resposta é inequívoca.
 *
 * A REGRA, EM UMA LINHA: nunca destrua a sessão de alguém por causa de um
 * soluço de rede.
 */

/** A resposta do servidor diz, sem ambiguidade, que esta sessão morreu? */
function sessaoRealmenteInvalida(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; code?: string; message?: string };
  if (e.status === 401 || e.status === 403) return true;
  const texto = `${e.code ?? ""} ${e.message ?? ""}`.toLowerCase();
  return (
    texto.includes("session_not_found") ||
    texto.includes("refresh_token_not_found") ||
    texto.includes("refresh_token_already_used") ||
    texto.includes("user_not_found") ||
    texto.includes("invalid claim")
  );
}

function ehRedirect(err: unknown): boolean {
  return !!err && typeof err === "object" && "isRedirect" in err;
}

/** Margem para renovar antes de vencer: um minuto. */
const MARGEM_SEGUNDOS = 60;

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    let sessao: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"] = null;

    try {
      const { data } = await supabase.auth.getSession();
      sessao = data.session ?? null;
    } catch {
      // Aqui é o armazenamento do navegador em estado ruim — não há sessão
      // para preservar. É o único caso em que a tela de entrada é a resposta
      // certa sem consultar mais ninguém.
      throw redirect({ to: "/auth", search: { next: undefined } });
    }

    if (!sessao) throw redirect({ to: "/auth", search: { next: undefined } });

    // Token vencido (ou a um minuto de vencer): renova ANTES de seguir, para
    // que a primeira chamada da página já saia com cabeçalho válido — foi
    // exatamente isso que faltou nas quatorze chamadas de 13:44:03.
    const agora = Math.floor(Date.now() / 1000);
    const precisaRenovar = !sessao.expires_at || sessao.expires_at - MARGEM_SEGUNDOS <= agora;

    if (precisaRenovar) {
      try {
        const { data, error } = await supabase.auth.refreshSession();
        if (error && sessaoRealmenteInvalida(error)) {
          try {
            await supabase.auth.signOut();
          } catch {
            // Mesmo sem conseguir limpar, o redirect abaixo tem que acontecer.
          }
          throw redirect({ to: "/auth", search: { next: undefined } });
        }
        if (data?.session) sessao = data.session;
        // Erro de rede: segue com a sessão que já existe. O cliente do
        // Supabase continua tentando renovar sozinho em segundo plano, e o
        // servidor recusa o que tiver de recusar — sem apagar nada daqui.
      } catch (err) {
        if (ehRedirect(err)) throw err;
        // idem: rede ruim não desloga ninguém.
      }
    }

    return { user: sessao.user };
  },
  component: () => <Outlet />,
});
