# Auditoria da IA de atendimento — condução, inteligência e acesso a informação (16/11/2026)

Base: banco de produção (mensagens, gerações, imóveis) e código em `main` após os PRs #145–#158. Período: **somente desde a religação da IA com as correções (15/11, 21:00 UTC)**.

**Atenção:** os PRs #149, #150, #152, #155, #156 e #158 só valem em produção depois de publicados. Parte dos casos abaixo aconteceu antes deles.

## Resumo

| # | Gap | Área | Prioridade |
|---|-----|------|-----------|
| 1 | 4 de 14 mensagens que pediam resposta ficaram sem resposta da IA | Confiabilidade | P0 |
| 2 | Prompt no limite (74.997 de 75.000) e com regras que se contradizem | Inteligência | P0 |
| 3 | Imóveis com dados essenciais vazios | Informação | P1 |
| 4 | Regra de chegada ainda manda reforçar material, com frases de exemplo | Condução | P1 |
| 5 | Depois de um "não", nenhuma alternativa de data | Condução | P1 |
| 6 | Pedido de preço ou desconto sem orientação | Condução | P1 |
| 7 | Equipe e IA respondendo ao mesmo tempo | Condução | P1 |
| 8 | Recomendações locais concentradas em poucos imóveis | Informação | P2 |
| 9 | Preço e mínimo de noites por data quase não aproveitados | Informação | P2 |
| 10 | Uma resposta saiu sem acentos | Qualidade | P2 |

## 1. Confiabilidade: 4 de 14 mensagens ficaram sem resposta da IA (P0)

Desde a religação, foram 18 mensagens de hóspedes:

- **9 respondidas pela IA (50%).**
- **4 silêncios, todos corretos (22%):** dois "Sim" de confirmação das regras no ato da reserva, "Ok, até quinta" e "Obrigada, farei a reserva".
- **3 falhas técnicas (17%):** Matheus 19:20 e Larissa 20:03 e 20:13, todas em menos de uma hora e pelo mesmo defeito de prazo, corrigido no #155.
- **1 barrada pelo validador:** o "Certo?!" da Marcela, falso positivo do calendário, corrigido no #150.
- **1 interrompida** por uma mensagem mais nova da própria hóspede.

Das 14 mensagens que pediam resposta, a IA respondeu 9 (64%). As 4 falhas vêm de duas causas já corrigidas, que valem depois da publicação.

Ainda falta:

- **Gravar a etapa e o tempo total de cada geração.** Hoje, quando uma etapa estoura, o banco não registra qual foi nem quanto tempo levou, e a segunda tentativa não fica marcada.
- **Fechar gerações presas.** Quando o processo morre, a linha fica em `generating` até chegar a próxima mensagem. Uma rotina curta deveria marcá-las como falha.
- **Medir depois da publicação.** As auditorias diárias acompanham isso.

## 2. Prompt saturado e com contradições (P0)

O prompt da IA tem 199 parágrafos e 74.997 de 75.000 caracteres permitidos. Toda correção de hoje exigiu cortar algo em outro lugar. Hoje apareceram quatro regras empurrando a IA a dizer mais do que foi pedido:

| Regra | Efeito | Situação |
|-------|--------|----------|
| Cumprimento "com convite para ajudar" | Despejo de informação (Ilizandra) | Corrigida (.17) |
| Dia do check-in "fique à disposição" | Fecho genérico | Corrigida (.17) |
| Aviso de chegada "deixando claro que a casa está esperando" | Despejo de informação (Ricardo) | Corrigida (.20) |
| Aviso de chegada "cite e reforce o material enviado", com frases de exemplo | Repete instruções (Ricardo) | **Pendente** (item 4) |

O prompt cresceu caso a caso. Regras antigas com exemplos e obrigações convivem com princípios novos, e o modelo tenta cumprir todas ao mesmo tempo.

**Oportunidade (a maior desta auditoria):**

