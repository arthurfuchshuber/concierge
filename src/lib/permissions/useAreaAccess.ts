import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAccessDecisions } from "@/lib/permissions/permission.access.functions";
import type { AccessLevelInput } from "@/lib/permissions/permissionClient";
import { useAccessEnv } from "@/lib/permissions/useAccessEnv";

/**
 * `useAreaAccess` — decisões do backend para VÁRIAS áreas em uma única consulta.
 *
 * Regra: o frontend nunca decide permissão; aqui só transportamos a decisão
 * já tomada pelo Authorization Runtime. Enquanto carrega, `loading` é true e
 * a UI deve aguardar (não mostrar nem esconder prematuramente).
 *
 * TRÊS ESTADOS, NUNCA DOIS (correção de 03/10/2026):
 *   - liberado / negado — o backend respondeu;
 *   - `loading`         — ainda sem token, consultando ou tentando de novo;
 *   - `failed`          — o backend NÃO respondeu depois das tentativas.
 *
 * O erro antigo: qualquer falha (token ainda não anexado, rede, reinício do
 * servidor) era engolida e virava `{ decisions: {} }`, que o cache guardava
 * como se fosse resposta. Sem decisão, a tela dizia "Você não tem acesso a
 * esta área" para quem tinha acesso. Falha NÃO é negação: agora ela é tentada
 * de novo sozinha e, se persistir, a tela oferece "Tentar de novo" em vez de
 * acusar a pessoa de não ter permissão.
 */
/** Nunca deixa a tela esperando para sempre: passou do prazo, vira falha (com "Tentar de novo"). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Tempo esgotado ao verificar o acesso.")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function useAreaAccess(namespaces: string[], required: AccessLevelInput = "READ") {
  const list = [...new Set(namespaces.filter(Boolean))].sort();
  const fetcher = useServerFn(getMyAccessDecisions);
  const { sessionReady, accountOwnerId } = useAccessEnv();

  const query = useQuery({
    queryKey: ["area-access", accountOwnerId ?? "self", required, list.join("|")],
    queryFn: () =>
      withTimeout(
        fetcher({
          data: {
            permissions: list,
            required,
            accountOwnerId,
            propertyId: null,
            clientId: null,
            recordId: null,
          },
        }),
        12_000,
      ),
    enabled: list.length > 0 && sessionReady,
    staleTime: 30_000,
    // Falha transitória (token a caminho, cold start, rede): tenta de novo
    // antes de desistir — 4 tentativas em ~3,5 s.
    retry: 2,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 2_000),
    // Voltar para a aba revalida; uma decisão boa já guardada NÃO some se a
    // revalidação falhar (o react-query mantém `data`).
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const decisions = query.data?.decisions ?? {};
  // Sem token ainda (`!sessionReady`) também é "carregando": a consulta está
  // desligada, não negada.
  const loading = list.length > 0 && !query.data && !query.isError;
  const failed = !query.data && query.isError;

  /** Área liberada? Sem uma decisão positiva do backend, o acesso fica fechado. */
  function can(namespace: string): boolean {
    const decision = decisions[namespace];
    // Carregando: mantém o comportamento de sempre (menu inteiro visível
    // enquanto a decisão não chega). Falhou ou sem decisão: fechado.
    if (!decision) return loading;
    return decision.allowed;
  }

  function reasonFor(namespace: string): string {
    return decisions[namespace]?.reason ?? "";
  }

  return {
    can,
    reasonFor,
    loading,
    failed,
    ready: !loading && !failed,
    decisions,
    retry: () => void query.refetch(),
  };
}
