import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/reembolso")({
  head: () => ({
    meta: [
      { title: "Política de Reembolso — Concierge" },
      {
        name: "description",
        content:
          "Garantia de devolução de 30 dias do Concierge. Veja como solicitar reembolso e cancelar sua assinatura pelo portal do cliente.",
      },
      { property: "og:title", content: "Política de Reembolso — Concierge" },
      {
        property: "og:description",
        content: "Garantia de 30 dias e instruções para solicitar reembolso ou cancelar a assinatura Concierge.",
      },
      { property: "og:url", content: "/reembolso" },
    ],
    links: [{ rel: "canonical", href: "/reembolso" }],
  }),
  component: RefundPage,
});

function RefundPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-5 py-12">
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
          ← Início
        </Link>
        <h1 className="font-display text-4xl mt-6">Política de Reembolso</h1>
        <p className="text-xs text-muted-foreground mt-2">Última atualização: Junho de 2026</p>
        <p className="text-sm mt-4">
          Prestador: <strong>Concierge</strong> — contato: <strong>sigma@anfitriaosigma.com.br</strong>.
        </p>

        <section className="mt-8 space-y-4 text-sm leading-relaxed">
          <h2 className="font-display text-2xl mt-6">Garantia de 30 dias</h2>
          <p>
            Oferecemos uma garantia de devolução de 30 dias. Se você não estiver satisfeito com sua assinatura, pode
            solicitar reembolso integral em até 30 dias após a data da compra.
          </p>

          <h2 className="font-display text-2xl mt-6">Como solicitar</h2>
          <p>Reembolsos são processados pelo nosso provedor de pagamentos, a Paddle. Para solicitar:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              Acesse{" "}
              <a className="underline" href="https://paddle.net" target="_blank" rel="noreferrer">
                paddle.net
              </a>{" "}
              e localize seu pedido pelo e-mail usado na compra; ou
            </li>
            <li>
              Entre em contato conosco em <strong>sigma@anfitriaosigma.com.br</strong> que encaminharemos sua
              solicitação.
            </li>
          </ul>

          <h2 className="font-display text-2xl mt-6">Cancelamento de assinatura</h2>
          <p>
            Você pode cancelar sua assinatura a qualquer momento pelo portal do cliente, dentro da área "Sua assinatura"
            no painel. Ao cancelar, você mantém acesso completo até o fim do período já pago.
          </p>

          <h2 className="font-display text-2xl mt-6">Prazos</h2>
          <p>
            Reembolsos aprovados são processados em até 5 a 10 dias úteis, dependendo do método de pagamento original.
          </p>
        </section>
      </div>
    </div>
  );
}
