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
  /** Coordenadas do imóvel (quando cadastradas) — usadas só pra desempate por
   * proximidade na ordenação dos checkouts (regra 4, pedido explícito). */
  lat: number | null;
  lng: number | null;

  hasPasswords: boolean;
  /**
   * O imóvel tem ALGUM dado de chegada para a equipe (portão, fechadura, rede
   * ou senha do Wi-Fi)? Decide se a chave aparece no card "Em Limpeza"
   * (mockup aprovado, 30/09/2026). Só o SIM/NÃO viaja na lista do quadro — os
   * códigos em si vêm sob demanda, por `getPropertyAccessInfo`. Opcional
   * porque só a esteira do Kanban (`arrival-board.server.ts`) preenche.
   */
  hasAccessInfo?: boolean;
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
  /**
   * Horários padrão do IMÓVEL, sempre os dois, independente do `kind` da
   * linha. `standardTime`/`standardTimeMax` mudam de significado conforme a
   * linha é chegada ou saída; estes não mudam nunca.
   *
   * Existem porque a JANELA DA LIMPEZA precisa dos dois lados ao mesmo tempo
   * (pedido explícito, 09/09/2026): ela começa quando o hóspede sai e termina
   * quando o próximo pode entrar. Uma linha de checkout sozinha só conhece o
   * lado da saída.
   */
  propertyCheckinTime: string | null; // checkin_time (mínimo de entrada)
  propertyCheckoutTime: string | null; // checkout_time (limite de saída)
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
  /** 'guest' quando a previsão foi informada pelo próprio hóspede no guia. */
  arrivalTimeSource?: string | null;
  /** ISO: até quando os alertas de atraso deste card estão silenciados */
  mutedUntil: string | null;
  doneAt: string | null;
  pendingFill: boolean; // true = reserva iCal sem formulário preenchido
  concludedAt?: string | null;
  ical: { hasIcal: boolean; matched: boolean; icalCheckin: string | null; icalCheckout: string | null };
  /**
   * LIMPEZA CRIADA MANUALMENTE (02/10/2026) — presente só nesses cards, que
   * não têm estadia por trás (`logId = "manual:<id>"`, `reservationId` nulo).
   * Tipo e valor já vêm definidos da criação; `reservationLinked` diz se ela
   * aponta para uma reserva (o hóspede vem em `guestName`). Ver
   * `manual-cleaning.server.ts`.
   */
  manual?: {
    id: string;
    cleaningType: "normal" | "completa";
    priceCents: number | null;
    reservationLinked: boolean;
  };
  additionalGuests: Array<{
    logId: string;
    name: string;
    phone: string | null;
    phoneCountry: string | null;
    reservationCode: string | null;
    arrivalTime: string | null;
  }>;
};
