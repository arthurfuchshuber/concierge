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
  openedGuide: boolean;
  readInstructions: boolean;
  viewedPasswords: boolean;
  guestName: string;
  guestPhone: string | null;
  guestPhoneCountry: string | null;
  guestArrivalTime: string | null; // HH:mm informado pelo hóspede
  standardTime: string | null; // horário padrão da propriedade
  standardTimeMax: string | null;
  /** Preço vigente da limpeza normal/completa do imóvel, em centavos — usado
   * só pra decidir quais opções aparecem no diálogo "Qual limpeza foi
   * realizada?" (uma opção sem preço configurado, ou com preço 0, não
   * aparece). */
  cleaningPriceNormalCents: number | null;
  cleaningPriceFullCents: number | null;
  date: string; // data prevista (checkin ou checkout)
  guestCheckin: string;
  guestCheckout: string | null;
  reservationCode: string | null;
  createdAt: string;
  status: "pending" | "done";
  note: string | null;
  arrivalTimeOverride: string | null;
  /** Data prevista informada manualmente (chegada em dia diferente da reserva) */
  arrivalDateOverride: string | null;
  /** ISO: até quando os alertas de atraso deste card estão silenciados */
  mutedUntil: string | null;
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
