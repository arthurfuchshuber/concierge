import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { horaCurta, horaDoCacheLocal } from "@/lib/offline/cache-age";

/**
 * Faixa exibida quando o dispositivo perde a conexão.
 * A tela continua mostrando as últimas informações carregadas (cache local).
 *
 * A HORA FOI ACRESCENTADA EM 11/09/2026, e é a parte que importa. Dizer
 * "exibindo as últimas informações salvas" é verdade, mas não responde a
 * única pergunta que muda uma decisão: de QUANDO. Uma faxineira lendo a fila
 * de limpeza de duas horas atrás, achando que é a de agora, limpa o imóvel
 * errado — e o cache, que existe para ajudar, teria causado o erro.
 *
 * Forma, posição, cor e tamanho continuam exatamente os de antes: o cliente
 * pediu para não mexer no que já estava implementado.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  const [hora, setHora] = useState<string | null>(null);

  // Lido quando a conexão cai, não no render: o carimbo muda ao longo da
  // sessão, e ler uma vez no primeiro desenho deixaria um valor preso.
  useEffect(() => {
    if (online) {
      setHora(null);
      return;
    }
    const ts = horaDoCacheLocal();
    setHora(ts ? horaCurta(ts) : null);
  }, [online]);

  if (online) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[9999] flex items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-center text-[12px] font-medium text-amber-950 shadow-md">
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      <span>
        Sem internet — exibindo as últimas informações salvas neste aparelho
        {hora ? <b className="font-semibold">, de {hora}</b> : null}.
      </span>
    </div>
  );
}

export default OfflineBanner;
