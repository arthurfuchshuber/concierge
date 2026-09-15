# Atualizações instantâneas para todos os usuários logados

## O que eu verifiquei (e encontrei)

Chequei como o painel recebe mudanças feitas por outras pessoas. Existem três falhas reais, e juntas explicam o "às vezes reflete, às vezes não":

1. **Só três tipos de informação avisam os outros usuários.** O painel escuta apenas
   chegadas/saídas de hóspedes, reservas e acessos ao guia. Pendências, registros de
   situação, conclusões de limpeza e dados do imóvel **não estão habilitados** para
   avisar ninguém — quem marcou vê; os demais só veem se recarregarem a página.
2. **Voltar para a aba não atualiza nada.** O sistema está configurado para não
   rebuscar dados quando a pessoa volta ao navegador ou reconecta a internet. No
   celular, ao sair do app e voltar, a conexão ao vivo cai e nada repõe o que foi
   perdido — a tela continua mostrando o estado antigo por tempo indeterminado.
3. **A conexão ao vivo não se recupera sozinha.** Se ela cai (rede oscilando, tela
   bloqueada, token renovado), ninguém tenta reconectar nem rebusca o que passou.

## O que vou fazer

### 1. Habilitar o aviso em tempo real das informações que faltam
Ligar o aviso de mudanças para pendências, conclusões de pendência, registros de
situação e imóveis — as mesmas regras de acesso de hoje continuam valendo (cada
pessoa só recebe aviso do que já pode ver).

### 2. Escutar essas informações no painel
O painel passa a atualizar também a lista de pendências, a aba Limpeza, os registros
e os cartões quando outra pessoa mexe — com o mesmo atraso curto de agrupamento já
usado hoje (para não disparar várias buscas seguidas).

### 3. Recuperação automática
- Reconectar sozinho quando a conexão ao vivo cair, e rebuscar os dados ao voltar.
- Rebuscar quando a pessoa volta para a aba, quando o celular volta a ter internet e
  quando a sessão é renovada.
- Uma rede de segurança discreta: enquanto a tela está visível, uma reconferência
  periódica leve, para nunca ficar preso num estado antigo.

Sem mudar nada de visual, de permissão ou de regra de negócio.

## Detalhes técnicos

- Migração: `ALTER PUBLICATION supabase_realtime ADD TABLE` para `tasks`,
  `task_completions`, `reservation_records`, `properties` (hoje ausentes; já estão
  presentes `guest_arrival_status`, `property_reservations`, `guide_access_logs`).
  RLS permanece como está — o Realtime avalia as políticas do assinante.
- `src/components/dashboard/OperationWorkspace.tsx`: o canal `dash-live` passa a
  incluir as novas tabelas e a invalidar também `dash-tasks` e `dash-cleaning-stats`;
  callback de `subscribe((status) => ...)` com re-subscribe em `CHANNEL_ERROR`/
  `TIMED_OUT`/`CLOSED` (backoff simples) e `refreshDashboard()` ao reconectar.
- `src/hooks/useRealtimeInvalidate.ts`: mesma lógica de status/reconexão, para as
  demais telas que já usam o hook (imóvel e ficha de stakeholder).
- Refetch em foco/reconexão: manter `refetchOnWindowFocus: false` global (decisão
  anterior por custo) e ativar `refetchOnWindowFocus: "always"` +
  `refetchOnReconnect: true` apenas nas consultas do painel de operação, ou um
  listener único de `visibilitychange`/`online` que chama `refreshDashboard()`.
- `supabase.realtime.setAuth()` no evento `TOKEN_REFRESHED`/`SIGNED_IN` em
  `src/routes/__root.tsx`, para o canal não perder autorização após renovação.

## Depois disso

Retomo a landing page aprovada: montar a home com as peças já criadas, tema escuro,
SEO e verificação em celular e computador.
