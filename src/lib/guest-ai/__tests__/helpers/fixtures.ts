import { FakeDb } from "./fake-db";

export const IDS = {
  owner1: "11111111-1111-4111-8111-111111111111",
  owner2: "22222222-2222-4222-8222-222222222222",
  prop1: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  prop2: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  res1: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  res2: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
  conv1: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
  convWa: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
  convAb: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
  conv2: "cccccccc-cccc-4ccc-8ccc-ccccccccccc4",
  msg1: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
  msgHuman: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
  msgNote: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
  msgWa: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
  msgAb: "dddddddd-dddd-4ddd-8ddd-ddddddddddd5",
  msg2: "dddddddd-dddd-4ddd-8ddd-ddddddddddd6",
} as const;

/** Valores de segredo reconhecíveis: os testes procuram por eles em qualquer saída. */
export const SECRETS = {
  lock: "LOCK-7391",
  gate: "GATE-5520",
  wifi: "WIFI-Sup3rSecret",
  pin: "PIN-4408",
  gateInstr: "Digite GATE-5520 e aguarde o bip",
  lockInstr: "Senha da porta LOCK-7391 no teclado",
} as const;

export const SECRET_VALUES = Object.values(SECRETS);

export function makeDb(over: { [table: string]: Array<Record<string, unknown>> } = {}): FakeDb {
  const property = (id: string, owner: string, extra: Record<string, unknown> = {}) => ({
    id,
    owner_id: owner,
    name: "Casa Teste",
    short_description: "Espaço inteiro",
    city: "Foz do Iguaçu",
    state: "PR",
    country: "Brasil",
    address: "Rua das Flores, 100 - Centro, Foz do Iguaçu - PR, 85851-000",
    checkin_time: "15:00",
    checkout_time: "11:00",
    lock_code: SECRETS.lock,
    gate_code: SECRETS.gate,
    wifi_password: SECRETS.wifi,
    pin_code: SECRETS.pin,
    access_codes_pin: "9999",
    access_mode: "pin",
    gate_instructions: SECRETS.gateInstr,
    lock_instructions: SECRETS.lockInstr,
    wifi_ssid: "CasaWifi",
    ...extra,
  });
  const base: Record<string, Array<Record<string, unknown>>> = {
    properties: [property(IDS.prop1, IDS.owner1), property(IDS.prop2, IDS.owner2, { name: "Casa Alheia", lock_code: "OUTRA-0000" })],
    property_chat_conversations: [
      { id: IDS.conv1, property_id: IDS.prop1, guest_session_id: "sess-guide-aaaaaaaaaaaa", status: "ai", reservation_id: IDS.res1 },
      { id: IDS.convWa, property_id: IDS.prop1, guest_session_id: "wa:5545999990000", status: "ai", reservation_id: null },
      { id: IDS.convAb, property_id: IDS.prop1, guest_session_id: "airbnb:thread-1", status: "needs_human", reservation_id: null },
      { id: IDS.conv2, property_id: IDS.prop2, guest_session_id: "sess-guide-bbbbbbbbbbbb", status: "ai", reservation_id: null },
    ],
    property_chat_messages: [
      { id: IDS.msg1, conversation_id: IDS.conv1, role: "user", sender_type: "guest", channel: "web", is_internal_note: false, created_at: "2026-11-02T10:00:00Z" },
      { id: IDS.msgHuman, conversation_id: IDS.conv1, role: "assistant", sender_type: "human", channel: "web", is_internal_note: false, created_at: "2026-11-02T10:01:00Z" },
      { id: IDS.msgNote, conversation_id: IDS.conv1, role: "user", sender_type: "guest", channel: "web", is_internal_note: true, created_at: "2026-11-02T10:02:00Z" },
      { id: IDS.msgWa, conversation_id: IDS.convWa, role: "user", sender_type: "guest", channel: "whatsapp", is_internal_note: false, created_at: "2026-11-02T10:03:00Z" },
      { id: IDS.msgAb, conversation_id: IDS.convAb, role: "user", sender_type: "guest", channel: "airbnb", is_internal_note: false, created_at: "2026-11-02T10:04:00Z" },
      { id: IDS.msg2, conversation_id: IDS.conv2, role: "user", sender_type: "guest", channel: "web", is_internal_note: false, created_at: "2026-11-02T10:05:00Z" },
    ],
    property_reservations: [
      { id: IDS.res1, property_id: IDS.prop1, status: "confirmed", source: "channex", checkin_date: "2026-11-10", checkout_date: "2026-11-12" },
      { id: IDS.res2, property_id: IDS.prop2, status: "confirmed", source: "channex", checkin_date: "2026-11-10", checkout_date: "2026-11-12" },
    ],
    guest_arrival_status: [],
    guide_access_logs: [],
    property_listing_raw_data: [],
    property_faqs: [],
    property_checkout_items: [],
    property_emergency_contacts: [],
    property_manual_items: [],
    property_playbook_entries: [],
  };
  return new FakeDb({ ...base, ...over });
}
