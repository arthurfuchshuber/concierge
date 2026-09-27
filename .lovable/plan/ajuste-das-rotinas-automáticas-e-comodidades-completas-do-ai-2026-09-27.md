# Ajuste das rotinas automáticas e comodidades completas do Airbnb

## 1. Atualização dos anúncios do Airbnb: conferido
Já está desligada no banco. O endereço automático também não faz mais nada. Só roda quando alguém clica em Importar/Sincronizar. Não precisa mudar nada.

## 2. Notícias e eventos da cidade: toda quarta às 8h
- Passa de "todo dia às 10h" para **toda quarta-feira às 8h (horário de Brasília)**.
- A janela de eventos passa de 8 para **7 dias** (de quarta até a terça seguinte).
- O guia mostra o resultado salvo de quarta a semana inteira. Hoje ele procura as notícias "do dia", então vai passar a usar a última busca da semana, sem gerar uma nova sozinho.

## 3. Mensagens proativas ao hóspede: todas desligadas
- A rotina de acompanhamento (a IA voltando a falar com o hóspede em caso aberto) é desligada no agendador.
- Uma trava no código impede o envio mesmo se ela for chamada.
- O concierge proativo já está com o envio travado. Ele continua só calculando métricas internas, sem mandar nada.
- Nada é apagado, então dá para religar depois.

## 4. Recomendações dos guias: dias 1, 10 e 20 às 8h
- Deixa de rodar todo dia às 6h.
- Passa a rodar **nos dias 1, 10 e 20 de cada mês, às 8h (Brasília)**, com uma atualização geral de todas as recomendações automáticas.

## 5. Comodidades completas na importação do Airbnb
O Airbnb carrega a janela "Mostrar todas as comodidades" aos poucos, conforme a pessoa rola. Por isso o robô lê só uma parte.

Correção: o Airbnb tem uma página própria só com as comodidades (o link do anúncio + `/amenities`), que já abre a lista inteira. A importação vai ler essa página e depois juntar com o que já vinha do anúncio, sem repetir nomes. As que o anúncio marca como "não inclusas" (riscadas) continuam vindo.

Custo: 1 leitura a mais do Firecrawl por importação, e só quando alguém clica em Importar.

## Detalhes técnicos
- Agendador (migração): `refresh-city-news-daily` vira `0 11 * * 3` (UTC = 8h BRT). `refresh-guide-recommendations-daily` vira `0 11 1,10,20 * *`. `guest-followup-hourly` fica com `active := false`.
- `cron.guest-followup.ts`: constante `GUEST_FOLLOWUP_ENABLED = false` e retorno imediato.
- `city-news.functions.ts`: `NEWS_WINDOW_DAYS = 6` (hoje + 6 = 7 dias). A leitura do cache passa a pegar o registro mais recente dos últimos 7 dias, em vez de exigir a data de hoje, para o guia não ficar vazio de quinta a terça.
- `airbnb.functions.ts`: nova `scrapeAirbnbAmenities(url)`, que faz o scrape de `/rooms/{id}/amenities` com schema só de `amenities` e ações de rolagem dentro do diálogo. `parseAmenities` junta com as comodidades do scrape principal, sem duplicar nomes e ignorando maiúsculas e acentos. Se essa leitura falhar, fica o resultado atual (nunca piora).
