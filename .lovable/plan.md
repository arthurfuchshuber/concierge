
# Plano: Gestão em massa, FAQ global, base de conhecimento e agrupamento por endereço

## 1. Edição em massa na visão lista

Na rota `/admin` (Painel), quando o usuário ativa a visão "lista", cada linha ganha checkbox e aparece uma barra de ações no topo: "Selecionar todos", "Limpar seleção", contador, botão **Editar selecionados**.

Ao clicar em editar selecionados, abre um modal de edição em massa com abas espelhando os campos editáveis de um guia:

- **Chegada**: `checkin_time`, `checkin_time_max`, `address_note`, `checkin_instructions`
- **Saída**: `checkout_time`, `checkout_time_min`, `checkout_instructions`
- **Acesso**: `gate_code`, `gate_instructions`, `lock_code`, `lock_instructions`
- **Wi-Fi**: `wifi_ssid`, `wifi_password`
- **Anfitrião**: `host_name`, `host_phone`
- **Marca**: `brand_name`, `brand_logo_url` (apenas plano Business)
- **Tema**: `guide_theme`

Cada campo tem um toggle "Aplicar a todos" — só os campos marcados são enviados. Campos não marcados ficam intocados nos guias selecionados. Não inclui endereço/coordenadas/galeria/manual/recomendações/FAQs (esses são específicos de cada guia).

Não inclui edição em massa de tabelas filhas (manual, FAQs, recomendações, emergências) — apenas campos diretos da tabela `properties`.

## 2. FAQ global e base de conhecimento

Nova aba no menu lateral do admin: **Biblioteca**, com duas seções:

### 2a. FAQ Global
Perguntas/respostas reutilizáveis que o anfitrião gerencia uma vez e pode aplicar em vários guias. No editor de cada guia, na seção de FAQs, aparece um botão "Importar da biblioteca" que abre um seletor multi-seleção de FAQs globais e copia para o guia (cópia, não link — assim o usuário pode editar localmente sem afetar a global).

Cada FAQ global tem o mesmo shape do FAQ por-guia (pergunta, resposta, tags de categoria).

### 2b. Base de conhecimento da IA
Texto livre / blocos de conhecimento que o anfitrião adiciona globalmente (ex: "sou anfitrião de imóveis em Foz do Iguaçu", "minha política de quebras é X", "minha empresa atende 24h via WhatsApp"). Cada bloco tem título + corpo (markdown simples).

O chat da IA (`/api/public/guide-chat`) passa a injetar esses blocos no system prompt além do contexto do guia atual, dando à IA conhecimento transversal do anfitrião.

## 3. Agrupamento automático por endereço na visão lista

Na visão lista (não na de cards), guias com o mesmo endereço normalizado são agrupados sob um cabeçalho colapsável com o endereço.

Critério de agrupamento: `lat`/`lng` quando ambos preenchidos (arredondados a ~10m), com fallback para `address` normalizado (lowercase + trim + colapso de espaços). Guias sem endereço ficam em um grupo "Sem endereço".

Cabeçalho do grupo mostra: endereço, contador de guias, ação **Editar todos do grupo** (atalho para selecionar todos do grupo e abrir o modal de edição em massa).

## Detalhes técnicos

### Banco
Migrações (tudo escopado por `owner_id`):

```sql
-- FAQ global por anfitrião
CREATE TABLE public.host_faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.host_faqs TO authenticated;
GRANT ALL ON public.host_faqs TO service_role;
ALTER TABLE public.host_faqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner all" ON public.host_faqs FOR ALL
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Base de conhecimento da IA
CREATE TABLE public.host_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.host_knowledge TO authenticated;
GRANT ALL ON public.host_knowledge TO service_role;
ALTER TABLE public.host_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner all" ON public.host_knowledge FOR ALL
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
```

### Server functions novas (em `src/lib/properties.functions.ts` e novos arquivos)
- `bulkUpdateProperties({ ids: string[], patch: Partial<PropertyFields> })` — RLS garante que só atualiza guias do `owner_id`.
- `listHostFaqs` / `saveHostFaqs` (replace-all)
- `listHostKnowledge` / `saveHostKnowledge`

### Frontend
- `src/routes/_authenticated/admin.index.tsx`: já tem toggle grid/lista — estender lista com checkboxes, barra de ações, agrupamento.
- `src/components/BulkEditDialog.tsx`: modal com abas e toggles "aplicar".
- `src/routes/_authenticated/admin.biblioteca.tsx`: nova rota com tabs "FAQ global" e "Base de conhecimento".
- `src/routes/_authenticated/admin.properties.$id.tsx`: botão "Importar da biblioteca" na seção FAQ.
- `src/routes/api/public/guide-chat.ts`: anexar `host_knowledge` enabled do owner do guia no system prompt.

### Não-objetivos
- Não substituir as FAQs por-guia (continuam existindo, a importação copia).
- Não vincular FAQs globais aos guias por foreign key — é cópia explícita.
- Edição em massa não toca galeria, manual, recomendações, emergências, FAQs ou checkout-list.
