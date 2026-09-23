// Tipos compartilhados da integração com o Google Agenda (seguros para o cliente).

export type GcalStatus = {
  connected: boolean;
  email: string | null;
  calendarsCount: number;
  error: string | null;
};

export type GcalCalendar = {
  id: string;
  summary: string;
  primary: boolean;
  timeZone: string | null;
};

export type GcalAttachment = {
  title: string;
  url: string;
  kind: "recording" | "transcript" | "file";
};

export type GcalEvent = {
  id: string;
  calendarId: string;
  calendarName: string;
  summary: string;
  description: string | null;
  location: string | null;
  start: string | null;
  end: string | null;
  hangoutLink: string | null;
  htmlLink: string | null;
  attendees: string[];
  attachments: GcalAttachment[];
  /** Vínculo automático (ou aprendido) com proprietário/prestador cadastrado. */
  link: { type: "owner" | "provider"; id: string; label: string; via: string } | null;
  /** Melhor identificador externo do evento (para o vínculo manual). */
  suggestedAlias: { kind: "email" | "domain"; value: string } | null;
};
