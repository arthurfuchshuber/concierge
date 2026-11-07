# Gate G2: ações operacionais autônomas da IA (plano arquitetural)

- **Branch:** `guest-ai/g2-ops-actions`, criada a partir da `main` em `d26cc61f`, que já inclui G1 e o registro da G1b.
- **Status:** plano para homologação. Ainda não há código, migration ou flag.

Escopo pedido pelo titular, aplicado aos cards de `guest_arrival_status`:

- **(a)** previsão de horário de chegada ou saída informada pelo hóspede;
- **(b)** conclusão do check-in;
- **(c)** conclusão do check-out;
- **(d)** travas: zero falso positivo, respeito a chamados e negociações, execução no servidor com auditoria.

---

## 1. O que já existe e será reaproveitado (nada novo onde já há regra)

| Necessidade                                                                                                                                                                                                                 | Já existe                                                                                                                                              | Onde                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Concluir check-in ou check-out com todas as regras do painel: no-show, estadia anterior aberta no imóvel, fechar a estadia no checkout, limpeza vencida, aviso de limpeza                                                   | `runAdvanceArrival(client, dados, { origin })`, já usado pelo painel (`staff`), pelo guia do hóspede (`guest`) e pelo cron de auto-checkout (`system`) | `src/lib/dashboard.functions.ts`                         |
| Hóspede confirmando "já entrei" ou "já saí", com trava de data e foto de antes para o "Desfazer"                                                                                                                            | `markGuideStayStep`                                                                                                                                    | `src/lib/guide-access.functions.ts`                      |
| Previsão informada pelo hóspede (`arrival_time_source = 'guest'`), dentro dos limites do imóvel (`checkin_time`…`checkin_time_max`, `checkout_time_min`…`checkout_time`), sem sobrescrever a previsão da equipe (`'staff'`) | gravação do formulário do guia                                                                                                                         | `src/lib/guide-access.functions.ts` (`withinTimeBounds`) |
| Fuso do imóvel e relógio local, com o lado conservador no horário de verão                                                                                                                                                  | `propertyTimeZoneOrNull`, `policy/wall-clock.ts`                                                                                                       | Guest AI                                                 |
| Escopo validado no backend (conversa, imóvel, conta, reserva)                                                                                                                                                               | `validateTurnScope`                                                                                                                                    | Guest AI (F0)                                            |
| Uma chamada ao modelo por mensagem, com teto diário obrigatório (G1)                                                                                                                                                        | cadeia do Copiloto (`runTurnChain` + `copilot_claim_generation`)                                                                                       | Guest AI                                                 |
| Previsão não autoriza nada (credenciais, early check-in ou late checkout)                                                                                                                                                   | `policy/credential-policy.ts` e `stay-authorizations.ts` já ignoram `arrival_time_source`                                                              | Guest AI                                                 |

A ação da IA é **o mesmo avanço** que a equipe e o hóspede já fazem, com uma nova origem (`origin: "ai"`). Não há caminho paralelo de escrita nos cards.

## 2. Arquitetura proposta

```
mensagem do hóspede → canal → Copiloto (mesma chamada ao modelo, já existente)
   └─ saída do modelo: sugestão (como hoje) + bloco `operational` (novo, opcional)
        └─ ops/policy (puro, determinístico) ── recusa ⇒ nada acontece (registro em auditoria)
             └─ ops/executor.server (service_role)
                  ├─ guest_ai_ops_claim (idempotente por mensagem + ação)  ← auditoria
                  ├─ modo shadow: só registra o que faria
                  └─ modo on: runAdvanceArrival(admin, …, origin "ai")  |  previsão (núcleo do guia)
                       └─ guest_ai_ops_finish (antes e depois, para o "Desfazer")
   └─ sugestão de resposta ao hóspede (acolhimento ou agradecimento) → equipe aprova e envia
```

### 2.1 Extração (modelo)

