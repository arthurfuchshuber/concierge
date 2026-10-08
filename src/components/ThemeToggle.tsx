import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/**
 * Botão claro/escuro do sistema (08/10/2026).
 *
 * NÃO cria tema novo: usa o que já existia — a classe `dark` no <html> e a
 * chave `sg-theme` no localStorage, lidas pelo script de __root.tsx antes da
 * primeira pintura. Este botão só ganhou o "clique" que faltava.
 *
 * Mesmo tamanho do botão de menu do cabeçalho (alvo 44px, ícone 20px).
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
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
      aria-label={dark ? "Mudar para tema claro" : "Mudar para tema escuro"}
      title={dark ? "Tema claro" : "Tema escuro"}
      className={`grid size-11 place-items-center rounded-xl text-foreground transition-colors hover:bg-secondary/60 ${className}`}
    >
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}
