import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — ConciergeIA" },
      {
        name: "description",
        content: "Como o ConciergeIA coleta, usa e protege seus dados pessoais em conformidade com a LGPD.",
      },
      { property: "og:title", content: "Política de Privacidade — ConciergeIA" },
      {
        property: "og:description",
        content:
          "Práticas de coleta, uso, compartilhamento, retenção e direitos sobre dados pessoais no ConciergeIA (LGPD).",
      },
      { property: "og:url", content: "/privacidade" },
    ],
    links: [{ rel: "canonical", href: "/privacidade" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-5 py-12">
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
          ← Início
        </Link>
        <h1 className="font-display text-4xl mt-6">Política de Privacidade</h1>
        <p className="text-xs text-muted-foreground mt-2">Última atualização: Junho de 2026</p>

        <section className="mt-8 space-y-4 text-sm leading-relaxed">
          <h2 className="font-display text-2xl mt-6">1. Controlador de dados</h2>
          <p>
            <strong>ConciergeIA</strong> é o nome legal do prestador responsável por este serviço e atua como
            controlador dos dados pessoais coletados, em conformidade com a LGPD (Lei Geral de Proteção de Dados).
            Contato: <strong>sigma@anfitriaosigma.com.br</strong>.
          </p>

          <h2 className="font-display text-2xl mt-6">2. Dados que coletamos</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Conta:</strong> nome, e-mail, senha (criptografada).
            </li>
            <li>
              <strong>Conteúdo do guia:</strong> informações dos imóveis, fotos, recomendações, contatos.
            </li>
            <li>
              <strong>Uso e telemetria:</strong> logs de acesso, IP, identificadores de dispositivo, eventos de
              navegação.
            </li>
            <li>
              <strong>Suporte:</strong> mensagens trocadas com nosso atendimento.
            </li>
          </ul>

          <h2 className="font-display text-2xl mt-6">3. Finalidades</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Criação de conta e prestação do serviço (execução de contrato).</li>
            <li>Cobrança, gestão da assinatura e tratamento de impostos (obrigação legal, via Paddle).</li>
            <li>Segurança, prevenção a fraudes e melhoria do produto (legítimo interesse).</li>
            <li>Suporte ao cliente e comunicações operacionais.</li>
            <li>Marketing apenas mediante seu consentimento.</li>
          </ul>

          <h2 className="font-display text-2xl mt-6">4. Compartilhamento</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Provedores de infraestrutura</strong> (hospedagem, banco de dados, analytics).
            </li>
            <li>
              <strong>Paddle.com</strong> — Merchant of Record para venda, gestão de assinaturas, pagamentos, tributos e
              emissão de notas.
            </li>
            <li>
              <strong>Assessores profissionais</strong> (jurídicos, contábeis), quando necessário.
            </li>
            <li>
              <strong>Autoridades</strong>, quando exigido por lei.
            </li>
          </ul>

          <h2 className="font-display text-2xl mt-6">5. Retenção</h2>
          <p>
            Mantemos seus dados pelo tempo necessário para prestar o serviço e cumprir obrigações legais. Após esse
            período, dados são deletados ou anonimizados.
          </p>

          <h2 className="font-display text-2xl mt-6">6. Seus direitos</h2>
          <p>
            Você pode solicitar a qualquer momento: acesso, correção, exclusão, portabilidade, restrição, oposição ao
            tratamento e revogação de consentimento. Atendemos solicitações em até 15 dias.
          </p>

          <h2 className="font-display text-2xl mt-6">7. Segurança</h2>
          <p>
            Aplicamos medidas técnicas e organizacionais adequadas: criptografia em trânsito e em repouso, controle de
            acesso, monitoramento contínuo.
          </p>

          <h2 className="font-display text-2xl mt-6">8. Cookies</h2>
          <p>
            Usamos cookies essenciais para autenticação e funcionamento do serviço. Cookies opcionais (analytics) só são
            ativados com seu consentimento.
          </p>

          <h2 className="font-display text-2xl mt-6">9. Contato</h2>
          <p>Encarregado de Dados (DPO): sigma@anfitriaosigma.com.br</p>
        </section>
      </div>
    </div>
  );
}
