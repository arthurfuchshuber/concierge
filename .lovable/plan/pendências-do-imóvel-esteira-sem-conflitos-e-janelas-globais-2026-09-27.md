# Pendências do imóvel, esteira sem conflitos e janelas globais

## 1. Faixa “Pendências do Imóvel”
- Trocar “Checklist desta limpeza” por **“Pendências do Imóvel”** na faixa recolhida e na lista aberta.
- Reduzir a altura, deixando o texto exatamente centralizado entre as bordas superior e inferior.
- Reduzir a curvatura de 14px para aproximadamente 5px, mantendo borda, fio dourado e contador.
- Continuar exibindo somente o título e a contagem no cartão; a lista completa abre ao tocar.

## 2. Corrigir definitivamente o Studio 105 e conflitos semelhantes
O banco confirma duas estadias consecutivas no Studio 105:
- Marcela: 22–26/09, com checkout feito, mas a etapa operacional ficou sem encerramento.
- Marlon: 26–28/09, com check-in feito e estadia vigente.

A esteira passará a encerrar automaticamente uma estadia antiga quando uma reserva posterior do mesmo imóvel já tiver começado ou tiver o check-in confirmado. Esse encerramento:
- retira o cartão antigo da Fila de Limpeza;
- preserva o histórico completo da estadia;
- não contabiliza nem inventa uma limpeza que não foi registrada;
- vale para o Studio 105 agora e para qualquer imóvel no futuro;
- será aplicado tanto na atualização do calendário quanto na montagem do painel, para corrigir também estados antigos já gravados.

Também será feita a correção pontual do estado antigo do Studio 105, para ele sair imediatamente da fila.

## 3. Clique fora e desfoque em todo o sistema
Centralizar a regra nas janelas compartilhadas, para que todas sigam o mesmo comportamento:
- clicar fora fecha somente a janela que está por cima e revela a anterior;
- o fundo atrás da janela aberta fica desfocado;
- diálogos, gavetas, folhas, menus, seletores, tooltips, cartões flutuantes, menus de contexto e submenus entram na mesma ordem global de camadas;
- janelas manuais que hoje usam regras próprias também passam a obedecer à pilha global;
- manter os limites de largura/altura e a regra de não cortar conteúdo nas laterais.

## Validação
- Conferir o Studio 105 sem o cartão antigo na Fila de Limpeza e com a estadia atual preservada.
- Abrir e fechar a faixa “Pendências do Imóvel”.
- Testar sequências com duas ou mais janelas: clique fora deve recuar uma camada por vez.
- Conferir desfoque, alinhamento e ausência de cortes em celular estreito e computador, nos temas claro e escuro.

## Detalhes técnicos
- Ajustar `CleaningChecklist` no painel operacional.
- Criar uma reconciliação reutilizável da esteira para encerrar estados superados sem preencher `cleaning_type` ou preço.
- Aplicar a reconciliação na sincronização do calendário e antes de retornar os cartões operacionais.
- Completar `useOverlayLayer` e `guardNestedOutside` nas primitivas ainda não cobertas e substituir listeners manuais de clique fora pela mesma regra global.
