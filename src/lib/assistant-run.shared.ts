/**
 * O formato de uma pergunta ao Assistente do Painel.
 *
 * Fica fora do arquivo `.server` porque quem valida é o servidor, mas quem
 * monta o corpo do pedido é a tela — e as duas pontas precisam concordar sem
 * que o navegador acabe importando código de servidor.
 */
import { z } from "zod";

export const AssistantAskInput = z.object({
  threadId: z.string().uuid().nullable().optional(),
  message: z.string().trim().min(1).max(2000),
  /** Rota em que a pessoa está — "onde eu marco isso?" depende disso. */
  currentPath: z.string().max(300).nullable().optional(),
  /**
   * Imagem anexada, como data URL (pedido explícito, 07/09/2026). Vai junto da
   * pergunta para o modelo olhar — um print da tela costuma explicar melhor
   * que qualquer descrição. Não é gravada em lugar nenhum.
   */
  imageDataUrl: z
    .string()
    .max(8_000_000)
    .regex(/^data:image\/(png|jpe?g|webp|gif);base64,/)
    .nullable()
    .optional(),
});

export type AssistantAskData = z.infer<typeof AssistantAskInput>;

/** O que o painel recebe enquanto o turno roda (SSE). */
export type AssistantEvent =
  | { type: "stage"; label: string }
  | { type: "delta"; text: string; step: number };