Contrato de decisão **v5**, aditivo: v1 a v4 continuam válidos e o parse continua estrito. Ganha um bloco opcional `operational` com no máximo um sinal de cada tipo:

| Tipo            | Campos                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `eta`           | `card` (`checkin` ou `checkout`), `time` (`HH:MM`, 24 h), `day` (`today`, `tomorrow` ou data ISO), `evidence` |
| `checkin_done`  | `evidence`                                                                                                    |
| `checkout_done` | `evidence`                                                                                                    |

- `evidence` é o **trecho literal** da mensagem do hóspede que sustenta o sinal (até 200 caracteres).
- O prompt instrui o modelo a **não emitir** sinal para:
  - plano ou futuro ("vamos sair às 8h" é `eta`, não `checkout_done`);
  - pergunta ("já posso entrar?");
  - negação ("ainda não entramos");
  - problema ("não conseguimos entrar", "a chave não funciona");
  - relato de terceiros, ou dúvida.
- **Uma única chamada ao modelo:** o sinal vem na mesma resposta que já gera a sugestão do Copiloto, então não há custo novo por mensagem. Se a sugestão for recusada (por exemplo, pelo filtro de segredos), o sinal também é descartado (fail-closed).

### 2.2 Trava determinística (`src/lib/guest-ai/ops/policy.ts`, pura e testável)

Todo sinal passa por todas as verificações. **Qualquer uma** que falhar significa nenhuma ação.

1. **Evidência:** `evidence` precisa existir literalmente, depois de normalizar caixa e acentos, numa mensagem **do hóspede** deste turno. Texto da equipe, da IA ou de outro turno não conta.
2. **Antifalso-positivo léxico (segunda barreira, independente do modelo):** a mensagem não pode conter, perto da evidência, negação, futuro, pergunta ou problema (`não`, `ainda`, `vamos`, `vou`, `?`, `problema`, `não consigo`, `travou`…), em PT, EN e ES. Na dúvida, não age.
3. **Reserva:** a conversa precisa estar vinculada pelo código (`reservation_id`) a uma reserva confirmada, sem no-show, do mesmo imóvel. Sem vínculo, não age (e não procura por data ou nome).
4. **Data no fuso do imóvel:**
   - `checkin_done` só no dia da entrada (ou depois, com a estadia em curso);
   - `checkout_done` só no dia da saída, com a mesma folga de um dia do `markGuideStayStep`;
   - `eta` só para a data do próprio card.
   - Sem fuso comprovado, não age.
5. **Estado do card:** o card precisa estar `pending`. Card já feito, silenciado (`muted_until`) ou da equipe, em edição, não recebe ação. Para `eta`, uma previsão com origem `'staff'` **nunca** é sobrescrita.
6. **Chamados e negociações (pedido d):** não age se a conversa estiver em qualquer uma destas situações:
   - `needs_human` com motivo diferente do padrão "sem IA", ou com urgência;
   - com responsável humano (`assigned_to`);
   - com a equipe no comando (`ai_paused` vigente);
   - turno com intenção `problem_report`, `emergency` ou `formal_change_request`;
   - pedido de early check-in ou late checkout pendente, sem resposta formal registrada.
7. **Limites do imóvel para `eta`:** os mesmos do formulário do guia (`withinTimeBounds`). Fora deles, não grava. A previsão não libera senha nem substitui early check-in ou late checkout formal; isso já é garantido pelas políticas atuais.

### 2.3 Execução (`src/lib/guest-ai/ops/executor.server.ts`, servidor, `service_role`)

**Chave nova:** `GUEST_AI_OPS_MODE`, com três valores:

| Valor                                                  | Efeito                                                  |
| ------------------------------------------------------ | ------------------------------------------------------- |
| `off` (padrão; ausente ou inválido também valem `off`) | nada acontece                                           |
| `shadow`                                               | registra em auditoria o que faria, sem escrever no card |
| `on`                                                   | executa                                                 |

