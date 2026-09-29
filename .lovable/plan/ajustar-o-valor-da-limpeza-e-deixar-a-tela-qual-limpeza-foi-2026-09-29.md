# Ajustar o valor da limpeza e deixar a tela "qual limpeza foi feita?" mais limpa

## 1. Mudar o valor de uma limpeza, sem poluir a tela

Nada de campos novos soltos nos cards. O valor aparece como um pequeno item discreto que só se mostra quando é útil.

- **Antes da equipe marcar a limpeza como feita:** no card da Fila de Limpeza, o menu de três pontos ganha a opção "Ajustar valor desta limpeza". Ela abre uma janela pequena com:
  - o valor padrão do imóvel (normal ou completa), só para consulta;
  - o campo "Valor desta limpeza" em R$;
  - o campo "Motivo", que é opcional (por exemplo: "hóspede ficou 1 dia a mais", "sujeira extra").

  O valor ajustado vale só para aquela limpeza. O cadastro do imóvel não muda.
- **Depois de concluída:** o mesmo item aparece na jornada da reserva e na lista de limpezas feitas, na linha do valor, com um ícone de lápis bem discreto. Ele abre a mesma janela.
- **Marcação visual:** quando o valor foi alterado, aparece um pontinho ao lado do valor com a legenda "ajustado". Passando o mouse (ou tocando), aparece: valor original, novo valor, motivo, quem mudou e quando.
- **Custos e painéis:** os totais de custo da Limpeza e do Dashboard passam a usar o valor ajustado.
- **Limpeza completa aguardando aprovação:** o gestor pode ajustar o valor antes de aprovar. O valor aprovado é o que entra no custo.
- **Quem pode ajustar:** apenas quem tem permissão de edição na Operação. Quem só tem permissão de ver não enxerga o lápis.

## 2. Tela "Qual limpeza foi feita?" mais limpa

- A janela segue o padrão do sistema: fundo desfocado, clique fora volta à tela anterior, mesmo arredondamento e as mesmas fontes, sem cortes em celular.
- Título curto: "Qual limpeza foi feita?". Embaixo, o nome do imóvel em tom discreto.
- Duas opções empilhadas, com o mesmo tamanho:
  - **Limpeza normal**, em destaque: borda e cor principal, já pré-selecionada, com o valor à direita. É a escolha padrão.
  - **Limpeza completa**, em estilo neutro, com o valor à direita e uma linha pequena: "Entra no custo após aprovação do gestor".
- Um botão "Confirmar" ocupa a largura toda. Os textos longos de explicação saem.
- Se o imóvel só tiver um dos valores cadastrados, a tela continua sem aparecer, como hoje.

## Detalhes técnicos

- Banco: novos campos opcionais onde a limpeza já guarda `cleaning_type`/`cleaning_price_cents`: `cleaning_price_override_cents`, `cleaning_price_override_reason`, `cleaning_price_override_by` e `cleaning_price_override_at`. O valor efetivo é `coalesce(override, cleaning_price_cents)`. Com GRANT e RLS existentes.
- Servidor: um único server fn `setCleaningPriceOverride`. Ele valida a permissão `operation_edit` do titular ativo, registra em `audit_logs` e envia o e-mail de aviso existente somente se a regra exigir (não exige: não é acesso).
- Os cálculos de custo (`cleaningStatsData`, trend e forecast em `OperationWorkspace.tsx`, e também o `CleaningApprovalPanel`) passam a ler o valor efetivo.
- O prompt de tipo (em torno de `setCleaningTypePrompt`, linhas ~3850–3930) é reescrito como a janela padrão, com a Normal pré-selecionada.
- A janela de ajuste registra no `global-overlay-store` como "window".
