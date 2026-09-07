/**
 * Renderização do texto que a IA escreve (pedido explícito, 07/09/2026).
 *
 * Os modelos escrevem em Markdown por conta própria — `**assim**` para
 * destacar um número, listas com hífen. Exibindo como texto puro, o leitor vê
 * os asteriscos crus, que é exatamente o oposto do destaque pretendido.
 *
 * Duas armadilhas que este componente resolve e que justificam ele existir em
 * vez de um `<ReactMarkdown>` solto em cada tela:
 *
 *   1. O preflight do Tailwind zera marcador e recuo de `ul`/`ol`. Sem estilo
 *      explícito, uma lista da IA vira um bloco de linhas coladas, sem bullet.
 *      Por isso cada elemento abaixo é estilizado à mão — o projeto não usa o
 *      plugin de typography.
 *
 *   2. Em Markdown, uma quebra de linha simples é "quebra suave" e some na
 *      renderização — mas a IA escreve uma frase por linha esperando ver uma
 *      frase por linha. O chat do hóspede resolve isso trocando toda quebra
 *      por linha em branco antes de renderizar; aqui não dá, porque a mesma
 *      troca destruiria tabela (que exige linhas adjacentes) e afrouxaria as
 *      listas. A saída é `whitespace-pre-line` no parágrafo: a quebra suave
 *      chega como "\n" no texto e o CSS a exibe, sem tocar no Markdown.
 *
 * Herda tamanho e cor de quem o envolve, então serve tanto num balão claro
 * quanto num escuro.
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRouter } from "@tanstack/react-router";

/**
 * Link para uma tela do próprio sistema (pedido explícito, 07/09/2026).
 *
 * A IA aponta caminhos escrevendo `[Kanban](/admin/dashboard/kanban)`, e o
 * leitor deve poder clicar no NOME — sem o endereço aparecer na resposta e sem
 * uma linha extra de "abrir tela" embaixo.
 *
 * Navega pelo router em vez de deixar o `<a>` recarregar a página: um recarregamento
 * completo aqui derrubaria o painel aberto e faria a pessoa perder a conversa
 * no exato momento em que ela seguiu a orientação recebida.
 */
function InternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <a
      href={href}
      onClick={(e) => {
        // Ctrl/Cmd/clique do meio continuam abrindo em outra aba, como em
        // qualquer link — interceptar isso seria tirar um comportamento que a
        // pessoa espera do navegador.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        void router.navigate({ to: href as never });
      }}
      className="font-medium underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  );
}

export function AiMarkdown({ children }: { children: string }) {
  return (
    <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ node, ...props }) => <p {...props} className="my-1.5 whitespace-pre-line leading-relaxed" />,
          strong: ({ node, ...props }) => <strong {...props} className="font-semibold" />,
          em: ({ node, ...props }) => <em {...props} className="italic" />,
          ul: ({ node, ...props }) => <ul {...props} className="my-1.5 list-disc space-y-0.5 pl-4" />,
          ol: ({ node, ...props }) => <ol {...props} className="my-1.5 list-decimal space-y-0.5 pl-4" />,
          li: ({ node, ...props }) => <li {...props} className="whitespace-pre-line leading-relaxed" />,
          h1: ({ node, ...props }) => <p {...props} className="mb-1 mt-2 font-semibold" />,
          h2: ({ node, ...props }) => <p {...props} className="mb-1 mt-2 font-semibold" />,
          h3: ({ node, ...props }) => <p {...props} className="mb-1 mt-2 font-semibold" />,
          code: ({ node, ...props }) => (
            <code {...props} className="rounded bg-black/10 px-1 py-0.5 text-[0.92em] dark:bg-white/15" />
          ),
          pre: ({ node, ...props }) => (
            <pre {...props} className="my-1.5 overflow-x-auto rounded-lg bg-black/10 p-2 text-[0.9em] dark:bg-white/10" />
          ),
          a: ({ node, href, children: label, ...props }) =>
            href && href.startsWith("/") ? (
              <InternalLink href={href}>{label}</InternalLink>
            ) : (
              <a
                {...props}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                {label}
              </a>
            ),
          hr: () => <hr className="my-2 border-current opacity-20" />,
          blockquote: ({ node, ...props }) => (
            <blockquote {...props} className="my-1.5 border-l-2 border-current/30 pl-2.5 opacity-90" />
          ),
          table: ({ node, ...props }) => (
            <div className="my-1.5 overflow-x-auto">
              <table {...props} className="w-full border-collapse text-[0.95em]" />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th {...props} className="border border-current/20 px-1.5 py-1 text-left font-semibold" />
          ),
          td: ({ node, ...props }) => <td {...props} className="border border-current/20 px-1.5 py-1" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
