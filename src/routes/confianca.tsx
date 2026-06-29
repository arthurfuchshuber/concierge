import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Lock, KeyRound, Database, Globe, Mail } from "lucide-react";

const FAQ_ITEMS: Array<{ q: string; a: string }> = [
  {
    q: "Como o SigmaConcierge protege senhas de Wi-Fi e códigos de acesso?",
    a: "Cada anfitrião pode proteger campos sensíveis (Wi-Fi, portões, fechaduras, códigos de acesso) com um PIN. Sem o PIN correto, nem o hóspede nem a assistente de IA conseguem ver o conteúdo bloqueado.",
  },
  {
    q: "Quem pode ver os dados dos meus guias?",
    a: "Apenas você. O isolamento é aplicado no banco de dados via Row Level Security, então cada anfitrião acessa somente seus próprios imóveis, conversas e configurações.",
  },
  {
    q: "Quais subprocessadores o SigmaConcierge utiliza?",
    a: "Hospedagem na Lovable (Cloudflare edge), banco e autenticação no Supabase, pagamentos na Paddle (Merchant of Record), Google Maps Platform para mapas e fotos, e provedores de IA via Lovable AI Gateway.",
  },
  {
    q: "Como excluo minha conta e meus dados?",
    a: "Envie a solicitação para seguranca@sigmaguide.app. Confirmamos a exclusão por e-mail e processamos em até 30 dias. Dados de cobrança ficam retidos pelo período exigido pela legislação fiscal.",
  },
  {
    q: "Como reporto uma vulnerabilidade de segurança?",
    a: "Escreva para seguranca@sigmaguide.app descrevendo o cenário e os passos para reproduzir. Pedimos que não divulgue publicamente a falha antes de termos a oportunidade de corrigi-la.",
  },
];

export const Route = createFileRoute("/confianca")({
  head: () => ({
    meta: [
      { title: "Central de Confiança — SigmaConcierge" },
      {
        name: "description",
        content:
          "Como o SigmaConcierge protege os dados de anfitriões e hóspedes: autenticação, criptografia, controle de acesso e privacidade.",
      },
      { property: "og:title", content: "Central de Confiança — SigmaConcierge" },
      {
        property: "og:description",
        content:
          "Controles de segurança, privacidade e subprocessadores do SigmaConcierge para anfitriões e hóspedes.",
      },
      { property: "og:url", content: "/confianca" },
    ],
    links: [{ rel: "canonical", href: "/confianca" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ_ITEMS.map((item) => ({
            "@type": "Question",
            name: item.q,
            acceptedAnswer: { "@type": "Answer", text: item.a },
          })),
        }),
      },
    ],
  }),
  component: TrustPage,
});

function TrustPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-5 py-12">
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
          ← Início
        </Link>

        <header className="mt-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-card text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" /> Página mantida pela SigmaConcierge
          </div>
          <h1 className="font-display text-4xl mt-4">Central de Confiança</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            Esta página é mantida pela equipe do SigmaConcierge para responder dúvidas
            comuns sobre segurança, privacidade e operação do produto. Não constitui
            certificação independente; é um descritivo dos controles atualmente em
            uso no aplicativo.
          </p>
        </header>

        <section className="mt-10 space-y-8 text-sm leading-relaxed">
          <Block
            icon={<KeyRound className="size-4" />}
            title="Autenticação e contas"
          >
            <ul className="list-disc pl-6 space-y-1.5">
              <li>Login por e-mail/senha e por conta Google.</li>
              <li>Senhas são armazenadas com hash; nunca em texto puro.</li>
              <li>Sessões usam tokens JWT de curta duração com renovação automática.</li>
              <li>O painel administrativo é acessível apenas após autenticação e seleção de plano.</li>
            </ul>
          </Block>

          <Block
            icon={<Lock className="size-4" />}
            title="Dados sensíveis dentro dos guias"
          >
            <ul className="list-disc pl-6 space-y-1.5">
              <li>
                Senhas de Wi-Fi, códigos de portão, códigos de fechadura e códigos
                de acesso podem ser protegidos por PIN definido pelo anfitrião.
              </li>
              <li>
                Quando o PIN está ativo, o conteúdo só é revelado após o hóspede
                informar o código correto; nenhum mecanismo do app (incluindo a
                assistente de IA) revela dados bloqueados.
              </li>
              <li>
                O anfitrião controla a expiração do PIN e pode trocá-lo a qualquer
                momento pelo painel.
              </li>
            </ul>
          </Block>

          <Block
            icon={<Database className="size-4" />}
            title="Acesso aos dados e isolamento entre contas"
          >
            <ul className="list-disc pl-6 space-y-1.5">
              <li>
                Cada anfitrião só enxerga seus próprios imóveis, conversas e
                configurações. O isolamento é enforced no banco de dados via
                Row Level Security.
              </li>
              <li>
                Operações administrativas privilegiadas exigem verificação
                explícita de papel no servidor.
              </li>
              <li>
                Webhooks externos (pagamentos) são verificados por assinatura
                criptográfica antes de qualquer escrita.
              </li>
            </ul>
          </Block>

          <Block
            icon={<Globe className="size-4" />}
            title="Infraestrutura e subprocessadores"
          >
            <ul className="list-disc pl-6 space-y-1.5">
              <li>Hospedagem da aplicação: Lovable (Cloudflare edge).</li>
              <li>Banco de dados, autenticação e armazenamento: Supabase.</li>
              <li>Pagamentos e gestão de assinaturas: Paddle (Merchant of Record).</li>
              <li>Mapas e fotos de pontos de referência: Google Maps Platform.</li>
              <li>Assistente de IA: provedores acessados via Lovable AI Gateway.</li>
            </ul>
            <p className="text-xs text-muted-foreground mt-3">
              O tráfego entre o navegador e nossos servidores ocorre via HTTPS
              (TLS). Dados em repouso ficam nos provedores listados acima, que
              aplicam seus próprios controles de criptografia e isolamento.
            </p>
          </Block>

          <Block icon={<ShieldCheck className="size-4" />} title="Retenção e exclusão">
            <ul className="list-disc pl-6 space-y-1.5">
              <li>
                Você pode editar ou excluir qualquer guia, foto ou recomendação a
                qualquer momento pelo painel.
              </li>
              <li>
                Para excluir sua conta e dados associados, envie a solicitação por
                e-mail (abaixo). Confirmamos a exclusão por e-mail e processamos em
                até 30 dias.
              </li>
              <li>
                Dados de cobrança ficam retidos pelo período exigido pela
                legislação fiscal aplicável, sob responsabilidade do processador
                de pagamentos.
              </li>
            </ul>
          </Block>

          <Block icon={<Mail className="size-4" />} title="Reportar uma vulnerabilidade">
            <p>
              Encontrou algo que parece um problema de segurança? Escreva para nós
              descrevendo o cenário e os passos para reproduzir. Pedimos que não
              divulgue publicamente a falha antes de termos a oportunidade de
              corrigi-la.
            </p>
            <p className="mt-2">
              Contato:{" "}
              <a
                className="underline"
                href="mailto:seguranca@sigmaguide.app"
              >
                seguranca@sigmaguide.app
              </a>
            </p>
          </Block>
        </section>

        <footer className="mt-12 pt-6 border-t border-border text-xs text-muted-foreground flex flex-wrap gap-4">
          <Link to="/privacidade" className="hover:text-foreground">
            Política de Privacidade
          </Link>
          <Link to="/termos" className="hover:text-foreground">
            Termos de Uso
          </Link>
          <Link to="/reembolso" className="hover:text-foreground">
            Política de Reembolso
          </Link>
        </footer>
      </div>
    </div>
  );
}

function Block({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center gap-2 mb-3">
        <div className="size-8 rounded-lg bg-secondary grid place-items-center text-foreground">
          {icon}
        </div>
        <h2 className="font-display text-xl">{title}</h2>
      </div>
      <div className="text-sm text-foreground/85">{children}</div>
    </div>
  );
}
