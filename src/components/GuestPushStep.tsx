/**
 * O ÚLTIMO PASSO DO PRIMEIRO ACESSO: as notificações (11/09/2026).
 *
 * Pedido: "quero forçar o hóspede a aceitar as notificações no momento em que
 * ele confirma os dados do formulário de primeiro acesso".
 *
 * Forçar não existe — permissão de navegador é uma pergunta que se faz UMA
 * vez, e um "Bloquear" é definitivo até a pessoa mexer nas configurações do
 * site. O que existe é pedir no melhor momento possível, e este é ele: o
 * hóspede acabou de digitar nome, telefone e datas, e está esperando a chave
 * da casa. Boa vontade não fica mais alta que isso.
 *
 * Por isso a tela é uma PERGUNTA MACIA: ela explica o ganho e só então dispara
 * a caixinha do navegador, para quem disse sim. Quem toca em "Agora não" sai
 * sem queimar a permissão e pode aceitar depois, pelo chat.
 *
 * E O IPHONE. Medido em `guide_access_logs`: 71% dos hóspedes deste sistema
 * chegam pelo iPhone, e a Apple não oferece notificação web no Safari comum —
 * só para sites instalados na Tela de Início. Não é permissão que dê para
 * pedir: a função não existe naquele contexto. Para eles a tela vira instrução
 * de instalação, curta e ilustrada, com saída livre. Fingir que o botão
 * resolveria seria mentir para a maioria dos hóspedes.
 */
import { useMemo, useState } from "react";
import { BellRing, Check, Loader2, Share } from "lucide-react";
import {
  enableGuestPush,
  guestPushState,
  GUEST_PUSH_DISMISS_KEY,
  type GuestPushState,
} from "@/lib/guest-push-client";

type Props = {
  slug: string;
  sessionId: string;
  guestFirstName: string | null;
  /** Chamado quando o passo termina, aceitando ou não. Abre o guia. */
  onDone: () => void;
};

export function GuestPushStep({ slug, sessionId, guestFirstName, onDone }: Props) {
  const inicial = useMemo<GuestPushState>(() => guestPushState(slug), [slug]);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function pular() {
    try {
      window.localStorage.setItem(GUEST_PUSH_DISMISS_KEY(slug), "1");
    } catch {
      /* ignore */
    }
    onDone();
  }

  async function aceitar() {
    setBusy(true);
    setErro(null);
    const r = await enableGuestPush({ slug, sessionId });
    setBusy(false);
    if (r.ok) {
      onDone();
      return;
    }
    if (r.reason === "dismissed") {
      // Fechou a caixinha do navegador sem responder. A permissão continua
      // disponível — dá para tentar de novo sem custo.
      setErro("Toque de novo e escolha Permitir na caixinha do navegador.");
      return;
    }
    // Negado, sem suporte ou falha de rede: não vale prender o hóspede na
    // porta do guia por causa disso.
    onDone();
  }

  const ola = guestFirstName ? `${guestFirstName}, ` : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="h-[5px] w-[11px] rounded-full bg-[#a855f7]/25" />
        <span className="h-[5px] w-[11px] rounded-full bg-[#a855f7]/25" />
        <span className="h-[5px] w-[22px] rounded-full bg-gradient-to-r from-[#7C1AD8] to-[#E82DAE]" />
        <span className="ml-1.5">Último passo</span>
      </div>

      {inicial === "ios-install" ? (
        <>
          <div className="mx-auto grid size-[52px] place-items-center rounded-[15px] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-[25px]">
            📲
          </div>
          <h2 className="text-center text-[17px] font-bold leading-tight tracking-tight text-foreground">
            Deixe o guia no seu iPhone
          </h2>
          <p className="text-center text-[12.5px] leading-relaxed text-muted-foreground">
            Fica como um app, abre com um toque — e é assim que consigo te avisar durante a estadia.
          </p>
          <div className="flex flex-col gap-2">
            {[
              <>
                Toque no ícone <strong>Compartilhar</strong>{" "}
                <Share className="inline size-3.5 align-[-2px]" />, na barra de baixo
              </>,
              <>
                Escolha <strong>Adicionar à Tela de Início</strong>
              </>,
              <>Abra o guia pelo novo ícone — aí eu peço a permissão</>,
            ].map((texto, i) => (
              <div key={i} className="grid grid-cols-[20px_1fr] items-start gap-2.5">
                <span className="grid size-5 place-items-center rounded-md bg-white/[0.07] text-[10.5px] font-semibold text-[#c084fc]">
                  {i + 1}
                </span>
                <span className="text-[12.5px] leading-snug text-muted-foreground">{texto}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={pular}
            className="mx-auto block px-2 py-1 text-[12px] text-muted-foreground underline underline-offset-[3px]"
          >
            Continuar sem instalar
          </button>
        </>
      ) : (
        <>
          <div className="mx-auto grid size-[52px] place-items-center rounded-[15px] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white">
            <BellRing className="size-6" strokeWidth={2} />
          </div>
          <h2 className="text-center text-[17px] font-bold leading-tight tracking-tight text-foreground">
            {ola ? `${ola}quer que eu te avise?` : "Quer que eu te avise?"}
          </h2>
          <p className="text-center text-[12.5px] leading-relaxed text-muted-foreground">
            Mando o código do portão quando você estiver chegando, e respondo aqui mesmo se precisar
            de algo durante a estadia.
          </p>
          {erro && (
            <p className="rounded-[12px] border border-amber-500/35 bg-amber-500/[0.08] px-3 py-2 text-center text-[12px] leading-snug text-amber-300">
              {erro}
            </p>
          )}
          <button
            type="button"
            onClick={aceitar}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-[12px] bg-gradient-to-r from-[#7C1AD8] to-[#E82DAE] px-4 py-3 text-[14px] font-bold text-white disabled:opacity-70"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" strokeWidth={2.5} />
            )}
            Sim, quero ser avisado
          </button>
          <button
            type="button"
            onClick={pular}
            className="mx-auto block px-2 py-1 text-[12px] text-muted-foreground underline underline-offset-[3px]"
          >
            Agora não
          </button>
        </>
      )}
    </div>
  );
}

/** Este hóspede, neste aparelho, tem alguma tela de notificação a ver? */
export function shouldShowGuestPushStep(slug: string): boolean {
  const s = guestPushState(slug);
  // "enabled" já está resolvido; "denied" e "unsupported" não têm saída — em
  // nenhum dos três vale gastar uma tela do hóspede.
  return s === "ask" || s === "ios-install";
}
