import { z } from "zod";

const HandoffListInput = z.object({
  queue: z
    .enum(["needs_human", "assigned_to_me", "all_active", "ai_only", "all", "resolved"])
    .default("needs_human"),
  limit: z.number().int().min(1).max(200).default(50),
});

const HandoffConversationInput = z.object({ conversationId: z.string().uuid() });

const HandoffTransferInput = z.object({
  conversationId: z.string().uuid(),
  toUserId: z.string().uuid(),
});

const HandoffSendInput = z.object({
  conversationId: z.string().uuid(),
  content: z.string().trim().min(1).max(4000),
  internalNote: z.boolean().optional().default(false),
});

export function parseHandoffListInput(input: unknown) {
  return HandoffListInput.parse(input);
}

export function parseHandoffConversationInput(input: unknown) {
  return HandoffConversationInput.parse(input);
}

export function parseHandoffTransferInput(input: unknown) {
  return HandoffTransferInput.parse(input);
}

export function parseHandoffSendInput(input: unknown) {
  return HandoffSendInput.parse(input);
}