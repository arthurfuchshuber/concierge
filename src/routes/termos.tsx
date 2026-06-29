import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos e Condições — SigmaConcierge" },
      {
        name: "description",
        content:
          "Leia os termos e condições de uso do SigmaConcierge: contas, pagamentos via Paddle, limites de responsabilidade e suporte.",
      },
      { property: "og:title", content: "Termos e Condições — SigmaConcierge" },
      {
        property: "og:description",
        content: "Termos de uso do SigmaConcierge, incluindo assinatura, pagamentos via Paddle e suporte.",
      },
      { property: "og:url", content: "/termos" },
    ],
    links: [{ rel: "canonical", href: "/termos" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-5 py-12 prose-sm">
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
          ← Início
        </Link>
        <h1 className="font-display text-4xl mt-6">Termos e Condições</h1>
        <p className="text-xs text-muted-foreground mt-2">Última atualização: Junho de 2026</p>

        <section className="mt-8 space-y-4 text-sm leading-relaxed">
          <h2 className="font-display text-2xl mt-6">1. O serviço e o prestador</h2>
          <p>
            <strong>SigmaConcierge</strong> ("nós", "serviço") é o nome legal do prestador responsável por este SaaS,
            que permite a anfitriões de aluguel por temporada criarem guias digitais editoriais para seus hóspedes.
            Contato: <strong>sigma@anfitriaosigma.com.br</strong>. Ao usar o serviço, você concorda com estes Termos e
            contrata diretamente com a SigmaConcierge.
          </p>

          <h2 className="font-display text-2xl mt-6">2. Uso aceitável</h2>
          <p>
            Você concorda em não usar o serviço para: atividades ilegais, fraude, spam, violação de propriedade
            intelectual, ou interferir na segurança do sistema (malware, sondagem, scraping não autorizado).
          </p>

          <h2 className="font-display text-2xl mt-6">3. Conta</h2>
          <p>
            Você é responsável pela confidencialidade de suas credenciais e por todas as atividades em sua conta.
            Forneça informações precisas e atualizadas.
          </p>

          <h2 className="font-display text-2xl mt-6">4. Propriedade intelectual</h2>
          <p>
            O SigmaConcierge retém todos os direitos sobre o software, documentação e marca. Concedemos a você uma
            licença limitada, não exclusiva e intransferível para usar o serviço dentro do plano contratado.
          </p>

          <h2 className="font-display text-2xl mt-6">5. Pagamentos e assinatura</h2>
          <p>
            Nosso processo de pedido é conduzido pelo nosso revendedor online <strong>Paddle.com</strong>. A Paddle.com
            é o <strong>Comerciante de Registro (Merchant of Record)</strong> de todos os nossos pedidos. A Paddle
            gerencia consultas de suporte ao cliente relacionadas a cobrança e processa reembolsos.
          </p>
          <p>
            Os termos de pagamento, cobrança, tributação e cancelamento são regidos pelos Termos do Comprador da Paddle:{" "}
            <a
              className="underline"
              href="https://www.paddle.com/legal/checkout-buyer-terms"
              target="_blank"
              rel="noreferrer"
            >
              paddle.com/legal/checkout-buyer-terms
            </a>
            .
          </p>
          <p>
            Assinaturas são renovadas automaticamente conforme o ciclo de cobrança escolhido. Você pode cancelar a
            qualquer momento pelo portal do cliente.
          </p>

          <h2 className="font-display text-2xl mt-6">6. Nível de serviço</h2>
          <p>
            Nos esforçamos para manter o serviço disponível, mas não garantimos funcionamento ininterrupto ou livre de
            erros. Não nos responsabilizamos por danos indiretos, consequenciais ou lucros cessantes.
          </p>

          <h2 className="font-display text-2xl mt-6">7. Suspensão e rescisão</h2>
          <p>
            Podemos suspender ou encerrar seu acesso em caso de: violação destes Termos, falta de pagamento, risco de
            segurança ou fraude, ou violações repetidas das políticas.
          </p>

          <h2 className="font-display text-2xl mt-6">8. Limitação de responsabilidade</h2>
          <p>
            Nossa responsabilidade agregada está limitada ao valor pago por você nos 12 meses anteriores à reclamação,
            exceto onde a lei exigir o contrário.
          </p>

          <h2 className="font-display text-2xl mt-6">9. Lei aplicável</h2>
          <p>
            Estes Termos são regidos pelas leis do Brasil. Qualquer disputa será resolvida no foro da comarca do
            prestador.
          </p>

          <h2 className="font-display text-2xl mt-6">10. Contato</h2>
          <p>Para questões sobre estes Termos: sigma@anfitriaosigma.com.br</p>
        </section>
      </div>
    </div>
  );
}
