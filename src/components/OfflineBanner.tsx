import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

/**
 * Faixa exibida quando o dispositivo perde a conexão.
 * A tela continua mostrando as últimas informações carregadas (cache local).
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[9999] flex items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-center text-[12px] font-medium text-amber-950 shadow-md">
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      <span>Sem internet — exibindo as últimas informações salvas neste aparelho.</span>
    </div>
  );
}

export default OfflineBanner;
