// Small event bus to command the FloatingHandoffDock from anywhere in the app.
// Consumers dispatch a CustomEvent with an optional guest identifier; the dock
// opens itself and, when possible, focuses the matching conversation so the
// existing chat surface (with WhatsApp integration inside ConversationView) is
// the single entry point for proactive contact.

export const HANDOFF_DOCK_OPEN_EVENT = "handoff-dock:open";

export type HandoffDockOpenDetail = {
  conversationId?: string | null;
  propertyId?: string | null;
  phone?: string | null;
  reservationCode?: string | null;
  guestName?: string | null;
};

export function openHandoffDock(detail: HandoffDockOpenDetail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(HANDOFF_DOCK_OPEN_EVENT, { detail }));
}
