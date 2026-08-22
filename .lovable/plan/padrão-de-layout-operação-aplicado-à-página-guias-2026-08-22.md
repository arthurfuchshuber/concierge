# Padrão de layout "Operação" aplicado à página Guias

## 1. Ajuste já feito no Dashboard
"Detalhes operacionais" agora fica colado ao período, com o mesmo espaçamento
que existe entre o nome do hóspede e o período (sem margem extra).

## 2. Padrão de layout oficial (extraído da página Operação)

- **Cabeçalho**: título (Sora 700, 22px) + subtítulo (Manrope, 13px, muted) logo abaixo,
  espaçamento de 1.5 entre eles. Sem eyebrow, sem botões soltos ao lado.
- **Barra de menu**: segmented control ocupando 100% da largura da página,
  cantos 0.3rem, fundo `foreground/5`, cada aba `flex-1`, altura mínima 46px,
  texto 14px semibold; aba ativa com gradiente roxo→rosa e texto branco.
- **Filtros/ações**: uma linha logo abaixo do menu, alinhada à direita,
  estilo do botão "Hoje" (altura 36px, cantos 0.3rem, fundo sutil, ícone 14px).
- **Cards**: sem bordas fortes, cantos 0.3rem, informações empilhadas
  uma por linha com a mesma fonte (12px), ações em botão de menu (kebab).

## 3. Mockup da página Guias (proposta)

```text
Guias
Seus imóveis e destinos publicados.

┌───────────────┬───────────────┐
│    Imóveis    │    Destinos   │   ← segmented control, largura total,
└───────────────┴───────────────┘      aba ativa com gradiente

                    [Buscar…]  [Filtros v]  [+ Novo guia]   ← linha à direita, 36px

┌──────────────────────────────────────────┐
│ Rua Exemplo, 123 — Foz do Iguaçu   [tudo]│  ← grupo por endereço
│ ┌──────────────────────────────────────┐ │
│ │ Studio 104 Completo            [⋮][🗑]│ │
│ │ Proprietário · publicado             │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

Removido nesta etapa: todo o bloco "Plano e uso" (barra de uso, cards de
plano/uso e o aviso de pagamento falhou). A visão fica limpa; os avisos de
limite voltam depois, já no padrão novo.

## 4. Escopo técnico

- `src/routes/_authenticated/admin.guias.tsx`: remover bloco de plano/uso e o
  banner de pagamento; trocar `PageHeader` pelo cabeçalho padrão da Operação;
  trocar `TabsList` (Imóveis/Destinos) pelo segmented control largura total;
  padronizar botões de ação (36px, 0.3rem, ícone 14px).
- Sem mudanças de regra de negócio: limites de plano continuam sendo validados
  no servidor; apenas a exibição some.
- Extrair o cabeçalho + segmented control para um componente reutilizável
  (`src/components/ds/WorkspaceHeader.tsx`) para replicar nas próximas páginas.
- Registrar o padrão em memória do projeto para as próximas replicações.