- Montar o prompt por fase: consulta, antes da chegada, durante a estadia, depois da saída. Cada conversa leva só as regras da sua fase, o que reduz o tamanho, as contradições e a chance de a IA aplicar uma regra fora de hora.
- Junto com isso, fazer uma revisão de consolidação: juntar duplicatas e trocar todos os exemplos de frase por descrição de comportamento.

## 3. Acesso a informação: imóveis com dados essenciais vazios (P1)

Todos os 11 imóveis com IA ligada:

| Imóvel | Playbook | FAQs | Instruções de entrada e saída | Wi-Fi | Regras da casa | Referências da cidade |
|--------|---------|------|-------------------------------|-------|----------------|----------------------|
| Apê Aconchegante | 4 | 3 | **não** | **não** | **não** | não |
| Casa Charmosa | 2 | 8 | sim | sim | sim | não |
| Casa Completa (Bairro Residencial) | 3 | 4 | sim | sim | sim | não |
| Casa Completa (Av. Turística) | 4 | 0 | sim | sim | sim | não |
| Studios 101–105 | 0 | 4 | sim | sim | sim | sim |
| Studio 3 | 0 | 0 | **não** | **não** | **não** | não |
| Studio 4 | 0 | 0 | **não** | **não** | **não** | não |

- **Nenhum imóvel tem manual cadastrado**, e 7 dos 11 têm o playbook vazio. Quase tudo o que a IA sabe vem do texto do anúncio.
- **Apê, Studio 3 e Studio 4:** durante a estadia, a IA não tem como orientar entrada, saída, Wi-Fi ou regras. Ela vai encaminhar tudo à equipe ou responder de forma vaga.
- **Ação, que é de cadastro e não de código:** preencher instruções, Wi-Fi e regras desses três; depois, manuais (aparelhos, disjuntor, registro) e playbook dos demais.

## 4. Regra de chegada que ainda manda reforçar material (P1)

A sub-regra "cite e reforce com naturalidade o material enviado" traz exemplos de frase entre parênteses e contradiz a regra nova de chegada (.20). A IA deve referir-se ao material já enviado só quando for orientar o acesso, e sem frase de exemplo. **Proposta pronta para implementar.**

## 5. Depois de um "não", nenhuma alternativa (P1)

- **Caso José Guilherme:** a IA disse corretamente que 17 a 19 não estava disponível, mas não mencionou que a noite de 18 estava livre. A equipe precisou conduzir.
- **Já resolvido:** com o #150 e o #152, a IA consulta os outros imóveis do anfitrião, com link e ficha.
- **Ainda falta:** quando o período pedido não cabe, a IA deveria apontar as noites livres mais próximas no próprio imóvel, como descrição de comportamento. Os dados já estão no fato de calendário.

## 6. Pedido de preço ou desconto sem orientação (P1)

- **Caso Matheus:** "Qual valor consegues de 30/11 a 05/12?" A geração falhou por tempo, mas mesmo sem a falha o prompt não diz o que fazer com negociação numa consulta.
- **O que a IA sabe hoje:** que o valor recebido é o repasse ao anfitrião e não pode ser citado.
- **Comportamento proposto:** acolher; dizer que a plataforma mostra o total exato; encaminhar o pedido de condição especial à equipe de imediato, sem prometer desconto. A oferta especial é uma ação do anfitrião no Airbnb.

## 7. Equipe e IA respondendo ao mesmo tempo (P1)

- **O que se viu:** desde a ativação, foram 17 mensagens da equipe e 6 da IA. Em vários casos a equipe respondeu em 1 a 2 minutos (José, Larissa, Marcela) e a IA pausou ou teve a resposta descartada.
- **Por que acontece:** a pausa de 10 minutos a cada fala humana faz com que, em conversas em que a equipe está ativa, a IA quase nunca fale.
- **Decisão de operação:** é preciso definir quem atende o quê. Por exemplo, a equipe só entra nas conversas encaminhadas; ou, em consultas, a equipe deixa a IA responder primeiro.

