/**
 * Espera curta pela reserva que a Channex já indicou na conversa mas que ainda não chegou ao banco (corrida
 * entre o webhook da mensagem e o da reserva; caso Karen, 10/11/2026: 19 s de diferença). Consulta só o banco,
 * a cada `stepMs`, até `maxMs`. Nunca lança.
 */
export const RESERVATION_WAIT_MAX_MS = 20_000;
export const RESERVATION_WAIT_STEP_MS = 2_500;

export async function waitForReservationCode(
  find: () => Promise<string | null>,
  opts: { maxMs?: number; stepMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<string | null> {
  const maxMs = opts.maxMs ?? RESERVATION_WAIT_MAX_MS;
  const stepMs = opts.stepMs ?? RESERVATION_WAIT_STEP_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let waited = 0; waited < maxMs; waited += stepMs) {
    await sleep(stepMs);
    try {
      const code = await find();
      if (code) return code;
    } catch {
      /* tenta de novo */
    }
  }
  return null;
}
