// Tipos compartilhados da esteira de chegadas/saídas.
export type ArrivalRow = {
  logId: string;
  reservationId: string | null;
  propertyId: string;
  propertyName: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerPhoneCountry: string | null;
  propertyAddress: string | null;
  mapsUrl: string | null;
  garageMapsUrl: string | null;

  hasPasswords: boolean;
  openedCheckin: boolean;
  viewedPasswords: boolean;
  guestName: string;
  guestPhone: string | null;
  guestPhoneCountry: string | null;
  guestArrivalTime: string | null; // HH:mm informado pelo hóspede
  standardTime: string | null; // horário padrão da propriedade
  standardTimeMax: string | null;
  date: string; // data prevista (checkin ou checkout)
  guestCheckin: string;
  guestCheckout: string | null;
  reservationCode: string | null;
  createdAt: string;
  status: "pending" | "done";
  note: string | null;
  arrivalTimeOverride: string | null;
  doneAt: string | null;
  pendingFill: boolean; // true = reserva iCal sem formulário preenchido
  concludedAt?: string | null;
  ical: { hasIcal: boolean; matched: boolean; icalCheckin: string | null; icalCheckout: string | null };
  additionalGuests: Array<{
    logId: string;
    name: string;
    phone: string | null;
    phoneCountry: string | null;
    reservationCode: string | null;
    arrivalTime: string | null;
  }>;
};
