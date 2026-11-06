/**
 * PROJEÇÕES EXPLÍCITAS de `properties` e demais tabelas.
 *
 * Regra de ouro: NUNCA `select("*")` em tabela com credenciais, e NUNCA carregar
 * uma senha para depois removê-la do objeto. Cada finalidade tem a sua lista de
 * colunas; as senhas só existem em `PROPERTY_CREDENTIAL_COLUMNS`, usada
 * exclusivamente por `fetchSensitiveCredentials` (que exige um `CredentialGrant`).
 * `data-boundary.test.ts` prova: nenhuma outra lista contém coluna sensível e
 * todas as colunas existem no banco real.
 */

/** Colunas de `properties` que carregam segredo ou texto que pode embuti-lo. NUNCA em projeção comum. */
export const SENSITIVE_PROPERTY_COLUMNS = [
  "lock_code",
  "gate_code",
  "wifi_password",
  "pin_code",
  "access_codes_pin",
  "lock_instructions",
  "gate_instructions",
] as const;

/** 1) Identificação do escopo (validação do turno). Sem nenhum dado do imóvel além do necessário. */
export const PROPERTY_SCOPE_COLUMNS = ["id", "owner_id", "name", "city", "country", "checkin_time", "checkout_time"] as const;

/** 2) Informações PÚBLICAS do imóvel (audiência P). */
export const PROPERTY_PUBLIC_COLUMNS = ["id", "name", "short_description", "city", "state", "country"] as const;

/** 3) Operacionais (audiência G): só com reserva ativa. */
export const PROPERTY_OPERATIONAL_COLUMNS = ["address"] as const;

/**
 * Colunas que alimentam o construtor do Dossiê (`buildPlaybook`) SEM credenciais.
 * As linhas de senha/instruções de acesso do Dossiê ficam vazias de propósito.
 */
export const PROPERTY_DOSSIER_COLUMNS = [
  "id",
  "name",
  "short_description",
  "airbnb_description_full",
  "address",
  "city",
  "state",
  "country",
  "maps_url",
  "garage_maps_url",
  "address_note",
  "lock_label",
  "in_condominium",
  "apartment_number",
  "apartment_floor",
  "vehicles_max",
  "access_mode",
  "gate_label",
  "checkin_instructions",
  "checkin_note",
  "checkout_instructions",
  "checkout_note",
  "wifi_ssid",
  "house_rules",
  "host_phone",
  "airbnb_rating",
  "airbnb_guest_count",
  "airbnb_bedroom_count",
  "airbnb_bed_count",
  "airbnb_bathroom_count",
  "airbnb_rooms_beds",
  "airbnb_amenities",
  "airbnb_house_rules",
  "airbnb_cancellation_policy",
  "airbnb_safety_info",
  "airbnb_listing_url",
  "airbnb_cancellation_category",
  "checkin_time",
  "checkin_time_max",
  "checkout_time",
  "parking_spots",
  "has_elevator",
] as const;

/** 4) CREDENCIAIS — só `fetchSensitiveCredentials`, só com `CredentialGrant`. */
export const PROPERTY_CREDENTIAL_COLUMNS = [
  "lock_code",
  "gate_code",
  "pin_code",
  "wifi_password",
  "access_mode",
  "lock_instructions",
  "gate_instructions",
] as const;

export const CONVERSATION_COLUMNS = ["id", "property_id", "guest_session_id", "status", "reservation_id"] as const;
/**
 * B2.4 — estado do atendimento humano da conversa (só leitura; preparado para integração, sem
 * loader instalado). `handoff_reason` é texto da equipe: passa pelo FreeTextGuard antes do prompt.
 */
export const CONVERSATION_OWNERSHIP_COLUMNS = ["id", "status", "assigned_to", "handoff_reason", "handoff_urgency", "handoff_at", "resolved_at", "ai_paused", "paused_until"] as const;
export const MESSAGE_COLUMNS = ["id", "conversation_id", "role", "sender_type", "channel", "is_internal_note", "created_at"] as const;
/** Sem `guest_contacts` (telefone/PII) nem valores financeiros. */
export const RESERVATION_COLUMNS = ["id", "property_id", "status", "source", "checkin_date", "checkout_date"] as const;
export const ARRIVAL_STATUS_COLUMNS = [
  "kind",
  "status",
  "done_at",
  "concluded_at",
  "arrival_time_override",
  "arrival_date_override",
  "arrival_time_source",
  "reservation_id",
  "log_id",
  "credentials_released_at",
  "credentials_released_by",
  "late_checkout_time",
  "late_checkout_approved_at",
  "late_checkout_by",
] as const;
export const ACCESS_LOG_COLUMNS = ["id", "property_id", "checkin_date"] as const;
export const LISTING_COLUMNS = ["property_id", "normalized", "synced_at"] as const;
export const FAQ_COLUMNS = ["id", "question", "answer"] as const;
export const CHECKOUT_ITEM_COLUMNS = ["id", "label"] as const;
export const EMERGENCY_COLUMNS = ["id", "label", "number"] as const;
export const MANUAL_COLUMNS = ["id", "title", "body"] as const;
export const ENTRY_COLUMNS = ["id", "field_key", "value", "note", "custom_label", "custom_audience", "section_num"] as const;