## 8. Recomendações locais concentradas (P2)

- **Onde existem:** só o Apê tem recomendações do guia (96), e só os Studios 101–105 têm referências da cidade.
- **Nos demais:** a IA depende da ferramenta de lugares. Isso exige uma segunda chamada ao modelo, que pesa no prazo de 26 s (item 1).
- **Ação:** vincular os demais imóveis ao grupo de referências da cidade (Foz do Iguaçu).

## 9. Preço e mínimo de noites por data quase não aproveitados (P2)

- **Preço:** `channex_ari_calendar` tem preço por noite para 5 dos 11 imóveis (Apê, Casas Completas, Studios 3 e 4). Não tem para os Studios 101–105 nem para a Casa Charmosa. Esse preço é o da tarifa, não o total pago pelo hóspede, então o uso seria só para orientar ("a partir de"), com cautela.
- **Mínimo de noites:** a coluna de mínimo por data está vazia. A IA usa o mínimo do cadastro do anúncio (2 noites nos studios).
- **A verificar:** a Larissa abriu no Airbnb uma consulta de **1 noite** no Studio 103 (18 a 19), o que sugere que o mínimo real naquela data pode ser diferente do que a IA usa. É preciso conferir na tela do Airbnb.

## 10. Uma resposta saiu sem acentos (P2)

- **O caso:** das 9 respostas desde a religação, só a do Ricardo ("voces", "instrucoes") saiu sem acentos.
- **Proposta:** uma checagem barata. Se uma resposta longa em português não tem nenhum acento, a IA tenta de novo.

## Casos lidos (desde a ativação)

| Hóspede | Mensagem | Desfecho | Avaliação |
|---------|----------|----------|-----------|
| Rosângela | Camas separáveis ou colchão reserva? | IA respondeu | Afirmou ausência sem fonte; corrigido (.17) |
| José Guilherme | Disponibilidade 17/18/19 | IA respondeu via varredura pós-pausa | Correto, mas sem alternativa (item 5) |
| Ilizandra | Só cumprimento | IA respondeu | Despejo de informação; corrigido (.17) |
| Marcela | Antecipar uma noite | IA disse "não temos" | Não olhou o portfólio; corrigido (#150/#152) |
| Marcela | "Certo?!" | Barrada pelo validador de calendário | Falso positivo; corrigido (#150) |
| Marcela | Qual studio em cada dia | IA respondeu | Boa |
| Marcela (Studio 101) | Confirmação de regras | Descartada pela confirmação automática | Aceitável |
| Matheus | Valor de 30/11 a 05/12 | Estouro de prazo | Corrigido (#155); falta orientação (item 6) |
| Larissa | Consulta 18 a 19, quer ficar mais | Estouro de prazo (2 vezes) | Corrigido (#155) |
| Ricardo | Previsão de chegada | IA respondeu | Despejo e sem acentos; corrigido (.20), pendentes os itens 4 e 10 |
| Veronica, Alex | "Sim" na hora da reserva | Silêncio | Correto |
| Ilizandra | "Ok, até quinta" | Silêncio | Correto |

## O que pode ser feito em código, e o que é cadastro ou decisão

**Código**, implementável na sequência:

1. Gravar a etapa e o tempo de cada geração, e fechar gerações presas.
2. Reescrever a sub-regra de reforço do material (item 4).
3. Noites livres próximas no próprio imóvel (item 5).
4. Pedido de desconto em consulta (item 6).
5. Checagem de acentos (item 10).
6. Montar o prompt por fase e consolidá-lo (item 2), que é o maior ganho e um trabalho maior.

**Cadastro**, feito pela equipe ou pelo anfitrião:

- Instruções, Wi-Fi e regras do Apê, do Studio 3 e do Studio 4.
- Manuais e playbook dos demais imóveis.
- Vínculo com as referências da cidade.

**Decisão sua:**

- Divisão de atendimento entre equipe e IA (item 7).
- Conferir o mínimo de noites real no Airbnb (item 9).
