/**
 * DE QUANDO É O QUE ESTÁ NA TELA (11/09/2026).
 *
 * O cache persistente das consultas já existia e faz a coisa certa: sem
 * internet, a última visão continua desenhada. É aí que mora o perigo que
 * ninguém tinha endereçado — uma faxineira olhando a fila de limpeza de duas
 * horas atrás, achando que é a de agora, limpa o imóvel errado.
 *
 * A informação que faltava na faixa não é "você está offline". É "isto aqui é
 * de 13:44".
 *
 * O retrato é gravado pelo `createSyncStoragePersister` (ver `__root.tsx`) com
 * uma chave por usuário e conta. Aqui a gente só lê o carimbo de hora — e
 * varre por prefixo em vez de remontar a chave, para não ter duas cópias da
 * regra de nomenclatura que precisariam andar juntas para sempre.
 */

const PREFIXO = "cia-cache-v2:";

export function horaDoCacheLocal(): number | null {
  if (typeof window === "undefined") return null;
  try {
    let maior: number | null = null;
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i) ?? "";
      if (!k.startsWith(PREFIXO)) continue;
      const bruto = window.localStorage.getItem(k);
      if (!bruto) continue;
      const ts = (JSON.parse(bruto) as { timestamp?: number } | null)?.timestamp;
      if (typeof ts === "number" && (maior === null || ts > maior)) maior = ts;
    }
    return maior;
  } catch {
    // localStorage bloqueado ou conteúdo corrompido: a faixa aparece sem a
    // hora, que é bem melhor do que a faixa não aparecer.
    return null;
  }
}

export function horaCurta(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
