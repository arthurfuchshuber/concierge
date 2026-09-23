import { useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Salva automaticamente `value` alguns instantes depois da última mudança —
 * sem precisar de botão "Salvar". Chame normalmente (a cada tecla, a cada
 * setState); o hook faz debounce e chama onSave() sozinho.
 *
 * Não salva na primeira renderização (quando os dados acabaram de carregar
 * do servidor) — só depois de uma mudança de verdade feita pela pessoa.
 */
export function useAutosave<T>(
  value: T,
  onSave: (value: T) => Promise<void>,
  options?: { delay?: number; enabled?: boolean },
) {
  const delay = options?.delay ?? 300;
  const enabled = options?.enabled ?? true;
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  // Guarda a mensagem real do último erro — sem isso, "Falha ao salvar" na
  // tela não dava nenhuma pista de qual campo/validação travou o autosave.
  const [lastError, setLastError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  const firstRunRef = useRef(true);
  const serialized = JSON.stringify(value);

  // onSave muda de identidade a cada render (fecha sobre props/estado que
  // podem mudar independente de `value`, ex.: um id que só existe depois do
  // primeiro save). Guardamos sempre a versão mais nova numa ref — sem isso,
  // um ciclo de save podia disparar com uma versão desatualizada da função e,
  // por exemplo, tentar inserir de novo em vez de atualizar o registro certo.
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  });

  useEffect(() => {
    valueRef.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);

  useEffect(() => {
    if (!enabled) return;
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus("idle");
    timerRef.current = setTimeout(async () => {
      setStatus("saving");
      try {
        await onSaveRef.current(valueRef.current);
        setStatus("saved");
        setLastError(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro desconhecido";
        console.warn("[autosave]", e);
        setLastError(msg);
        setStatus("error");
      }
    }, delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, enabled, delay]);

  /** Força salvar agora, ignorando o debounce — útil ao fechar/sair da tela. */
  async function flush() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus("saving");
    try {
      await onSaveRef.current(valueRef.current);
      setStatus("saved");
      setLastError(null);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      console.warn("[autosave]", e);
      setLastError(msg);
      setStatus("error");
      return false;
    }
  }

  return { status, lastError, flush };
}
