
# Guia do hóspede: da consulta pontual → hub diário de estadia

Vamos priorizar **prender a atenção primeiro, monetizar depois**. A estrutura abaixo é faseada: cada fase entrega valor sozinha e prepara terreno para a próxima.

## Princípios que guiam tudo

- **Nada que o anfitrião não preencheu aparece** (regra já ativa no projeto — mantida).
- **Zero atrito de identidade**: o popup de telefone no primeiro acesso permanece exatamente como está.
- **A IA é o motor** (dicas, notícias, chat) — reaproveitando `LOVABLE_API_KEY` que já existe.
- **Toda seção nova é "colapsável" ou opcional**: se o anfitrião não configurar cidade/coordenadas, ela simplesmente some.

---

## Fase 1 — Home viciante (retenção)

Redesenhar `src/routes/g.$slug.index.tsx` para ter esta ordem visual (inspirado no print enviado, mas com nossa identidade):

```text
┌─────────────────────────────────────┐
│ Hero: "Bem-vindo à {Casa}"          │
│ + foto do imóvel                    │
├─────────────────────────────────────┤
│ Cards essenciais (Wi-Fi | Check-in  │
│ | Regras) — como no print           │
├─────────────────────────────────────┤
│ 🌤️  Dica do dia (IA)                │
│ "Hoje faz sol e 28°C — que tal…"    │
│ [gerada 1x/dia por hóspede]         │
├─────────────────────────────────────┤
│ 💬 Bolha do Concierge IA            │
│ "Olá! Sou a ConciergeIA…"           │
│ [campo digite sua dúvida — CTA]     │
├─────────────────────────────────────┤
│ 📰 O que rola em {Cidade} hoje      │
│ Feed de 3-5 eventos/notícias        │
│ [gerado por IA + curadoria Sigma]   │
├─────────────────────────────────────┤
│ 🍽️  Dicas locais (recs do imóvel)   │
│ Cards grandes horizontais           │
│ [primeiro com foto — estilo print]  │
├─────────────────────────────────────┤
│ Nav inferior: Início | Guia | …     │
└─────────────────────────────────────┘
```

### Novidades técnicas da Fase 1

1. **Dica do dia (IA)** — nova server fn `getDailyTip({ propertyId })`:
   - Prompt considera: cidade, clima (via API pública gratuita open-meteo), hora do dia, dia da semana.
   - Cache por `property_id + data` em nova tabela `property_daily_tips` (auto-expira em 24h).
   - Fallback: se sem cidade/coords, seção não renderiza.

2. **Feed "Rola em {Cidade}"** — nova server fn `getCityPulse({ cityKey })`:
   - Reusa `city_references` (já existente) + cron diário que a IA sintetiza em "manchetes do dia".
   - Nova tabela `city_daily_pulse` (`city_key`, `date`, `items jsonb`) — 1 registro/cidade/dia.
   - Cron já configurado (`cron.refresh-city-references`) ganha um passo extra para gerar o pulse.

3. **Chat IA em destaque na home** — mover `GuideAiChat` para uma "bolha viva" no meio da home (não só na aba dedicada), com 2-3 sugestões contextuais clicáveis ("O que fazer hoje?", "Melhor restaurante perto", "Como chegar na praia").

4. **Redesign visual** — captura da home atual + `design--create_directions` com o print de inspiração para 3 direções (paleta/tipografia/densidade). Você escolhe uma.

---

## Fase 2 — Ingressos e experiências (monetização suave)

O campo de link de ingresso **já existe em Explorar** (`property_recommendations.booking_url` e afins). Vamos ativá-lo estrategicamente:

1. **Badge "Reservar" / "Comprar ingresso"** nos cards de recomendação que tiverem `booking_url` preenchido — CTA proeminente no card, não escondido.
2. **Rastrear cliques**: novo evento `poi_engagement_events` do tipo `booking_click` (tabela já existe) — mede quais parceiros convertem.
3. **Nada de comissão agora**: só medimos volume. Quando tivermos números, negociamos afiliação com parceiros grandes (GetYourGuide, Civitatis) ou cobramos taxa dos locais.
4. **Curadoria Sigma opcional**: a curadoria por cidade (`sigma_city_recommendations`, já existe) pode ganhar campos `booking_url` gerenciados pela Sigma — quando o anfitrião importa, herda o link e a receita futura pode ser dividida.

---

## Fase 3 — Comunidade / retorno (futura, só planejar)

Já temos telefone do hóspede no popup. **Não vamos usar agora**, mas o ativo está lá para:
- Push notification pós-checkout ("Voltou pra cidade? Nova recomendação…")
- Newsletter mensal por cidade
- Convite para deixar review público → alimenta social proof do anfitrião

Vou deixar apenas registrado em memória do projeto para retomar depois.

---

## Detalhes técnicos

### Novas tabelas

```sql
-- Cache diário de dicas por imóvel (1 linha/imóvel/dia)
CREATE TABLE public.property_daily_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  date date NOT NULL,
  content jsonb NOT NULL, -- {title, body, cta?, weather?}
  created_at timestamptz DEFAULT now(),
  UNIQUE (property_id, date)
);
GRANT SELECT ON public.property_daily_tips TO anon, authenticated;
GRANT ALL ON public.property_daily_tips TO service_role;
ALTER TABLE public.property_daily_tips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read via guide" ON public.property_daily_tips FOR SELECT USING (true);

-- Pulse diário por cidade (manchetes/eventos sintetizados)
CREATE TABLE public.city_daily_pulse (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_key text NOT NULL,
  date date NOT NULL,
  items jsonb NOT NULL, -- [{title, category, url?, distance?}]
  created_at timestamptz DEFAULT now(),
  UNIQUE (city_key, date)
);
GRANT SELECT ON public.city_daily_pulse TO anon, authenticated;
GRANT ALL ON public.city_daily_pulse TO service_role;
ALTER TABLE public.city_daily_pulse ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON public.city_daily_pulse FOR SELECT USING (true);
```

### Novas server functions (em `src/lib/`)

- `daily-tip.functions.ts` → `getDailyTip({ propertyId })`
- `city-pulse.functions.ts` → `getCityPulse({ cityKey })`
- Ambas: cache-first, IA on-miss, retorna `null` se faltar contexto (a UI simplesmente esconde).

### Cron / geração em background

Estender `src/routes/api/public/cron.refresh-city-references.ts` para, no fim do job, gerar `city_daily_pulse` das cidades ativas via `openai/gpt-5.5` (bundle no gateway Lovable AI).

### Redesign

Depois deste plano aprovado, capturo screenshot da home atual em Playwright e disparo `design--create_directions` com o print que você enviou como referência de composição. Você escolhe uma das 3 direções e eu implemento.

---

## O que fica de fora deste plano (para não inchar)

- Comissão/checkout no app (só link externo, sem processar pagamento agora).
- Publicidade paga por local (só quando tivermos volume medido).
- Perfil/comunidade pública de hóspedes (Fase 3, futura).
- Qualquer mudança no popup de telefone / fluxo de acesso (mantido intacto conforme pedido).

---

## Ordem sugerida de execução após aprovação

1. Migração das 2 novas tabelas.
2. Server fns `getDailyTip` + `getCityPulse` (com fallbacks).
3. Extensão do cron.
4. Redesign da home (`design--create_directions` → você escolhe → implemento).
5. Badges de "Reservar" nos cards de recomendação.
6. Evento de tracking `booking_click`.

Cada passo é entregável sozinho. Podemos parar em qualquer ponto se algo não fizer sentido.
