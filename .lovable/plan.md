
## Plano de execução

### 1. Remover qualquer dado de reserva
Limpar `property.ts` e telas: sem `guest.firstName`, sem datas de check-in/out específicas, sem "noites". Manter apenas **horários** padrão (15:00 / 11:00) como regra da casa. Hero passa a saudar genericamente ("Bem-vindo à Casa da Falésia") sem nome do hóspede.

### 2. Backend (Lovable Cloud)
Ativar Cloud e criar schema:

- `profiles` (id, full_name, avatar_url) — trigger on auth signup
- `user_roles` (user_id, role enum: admin | host) + `has_role()` security definer
- `properties`:
  - identidade: `id`, `owner_id`, `slug` (único), `name`, `tagline`, `hero_image_url`
  - localização: `address`, `maps_url`, `lat`, `lng`, `city`, `country`
  - regras: `checkin_time`, `checkout_time`, `lock_code`, `gate_code`, `address_note`
  - wifi: `wifi_ssid`, `wifi_password`
  - emergência: `host_name`, `host_phone`
  - acesso: `access_mode` (public | pin), `pin_code`, `pin_expires_at`
  - i18n: `default_language` (pt | en)
- `property_manual_items` (property_id, title, desc, body, order)
- `property_recommendations` (property_id, name, category, scope `nearby|city`, type `restaurant|bar|cafe|beach|attraction|market|pharmacy|park`, rating, distance_text, distance_meters, note, image_url, maps_url, place_id)
- `property_emergency_contacts` (property_id, label, number)
- `property_faqs` (property_id, q, a, order)
- `checkout_checklist_items` (property_id, label, order)

RLS: hosts veem/editam apenas suas próprias propriedades; leitura pública de `properties` quando `access_mode='public'` (apenas colunas seguras via server fn); leitura via PIN validado server-side.

### 3. Autenticação
Email/senha + Google (broker Lovable). Página `/auth`. Layout `_authenticated/` gerenciado pela integração para gating do `/admin`.

### 4. Painel admin
Rotas sob `_authenticated/admin/`:

- `/admin` — lista de propriedades do host com QR code, status e link
- `/admin/new` — wizard de criação:
  1. **Cole o link do Google Maps** (único campo obrigatório inicial) + nome do imóvel
  2. Botão "Auto-preencher" chama server fn `enrichFromMapsLink`
  3. Pré-visualização editável de tudo (endereço, lat/lng, recomendações)
  4. Acesso: público OU PIN (com data de expiração opcional)
  5. Wi-Fi, códigos, horários, manual, contatos
- `/admin/$id/edit` — mesma UI do wizard, modo edição
- `/admin/$id/qr` — QR code da URL pública

### 5. Auto-preenchimento (Google Maps connector)
Server fn `enrichFromMapsLink(mapsUrl, name)`:

1. Resolver URL curta (`maps.app.goo.gl`) seguindo redirect
2. Extrair coordenadas (`@lat,lng` ou `!3dlat!4dlng`) ou place_id
3. **Geocoding reverso** → endereço estruturado + cidade + país
4. **Places API (New) — nearbySearch** (raio 1.5km) por tipo: restaurant, bar, cafe, beach, tourist_attraction, supermarket, pharmacy, park → **escopo "nearby"**
5. **Places API (New) — searchText** filtrando pela cidade para os mesmos tipos → **escopo "city"**
6. **Deduplicar por `place_id`** — itens já marcados como `nearby` não entram em `city`
7. Calcular `distance_meters` via fórmula de Haversine; formatar `distance_text` (m / km / "X min de carro" quando >1.5km)
8. Para cada item: nome, categoria amigável, rating, foto (Places Photo via gateway), maps_url, place_id
9. Limite ~8 por categoria/escopo para não inflar

Retorno: objeto pronto para o admin revisar e salvar.

### 6. Guia público
`/g/$slug` substitui a home hardcoded. Carrega via server fn pública:

- Se `access_mode='pin'` e cookie de PIN ausente/expirado → tela "Digite o código" (server fn valida PIN + `pin_expires_at`, seta cookie httpOnly de sessão por 24h)
- Caso contrário renderiza o guia completo
- Concierge usa `recommendations`: dois grupos visuais com label claro — **"Aqui pertinho"** (scope=nearby) e **"Pela cidade"** (scope=city), tabs por categoria
- IA Chat recebe contexto do `property` via prompt dinâmico

### 7. i18n PT + EN
Provider leve baseado em contexto (`src/lib/i18n.tsx`):

- Detecta `default_language` da propriedade, com toggle PT/EN no header
- Persiste em localStorage
- Dicionário em `src/lib/locales/{pt,en}.ts` cobrindo toda a UI
- Conteúdo do guia (manual, notas) fica no idioma que o anfitrião digitou — não é traduzido automaticamente

### 8. Detalhes técnicos
- Conectar Google Maps via `standard_connectors--connect`
- `enrichFromMapsLink` no servidor, usa `LOVABLE_API_KEY` + `GOOGLE_MAPS_API_KEY` via connector gateway
- QR code: lib `qrcode` (puro JS, Worker-safe)
- PIN: cookie httpOnly + assinatura HMAC, sem dependência extra
- Mantém estética atual (Boutique Minimal, animações, glassmorphism)

### 9. Migração do mock atual
Inserir "Casa da Falésia" como seed (migration de dados) com slug `casa-da-falesia` para a demo continuar funcionando em `/g/casa-da-falesia`. A home `/` vira landing page do SaaS (CTA: "Sou anfitrião → painel" / "Sou hóspede → use o link recebido").

### Entregáveis nesta rodada
1. Cloud + schema + RLS + seed
2. Auth (email/senha + Google) + página `/auth`
3. Painel admin completo (lista + wizard com auto-preenchimento + QR + edit)
4. Guia público `/g/$slug` + gate de PIN
5. i18n PT/EN
6. Limpeza de todos os dados de reserva
7. Refator do chat IA para receber contexto dinâmico do imóvel

Confirma para eu seguir?