// ─────────────── B2.2 — Dossiê multipropriedade ───────────────

/** Identidade e posse do imóvel (autorização por imóvel: dono = tenant, não arquivado). */
export const PROPERTY_ACCESS_COLUMNS = ["id", "owner_id", "archived_at"] as const;
/** Manuais COM descrição e referências de imagem (faltavam na projeção F1, que segue intacta). */
export const MANUAL_DOSSIER_COLUMNS = ["id", "title", "description", "body", "images"] as const;
/**
 * Recomendações do entorno. FORA de propósito: `walk_minutes`, `drive_minutes` e `distance_text`
 * (minutos derivados de velocidade presumida — decisão D5) e `image_url`/`maps_url`/`last_synced_at`.
 * `distance_meters` = linha reta.
 */
export const RECOMMENDATION_PUBLIC_COLUMNS = [
  "id",
  "property_id",
  "name",
  "category",
  "type",
  "rating",
  "user_ratings_total",
  "distance_meters",
  "opening_hours",
  "note",
  "position",
] as const;

/** Junta as colunas na forma aceita por `.select()`. Recusa "*" e lista vazia. */
export function cols(list: readonly string[]): string {
  if (list.length === 0 || list.includes("*")) throw new Error("projeção inválida");
  return list.join(", ");
}

/** Chaves do Dossiê que NUNCA entram no conhecimento comum (podem conter ou apontar para segredo). */
export const CREDENTIAL_ROW_KEYS: ReadonlySet<string> = new Set([
  "codigo_do_portao",
  "codigo_da_porta",
  "senha_do_wi_fi",
  "instrucoes_do_portao",
  "instrucoes_da_porta",
  "senhas_temporarias_por_reserva",
  "fechadura_eletronica",
  "bateria_da_fechadura",
]);

// ─────────────── B3.2 — loaders reais (somente leitura) ───────────────

/**
 * Metadados de um webhook bruto de mensagem do Airbnb (`channex_raw_records`, `webhook:message`).
 * Só caminhos JSON escalares: NUNCA o `payload` inteiro (que contém o texto da mensagem).
 */
export const RAW_MESSAGE_META_SELECT =
  "id, first_seen_at, channex_property_id, sender:payload->payload->>sender, inserted_at:payload->payload->>inserted_at, message_id:payload->payload->>id, ota_message_id:payload->payload->>ota_message_id";
/** Cartão de estadia para o R6 com `id` (liga o histórico) e imóvel; sem credenciais. */
export const STAY_AUTH_CARD_COLUMNS = ["id", "property_id", ...ARRIVAL_STATUS_COLUMNS] as const;
/** Histórico do R6 em `audit_logs`: só ação, entidade e instante (sem metadata, ip, e-mail). */
export const STAY_AUTH_AUDIT_COLUMNS = ["id", "action", "entity_id", "created_at"] as const;
/** Imóvel para fuso com origem declarada e horário oficial (sem nada sensível). */
export const PROPERTY_TIMEZONE_COLUMNS = ["id", "owner_id", "country", "state", "checkout_time"] as const;
/** Identidade de envio (B2.5): anúncios, gêmeos, contas — só as colunas do contrato. */
export const SENDER_LISTING_COLUMNS = ["property_id", "owner_id", "airbnb_listing_id", "channex_channel_id", "channex_property_id"] as const;
export const SENDER_TWIN_COLUMNS = ["owner_id", "property_id", "primary_listing_id", "twin_listing_id", "twin_channex_property_id", "status"] as const;
export const SENDER_ACCOUNT_COLUMNS = ["owner_id", "channex_channel_id", "status"] as const;
/** Preferência do anfitrião (`airbnb_sender_pref`): só os campos usados, por caminho JSON. */
export const SENDER_PREF_SELECT = "channex_id, owner_id:payload->>owner_id, channel_id:payload->>channel_id, updated_at:payload->>updated_at";
