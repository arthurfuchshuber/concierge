# Ajustes: Resolver pendência, Previsão, obrigatórios, Registros e linha do tempo

## 1. "Resolver pendência" mais clara e enxuta (print 1)
- Frase curta no topo explicando o que está sendo feito: "Registre se houve gasto, quem deve arcar e quem já pagou."
- "Responsável pela despesa" e "Quem pagou?" viram listas de escolha (uma linha cada) em vez de 4 botões cada.
- "Valor da resolução" e "Valor pago" ficam lado a lado numa linha só.
- Se quem pagou for diferente do responsável, aparece uma linha de resumo: "Proprietário deve reembolsar R$ X à empresa". Se forem iguais, "Valor pago" já vem preenchido com o valor da resolução.
- Sem "Houve custo", só aparece a observação.

## 2. Aviso ao mudar previsão feita pelo hóspede (print 2)
- Quando a data ou o horário de Chegada/Saída foi preenchido pelo próprio hóspede no guia, tocar em Data ou Horário abre antes uma confirmação: "Esta previsão foi informada pelo hóspede. Deseja alterar mesmo assim?" com "Cancelar" e "Alterar".
- Um pequeno selo "informado pelo hóspede" aparece ao lado do valor.

## 3. Campos obrigatórios com "(obrigatório)" em vermelho
- Todo rótulo de campo obrigatório ganha "(obrigatório)" em letra pequena vermelha à direita do título. Começa pelo título do registro de limpeza e vale para os demais formulários com campos obrigatórios (resolver pendência, novo registro, editar registro, cadastros).

## 4. Registros: no máximo 5 imóveis por quadrante
- "Precisam de atenção" e "Em dia" mostram até 5 cartões cada; o restante fica acessível rolando dentro do próprio quadrante (rolagem sutil lilás), sem nada cortado na borda.

## 5. Pendências dentro do cartão sempre recolhidas
- A lista de pendências no cartão do imóvel aparece sempre como uma barra fechada ("3 pendências"), sem setas.
- Tocar na barra abre uma janela flutuante acima dela com as pendências; o cartão não cresce para baixo. Tocar fora fecha só essa janela.

## 6. Correção do cartão de registro na linha do tempo (print 3)
- Miniaturas menores (como combinado antes), deixando espaço para o texto.
- Título em destaque; embaixo, autor e origem em uma linha que quebra naturalmente, sem ponto "·" solto no fim da linha; contagem de mídias na linha seguinte.
- Nada cortado em 360–393px, tema claro e escuro.

## Conferência
- Prints em 393px de cada tela alterada antes de concluir.

## Detalhes técnicos
- Resolver pendência: componente em `pendencias.tsx`/`RecordSituationSheet.tsx`; usar `Select` shadcn (já com `ds-overlay`).
- Origem da previsão: verificar em `guest_arrival_status` se há marca de quem preencheu (hóspede via `submitPredictedTime`); se não houver, adicionar coluna `source` ('guest'|'staff') gravada nos dois caminhos. `AlertDialog` antes de abrir os popovers em `SideBlock` (`OperationWorkspace.tsx`).
- Criar peça `RequiredMark` em `src/components/ds/` e aplicar nos rótulos obrigatórios.
- `RecordsWorkspace.tsx`: lista de cada quadrante com `max-h` calculado para 5 cartões + `overflow-y-auto`.
- Pendências no cartão: trocar expansão inline por `Popover side="top"`.
- Linha do tempo: `RecordBlock` em `ReservationRecords.tsx` — miniaturas ~56px, separadores dentro de spans `whitespace-nowrap` com a palavra anterior.
