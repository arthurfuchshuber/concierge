import { useEffect, useRef, useState } from "react";

/**
 * Guia do hóspede REAL dentro da moldura da landing.
 *
 * Não é uma recriação: é a própria página do guia (`/g/<slug>`), carregada em
 * um iframe no modo vitrine (`?preview=1&demo=1`). O modo vitrine pula o
 * formulário de acesso e mascara no servidor tudo que é sensível — senha de
 * wi-fi, códigos de fechadura/portão, endereço e telefones.
 *
 * ALTURA TRAVADA (17/09/2026, pedido do cliente com print): a moldura mostra
 * o guia do topo até logo abaixo do cartão "Chegada" — contando que a faixa
 * "check-in libera em" e o aviso "Importante · Check-in" estejam visíveis —
 * e, embaixo, a barra de navegação do guia. A altura é FIXA: não é medida
 * depois de carregar e não muda com a tela.
 *
 * Como a mesma altura vale em qualquer tela: o guia é sempre desenhado com
 * 375 px de largura e reduzido/ampliado para caber na moldura, então a quebra
 * de linha dos textos e o ponto de corte são os mesmos em todo lugar.
 *
 * De onde vem o número (medido no site publicado, em 375 px de largura, com
 * duas alturas de janela diferentes — o resultado foi o mesmo nas duas):
 * topo do guia → fim do cartão "Chegada" = 593 px; a barra de navegação do
 * modo vitrine ocupa 59 px e encosta no rodapé da moldura. Para a barra cair
 * no ESPAÇAMENTO abaixo do cartão (são 12 px até a próxima fileira), o corte
 * fica 6 px depois do cartão: 593 + 6 = 599 de conteúdo + 59 da barra = 658.
 *
 * O valor anterior (610) foi medido quando o topo do guia era 48 px mais
 * curto; depois que ele cresceu, a barra passou a cobrir o pé do cartão
 * "Chegada" — que é exatamente o que o cliente apontou nos prints de
 * 17/09/2026. Se o topo do guia mudar de altura de novo, refaça a medida e
 * ajuste GUIDE_HEIGHT.
 */
const DEMO_SLUG = "casa-charmosa-prox-a-avenida-das-cataratas";
const GUIDE_WIDTH = 375;
const GUIDE_HEIGHT = 658;

/**
 * POR QUE TEM UM <script> AQUI DENTRO (17/09/2026, pedido do cliente com
 * print: "o guia não está abrindo no mockup assim que o usuário carrega a
 * página").
 *
 * O guia carregava normalmente — o que faltava era deixá-lo APARECER. A
 * redução (`scale`) só podia ser calculada no navegador, porque depende da
 * largura da moldura, e antes disso a moldura ficava preta de propósito, para
 * ninguém ver o guia no tamanho errado. Só que essa conta morava num efeito
 * do React: ela só acontecia depois da HIDRATAÇÃO da landing — que no celular
 * demora vários segundos, com a página inteira e o próprio guia disputando o
 * processador. Resultado: retângulo preto por segundos, com o guia pronto
 * atrás dele.
 *
 * Este script roda na hora em que o navegador LÊ o HTML, antes de qualquer
 * JavaScript da aplicação: mede a moldura, aplica a redução e revela o guia
 * no primeiro quadro. O efeito do React abaixo faz a mesma coisa (para quando
 * a landing é aberta por navegação interna, sem recarregar a página) e cuida
 * de continuar acompanhando quando a janela muda de tamanho.
 */
const FRAME_ID = "guia-vitrine";
const REVELAR_NA_HORA = `(function(){var b=document.getElementById(${JSON.stringify(FRAME_ID)});if(!b)return;var f=b.querySelector('iframe');if(!f)return;var a=function(){f.style.transform='scale('+(b.clientWidth/${GUIDE_WIDTH})+')';f.style.opacity='1';};a();if(window.ResizeObserver){new ResizeObserver(a).observe(b);}else if(window.addEventListener){window.addEventListener('resize',a);}})();`;

export function LiveGuideFrame() {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  /* ESQUELETO ENQUANTO O GUIA CARREGA (19/09/2026, pedido com print: "o guia
     no mockup está demorando muito a aparecer"). O guia é uma página inteira:
     mesmo carregando já, leva um instante até desenhar. Antes, esse instante
     era um retângulo preto. Agora é o contorno do próprio guia piscando, e
     ele some assim que a página de dentro termina de carregar. */
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    const frame = frameRef.current;
    if (!box || !frame) return;
    const aplicar = () => {
      frame.style.transform = `scale(${box.clientWidth / GUIDE_WIDTH})`;
      frame.style.opacity = "1";
    };
    aplicar();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(aplicar) : null;
    ro?.observe(box);
    // Se o `load` do iframe não chegar (cache, navegação interna), o esqueleto
    // não pode ficar preso na frente do guia.
    const t = window.setTimeout(() => setCarregado(true), 4000);
    return () => {
      ro?.disconnect();
      window.clearTimeout(t);
    };
  }, []);

  return (
    <div
      id={FRAME_ID}
      ref={boxRef}
      className="relative w-full min-w-0 overflow-hidden bg-[#07070d]"
      style={{ aspectRatio: `${GUIDE_WIDTH} / ${GUIDE_HEIGHT}` }}
    >
      {!carregado && (
        <div
          aria-hidden
          className="absolute inset-0 z-10 animate-pulse bg-[#0b0b14] px-[6%] pt-[8%]"
        >
          <div className="h-[22%] w-full rounded-[10px] bg-white/[0.07]" />
          <div className="mt-[6%] h-[7%] w-3/5 rounded-full bg-white/[0.06]" />
          <div className="mt-[3%] h-[5%] w-2/5 rounded-full bg-white/[0.05]" />
          <div className="mt-[7%] grid grid-cols-2 gap-[4%]">
            <div className="aspect-[3/2] rounded-[10px] bg-white/[0.06]" />
            <div className="aspect-[3/2] rounded-[10px] bg-white/[0.06]" />
            <div className="aspect-[3/2] rounded-[10px] bg-white/[0.05]" />
            <div className="aspect-[3/2] rounded-[10px] bg-white/[0.05]" />
          </div>
          <div className="absolute inset-x-0 bottom-0 h-[9%] bg-white/[0.04]" />
        </div>
      )}
      <iframe
        ref={frameRef}
        src={`/g/${DEMO_SLUG}?preview=1&demo=1`}
        title="Guia do hóspede — demonstração"
        // Fica no topo da landing: carregar já, sem esperar a rolagem.
        loading="eager"
        onLoad={() => setCarregado(true)}
        className="absolute top-0 left-0 block border-0"
        style={{
          width: GUIDE_WIDTH,
          height: GUIDE_HEIGHT,
          transformOrigin: "top left",
          // Some até o script abaixo saber a redução — é questão de um quadro.
          opacity: 0,
        }}
      />
      <script dangerouslySetInnerHTML={{ __html: REVELAR_NA_HORA }} />
    </div>
  );
}
