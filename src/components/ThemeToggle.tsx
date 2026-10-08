import { Moon, Sun } from "lucide-react";

/**
 * Botão claro/escuro do sistema (08/10/2026).
 *
 * NÃO cria tema novo: usa o que já existia — a classe `dark` no <html> e a
 * chave `sg-theme` no localStorage.
 *
 * TEMA FIXADO ATÉ A PESSOA TROCAR (pedido explícito, 08/10/2026): a escolha
 * fica em `sg-theme` e o script de `__root.tsx` a aplica no <html> ANTES da
 * primeira pintura, em todo acesso — por isso o sistema abre já no tema certo,
 * sem "piscar" no outro. Sem escolha salva, vale o tema do aparelho.
 *
 * O ícone troca só por CSS (variante `dark:`), nunca por estado do React: um
 * estado iniciado em "claro" e corrigido depois do carregamento faria o ícone
 * errado aparecer por um instante em quem usa o tema escuro.
 *
 * Mesmo tamanho do botão de menu do cabeçalho (alvo 44px, ícone 20px).
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      window.localStorage.setItem("sg-theme", next ? "dark" : "light");
    } catch {
      // localStorage indisponível (modo privado etc.) — o tema vale na sessão.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Alternar entre tema claro e escuro"
      title="Alternar tema"
      className={`grid size-11 place-items-center rounded-xl text-foreground transition-colors hover:bg-secondary/60 ${className}`}
    >
      <Moon className="size-5 dark:hidden" />
      <Sun className="hidden size-5 dark:block" />
    </button>
  );
}
