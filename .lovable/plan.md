# Assistente interno: anexar arquivos a uma reserva ou limpeza

Hoje o assistente do painel só aceita **imagem** e só sabe preparar ações de pendência e de esteira. O pedido: mandar um vídeo (ou foto, áudio, arquivo) na conversa e dizer "anexa isso na limpeza do Studio 102 de ontem" — e ele conseguir. A única coisa que ele continua **sem** poder mexer é a reserva sincronizada com o canal.

## Como vai funcionar para quem usa

1. A pessoa anexa um arquivo qualquer no assistente e escreve o que quer ("anexa na limpeza do 102 de ontem", "esse vídeo é da auditoria de limpeza da Esther").
2. O assistente descobre o imóvel e a estadia certa, e mostra um cartão de confirmação: imóvel, hóspede, data, tipo do registro e o que será anexado.
3. Ao confirmar, o arquivo sobe e vira um registro igual ao que a equipe cria pela tela de registros — com nome, autor, categoria e, quando for dano/manutenção/objeto esquecido, a pendência no Kanban.
4. Se a pessoa já tiver ligado "dispense a confirmação", grava direto, como nas outras ações.

O arquivo só sai do aparelho **na confirmação** — enquanto isso, o assistente trabalha só com nome, tipo e tamanho. Isso evita subir vídeo grande para uma conversa que não vira registro.

## Mudanças técnicas

- `src/lib/assistant-run.shared.ts`: `AssistantAskInput` ganha `attachment` (nome, mime, tamanho, tipo inferido, duração). `imageDataUrl` continua só para imagem (o modelo olha o print).
- `src/lib/assistant-types.ts`: nova ação `attach_record_media` com propertyId, propertyName, logId/reservationId, cardMode, category, title, description. (feito)
- `src/lib/ai/assistant-tools.server.ts`:
  - contexto ganha `attachment`;
  - nova ferramenta de leitura `reservas_do_imovel` (janela de −21 a +14 dias em `property_reservations`: id, datas, hóspede) para achar a estadia de ontem/semana passada, que a agenda de 7 dias não cobre;
  - nova ferramenta `preparar_anexar_midia` — valida que existe anexo, confere o imóvel contra a permissão do usuário, escolhe a categoria (`cleaning_audit`, `damage`, `maintenance`, `forgotten`, `other`) e monta o cartão. Sem anexo na mensagem, devolve erro explicando que a pessoa precisa anexar o arquivo.
- `src/lib/assistant-run.server.ts`: repassa o anexo ao contexto das ferramentas, descreve o anexo no prompt e acrescenta ao bloco AÇÕES a instrução de anexar registros.
- `src/routes/api/assistant-stream.ts`: nada além do schema compartilhado (já valida tudo).
- `src/components/assistant/AssistantPanel.tsx`:
  - o seletor passa a aceitar qualquer arquivo (`accept="*/*"`), guarda o `File` em memória e mostra um chip com nome/tamanho;
  - imagem continua virando data URL (≤6MB) para o modelo enxergar;
  - o executor da confirmação, no caso `attach_record_media`, sobe via `enviarMidia` (bucket `reservation-records`, caminho `${propertyId}/${logId ?? reservationId}/uuid.ext`) e grava com `createRecordSituation`; erro de envio aparece em português e o arquivo continua no chip para tentar de novo.

## Limite mantido de propósito

Nenhuma ação escreve em `property_reservations`. Datas, hóspede e status de reserva sincronizada continuam vindo só do canal.