Há também um filtro opcional por imóvel, `GUEST_AI_OPS_PROPERTY_IDS`, para piloto.

**Tabela nova `guest_ai_ops_actions`:**

- RLS ligada, só `SELECT` pelos membros do imóvel, escrita só por RPC `service_role`.
- Colunas: tenant, imóvel, conversa, mensagem que disparou, reserva, `action` (`eta_checkin`, `eta_checkout`, `checkin_done`, `checkout_done`), modo, desfecho (`applied`, `shadow`, `refused:<código>`, `failed:<código>`), valores antes e depois do card, `applied_at`, `reverted_at` e `reverted_by`.
- **Não guarda texto do hóspede:** só o id da mensagem e a posição do trecho de evidência.

**RPCs:**

- `guest_ai_ops_claim`: idempotente por (`trigger_message_id`, `action`). Repetir o webhook ou fazer duas drenagens ao mesmo tempo resulta numa única ação.
- `guest_ai_ops_finish`: registra o desfecho.

Ambas só para `service_role`, `SECURITY DEFINER` e com `search_path` fixo, no padrão do G1.

**Aplicação:**

- `checkin_done` e `checkout_done`: `runAdvanceArrival(supabaseAdmin, { logId?, reservationId, from }, { origin: "ai", skipStaffPush: false })`. A nota no histórico fica "Confirmado pela IA a partir da mensagem do hóspede". Todas as travas do painel valem: se o painel recusaria, a IA também recusa e registra o motivo.
- `eta`: o mesmo núcleo do formulário do guia, extraído para uma função compartilhada sem mudar o comportamento atual.
- **Foto de antes**, para o "Desfazer" pela equipe. O mesmo racional do `markGuideStayStep`.
- O disparo usa `runInBackground` (G1), então nunca fica promessa solta.

### 2.4 Resposta ao hóspede (b, c): ponto que depende do titular

Hoje a IA **não envia** mensagens: `slot.server.ts` devolve `null` e o envio é sempre humano, pelo Copiloto. Uma resposta automática ao hóspede seria a primeira mensagem autônoma da IA, que a sequência de gates aprovada deixava para depois da homologação do Copiloto (G4 e G5).

**Proposta:** no G2, a resposta de acolhimento (check-in) ou de agradecimento (check-out) vem como **sugestão do Copiloto**, escrita pelo modelo a partir do contexto e sem frase roteirizada. A equipe aprova e envia com um clique. O card já fica atualizado automaticamente. Ver decisão D-G2-1.

### 2.5 Interação com o auto-checkout (risco encontrado)

O cron `auto-checkout-scan` (a cada 5 min) confirma o checkout **no horário previsto do card, seja qual for a origem** (`arrival_time_override`). Isso já vale hoje para a previsão do formulário do guia.

**Consequência:** se a IA gravar "saímos às 08h", o card de checkout será confirmado às 08h e a limpeza será liberada, mesmo que o hóspede atrase. Ver decisão D-G2-2.

### 2.6 Interface

Nenhuma mudança de layout neste gate. O histórico da reserva já mostra a nota de origem. Um selo "IA" no card e o "Desfazer" pela equipe exigem mockup antes, conforme a regra do projeto, e ficam numa etapa à parte, se o titular quiser.

## 3. Entrega por etapas

