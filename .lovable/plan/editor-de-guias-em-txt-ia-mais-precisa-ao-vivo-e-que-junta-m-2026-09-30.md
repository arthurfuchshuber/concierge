# Editor de guias em TXT + IA mais precisa, ao vivo e que junta mensagens

## 1. Estrutura completa do "Editar guia" (arquivo TXT)

Gerar `estrutura-editar-guia.txt` na sua pasta de Arquivos, lendo o editor real, com:
- cada aba em ordem (A casa, O guia, Checkin, Checkout, FAQ & Contatos, Recomendações);
- dentro de cada aba: seções, campos (nome como aparece na tela), tipo (texto, foto, seletor…), se é obrigatório, dicas/ajudas, botões e janelas que abrem;
- o que cada campo aciona no guia do hóspede (e se some quando fica vazio);
- itens repetidos entre abas e campos sem uso aparente, marcados, para facilitar seu plano de enxugar.

Só leitura: nada muda no editor agora.

## 2. Fim do "Não consegui confirmar a distância"

Causa confirmada: a busca de lugares no Google traz nome, endereço e nota, mas não traz a localização do lugar nem compara com a casa. E a busca nem é centrada no endereço do imóvel, só no nome da cidade. Por isso a IA não tinha como saber a distância.

Correção:
- a busca no Google passa a ser centrada na localização do imóvel (raio de 30 km, a regra já existente) e devolve a distância de cada lugar até a casa, com uma indicação "dá para ir a pé" (até ~1,2 km) ou "melhor de carro/app";
- as recomendações cadastradas também passam a trazer distância calculada pela localização da casa quando o texto de distância estiver vazio;
- ordem para a IA: primeiro as recomendações do guia; se não houver o que foi pedido, o Google (uma só busca, mais barata);
- regra no prompt: com distância em mãos, a IA informa ("fica a 400 m, uns 5 minutos a pé"); a frase "não consegui confirmar" só é permitida quando o imóvel não tem localização cadastrada.

## 3. Resposta aparecendo enquanto é escrita

- **Assistente do painel:** já tem o caminho ao vivo; confiro que está ligado de ponta a ponta e que o texto aparece palavra por palavra desde o início.
- **Chat do hóspede:** hoje o texto só aparece depois de pronto e conferido (proteção contra informação errada). Passa a aparecer enquanto é escrito, como no Gemini/Claude, com a proteção mantida assim:
  - senhas, códigos e dados travados continuam filtrados antes de qualquer letra sair;
  - a conferência final roda no fim; se ela reprovar algo, a mensagem é substituída pela versão corrigida (raro, e sinalizado de forma discreta).

## 4. Várias mensagens seguidas = uma resposta só

Hóspede ou usuário que manda "oi", "chego às 22h", "tem estacionamento?" em mensagens separadas recebe uma resposta única cobrindo tudo:
- a IA espera um intervalo curto (~3 s) após a última mensagem antes de começar; nova mensagem nesse intervalo reinicia a espera;
- se chegar mensagem enquanto ela já está respondendo, a resposta em andamento é interrompida e refeita incluindo a nova;
- vale para o chat do hóspede, o WhatsApp e o Assistente do painel.

## 5. Revisão de dados sensíveis pela IA

Auditar e cobrir com testes, para todo guia e toda conta:
- senha do Wi-Fi, código da porta/fechadura e endereço exato só liberados dentro da janela permitida (antes do check-in conforme a regra do guia, até o fim do check-out) e só com reserva ativa conferida;
- reserva cancelada, vencida ou de outra data: nada sensível é entregue;
- chat sem nome só usa reserva que cubra o dia de hoje (regra já existente);
- nenhuma informação de outra reserva, outro hóspede, outro imóvel ou outra conta;
- dados pessoais (telefone, e-mail, documento) mascarados nas respostas e nos registros.
Relatório final com o que estava certo e o que foi corrigido.

## Parte técnica

- TXT: script lendo `admin.properties.$id.tsx`, `BulkEditDialog.tsx` e componentes em `src/components/admin/` → `/mnt/documents/estrutura-editar-guia.txt`.
- `tools.server.ts`: `search_places` com `locationBias` circular (lat/lng do imóvel, 30 km), FieldMask com `places.location`, retorno `distancia_m` + `a_pe` via haversine já existente; `list_recommendations` com `lat/lng` para calcular distância; texto do prompt em `prompts.ts`.
- Streaming hóspede: `guide-chat.ts` passa `onTextDelta` do `runAgent` direto ao SSE, com filtro de trechos travados em buffer por frase; evento `replace` quando a validação corrige; cliente do guia trata `replace`.
- Consolidação: debounce por conversa no cliente (hóspede e painel) + no webhook de WhatsApp via marcação da última mensagem; ao responder, junta todas as mensagens do usuário desde a última resposta da IA; `AbortController` cancela a geração em curso quando chega nova mensagem.
- Sensíveis: revisar `context.server.ts` (`sensitiveLocked`, fase da estadia, status da reserva), máscara em `validate.server.ts`; testes em vitest para cada cenário (antes/durante/depois, cancelada, outra conta).
