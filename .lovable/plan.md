## Escopo
Refinar o guia público (`/g/:slug`) sem mexer em lógica de assinatura, plano ou autenticação. Mudanças concentradas em `src/routes/g.$slug.index.tsx` e no editor admin `src/routes/_authenticated/admin.properties.$id.tsx`, com uma migração para novos campos de check-in detalhado.

## 1. Textos e rótulos (mudanças simples)
- Remover o "eyebrow" (— ESTADIA / A CASA / SUPORTE / CONEXÃO / COMBINADOS) acima de todos os títulos de seção. Simplifica `SectionTitle` para mostrar só título + intro.
- Em Chegada & Saída → Horário: trocar rótulos do tile "Check-in" / "Check-out" para "Início" / "Fim" (mantendo os horários e textos auxiliares já existentes).
- Renomear o sub-item "Chegada" → "Chegada & Localização".
- Renomear a seção "Dúvidas Frequentes" → "Dúvidas" (título e nome do cartão no home).
- Mostrar a seção Anfitrião sempre que o admin tiver preenchido nome/telefone (sem placeholders, conforme memória).

## 2. Check-in detalhado com fotos e vídeos (feature nova)
Hoje só existe `address_note` (texto). Adicionar:

- Migração SQL:
  ```sql
  ALTER TABLE public.properties
    ADD COLUMN checkin_instructions text,
    ADD COLUMN checkin_media jsonb NOT NULL DEFAULT '[]'::jsonb;
  ```
- Storage: reutilizar o bucket público de mídia já em uso pelas fotos da propriedade (mesma política RLS já existente).
- Admin (editor): dentro de "Chegada & Localização" um bloco novo "Instruções de check-in" com:
  - `Textarea` (max 3000 chars) — passo a passo livre.
  - Uploader múltiplo (até 8 itens) aceitando imagens e vídeos `image/*,video/*`, com lista reordenável e botão remover.
  - Cada item salvo como `{ url, type: "image"|"video" }` em `checkin_media`.
- Guia público: dentro do sub-item "Chegada & Localização", renderizar abaixo do `address_note` um bloco "Instruções de check-in" com:
  - Texto (se houver) com `whitespace-pre-line`.
  - Galeria responsiva (mídia em cards arredondados; vídeos com `<video controls playsInline preload="metadata">`).
- Manter a regra de memória: se texto e mídia vazios, nada aparece.

## 3. A Residência — visual mais atrativo (sair do estilo FAQ)
Atualmente é um `Accordion` linha-a-linha. Trocar por grid de cards:

- Layout: `grid grid-cols-1 sm:grid-cols-2 gap-3` de cards clicáveis (`button`) que abrem um `Dialog` com o conteúdo completo do item.
- Cada card: ícone temático (mapeado por palavra-chave do título — Wi-Fi, ar, TV, cozinha, piscina, manual…), título, 1 linha de descrição truncada, chevron sutil.
- Cabeçalho da seção ganha um intro mais leve.
- Mantém ordenação atual; nenhum dado novo.

## 4. Dúvidas — reordenação e refino
Nova ordem dentro do TabsContent `faq`:

```text
1. FAQ (Accordion refinado)
2. Emergências
3. Contato do anfitrião (último)
```

- FAQ: cards com cantos `rounded-2xl`, sombra suave, número discreto à esquerda ("01", "02"…), pergunta serif, resposta em coluna estreita; transição mais suave no abrir/fechar.
- Emergências: mantém grid de tels mas com ícone categórico (`Phone` colorido por tipo) e tipografia revisada.
- Card do Anfitrião redesenhado: bloco maior com avatar (iniciais se sem foto), nome em serif, telefone como botão pill `Ligar`, opcional `WhatsApp` se o número permitir. Ocupa largura total, visual premium (gradiente sutil do accent).

## 5. Detalhes técnicos
- Arquivos editados:
  - `src/routes/g.$slug.index.tsx` — textos, ordem do FAQ, novos blocos.
  - `src/routes/_authenticated/admin.properties.$id.tsx` — novos campos de check-in.
  - `src/lib/properties.functions.ts` + tipos — passar `checkin_instructions` e `checkin_media` no upsert/get.
  - `src/integrations/supabase/types.ts` — regenerar manualmente as colunas novas.
  - Nova migração em `supabase/migrations/`.
- Reuso: uploader já existente para fotos da propriedade serve de base; clonar com suporte a vídeo.
- Sem mudança em planos, RLS, autenticação, rotas ou roteamento.

## Fora de escopo
- Não vou alterar layout do home (cards de categoria), nem o WifiStrip, nem a aba Regras.
- Sem ajustes em assinatura/checkout/admin dashboard.
