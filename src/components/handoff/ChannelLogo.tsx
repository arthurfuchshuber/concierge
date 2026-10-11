/** Logomarca do canal por onde o hóspede está falando (sem texto). */
export type ChatChannel = "airbnb" | "whatsapp" | "guide";

const LABEL: Record<ChatChannel, string> = {
  airbnb: "Airbnb",
  whatsapp: "WhatsApp",
  guide: "Guia digital",
};

export function channelOf(ch: string | null | undefined, session?: string | null): ChatChannel {
  const c = (ch ?? "").toLowerCase();
  if (c === "airbnb" || c === "whatsapp") return c;
  if (c) return "guide";
  const s = String(session ?? "");
  if (s.startsWith("airbnb:")) return "airbnb";
  if (s.startsWith("whatsapp")) return "whatsapp";
  return "guide";
}

export function ChannelLogo({ channel, size = 14 }: { channel: ChatChannel; size?: number }) {
  const title = `Via ${LABEL[channel]}`;
  if (channel === "airbnb")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={title}>
        <title>{title}</title>
        <path
          fill="#FF385C"
          d="M12 1.5c-1.1 0-2 .7-2.6 1.9C7.6 7 5.4 11.6 3.6 15.4c-.9 2-.3 4.4 1.6 5.5 1.7 1 3.8.6 5.3-.8.5-.5 1-1 1.5-1.6.5.6 1 1.1 1.5 1.6 1.5 1.4 3.6 1.8 5.3.8 1.9-1.1 2.5-3.5 1.6-5.5C18.6 11.6 16.4 7 14.6 3.4 14 2.2 13.1 1.5 12 1.5Zm0 15.2c-1.3-1.6-2.3-3.2-2.3-4.5 0-1.3 1-2.2 2.3-2.2s2.3.9 2.3 2.2c0 1.3-1 2.9-2.3 4.5Z"
        />
      </svg>
    );
  if (channel === "whatsapp")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={title}>
        <title>{title}</title>
        <path
          fill="#25D366"
          d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9 0-1.4.7-2 1-2.3.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.3.4c-.1.1-.3.3-.1.6.2.3.7 1.2 1.6 2 1.1 1 2 1.3 2.3 1.4.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.2Z"
        />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={title}>
      <title>{title}</title>
      <rect x="3" y="2" width="18" height="20" rx="4" fill="currentColor" className="text-primary" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
