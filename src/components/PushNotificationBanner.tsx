import { useEffect, useState } from "react";
import { BellRing, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { enablePush, isPushSupported, currentPushSubscription } from "@/lib/push-client";

const DISMISS_KEY = "push-banner-dismissed";

/**
 * O AVISO É CURTO, E CONTINUA CURTO (11/09/2026).
 *
 * Tentei transformá-lo num cartão com passo a passo quando o navegador
 * bloqueia o site. O cliente cortou na hora, e com razão: "aquele banner
 * curto, bonito... agora você colocou algo extremamente grande". Um aviso no
 * topo do painel é um convite, não um manual.
 *
 * Então a forma é a de sempre: título, uma linha, Ativar e Agora não. O caso
 * do site bloqueado — em que nenhum código do mundo reabre a permissão — vira
 * um aviso de texto e some, como qualquer outro erro.
 *
 * A melhoria que ficou é INVISÍVEL, que é como ela deveria ter sido desde o
 * começo: o app escuta a permissão mudar. Quem libera nas configurações do
 * navegador e volta encontra a notificação JÁ ativada e o aviso sumido, sem
 * apertar nada de novo.
 */
export function PushNotificationBanner() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined") return;
      try {
        if (localStorage.getItem(DISMISS_KEY) === "1") return;
      } catch {
        /* ignore */
      }
      if (!isPushSupported()) return;
      const sub = await currentPushSubscription().catch(() => null);
      if (sub) return;
      if (typeof Notification !== "undefined" && Notification.permission === "denied") return;
      setVisible(true);
    })();
  }, []);

  /**
   * ATIVAR SOZINHO ASSIM QUE A PERMISSÃO ABRIR (11/09/2026).
   *
   * Pedido: "quando clicar em ativar, já ative imediatamente". Num aparelho
   * normal é exatamente o que acontece — a caixinha do navegador abre na mesma
   * tela, a pessoa toca em Permitir e pronto.
   *
   * O problema é o aparelho BLOQUEADO: ali o navegador não mostra caixinha
   * nenhuma, por definição. A única saída é a configuração do site, e isso
   * significa sair do app e voltar. O que dá para eliminar é o TOQUE A MAIS na
   * volta: `navigator.permissions` avisa quando a permissão muda, mesmo que a
   * mudança tenha acontecido na tela de configurações do navegador. Então a
   * pessoa libera lá, volta, e o aviso JÁ SUMIU — ativado sozinho.
   *
   * `visibilitychange` é a rede de segurança para os navegadores que não
   * disparam `onchange` (o Safari é um deles).
   */
  useEffect(() => {
    if (typeof window === "undefined" || !isPushSupported()) return;
    let vivo = true;
    let status: PermissionStatus | null = null;

    const ativarSeLiberado = async () => {
      if (!vivo) return;
      if (typeof Notification === "undefined") return;
      if (Notification.permission !== "granted") return;
      // Já está permitido: assinar não pede nada a ninguém.
      const sub = await currentPushSubscription().catch(() => null);
      if (!vivo || sub) return;
      const res = await enablePush().catch(() => null);
      if (!vivo) return;
      if (res?.ok) {
        toast.success("Notificações ativadas!");
        dismiss();
      }
    };

    const aoVoltar = () => {
      if (document.visibilityState === "visible") void ativarSeLiberado();
    };
    document.addEventListener("visibilitychange", aoVoltar);

    (async () => {
      try {
        const perms = navigator.permissions;
        if (!perms?.query) return;
        status = await perms.query({ name: "notifications" as PermissionName });
        if (!vivo) return;
        status.onchange = () => void ativarSeLiberado();
      } catch {
        /* Safari não sabe consultar "notifications": fica o visibilitychange */
      }
    })();

    return () => {
      vivo = false;
      document.removeEventListener("visibilitychange", aoVoltar);
      if (status) status.onchange = null;
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setVisible(false);
  }

  async function handleEnable() {
    setBusy(true);
    try {
      // iOS Chrome/Safari fora do modo standalone não suporta push
      const nav = window.navigator as Navigator & { standalone?: boolean };
      const standalone =
        nav.standalone || window.matchMedia?.("(display-mode: standalone)").matches;
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isIOS && !standalone) {
        toast.info("No iPhone, adicione o app à Tela de Início para receber notificações.");
        return;
      }
      const res = await enablePush();
      if (res.ok) {
        toast.success("Notificações ativadas!");
        dismiss();
      } else if (res.reason === "dismissed") {
        // Só fechou o aviso do navegador: é um toque a mais, não um problema.
        toast.info("Toque em Ativar de novo e escolha Permitir na caixinha do navegador.");
      } else if (res.reason === "denied") {
        // Bloqueado para este site: nenhum código reabre isso, só a
        // configuração do navegador. Uma linha dizendo onde, e pronto.
        toast.error(
          "Notificações bloqueadas no navegador. Toque no cadeado ao lado do endereço → Notificações → Permitir.",
          { duration: 9000 },
        );
        dismiss();
      } else if (res.reason === "unsupported") {
        toast.error("Navegador não suporta notificações push.");
      } else {
        toast.error("Não foi possível ativar as notificações.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao ativar notificações");
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <div className="mx-3 mt-3 sm:mx-4 sm:mt-4">
      <div className="ds-surface relative border border-accent/25 bg-accent/[0.07] p-4 flex items-start gap-3">
        <span className="shrink-0 size-10 rounded-lg bg-gradient-to-br from-brand-purple to-brand-magenta grid place-items-center text-white shadow-sm">
          <BellRing className="size-5" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1 pr-6">
          <p className="ds-card-title">Ative as notificações</p>
          <p className="ds-body text-muted-foreground mt-0.5">
            Saiba na hora quando um hóspede precisar de ajuda humana.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleEnable}
              disabled={busy}
              className="h-9 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-brand-purple to-brand-magenta text-white px-4 text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Ativar
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="h-9 inline-flex items-center rounded-full border border-border bg-secondary/40 px-4 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
            >
              Agora não
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="absolute top-3 right-3 size-6 grid place-items-center rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Fechar"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