| Etapa                    | O que faz                                                                                                                                      | Entrada                                                           | Saída e evidência                                                                     | Rollback                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------- |
| **G2a: código + shadow** | Contrato v5, política, executor, tabela e RPCs (migration aditiva, aplicada pelo titular), modo `shadow`                                       | Plano homologado                                                  | Testes verdes; PR homologado; migration conferida                                     | `GUEST_AI_OPS_MODE=off`                 |
| **G2b: medição**         | Duas semanas em `shadow`. Comparação entre o que a IA faria e o que a equipe e o hóspede fizeram de fato, por consulta só de leitura em `ops/` | G2a no ar                                                         | Relatório de precisão por ação: falsos positivos, falsos negativos, recusas por trava | —                                       |
| **G2c: previsão `on`**   | Só `eta_*`                                                                                                                                     | Precisão ≥ 99% em pelo menos 30 casos e zero falso positivo grave | Auditoria sem divergência por 7 dias                                                  | Chave em `shadow` ou `off` + "Desfazer" |
| **G2d: conclusões `on`** | `checkin_done` e `checkout_done`                                                                                                               | O mesmo critério, com pelo menos 30 casos de cada                 | O mesmo                                                                               | O mesmo                                 |

"Zero falso positivo" vira critério mensurável: nenhuma conclusão indevida observada no shadow. Uma única ocorrência mantém a ação em `shadow`.

## 4. Testes previstos

- **Golden set** de pelo menos 120 frases em PT, EN e ES.
  - Positivos: "já entramos", "acesso concluído", "check-out feito, chave no cofre", "pousamos às 14h, chegamos lá pelas 16:30", "amanhã saímos cedo, 8h".
  - Negativos: "ainda não entramos", "vamos sair às 8h" (não é conclusão), "já posso entrar?", "não conseguimos entrar", "a chave não funciona", "meu amigo já entrou?", "saímos para jantar", "entramos no Airbnb para ver as regras".
- **Política:** cada trava isolada (data, fuso, horário de verão, vínculo, estado, `staff`, chamado, negociação, limites do imóvel).
- **PostgreSQL 17.6:**
  - RPCs `service_role` e nada para `anon` ou `authenticated`;
  - idempotência com 10 chamadas simultâneas resultando em uma única ação;
  - RLS de leitura por imóvel e isolamento entre tenants.
- **Executor:** modo `off` e `shadow` sem nenhuma escrita no card; `on` chamando `runAdvanceArrival` com `origin "ai"`; recusa do painel registrada; foto de antes.
- **Estáticos:**
  - slot com `return null`;
  - nenhuma escrita em `guest_arrival_status` fora dos núcleos existentes;
  - migration sem `cron` ou `pg_net`.

## 5. Decisões do titular

| #          | Decisão                                                                                                                                                                    | Recomendação                                                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-G2-1** | Resposta de acolhimento ou agradecimento: sugestão do Copiloto (equipe envia) **ou** envio automático pela IA (ativa o slot pela primeira vez, fora da sequência de gates) | **Sugestão do Copiloto** no G2; envio automático só depois do G4 e G5                                                                                                                               |
| **D-G2-2** | Previsão de saída gravada pela IA deve disparar o auto-checkout no horário previsto, como o formulário do guia já faz hoje?                                                | **Não.** Gravar com origem `'guest_ai'`, que o auto-checkout ignora; a saída real vem da conclusão (c) ou do horário padrão do imóvel. A alternativa é manter `'guest'`, com o comportamento atual. |
| **D-G2-3** | Critério para sair do `shadow`                                                                                                                                             | Pelo menos 30 casos por ação, precisão ≥ 99% e zero conclusão indevida                                                                                                                              |
| **D-G2-4** | O G2 depende da geração do Copiloto ligada (mesma chamada ao modelo)                                                                                                       | **Sim.** Sem custo novo; se a geração for desligada, a IA operacional também para.                                                                                                                  |
| **D-G2-5** | Previsão de chegada fora dos limites do imóvel (por exemplo, 13h com check-in às 15h)                                                                                      | **Não gravar**, como o formulário do guia; a informação fica só na sugestão para a equipe                                                                                                           |

## 6. Fora do escopo do G2

- Envio automático de mensagens (salvo se a D-G2-1 decidir o contrário).
- Liberação de senhas.
- Aprovação de early check-in ou late checkout.
- Alteração de reserva.
- Mudança de layout.
- iCal e a tabela `reservas`.
- `slot.server.ts` continua com `return null`.
