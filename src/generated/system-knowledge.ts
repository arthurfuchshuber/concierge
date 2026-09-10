// GERADO AUTOMATICAMENTE por scripts/extract-system-knowledge.mjs — não edite à mão.
// Fonte do conhecimento do Assistente do Painel. Regenerado a cada build.

export type GeneratedSystemDoc = {
  doc_key: string;
  kind: string;
  title: string;
  content: string;
  source_path: string | null;
  audience: string[];
  content_hash: string;
};

export const GENERATED_AT = "2026-09-10T16:55:54.402Z";

export const SYSTEM_KNOWLEDGE: GeneratedSystemDoc[] = [
  {
    "doc_key": "route:/",
    "kind": "route",
    "title": "ConciergeIA — Atendimento com IA para hóspedes de temporada — tela /",
    "content": "Caminho no sistema: /\n\nO ConciergeIA responde seus hóspedes em segundos, no idioma deles, com o tom da sua marca. Menos check-ins caóticos, mais avaliações 5 estrelas.",
    "source_path": "src/routes/index.tsx",
    "audience": [],
    "content_hash": "f4082c37773fdf585eda6fba12139b77"
  },
  {
    "doc_key": "route:/admin/administrativo",
    "kind": "route",
    "title": "Administrativo — tela /admin/administrativo",
    "content": "Caminho no sistema: /admin/administrativo\n\nNo menu do painel esta tela se chama \"Administrativo\".",
    "source_path": "src/routes/_authenticated/admin.administrativo.tsx",
    "audience": [],
    "content_hash": "2aefcc71e25271ca2c005843831616fe"
  },
  {
    "doc_key": "route:/admin/admins",
    "kind": "route",
    "title": "Administradores — tela /admin/admins",
    "content": "Caminho no sistema: /admin/admins\n\nNo menu do painel esta tela se chama \"Administradores\".",
    "source_path": "src/routes/_authenticated/admin.admins.tsx",
    "audience": [],
    "content_hash": "770b3bce39a04a9049d69504eabe33c3"
  },
  {
    "doc_key": "route:/admin/atendimento",
    "kind": "route",
    "title": "Atendimento — tela /admin/atendimento",
    "content": "Caminho no sistema: /admin/atendimento\n\nNo menu do painel esta tela se chama \"Atendimento\".",
    "source_path": "src/routes/_authenticated/admin.atendimento.tsx",
    "audience": [],
    "content_hash": "c368140d272caa29058f9da307ee776f"
  },
  {
    "doc_key": "route:/admin/clientes",
    "kind": "route",
    "title": "Clientes — tela /admin/clientes",
    "content": "Caminho no sistema: /admin/clientes\n\nNo menu do painel esta tela se chama \"Clientes\".",
    "source_path": "src/routes/_authenticated/admin.clientes.tsx",
    "audience": [],
    "content_hash": "73cf3196522df92d01435add83f669a9"
  },
  {
    "doc_key": "route:/admin/dashboard",
    "kind": "route",
    "title": "Dashboard — tela /admin/dashboard",
    "content": "Caminho no sistema: /admin/dashboard\n\nNo menu do painel esta tela se chama \"Dashboard\".\n\nPainel operacional diário do anfitrião: check-ins, checkouts e engajamento do guia.",
    "source_path": "src/routes/_authenticated/admin.dashboard.index.tsx",
    "audience": [],
    "content_hash": "7e5ab3cfe8ad4d3e4a6e481abb21b8c6"
  },
  {
    "doc_key": "route:/admin/dashboard/kanban",
    "kind": "route",
    "title": "Kanban da operação — ConciergeIA — tela /admin/dashboard/kanban",
    "content": "Caminho no sistema: /admin/dashboard/kanban\n\nQuadro de reservas por etapa: chegada, estadia, saída, limpeza e concluídos.",
    "source_path": "src/routes/_authenticated/admin.dashboard.kanban.tsx",
    "audience": [],
    "content_hash": "99c20b3316a55c7aa50e6e8be6426305"
  },
  {
    "doc_key": "route:/admin/dashboard/limpeza",
    "kind": "route",
    "title": "Limpeza — ConciergeIA — tela /admin/dashboard/limpeza",
    "content": "Caminho no sistema: /admin/dashboard/limpeza\n\nHistórico e custos das limpezas realizadas.",
    "source_path": "src/routes/_authenticated/admin.dashboard.limpeza.tsx",
    "audience": [],
    "content_hash": "90714c885b613af323056da6061d15c5"
  },
  {
    "doc_key": "route:/admin/dashboard/registros",
    "kind": "route",
    "title": "Registros — ConciergeIA — tela /admin/dashboard/registros",
    "content": "Caminho no sistema: /admin/dashboard/registros\n\nFotos, vídeos, áudios e notas registrados em todos os imóveis.",
    "source_path": "src/routes/_authenticated/admin.dashboard.registros.tsx",
    "audience": [],
    "content_hash": "0e6b71b1d4dbad55a319d66ce5d26778"
  },
  {
    "doc_key": "route:/admin/engajamento",
    "kind": "route",
    "title": "Engajamento — tela /admin/engajamento",
    "content": "Caminho no sistema: /admin/engajamento\n\nNo menu do painel esta tela se chama \"Engajamento\".",
    "source_path": "src/routes/_authenticated/admin.engajamento.tsx",
    "audience": [],
    "content_hash": "e942ffa70fdb123880a924edc9085528"
  },
  {
    "doc_key": "route:/admin/guias",
    "kind": "route",
    "title": "Guias — tela /admin/guias",
    "content": "Caminho no sistema: /admin/guias\n\nNo menu do painel esta tela se chama \"Guias\".",
    "source_path": "src/routes/_authenticated/admin.guias.tsx",
    "audience": [],
    "content_hash": "e21346780d8aa5c0546fbb2f122bad45"
  },
  {
    "doc_key": "route:/admin/ia",
    "kind": "route",
    "title": "IA Concierge — tela /admin/ia",
    "content": "Caminho no sistema: /admin/ia\n\nNo menu do painel esta tela se chama \"IA Concierge\".\n\nGovernança do conhecimento do ConciergeIA: memória da operação, regras da empresa e aprendizados pendentes de aprovação.",
    "source_path": "src/routes/_authenticated/admin.ia.tsx",
    "audience": [],
    "content_hash": "efd064d64a1041dfcac4f448878648b6"
  },
  {
    "doc_key": "route:/admin/inteligencia",
    "kind": "route",
    "title": "Inteligência — tela /admin/inteligencia",
    "content": "Caminho no sistema: /admin/inteligencia\n\nNo menu do painel esta tela se chama \"Inteligência\".\n\nPainel único da plataforma: inteligência global, pipeline de aprendizado, evolução de agentes e prompts, mais o rastro de auditoria de todo o SaaS.",
    "source_path": "src/routes/_authenticated/admin.inteligencia.tsx",
    "audience": [],
    "content_hash": "10a0338d171222da340800c41c589aee"
  },
  {
    "doc_key": "route:/admin/recomendacoes-sigma",
    "kind": "route",
    "title": "Recomendações — tela /admin/recomendacoes-sigma",
    "content": "Caminho no sistema: /admin/recomendacoes-sigma\n\nNo menu do painel esta tela se chama \"Recomendações\".",
    "source_path": "src/routes/_authenticated/admin.recomendacoes-sigma.index.tsx",
    "audience": [],
    "content_hash": "2de03867ae936c79d01db98a98f568b5"
  },
  {
    "doc_key": "route:/admin/stakeholders",
    "kind": "route",
    "title": "Stakeholders — tela /admin/stakeholders",
    "content": "Caminho no sistema: /admin/stakeholders\n\nNo menu do painel esta tela se chama \"Stakeholders\".\n\nProprietários, hóspedes e prestadores da sua operação em um só lugar.",
    "source_path": "src/routes/_authenticated/admin.stakeholders.tsx",
    "audience": [],
    "content_hash": "1ecdf7bde55e5dc77c55fbc9e8fe3ca2"
  },
  {
    "doc_key": "route:/auth",
    "kind": "route",
    "title": "Entrar — ConciergeIA — tela /auth",
    "content": "Caminho no sistema: /auth\n\nAcesse o ConciergeIA e automatize o atendimento aos seus hóspedes com IA.",
    "source_path": "src/routes/auth.tsx",
    "audience": [],
    "content_hash": "99add2912345dccc91b80ce2b553faff"
  },
  {
    "doc_key": "route:/confianca",
    "kind": "route",
    "title": "Central de Confiança — ConciergeIA — tela /confianca",
    "content": "Caminho no sistema: /confianca\n\nComo o ConciergeIA protege os dados de anfitriões e hóspedes: autenticação, criptografia, controle de acesso e privacidade.",
    "source_path": "src/routes/confianca.tsx",
    "audience": [],
    "content_hash": "5f29062f96148137dd7a8ca8a6f051ef"
  },
  {
    "doc_key": "route:/definir-senha",
    "kind": "route",
    "title": "Criar senha de acesso | ConciergeIA — tela /definir-senha",
    "content": "Caminho no sistema: /definir-senha\n\nDefina a sua senha de acesso ao painel do ConciergeIA e comece a gerenciar check-ins, check-outs e o atendimento aos hóspedes.",
    "source_path": "src/routes/definir-senha.tsx",
    "audience": [],
    "content_hash": "848fe998bc9acf39b1924da50315e852"
  },
  {
    "doc_key": "route:/oauth/google-calendar/return",
    "kind": "route",
    "title": "Conectando Google Agenda | SigmaConcierge — tela /oauth/google-calendar/return",
    "content": "Caminho no sistema: /oauth/google-calendar/return\n\nFinalizando a conexão da sua conta Google Agenda com o SigmaConcierge.",
    "source_path": "src/routes/oauth.google-calendar.return.tsx",
    "audience": [],
    "content_hash": "c2c95042a0de8ccc4139d72d5f32abaa"
  },
  {
    "doc_key": "route:/precos",
    "kind": "route",
    "title": "Planos e preços — ConciergeIA — tela /precos",
    "content": "Caminho no sistema: /precos\n\nEscolha o plano ideal para criar guias digitais para seus hóspedes. 7 dias grátis em todos os planos pagos.",
    "source_path": "src/routes/precos.tsx",
    "audience": [],
    "content_hash": "349efc738bf11002eda82c71903fddfe"
  },
  {
    "doc_key": "route:/privacidade",
    "kind": "route",
    "title": "Política de Privacidade — ConciergeIA — tela /privacidade",
    "content": "Caminho no sistema: /privacidade\n\nComo o ConciergeIA coleta, usa e protege seus dados pessoais em conformidade com a LGPD.",
    "source_path": "src/routes/privacidade.tsx",
    "audience": [],
    "content_hash": "fe2f574e077f4eaff289dfe42c9d797a"
  },
  {
    "doc_key": "route:/reembolso",
    "kind": "route",
    "title": "Política de Reembolso — ConciergeIA — tela /reembolso",
    "content": "Caminho no sistema: /reembolso\n\nGarantia de devolução de 30 dias do ConciergeIA. Veja como solicitar reembolso e cancelar sua assinatura pelo portal do cliente.",
    "source_path": "src/routes/reembolso.tsx",
    "audience": [],
    "content_hash": "92a7eb8a032fab1bc104644d77ba4209"
  },
  {
    "doc_key": "route:/termos",
    "kind": "route",
    "title": "Termos e Condições — ConciergeIA — tela /termos",
    "content": "Caminho no sistema: /termos\n\nLeia os termos e condições de uso do ConciergeIA: contas, pagamentos via Paddle, limites de responsabilidade e suporte.",
    "source_path": "src/routes/termos.tsx",
    "audience": [],
    "content_hash": "b3ddc4ae7717516e16239ce371788ae6"
  },
  {
    "doc_key": "route:/unsubscribe",
    "kind": "route",
    "title": "Cancelar e-mails — ConciergeIA — tela /unsubscribe",
    "content": "Caminho no sistema: /unsubscribe\n\nCancele o recebimento de e-mails do ConciergeIA em poucos segundos, com confirmação segura.",
    "source_path": "src/routes/unsubscribe.tsx",
    "audience": [],
    "content_hash": "77b2d459ed19d7df676713e6ee86dc9d"
  },
  {
    "doc_key": "rule:ACCENT_FROM",
    "kind": "rule",
    "title": "Regra — ACCENT_FROM",
    "content": "NOME DO REGISTRO (pedido explícito, 10/09/2026): as 10 primeiras letras do\nanúncio + o sequencial daquele imóvel — \"STUDIO101-01\".\n\nO nome que vinha da câmera do celular (\"17890533261888326086821345931428\n.jpg\") não dizia nada, e é ele que aparece como título quando o registro\nnão tem texto digitado. Isto é só RÓTULO: a chave real do arquivo é\n`storage_path`, que não é tocado.\n\nA mesma regra está na migração 20260910150000, que renomeou o que já\nestava gravado. Se mudar aqui, mude lá.",
    "source_path": "src/lib/reservation-records.functions.ts",
    "audience": [],
    "content_hash": "01d444953dcf5e7fce254d2e3265a71b"
  },
  {
    "doc_key": "rule:ACTION_OPTIONS",
    "kind": "rule",
    "title": "Regra — ACTION_OPTIONS",
    "content": "O usuário só tem 2 ações reais aqui: reativar o cadastro, ou definir a\ndata final do contrato (o que agenda o cancelamento). \"Cancelando\" e\n\"Cancelado\" nunca são escolhidos diretamente — são derivados dessa data\npela mesma regra de data futura que já promove o cadastro sozinho quando\no dia chega (`setStakeholderStatus` / `promoteDueStages`). Os estágios\nantigos (Documentação/Contrato/Assinatura/Pausado) saíram daqui; ainda são\nreconhecidos em cadastros antigos (rótulo/cor em stakeholder-status.ts),\nsó não são mais oferecidos como opção.",
    "source_path": "src/components/stakeholders/StakeholderStatusControl.tsx",
    "audience": [],
    "content_hash": "497a7b770a19055ba45867e8899a2fb1"
  },
  {
    "doc_key": "rule:Addr",
    "kind": "rule",
    "title": "Regra — Addr",
    "content": "Enriquecimento de endereço a partir de fontes públicas confiáveis.\n\nRegra do projeto: campos que podem ser conferidos online (CEP, endereço,\ncidade/UF) NÃO devem ficar vazios quando é possível descobri-los. Aqui a\nordem de confiança é:\n 1. BrasilAPI /cep (Correios/open-cep) — fonte oficial para CEP brasileiro;\n 2. Nominatim (OpenStreetMap) — busca textual do endereço, usada quando não\n há CEP válido ou quando o CEP não resolveu.\n\nNunca sobrescreve valor já preenchido pelo usuário: só completa o que falta.",
    "source_path": "src/lib/geo-enrich.server.ts",
    "audience": [],
    "content_hash": "b2a00562842724edc278ee68cf29e039"
  },
  {
    "doc_key": "rule:adminApplyCustomTrial",
    "kind": "rule",
    "title": "Regra — adminApplyCustomTrial",
    "content": "Aplica um trial personalizado no Paddle para uma assinatura existente:\npausa a cobrança agora e agenda o retorno automático em `trialEndsAt`.\nEnquanto pausada, o Paddle não gera nenhuma cobrança. Na data definida,\nretoma sozinho e cobra o proporcional até o próximo ciclo.\n\nSe `trialEndsAt` for nulo/passado e a assinatura estiver pausada,\ndespausa imediatamente (encerra o trial customizado).",
    "source_path": "src/lib/admin-subs.functions.ts",
    "audience": [],
    "content_hash": "cf95a46aea198eb04a974a076be740a1"
  },
  {
    "doc_key": "rule:AgendaHit",
    "kind": "rule",
    "title": "Regra — AgendaHit",
    "content": "Reencontra na agenda REAL o card que o modelo indicou, e devolve a linha\ninteira — nunca só um \"ok\".\n\nExiste porque nenhuma ferramenta de escrita deve confiar no id que o\nmodelo escreveu. Gravar no card errado aqui não é um erro de texto: move\no card de dia no quadro de todo mundo, cancela o checkout e a limpeza de\numa estadia, ou avança uma etapa que ninguém pediu. Conferir contra a\nagenda custa uma consulta e transforma \"o modelo alucinou um uuid\" em uma\nmensagem de erro em vez de uma gravação silenciosa.\n\nOs identificadores que seguem para a gravação são os DA LINHA ENCONTRADA.",
    "source_path": "src/lib/ai/assistant-tools.server.ts",
    "audience": [],
    "content_hash": "cf8e65fc42202fa18217ff7528682325"
  },
  {
    "doc_key": "rule:allowedWindowPhrase",
    "kind": "rule",
    "title": "Regra — allowedWindowPhrase",
    "content": "A JANELA PERMITIDA do imóvel, em frase.\n\nPedido explícito (08/09/2026): \"PERMITIDO: ENTRE 15H00 E 23H00\". Antes o\nhorário padrão aparecia sem nome nenhum, e quem não conhecia a tela não\nsabia o que aquele segundo horário significava.\n\nA ordem dos campos é invertida no checkout de propósito — é assim que o\ncadastro do imóvel guarda: `standardTime` é o horário LIMITE de saída e\n`standardTimeMax` o de abertura.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "aa559bfb5c318579be22dfd7ffd8c016"
  },
  {
    "doc_key": "rule:AreaGate",
    "kind": "rule",
    "title": "Regra — AreaGate",
    "content": "`AreaGate` — bloqueia uma área inteira quando o backend nega o acesso.\nEnquanto a decisão não chega, exibe um esqueleto (nunca conteúdo protegido).",
    "source_path": "src/components/permissions/AreaGate.tsx",
    "audience": [],
    "content_hash": "f5a072be47e2e09fbb90667c37bb02ca"
  },
  {
    "doc_key": "rule:attachReservationRecord",
    "kind": "rule",
    "title": "Regra — attachReservationRecord",
    "content": "Registra um anexo (foto/vídeo/áudio/arquivo) já enviado pelo cliente\ndireto pro storage — mesmo fluxo de attachStaffMessage (chat-\nattachments.functions.ts): o navegador sobe o arquivo pro bucket\nprimeiro (RLS de storage.objects garante que só quem acessa o imóvel\nescreve ali), e esta função só grava a linha com os metadados.",
    "source_path": "src/lib/reservation-records.functions.ts",
    "audience": [],
    "content_hash": "ad288b0ededa953cb49739e26bc16e5c"
  },
  {
    "doc_key": "rule:attachTaskRecord",
    "kind": "rule",
    "title": "Regra — attachTaskRecord",
    "content": "Anexo preso a uma PENDÊNCIA (não a uma reserva) — usado pela comprovação\nda resolução e pelos anexos da criação de pendência (07/09/2026).\n\nMesma mecânica do anexo de reserva: o navegador sobe o arquivo pro bucket\ne aqui só gravamos os metadados. Quando a pendência tem reserva vinculada,\n`logId`/`reservationId` vêm junto — assim a comprovação também aparece na\nlinha do tempo daquela reserva, fechando o ciclo \"problema → conserto\" no\nmesmo lugar. Sem reserva (pendência só do imóvel), o registro fica preso\napenas à pendência, e `cardMode` fica vazio: não nasceu em coluna nenhuma\ndo Kanban.",
    "source_path": "src/lib/reservation-records.functions.ts",
    "audience": [],
    "content_hash": "a68f0fbf497293a3e7408cea2dda1249"
  },
  {
    "doc_key": "rule:AudioAttachButton",
    "kind": "rule",
    "title": "Regra — AudioAttachButton",
    "content": "Só o microfone, separado do resto — pedido explícito (07/09/2026): na\nconclusão de pendência ele fica junto do campo \"Como foi resolvido\", pra\nquem prefere explicar falando em vez de digitar. Grava assim que é tocado\n(autoStart), sem exigir um segundo clique.",
    "source_path": "src/components/dashboard/TaskAttachments.tsx",
    "audience": [],
    "content_hash": "54286623a751a461a23230c18cec34c1"
  },
  {
    "doc_key": "rule:blobToBase64",
    "kind": "rule",
    "title": "Regra — blobToBase64",
    "content": "A FOLHA DA SITUAÇÃO (pedido explícito, 10/09/2026).\n\n\"cada vez que o prestador for gravar video/audio/foto, etc.. criar uma\n 'folha' para aquela situação e um botão 'registrar situação' para que ele\n consiga registrar uma nova, e assim por diante\"\n\nAntes, a captura subia o arquivo na hora e acabava ali: sem título, sem\ndescrição, e cada toque virava um registro (e uma pendência) separado. Agora\na captura ABRE ESTA FOLHA e nada sai do aparelho até \"Registrar situação\":\n\n · a faixa de mídias, com o \"+\" para juntar mais arquivos DA MESMA situação\n (a categoria já é da situação — o \"+\" não pergunta de novo);\n · título curto e descrição, cada um com microfone que vira TEXTO;\n · um envio só, que cria UMA pendência com todas as provas dentro.\n\nMicrofone do CAMPO ≠ áudio pelo \"+\": o do campo é ditado (o áudio é usado e\ndescartado), o do \"+\" é mídia guardada.",
    "source_path": "src/components/dashboard/RecordSituationSheet.tsx",
    "audience": [],
    "content_hash": "3a6b1ba2913aff9e720458f28df5e511"
  },
  {
    "doc_key": "rule:bodyByCity",
    "kind": "rule",
    "title": "Regra — bodyByCity",
    "content": "Monta o corpo da notificação agrupado por cidade:\n \"2 em Foz do Iguaçu\\n1 em Praia do Peró\"\nQuando não há cidade cadastrada, usa o nome do imóvel como fallback.",
    "source_path": "src/lib/ops-push.server.ts",
    "audience": [],
    "content_hash": "733d6c253a2c2a01935e1199bc25d1bc"
  },
  {
    "doc_key": "rule:bucketCounts",
    "kind": "rule",
    "title": "Regra — bucketCounts",
    "content": "Contadores do topo. Contam sempre o TOTAL, nunca o filtrado — é assim que\ndá pra trocar de faixa sem antes desligar a atual.\n\nPedido explícito: contador ZERADO não aparece. Como eles dividem a largura\nentre si, dois contadores ficam maiores e mais legíveis que quatro; o\nespaço não sobra, é redistribuído. Zerando todos, some a barra inteira.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "748887ff8081a2bed7f0ac2cf5200983"
  },
  {
    "doc_key": "rule:buildHourOptions",
    "kind": "rule",
    "title": "Regra — buildHourOptions",
    "content": "Horas selecionáveis dentro de [min, max] (ambos opcionais — sem limite\nquando ausente). Usado pelos seletores de chegada e saída (05/09/2026,\nmesma regra do painel do anfitrião: \"checkin só pode ser preenchido o\nhorário a partir do horário configurado... checkout pode selecionar até\na data/horário limite configurado\").",
    "source_path": "src/components/GuideAccessGate.tsx",
    "audience": [],
    "content_hash": "1a43778face7123eb6636f53377f99aa"
  },
  {
    "doc_key": "rule:buildInitialState",
    "kind": "rule",
    "title": "Regra — buildInitialState",
    "content": "Pré-carrega o popup com o que já existe nos guias selecionados: o campo\naparece sempre preenchido com o valor atual (quando os guias divergem, o\ncampo fica vazio com aviso — nada é sobrescrito sem edição explícita).",
    "source_path": "src/components/BulkEditDialog.tsx",
    "audience": [],
    "content_hash": "c7d8c644541b6cda766a97f30451c791"
  },
  {
    "doc_key": "rule:buildReceiptNode",
    "kind": "rule",
    "title": "Regra — buildReceiptNode",
    "content": "Monta, fora da tela (position: fixed + offset negativo — nunca\ndisplay:none, que impediria a medição/captura), o layout \"comprovante\"\nusado no print das listas de hóspedes (pedido explícito): largura sempre\nfixa, uma linha compacta por hóspede (em vez do card grande da tela),\ncom um cabeçalho e um rodapé de recibo. Reaproveita as mesmas classes\nTailwind/tokens do resto do app — não é um estilo à parte.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "87ac883cc8c5c126bceb8c25a3863ce4"
  },
  {
    "doc_key": "rule:buildSameDayCheckinLookup",
    "kind": "rule",
    "title": "Regra — buildSameDayCheckinLookup",
    "content": "Mapa `propriedade|data` → horário previsto do check-in daquele dia (ou\n`null` se houver check-in sem horário definido) — usado só pra decidir se\num checkout \"cruza\" com uma chegada no mesmo imóvel no mesmo dia (giro).\nQuando há mais de um check-in no mesmo imóvel/dia (raro), fica o mais cedo.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "b4ccf87270d1da5e51220efb64dc0dae"
  },
  {
    "doc_key": "rule:CalendarFiltersButton",
    "kind": "rule",
    "title": "Regra — CalendarFiltersButton",
    "content": "Botão único que reúne Período + Cidade + Proprietário + \"limpar todos\" num\nsó painel — pedido explícito: no Dashboard, os 3 botões de filtro (que\nantes ficavam numa linha própria acima do calendário) viraram só ESTE\nbotão, ao lado do título \"Calendário de ocupação\" (mesma ideia do botão\núnico \"Hoje/Amanhã/7 dias/Todos\" da visão Kanban). O estado\n(periodRange/cityFilters/ownerFilters) continua vivendo no pai\n(OperationWorkspace), porque também afeta os cards de limpeza acima —\neste componente só desenha o painel e delega toda mudança pro pai.\n\nLayout escolhido pelo usuário entre 3 mockups (Opção C — \"lista →\ndetalhe\"): abre num resumo enxuto de 1 linha por filtro (com o valor\natual à direita); tocar numa linha entra no editor daquele filtro\nespecífico, com \"‹ Filtros\" pra voltar. Pedido explícito: o editor de\n\"Período\" é o MESMO calendário padrão (completo) que já era usado no\nantigo botão \"Período\" sozinho — não uma versão reduzida.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "91cd1b68599a4403d23f1384b79bd2a3"
  },
  {
    "doc_key": "rule:CancellationReviewDialog",
    "kind": "rule",
    "title": "Regra — CancellationReviewDialog",
    "content": "Popup global: quando chega a data de um cancelamento agendado, toda a equipe\né consultada para confirmar o cancelamento definitivo ou reverter para Ativo.\nEnquanto ninguém responder, o popup continua aparecendo em qualquer tela.",
    "source_path": "src/components/stakeholders/CancellationReviewDialog.tsx",
    "audience": [],
    "content_hash": "d3c327edec42c496f04c190f3ac1114c"
  },
  {
    "doc_key": "rule:CARD_NUMBER_TONE",
    "kind": "rule",
    "title": "Regra — CARD_NUMBER_TONE",
    "content": "Contador/filtro de uma categoria. Mesma casca dos KPIs da Operacional.\n\nA COR DO NÚMERO É UM SEMÁFORO, NÃO UMA ETIQUETA (pedido explícito,\n10/09/2026): zerado é BRANCO em todas as categorias — não há nada ali, nada\na sinalizar. Acima de zero, a cor diz o quanto aquilo pesa: manutenção e\ndano em vermelho (é trabalho parado), esquecidos e outros em âmbar (é\natenção), auditoria de limpeza no violeta de sempre (é rotina, não alarme)\ne \"Todos\" sempre branco, porque somar tudo não é sinal de nada.\n\nCartão zerado NÃO é mais esmaecido — todos têm a mesma tonalidade.",
    "source_path": "src/components/dashboard/RecordsWorkspace.tsx",
    "audience": [],
    "content_hash": "81e657e993d3db98c81a03c7d04accac"
  },
  {
    "doc_key": "rule:CARD_ORDER",
    "kind": "rule",
    "title": "Regra — CARD_ORDER",
    "content": "ORDEM DOS CARTÕES nesta tela (pedido explícito, 10/09/2026): manutenção,\ndano, esquecidos, auditoria e outros — a ordem de PRIORIDADE da operação,\ncom \"Todos\" na frente de todos.\n\nNão mexe em `CATEGORIES`: aquela ordem é do SELETOR que abre antes da\ncâmera (definida pelo cliente em 07/09/2026) e continua valendo lá.",
    "source_path": "src/components/dashboard/RecordsWorkspace.tsx",
    "audience": [],
    "content_hash": "4c196526bd47a11b81a5a5ce93afbb90"
  },
  {
    "doc_key": "rule:CardStage",
    "kind": "rule",
    "title": "Regra — CardStage",
    "content": "A BARRA LATERAL DE ETAPA — 3px na borda esquerda do card.\n\nPedido explícito (08/09/2026, layout novo dos cards): a etapa sai do texto e\nvira cor, sempre na mesma posição. É a única coisa do card que se lê sem\nler — passando o olho por uma coluna inteira dá para ver onde cada reserva\nestá sem parar em nenhuma.\n\nAtraso sobrepõe a etapa: uma data vencida sem a ação feita é o único estado\nque precisa gritar mais alto que \"em que fase estou\".",
    "source_path": "src/components/dashboard/card-colors.ts",
    "audience": [],
    "content_hash": "c47eaa9424d89caa750b4901b33ec3df"
  },
  {
    "doc_key": "rule:cellHalves",
    "kind": "rule",
    "title": "Regra — cellHalves",
    "content": "Cada dia é dividido em duas metades (manhã = saída, tarde = entrada),\nque é a ordem natural do dia. Quando as duas metades são iguais o\ndesenho é renderizado inteiro.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "7ac439d7f03848e5eae4591d9ee2343d"
  },
  {
    "doc_key": "rule:centsToReaisInput",
    "kind": "rule",
    "title": "Regra — centsToReaisInput",
    "content": "Campo de dinheiro (R$) que aceita digitação livre.\n\nPor que não um <Input type=\"number\"> controlado direto pelos centavos?\nPorque reformatar o valor a cada tecla (ex.: \"1\" -> grava 100 centavos ->\nrepinta \"1,00\") empurra o cursor pro fim e trava a digitação no meio do\nnúmero — o usuário não consegue completar \"1,50\" porque, ao digitar o\n\"5\", o campo já virou \"1,00\" e o \"5\" cai fora do lugar.\n\nAqui o campo guarda seu PRÓPRIO texto (livre, sem reformatar a cada\ntecla) e só chama onChange com os centavos já convertidos. A formatação\n\"bonita\" (2 casas decimais) só é reaplicada ao perder o foco.",
    "source_path": "src/components/ui/money-input.tsx",
    "audience": [],
    "content_hash": "681aaf06e118ef3af14a89d0f1d4c8d8"
  },
  {
    "doc_key": "rule:ChannelType",
    "kind": "rule",
    "title": "Regra — ChannelType",
    "content": "Channel Gateway — contratos.\n\nO Agent Core NUNCA sabe de onde veio a mensagem. Todo canal converte sua\ncarga própria em `InboundMessage` e recebe de volta `OutboundMessage`.",
    "source_path": "src/lib/ai/channels/types.ts",
    "audience": [],
    "content_hash": "ce1a505497fee1c4533be8de48881247"
  },
  {
    "doc_key": "rule:checkinNoShowStays",
    "kind": "rule",
    "title": "Regra — checkinNoShowStays",
    "content": "\"Não Compareceu\" identificado pela ESTADIA (imóvel + data de entrada),\nnão só pelos identificadores gravados.\n\nPor que isto foi preciso (bug real relatado em 08/09/2026: \"ao acionar\nnão compareceu, o card continua espelhado na Fila de Limpeza\"):\n\nO gate por id só funciona quando o card de CHECK-IN e o card de\nCHECKOUT da mesma estadia carregam o mesmo identificador — e nem\nsempre carregam. O casamento log↔reserva é FEITO DE FORMA DIFERENTE\nnos dois lados: `findLogsForReservation` tem a linha\n`if (resCode && !logCode && kind === \"checkin\") continue;`, ou seja,\num formulário sem código de reserva casa com a reserva no lado da\nSAÍDA e não casa no lado da CHEGADA. Nesse caso o card de chegada é o\ndo log (reservationId nulo) e o de saída é o da reserva — e\n`markNoShow`, que grava só o que o card clicado tinha, deixa o outro\nlado sem nenhuma chave em comum. O card sobrevive ao filtro e reaparece\nem Checkouts/Limpeza.\n\nA estadia resolve isso porque não depende de casamento nenhum: dois\nhóspedes diferentes não começam no MESMO imóvel no MESMO dia. É a\nmesma identidade que a pessoa enxerga na tela.\n\nAs duas consultas abaixo só acontecem quando existe algum \"não\ncompareceu\" na conta.",
    "source_path": "src/lib/arrival-board.server.ts",
    "audience": [],
    "content_hash": "314eb75812f6c04b06c933a3b0f2fa4f"
  },
  {
    "doc_key": "rule:CLEANING_DAY_MIN_PX",
    "kind": "rule",
    "title": "Regra — CLEANING_DAY_MIN_PX",
    "content": "Largura mínima de UM dia nos gráficos de previsão. Escolhida pelo rótulo\nmais largo que pode aparecer (\"08/09\" ou \"R$1.234\" em 9–10px, ~36px), mais\nrespiro dos dois lados. É esse número que garante que dois dias vizinhos\nnunca fiquem \"muito próximos um do outro\" — a condição que o pedido usa\npara acionar a rolagem.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "df052b208c2bc159c5eb49378ff0f4a7"
  },
  {
    "doc_key": "rule:CleaningBreakdownContent",
    "kind": "rule",
    "title": "Regra — CleaningBreakdownContent",
    "content": "Conteúdo do tooltip \"quais imóveis\" (Limpezas Realizadas / Custo Total\nLimpeza). Pedido explícito: também ganha o alternador Completo/Lista e o\nbotão de print — no modo Lista mostra só proprietário + imóvel + um\natalho pro mapa (bem pequeno).",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "5eb4a030742377d73ed305d31cc5f25b"
  },
  {
    "doc_key": "rule:CleaningChartFrame",
    "kind": "rule",
    "title": "Regra — CleaningChartFrame",
    "content": "Moldura comum dos dois gráficos de previsão (pedido explícito, 08/09/2026).\n\nDuas decisões moram aqui:\n\n · NÃO existe mais eixo vertical. A grandeza é lida no rótulo em cima de\n cada marca e no tooltip — a \"legenda vertical\" saiu a pedido, e sair\n sem colocar nada no lugar deixaria o gráfico ilegível.\n\n · TODO dia do filtro aparece rotulado (`interval={0}`), nunca \"um sim,\n outro não\". Quando os dias não cabem, quem cede é a largura da vista,\n não o rótulo: a faixa passa a rolar para a direita e a janela visível\n encolhe até o último dia INTEIRO (regra anti-corte, ver\n useAntiClipColumns). Sem degradê nas bordas — proibido pelo cliente.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "abc6be4b1241f1b198d0c96335e60b46"
  },
  {
    "doc_key": "rule:cleaningForecastListQ",
    "kind": "rule",
    "title": "Regra — cleaningForecastListQ",
    "content": "\"Limpeza Prevista 7d\" (pedido explícito) — diferente do histórico\n(`getCleaningStats`, baseado em `concluded_at`), aqui a base são os\nCHECKOUTS AGENDADOS (ainda pendentes) pros próximos 7 dias: cada\ncheckout previsto vira uma limpeza esperada naquele dia. Reaproveita a\nmesma lista/lógica de \"Checkouts\" (iCal, gating etc.) via `listFn`, só\nque com `range: \"7d\"` (hoje → hoje+6).\nCusto: como o tipo de limpeza (normal/completa) só é escolhido na hora\nde concluir, o valor aqui é uma ESTIMATIVA usando o preço da limpeza\nnormal de cada imóvel (pedido explícito) — nunca um valor fechado.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "4dc9e8de43bca8c3b191eb5fa43abda1"
  },
  {
    "doc_key": "rule:cleaningRows",
    "kind": "rule",
    "title": "Regra — cleaningRows",
    "content": "\"Fila de Limpeza\" precisa incluir também o checkout ANTECIPADO de um\ncard de amanhã: ele sai da lista de amanhã (deixa de ser pendente) e,\nsem isso, não apareceria em lugar nenhum.\n\nPedido explícito (mesmo ajuste já feito no quadrante do Kanban): a faixa\nespelha TODOS os checkouts do período, não só os já liberados — quem\nainda não fez check-out aparece também, bloqueado (ver `awaitingCheckout`\nno ArrivalCard). Bloqueado nunca compete com quem já está liberado, por\nisso vem sempre DEPOIS na lista (mesmo racional de sempre).",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "28f8194ed1c409eb4bdf7e276a73dfb6"
  },
  {
    "doc_key": "rule:ClicksignContractStartConflictDialog",
    "kind": "rule",
    "title": "Regra — ClicksignContractStartConflictDialog",
    "content": "Quando a sincronização do ClickSign encontra cadastros cuja \"Início do\ncontrato\" já foi preenchida manualmente com uma data diferente da\nassinatura mais antiga do ClickSign, mostramos essa lista e deixamos a\ndecisão (manter ou sobrescrever) sempre com quem acionou a sincronização —\na integração nunca decide isso sozinha.",
    "source_path": "src/components/admin-pages/ClicksignContractStartConflictDialog.tsx",
    "audience": [],
    "content_hash": "6c0dd8e906ea21d5af7eb29fa7231b93"
  },
  {
    "doc_key": "rule:ClicksignDisconnectDialog",
    "kind": "rule",
    "title": "Regra — ClicksignDisconnectDialog",
    "content": "Ao desativar a integração, pergunta se os dados criados por ela devem ser\nmantidos ou removidos. Cadastros feitos manualmente nunca são apagados.",
    "source_path": "src/components/admin-pages/ClicksignDisconnectDialog.tsx",
    "audience": [],
    "content_hash": "c93bcbf9eaf9c9de60b22eff8a2ed757"
  },
  {
    "doc_key": "rule:clusterByProximity",
    "kind": "rule",
    "title": "Regra — clusterByProximity",
    "content": "Encadeia os itens de um grupo empatado pelo vizinho mais próximo (rota\ncurta): parte do primeiro item do grupo e, a cada passo, escolhe entre os\nrestantes aquele que está mais perto do ÚLTIMO item já encadeado — não do\nprimeiro. Pedido explícito, com exemplo real: \"casa da Patrícia\" → o\npróximo deve ser quem está mais perto DELA (ex.: \"casa do Arthur\"), e o\nseguinte, mais perto do Arthur (ex.: \"studio da Eliete\") — não uma\npropriedade distante só porque pertence a um grupo com mais unidades\n(ex.: vários \"studios do Clayton\" longe dali). Isso também garante que\nimóveis no mesmo endereço apareçam juntos (distância ~0 = sempre o\npróximo escolhido). Imóveis sem coordenada cadastrada não competem nesse\ncritério; ficam ao final do grupo, na ordem que já tinham.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "7bb57d8ce7d452ae85a0bb5a3783d3ff"
  },
  {
    "doc_key": "rule:commitPrediction",
    "kind": "rule",
    "title": "Regra — commitPrediction",
    "content": "Grava uma previsão. `side` decide EM QUAL LINHA do banco ela cai\n(`guest_arrival_status.kind`), e `target` decide com quais identificadores\n— os da linha daquele lado, nunca os do card que abriu o editor. As duas\nprevisões da mesma estadia vivem em registros diferentes: por construção,\nnão há como uma sobrescrever a outra.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "c985da08335d34800968b717a3992aa6"
  },
  {
    "doc_key": "rule:COMPOSER_INPUT",
    "kind": "rule",
    "title": "Regra — COMPOSER_INPUT",
    "content": "O campo em si. Altura de linha travada para a pílula não crescer sozinha —\nera isso que deixava a barra do Atendimento mais alta que a do Assistente.",
    "source_path": "src/components/chat/composer-styles.ts",
    "audience": [],
    "content_hash": "ed9ab3243554b00d65ae2ecc079754d5"
  },
  {
    "doc_key": "rule:contratanteBlock",
    "kind": "rule",
    "title": "Regra — contratanteBlock",
    "content": "Recorta o trecho do \"CONTRATANTE\" — do rótulo até o próximo bloco\n(CONTRATADA/CONTRATADO, cláusula, objeto…). Se não achar, devolve o\ninício da página para a IA analisar mesmo assim.",
    "source_path": "src/lib/contract-extract.server.ts",
    "audience": [],
    "content_hash": "81593a28310de075cb3d992a743ae6b4"
  },
  {
    "doc_key": "rule:countAccountGuides",
    "kind": "rule",
    "title": "Regra — countAccountGuides",
    "content": "Contagem GLOBAL de guias da conta (número total de imóveis do titular),\nindependente do recorte de residências visíveis para o caller. Serve para\nindicadores de plano (\"X/900\"), que são informação da conta, não do escopo.",
    "source_path": "src/lib/properties.functions.ts",
    "audience": [],
    "content_hash": "c22a95b71b33ecdaba9ecb14d005de44"
  },
  {
    "doc_key": "rule:createGuidePreviewToken",
    "kind": "rule",
    "title": "Regra — createGuidePreviewToken",
    "content": "Emite um token curto para pré-visualizar o guia (inclusive rascunhos).\n A RLS de `properties` garante que só quem tem acesso ao imóvel recebe.",
    "source_path": "src/lib/guide-preview.functions.ts",
    "audience": [],
    "content_hash": "f748e593c76b7da6d2b2ca9d510f4016"
  },
  {
    "doc_key": "rule:createLinkedTask",
    "kind": "rule",
    "title": "Regra — createLinkedTask",
    "content": "Abre a pendência no Kanban para as categorias que exigem ação\n(objeto esquecido / dano / manutenção). Devolve o id da tarefa criada, ou\nnull quando a categoria não gera pendência.\n\nA tarefa nasce ligada à reserva E ao imóvel — os dois vínculos que o\ncliente pediu — reaproveitando exatamente os campos que `tasks` já tinha\n(property_id + log_id + reservation_id), com o mesmo insert de\n`createTask` (tasks.functions.ts).",
    "source_path": "src/lib/reservation-records.functions.ts",
    "audience": [],
    "content_hash": "8951ade053510905855fad89e733609e"
  },
  {
    "doc_key": "rule:DateEditor",
    "kind": "rule",
    "title": "Regra — DateEditor",
    "content": "Calendário no MESMO padrão já usado em outros pontos do sistema (ex.:\n\"Prazo\" do card de tarefa) — Popover + Calendar do design system, em vez\ndo seletor nativo do navegador (que além de destoar do tema, em alguns\nambientes simplesmente parava de abrir depois do primeiro valor\nescolhido). Pedido explícito, 05/09/2026.\n\nA confirmação (`onChange`) só dispara quando o popover FECHA, nunca no\nclique do dia em si — assim o card não \"pula\" de lista/ordenação no meio\nda edição, dando tempo do usuário ajustar também o horário antes da\nprevisão ser efetivamente salva (mesmo pedido). Fechar sem escolher nada\nnão altera o valor.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "ea31ea92e4d0ab8e5ad3511d50f5d855"
  },
  {
    "doc_key": "rule:dedupeFormLogs",
    "kind": "rule",
    "title": "Regra — dedupeFormLogs",
    "content": "Dedupe apenas submissões repetidas do MESMO formulário para a MESMA\nestadia (nunca mescla reservas back-to-back na mesma unidade — checkout\nfaz parte da identidade, pois um hóspede pode sair no mesmo dia que outro\nentra). Compartilhado entre o Kanban (buildArrivalRows) e o agregado de\nengajamento do Dashboard (getGuideEngagement) para que os dois nunca\n\"casem\" hóspedes diferentes com a mesma reserva.",
    "source_path": "src/lib/arrival-board.server.ts",
    "audience": [],
    "content_hash": "e8396655bc05b566a9cc1b5b5c33218b"
  },
  {
    "doc_key": "rule:DEFAULT_TZ",
    "kind": "rule",
    "title": "Regra — DEFAULT_TZ",
    "content": "Fuso horário do IMÓVEL (cidade/país), nunca o do aparelho do hóspede.\nTodas as contagens e horários exibidos no guia devem usar estas funções.",
    "source_path": "src/lib/property-timezone.ts",
    "audience": [],
    "content_hash": "c133080e51961339b4374115e172b6d8"
  },
  {
    "doc_key": "rule:defaultShowInCleaning",
    "kind": "rule",
    "title": "Regra — defaultShowInCleaning",
    "content": "Pedido explícito (07/09/2026): pendência de MANUTENÇÃO já nasce visível\npara a limpeza — a chave, nesse caso, serve para OCULTAR. Todas as outras\ncategorias nascem ocultas e a chave serve para MOSTRAR.\n\nVale para os dois caminhos de criação: o formulário \"Nova pendência\" e as\npendências abertas automaticamente a partir de um registro da reserva.\nUma vez criada, o valor é sempre o que estiver gravado — esta função só\ndecide o PADRÃO inicial.",
    "source_path": "src/lib/tasks-types.ts",
    "audience": [],
    "content_hash": "79655ce433b542cf5418297d7d066721"
  },
  {
    "doc_key": "rule:deleteReservationRecord",
    "kind": "rule",
    "title": "Regra — deleteReservationRecord",
    "content": "Remove um registro (e o arquivo do storage, se houver). A pendência\ngerada NÃO é apagada junto: ela pode já estar em andamento com outra\npessoa: quem quiser encerrá-la faz isso na tela de Pendências.",
    "source_path": "src/lib/reservation-records.functions.ts",
    "audience": [],
    "content_hash": "e57100511b0c10d3f65a8ad99e7ce441"
  },
  {
    "doc_key": "rule:DictationField",
    "kind": "rule",
    "title": "Regra — DictationField",
    "content": "Campo de texto com DITADO. O microfone monta o gravador já gravando; ao\nparar, o áudio vai para a transcrição e o texto cai no campo (somando ao\nque já estava escrito, nunca substituindo).",
    "source_path": "src/components/dashboard/RecordSituationSheet.tsx",
    "audience": [],
    "content_hash": "a3e3bb3e1ff847e56bb3a4e65dae7545"
  },
  {
    "doc_key": "rule:diffPayload",
    "kind": "rule",
    "title": "Regra — diffPayload",
    "content": "Mudanças legíveis entre o cadastro anterior e o novo, já em frases\n prontas para a Linha do Tempo (não \"Campo: A → B\"). Início e fim do\n contrato viram frases próprias e independentes (\"Data de início do\n contrato alterada para X\"), e quando os dois mudam juntos (ex.: contrato\n novo com vigência completa) as duas frases se juntam numa só com \"e\" —\n cada uma só aparece quando aquele campo específico realmente mudou.",
    "source_path": "src/lib/stakeholders.functions.ts",
    "audience": [],
    "content_hash": "587d644cd63750935d1cba6ef32c1139"
  },
  {
    "doc_key": "rule:DraftKind",
    "kind": "rule",
    "title": "Regra — DraftKind",
    "content": "O RASCUNHO DA SITUAÇÃO — os arquivos que a pessoa já capturou e que ainda\nnão saíram do aparelho.\n\nVive fora do componente porque três telas o tocam (a folha da situação, a\nlinha do tempo da reserva e, no futuro, a unificação) e porque exportar\nfunção junto com componente quebra o fast refresh.",
    "source_path": "src/components/dashboard/record-draft.ts",
    "audience": [],
    "content_hash": "63b9a471041fc1a614eb08df847578b4"
  },
  {
    "doc_key": "rule:earliestSignedAt",
    "kind": "rule",
    "title": "Regra — earliestSignedAt",
    "content": "Data (yyyy-mm-dd) do primeiro documento assinado no ClickSign vinculado a\neste cadastro. Quando há mais de um documento (contrato, aditivo, termo…),\nusamos sempre o mais antigo já concluído — é o que mais se aproxima do\ninício real da vigência.",
    "source_path": "src/lib/contract-fill.server.ts",
    "audience": [],
    "content_hash": "e2e455ccbb86e8a30d5213e6edb5c29c"
  },
  {
    "doc_key": "rule:EngagementBreakdownDialog",
    "kind": "rule",
    "title": "Regra — EngagementBreakdownDialog",
    "content": "Redesign aprovado (Opção C): abas \"Viram\"/\"Não viram\" em vez das 2 listas\nempilhadas — só um grupo por vez, com mais respiro por linha (avatar de\niniciais + nome + imóvel), melhor pra quando a lista de hóspedes cresce.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "4e3dcc804876f097fcf80f261b06c420"
  },
  {
    "doc_key": "rule:EngagementCard",
    "kind": "rule",
    "title": "Regra — EngagementCard",
    "content": "Card individual do Engajamento (desktop) — exatamente o tratamento visual\ndo mockup aprovado (borda + fundo com gradiente radial roxo/rosa + acento\nlateral + ícone em caixinha + valor em destaque), só sem negrito nas\nfrases (pedido explícito).",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "d2569b61de70b30381dd02696cbf9574"
  },
  {
    "doc_key": "rule:EngagementFlags",
    "kind": "rule",
    "title": "Regra — EngagementFlags",
    "content": "Pendências de engajamento do hóspede — só mostramos o que está em falta:\n1) não acessou o guia · 2) não leu as instruções (menos de 5s na Chegada)\n3) não viu as senhas.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "c471246258005f899ac3ec7d0f6a3efd"
  },
  {
    "doc_key": "rule:ensureRegistry",
    "kind": "rule",
    "title": "Regra — ensureRegistry",
    "content": "Garante que o Registry esteja carregado em memória e que a árvore exista\nno banco. O sync oficial só dispara quando a tabela está vazia — nunca\nsilenciosamente a cada leitura. Falhas são registradas, não propagadas.",
    "source_path": "src/lib/permissions/permission.admin.server.ts",
    "audience": [],
    "content_hash": "189811dc72d08c4938a80b671b1b24ec"
  },
  {
    "doc_key": "rule:ensureRegistrySynced",
    "kind": "rule",
    "title": "Regra — ensureRegistrySynced",
    "content": "Garante que a árvore exista antes de qualquer leitura administrativa.\nSó dispara o sync quando a tabela está vazia — evita \"árvore vazia no boot\".",
    "source_path": "src/lib/permissions/permission.sync.server.ts",
    "audience": [],
    "content_hash": "1fd733aed05a2ecd527404f56fc93db4"
  },
  {
    "doc_key": "rule:evaluate",
    "kind": "rule",
    "title": "Regra — evaluate",
    "content": "Avalia um pedido de permissão de forma determinística.\n\nOrdem: OWNER → papéis de bypass → feature gating → assignment direto →\nherança pelos ancestrais → negação padrão.",
    "source_path": "src/lib/permissions/permission.engine.ts",
    "audience": [],
    "content_hash": "40d1f8ff9c3906240f7df78ead374be0"
  },
  {
    "doc_key": "rule:falhas",
    "kind": "rule",
    "title": "Regra — falhas",
    "content": "UMA confirmação, N gravações — pedido explícito (08/09/2026): \"crie\na recorrência em todos os imóveis sem me pedir para confirmar a\ngravação de cada um deles\".\n\nEm série, de propósito: `createTask` é a MESMA server function da\ntela de Pendências, e disparar quarenta em paralelo só troca a\nespera do usuário por picos no banco. Em série, um erro no meio não\nderruba o que já entrou — o que já foi criado, fica.",
    "source_path": "src/components/assistant/AssistantPanel.tsx",
    "audience": [],
    "content_hash": "85a54d1afa5a112b1f0adb5f30397855"
  },
  {
    "doc_key": "rule:FALLBACK_CATEGORY",
    "kind": "rule",
    "title": "Regra — FALLBACK_CATEGORY",
    "content": "Categoria usada como último recurso quando, por algum motivo, a escolha\nnão chegou até o envio (a folha SEMPRE aparece antes da captura, então na\nprática isso não acontece).\n\nPedido explícito (07/09/2026): NENHUMA categoria é sugerida/destacada na\nfolha — a escolha é sempre 100% do usuário, sem viés visual. Antes\n\"Observação / Outros\" vinha marcada como sugerida.",
    "source_path": "src/components/dashboard/ReservationRecords.tsx",
    "audience": [],
    "content_hash": "e71705698627af53a6baeb089cfa258e"
  },
  {
    "doc_key": "rule:fetchWithRetry",
    "kind": "rule",
    "title": "Regra — fetchWithRetry",
    "content": "fetch com um retry curto para falhas transitórias (5xx ou erro de rede).\nNUNCA retenta se o cancelamento veio do próprio signal do caller (timeout\nintencional) — nesse caso, insistir só atrasaria uma resposta que já vai\nser abandonada. 429/402 não são retentados aqui: já têm tratamento próprio\nem `throwForStatus` e retry imediato só pioraria rate limit/billing.",
    "source_path": "src/lib/ai/gateway.server.ts",
    "audience": [],
    "content_hash": "2088aac0620c20f56d9307ab08ba6ee2"
  },
  {
    "doc_key": "rule:FieldTypingBadge",
    "kind": "rule",
    "title": "Regra — FieldTypingBadge",
    "content": "Mostra \"Fulano está digitando: ...\" junto de um campo, com o texto exato\nque a outra pessoa está digitando naquele campo agora. Só leitura — nunca\nmescla com o que você mesmo está digitando ali.",
    "source_path": "src/components/presence/FieldTypingBadge.tsx",
    "audience": [],
    "content_hash": "f7f55f2830a8f498fe6d611b4a82e8a0"
  },
  {
    "doc_key": "rule:fillContractStartFromClicksign",
    "kind": "rule",
    "title": "Regra — fillContractStartFromClicksign",
    "content": "Preenche a \"Início do contrato\" com a data do primeiro documento assinado\nno ClickSign. Nunca sobrescreve um valor já existente por conta própria —\nse o cadastro já tem uma data diferente, isso vira um \"conflito\" e só é\nresolvido se quem acionou a sincronização pedir explicitamente (`overwrite`).",
    "source_path": "src/lib/contract-fill.server.ts",
    "audience": [],
    "content_hash": "b53e260469b18dce69d27a8b94392cea"
  },
  {
    "doc_key": "rule:filterUpcoming",
    "kind": "rule",
    "title": "Regra — filterUpcoming",
    "content": "Regra de ouro do calendário: nada que já aconteceu chega ao hóspede, e nada\ndistante demais (só a janela de hoje até +8 dias).\n- Itens de categoria \"evento\" só passam com data confirmada.\n- Um evento é válido enquanto (endDate ?? startDate) >= hoje e começa até hoje+8.\n- Itens perenes (restaurante, passeio, natureza…) não têm data e seguem válidos.",
    "source_path": "src/lib/city-news.functions.ts",
    "audience": [],
    "content_hash": "63746b66ab047ef3044711547e6e89a5"
  },
  {
    "doc_key": "rule:findArrivalPointers",
    "kind": "rule",
    "title": "Regra — findArrivalPointers",
    "content": "Busca, sem LLM e sem revelar conteúdo sensível, se o anfitrião já documentou um\nprocedimento de chegada para este imóvel — só para apontar o hóspede ao item certo\ndentro do guia, nunca para substituir a leitura dele.",
    "source_path": "src/lib/ai/guest-safety.server.ts",
    "audience": [],
    "content_hash": "959ce311a399bc1e994de8d50ade35f4"
  },
  {
    "doc_key": "rule:findLogsForReservation",
    "kind": "rule",
    "title": "Regra — findLogsForReservation",
    "content": "Retorna todos os logs que representam hóspedes da MESMA reserva iCal\n(primário + acompanhantes). Ordenados por prioridade (código HM bate mais\nforte que datas), o primeiro vira o hóspede exibido; os demais ficam como\nacompanhantes. Usada tanto pelo Kanban (buildArrivalRows) quanto pelo\nagregado de engajamento do Dashboard (getGuideEngagement) — é o que\ngarante que os dois concordem sobre QUAL hóspede pertence a qual reserva\n(antes, o Dashboard usava um casamento mais simples e podia atribuir a\nreserva a um hóspede diferente do que aparece no card do Kanban).",
    "source_path": "src/lib/arrival-board.server.ts",
    "audience": [],
    "content_hash": "b7f8fd330b0648e76c671e618b20c820"
  },
  {
    "doc_key": "rule:FirstVisitTour",
    "kind": "rule",
    "title": "Regra — FirstVisitTour",
    "content": "Tour de primeiro acesso: depois que o hóspede preenche seus dados pela\nprimeira vez para ESSA reserva (telefone+nome+data+imóvel), guiamos ele\naté o essencial — sem isso, muita gente nem descobria que \"Check-in\" tinha\numa aba de senhas dentro.\n\nPasso 1 aponta para o card \"Check-in\" (data-tour=\"checkin-card\").\nAssim que ele toca ali (o card abre), passo 2 aponta para a aba \"Senhas\"\ndentro do card (data-tour=\"senhas-tab\"). Ao tocar nela, o tour termina.\n\"Pular\" encerra a qualquer momento. Nunca reaparece na mesma reserva.",
    "source_path": "src/components/guide/FirstVisitTour.tsx",
    "audience": [],
    "content_hash": "d3274393c73139e4eeb07352e8f5ee34"
  },
  {
    "doc_key": "rule:freeProperties",
    "kind": "rule",
    "title": "Regra — freeProperties",
    "content": "Imóveis livres do dia aberto — exatamente o que o servidor calculou.\n\nAntes o cliente ainda subtraía `cleaningPendingPropIds` daqui (\"imóvel\ncom check-out pendente ou limpeza em andamento não é livre\"). Isso\nquebrava o indicador de duas formas ao mesmo tempo, e as duas foram\napontadas no pedido de 08/09/2026:\n\n 1. amarrava um número de DIA ao andamento dos checkouts/limpezas de\n HOJE — abrir outro dia no calendário mostrava um número contaminado\n pelo que está pendente agora;\n 2. respondia a outra pergunta. \"Livre\" aqui é \"não tem reserva com\n entrada nem estadia nesse dia\". Uma limpeza pendente não é uma\n reserva: o imóvel continua sem ninguém dentro e disponível para\n receber, que é a informação que a pessoa procura ao abrir o dia.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "a9d0454168bb05b3edfc06aa4287b769"
  },
  {
    "doc_key": "rule:getPropertyForQuickEdit",
    "kind": "rule",
    "title": "Regra — getPropertyForQuickEdit",
    "content": "Igual a getMyProperty, mas SEM assinar as URLs de imagem — deliberadamente.\nNÃO É MAIS USADA: existia para o antigo popup de edição rápida (removido —\no link \"Editar\" do imóvel em Stakeholders agora abre a mesma página\n/admin/properties/$id, em modo \"houseOnly\", em vez de duplicar a tela em\noutro componente). Mantida por ora por segurança, mas sem consumidores.",
    "source_path": "src/lib/properties.functions.ts",
    "audience": [],
    "content_hash": "dddb84bbce25db21cffe9f642035629d"
  },
  {
    "doc_key": "rule:getPropertyNotifiableUsers",
    "kind": "rule",
    "title": "Regra — getPropertyNotifiableUsers",
    "content": "Retorna user_ids que devem ser notificados quando um handoff acontece\nem uma dada propriedade: o owner + os account_members ativos com\npapel owner/agent (viewers não recebem push).",
    "source_path": "src/lib/handoff.server.ts",
    "audience": [],
    "content_hash": "2b8df4d1c9fba58293297d3049815e90"
  },
  {
    "doc_key": "rule:getTeamInviteLink",
    "kind": "rule",
    "title": "Regra — getTeamInviteLink",
    "content": "Gera um link direto de acesso para o convidado — usado quando o e-mail não\nchega (filtro de spam do provedor do destinatário). O titular copia e envia\npelo canal que preferir (WhatsApp, etc).",
    "source_path": "src/lib/team.functions.ts",
    "audience": [],
    "content_hash": "4dea2f26097fe9d43ecd94ee106f5d8c"
  },
  {
    "doc_key": "rule:GroupBy",
    "kind": "rule",
    "title": "Regra — GroupBy",
    "content": "ABA \"REGISTROS\" — mockup aprovado \"filtrado por dano, agrupado por imóvel\".\n\nO dado já era rico; o que faltava era a PORTA. Um registro só existia\ndentro do clipe de uma reserva: para achar qualquer coisa era preciso já\nsaber em qual reserva ela estava, e nenhuma pergunta transversal era\npossível (\"todos os danos\", \"os registros do Studio 101\").\n\nA tela tem DOIS andares:\n 1. CONTADORES por categoria, em duas linhas de três — a leitura\n estratégica (\"quantos e de quê\") e, ao mesmo tempo, o filtro. Mesmo\n cartão dos KPIs da tela Operacional (bg-card + ds-3d + ds-eyebrow).\n 2. Um CARTÃO POR IMÓVEL (ver `PropertyCard`): o que há para EXECUTAR em\n cima, em linhas com título legível; o acervo embaixo, em miniaturas.\n\nTodo o resto dos filtros — categoria, agrupar, período, proprietário e\nimóvel — mora no botão único ao lado do título. Nenhuma faixa horizontal\nde controles: foi ela que deixou as Pendências poluídas.\n\nSem recorte de período por padrão (pedido explícito): abre com o histórico\ninteiro e com o cartão \"TODOS\" selecionado.",
    "source_path": "src/components/dashboard/RecordsWorkspace.tsx",
    "audience": [],
    "content_hash": "511796e0b6bf4d633535de18f3657124"
  },
  {
    "doc_key": "rule:GuestMarkGroup",
    "kind": "rule",
    "title": "Regra — GuestMarkGroup",
    "content": "Mesma lógica dos cards: hóspede principal (1º a acessar) + \"+N\" expansível.\nLayout em \"linha-cartão\" com avatar de iniciais (redesign aprovado do\ntooltip de engajamento — Opção C: abas \"Viram\"/\"Não viram\" + linhas mais\nespaçadas).",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "4e5e1b4b39cbb858a2ef42978b4ce86d"
  },
  {
    "doc_key": "rule:handleSaveClick",
    "kind": "rule",
    "title": "Regra — handleSaveClick",
    "content": "\"Salvar alterações\": só dispara depois da confirmação explícita no\nAlertDialog — sem salvamento automático. Uma edição em massa aplica a\nMESMA alteração em vários guias de uma vez (SÓ os campos/listas\nrealmente editados neste popup; valores divergentes entre os guias\nviram vazio até a pessoa preencher — nunca ficam sobrescritos sem\nintenção), então merece um passo deliberado antes de gravar de verdade.",
    "source_path": "src/components/BulkEditDialog.tsx",
    "audience": [],
    "content_hash": "83aa804f205c1de49deeaea19ea26ede"
  },
  {
    "doc_key": "rule:handoffFallback",
    "kind": "rule",
    "title": "Regra — handoffFallback",
    "content": "A frase que substitui uma resposta parcial REPROVADA pelo validador numa\nescalação.\n\nO prompt manda responder parcialmente antes de escalar, e essa resposta\nparcial passou a ser validada como qualquer outra (ver orchestrator). Quando\nela não passa, o certo não é remendar o texto: é dizer pouco e verdadeiro.\nQuem continua a conversa é a pessoa que recebeu a escalação — o hóspede não\nprecisa saber disso, e por isso a frase não menciona transferência nem\nequipe (proibido pelo prompt).",
    "source_path": "src/lib/ai/confidence.ts",
    "audience": [],
    "content_hash": "44b23f348fb56e29bfdfa03f9f49f498"
  },
  {
    "doc_key": "rule:hasPendingOnboarding",
    "kind": "rule",
    "title": "Regra — hasPendingOnboarding",
    "content": "Checa (sem apagar) se o onboarding pós-formulário desta reserva ainda está\npendente. Diferente do antigo \"consome e apaga na hora\": aqui a flag\nSOBREVIVE a um refresh no meio do onboarding — o hóspede não consegue\nescapar pra página principal atualizando a tela enquanto não passar por\ntodas as etapas. Só quem apaga a flag é `clearPendingOnboarding`, chamada\nquando o hóspede realmente termina (qualquer um dos botões finais).",
    "source_path": "src/components/GuideAccessGate.tsx",
    "audience": [],
    "content_hash": "2dcd95af10c0c9277d0c95d8564c9d34"
  },
  {
    "doc_key": "rule:HISTORY_PAGE",
    "kind": "rule",
    "title": "Regra — HISTORY_PAGE",
    "content": "HISTÓRICO PERMANENTE (pedido explícito, 09/09/2026): \"o histórico COMPLETO\nda conversa do usuário com a IA precisa permanecer eternamente no chat —\ntodas as conversas, todas as decisões, tudo\".\n\nTrês coisas escondiam o passado, e nenhuma delas apagava nada — o que torna\na correção puramente de leitura:\n\n 1. A consulta lia UMA thread só (a mais recente). Tudo que veio antes de\n um \"nova conversa\" continuava no banco e sumia da tela.\n 2. Ela parava em 60 mensagens.\n 3. As ações CONFIRMADAS não viravam mensagem: o cartão sumia e, depois de\n recarregar, não havia registro nenhum de que aquilo tinha sido feito.\n O (3) está resolvido em `recordAssistantAction`, logo abaixo.\n\nAgora a leitura é por USUÁRIO, não por thread, e vem paginada do fim para o\ncomeço: a tela abre com as últimas `PAGE` mensagens e busca as anteriores\nconforme a pessoa sobe. Trazer dez mil mensagens de uma vez seria a única\nforma de \"mostrar tudo\" que trava o navegador — paginar é o que mantém a\npromessa de que nada some.\n\n`threadId` de cada mensagem vem junto para a interface desenhar a divisória\nde \"nova conversa\" onde ela existiu.",
    "source_path": "src/lib/assistant.functions.ts",
    "audience": [],
    "content_hash": "d320ff76de3a6a8eda05d230e31ecb66"
  },
  {
    "doc_key": "rule:HoraPrevista",
    "kind": "rule",
    "title": "Regra — HoraPrevista",
    "content": "Horário previsto de um card, e — igualmente importante — de ONDE ele veio\n(pedido explícito, 07/09/2026).\n\nDuas armadilhas moram aqui:\n\n 1. `guestArrivalTime` é o horário que o hóspede informou para a CHEGADA.\n Num card de checkout ele não diz nada sobre a saída. Usá-lo ali foi\n exatamente o bug que fez o checkout automático confirmar na hora\n errada (06/09/2026) — por isso a saída só olha para o override do card\n e, na falta dele, para o padrão do imóvel.\n\n 2. \"11h\" pode significar duas coisas muito diferentes: alguém informou 11h,\n ou ninguém informou nada e 11h é só o padrão do imóvel. Dizer \"todas às\n 11h\" no segundo caso afirma uma precisão que não existe — a resposta\n honesta é \"a partir das 11h\". Daí a origem viajar junto do valor, para\n o agente escolher a palavra certa em vez de adivinhar.",
    "source_path": "src/lib/ai/assistant-tools.server.ts",
    "audience": [],
    "content_hash": "7debd17936f90d854ee645fc0d381bcc"
  },
  {
    "doc_key": "rule:HOUSE_RULES_VERSION",
    "kind": "rule",
    "title": "Regra — HOUSE_RULES_VERSION",
    "content": "REGRAS DA CASA — o padrão único das IAs do ConciergeIA.\n\nPedido explícito (07/09/2026): \"tudo que eu falar sobre regras para a IA\nassistente deve valer também para a IA de atendimento e vice-versa\".\n\nAntes disso as mesmas regras existiam duas vezes, escritas de formas\ndiferentes: o prompt do atendimento já mandava usar `**negrito**` e\n`[texto](url)`, e a mesma orientação foi escrita de novo, com outras\npalavras, no assistente do painel. Duas cópias de uma regra não ficam iguais\npor muito tempo — uma é ajustada, a outra não, e as duas IAs passam a se\ncomportar de um jeito que ninguém decidiu.\n\nONDE ENTRA UMA REGRA NOVA\n\n · Vale para qualquer pessoa que converse com o sistema? Entra AQUI, e as\n duas IAs mudam juntas.\n · Só faz sentido para um dos públicos? Fica no prompt daquele agente —\n apontar uma tela do painel não significa nada para um hóspede, e o canal\n de senhas do guia não significa nada para um operador.\n\nAo mexer no texto abaixo, suba a versão: ela entra no hash de prompt gravado\nem `ai_agent_logs`, então uma resposta antiga continua rastreável até as\nregras que valiam quando ela foi dada.",
    "source_path": "src/lib/ai/house-rules.ts",
    "audience": [],
    "content_hash": "0a1d0997652211eb8af41faabb2c2f22"
  },
  {
    "doc_key": "rule:HouseFieldsInput",
    "kind": "rule",
    "title": "Regra — HouseFieldsInput",
    "content": "Campos obrigatórios da aba \"A casa\" (dados básicos do imóvel): tipo do\nimóvel, endereço completo e calendário do Airbnb. Compartilhado entre a\ntela \"Novo imóvel\", a trava de informações pendentes e o \"Salvar\" do editor\ncompleto (admin.properties.$id.tsx) — inclusive no modo \"houseOnly\" usado\npelo link \"Editar\" do imóvel em Stakeholders, já que é a MESMA tela (sem\npágina/componente duplicado) — sempre a mesma lista, em todo lugar que\nsalva o imóvel.\n\nProprietário é validado à parte (não é um campo de \"A casa\").",
    "source_path": "src/lib/property-house-fields.ts",
    "audience": [],
    "content_hash": "08a9c68d5f543af7930dd7d27abad25c"
  },
  {
    "doc_key": "rule:humanizeEventMessage",
    "kind": "rule",
    "title": "Regra — humanizeEventMessage",
    "content": "Reescreve uma mensagem de evento \"Cadastro atualizado — ...\" do formato\n bruto antigo pro formato objetivo atual. Mensagens que não batem com o\n padrão reconhecido (já no formato novo, ou de outro tipo de evento)\n voltam exatamente como vieram.",
    "source_path": "src/lib/stakeholder-event-message.ts",
    "audience": [],
    "content_hash": "0b895f93308ecf69916522d2fc66324f"
  },
  {
    "doc_key": "rule:InputSchema",
    "kind": "rule",
    "title": "Regra — InputSchema",
    "content": "Motor de dados da página Engajamento (visão gerencial multi-cliente).\n\nO DTO já vem consolidado — cliente só renderiza. Foco: tempo de permanência,\nprofundidade de leitura, atrito no chat, e ranking real de imóveis por\nengajamento (não apenas volume).",
    "source_path": "src/lib/engagement-analytics.functions.ts",
    "audience": [],
    "content_hash": "259251e76ccdf3c4b518c36cdb76c99e"
  },
  {
    "doc_key": "rule:InternalLink",
    "kind": "rule",
    "title": "Regra — InternalLink",
    "content": "Link para uma tela do próprio sistema (pedido explícito, 07/09/2026).\n\nA IA aponta caminhos escrevendo `[Kanban](/admin/dashboard/kanban)`, e o\nleitor deve poder clicar no NOME — sem o endereço aparecer na resposta e sem\numa linha extra de \"abrir tela\" embaixo.\n\nNavega pelo router em vez de deixar o `<a>` recarregar a página: um recarregamento\ncompleto aqui derrubaria o painel aberto e faria a pessoa perder a conversa\nno exato momento em que ela seguiu a orientação recebida.",
    "source_path": "src/components/ai/AiMarkdown.tsx",
    "audience": [],
    "content_hash": "ac7b00788b10556672931c7a9faaaf91"
  },
  {
    "doc_key": "rule:isExpired",
    "kind": "rule",
    "title": "Regra — isExpired",
    "content": "O acesso vale até as 15h do dia de checkout no fuso do imóvel. Quando o fuso\nnão é conhecido, damos 12h de tolerância para não expulsar um hóspede que\nestá navegando de outro fuso.",
    "source_path": "src/components/GuideAccessGate.tsx",
    "audience": [],
    "content_hash": "c8e37b8e68b965b3d8099f003d2eca5c"
  },
  {
    "doc_key": "rule:isoDateSaoPaulo",
    "kind": "rule",
    "title": "Regra — isoDateSaoPaulo",
    "content": "Data (YYYY-MM-DD) de um timestamp no fuso de São Paulo.\n\n`createdAt` vem em UTC. Cortar os 10 primeiros caracteres dava a data UTC —\ne uma pendência aberta às 22h daqui nasceria \"aberta há 1 dia\", porque em\nUTC já era o dia seguinte.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "11f231840136917937c3a2ea9d7f0b40"
  },
  {
    "doc_key": "rule:isTodayOrFutureDate",
    "kind": "rule",
    "title": "Regra — isTodayOrFutureDate",
    "content": "Data é hoje ou está no futuro (comparando por dia). Diferente de\n`isFutureDate` (que trata \"hoje\" como já chegado), esta é usada\nespecificamente para cancelamento agendado: o próprio dia marcado ainda\nprecisa contar como \"não passou\" — só deixa de ser true a partir do dia\nseguinte, quando o cancelamento passa a ser definitivo.",
    "source_path": "src/lib/stakeholder-status.ts",
    "audience": [],
    "content_hash": "3710e7eee0aea8a0539e618ee4f0bafd"
  },
  {
    "doc_key": "rule:KIND_ICON",
    "kind": "rule",
    "title": "Regra — KIND_ICON",
    "content": "O ÍCONE DO QUADRANTE — diz o TIPO do registro (foto, vídeo, áudio, nota,\narquivo).\n\nO quadrante NÃO mostra a mídia (pedido explícito, 10/09/2026). Chegou a\nmostrar: foto e vídeo viravam capa, áudio virava play, nota virava a letra\nT. Na tela real, com dezenas de miniaturas de origens diferentes, a tira\nvirou uma colcha de retalhos — e o vídeo ainda obrigava o navegador a\nbuscar o cabeçalho de cada arquivo só para pintar um quadro. O ícone é\ncalmo, é instantâneo e diz o que interessa na lista: que tipo de registro\né aquele. A MÍDIA abre no clique, no visualizador.",
    "source_path": "src/components/dashboard/RecordsWorkspace.tsx",
    "audience": [],
    "content_hash": "628e93f14244f27e9f80545470662d8b"
  },
  {
    "doc_key": "rule:KIND_WEIGHT",
    "kind": "rule",
    "title": "Regra — KIND_WEIGHT",
    "content": "Um trecho escrito à mão vale mais que um extraído do código, e uma regra de\nnegócio vale mais que a descrição de uma tela: quem pergunta \"por quê\"\nquer o racional, não o rótulo do menu.",
    "source_path": "src/lib/ai/system-knowledge.server.ts",
    "audience": [],
    "content_hash": "323ab523dae8275d4b429a8df47ce0b7"
  },
  {
    "doc_key": "rule:KnowledgeScope",
    "kind": "rule",
    "title": "Regra — KnowledgeScope",
    "content": "Fronteira de conhecimento (Tenant Knowledge Boundary):\n property → owner_portfolio → company_tenant → global\nUma informação nunca sobe além do escopo em que foi registrada.",
    "source_path": "src/lib/ai/tenant/context.server.ts",
    "audience": [],
    "content_hash": "dd8144a8f917a4a36baf67afe3f6b875"
  },
  {
    "doc_key": "rule:KnowledgeScopeType",
    "kind": "rule",
    "title": "Regra — KnowledgeScopeType",
    "content": "Knowledge Governance — hierarquia oficial de conhecimento do ConciergeIA.\n\nRegra de ouro: dados do imóvel NÃO são duplicados. `PROPERTY_DATA` continua\nsendo lido da tabela `properties` e suas filhas; as demais camadas apenas\ncomplementam com regras, memória e inteligência acumulada.",
    "source_path": "src/lib/ai/governance/scopes.ts",
    "audience": [],
    "content_hash": "9866940972979b69fae923168a51521c"
  },
  {
    "doc_key": "rule:LEGACY_PREFIX",
    "kind": "rule",
    "title": "Regra — LEGACY_PREFIX",
    "content": "Alguns eventos antigos da Linha do Tempo foram gravados no formato bruto\nde antes da reescrita de `diffPayload` (stakeholders.functions.ts):\n \"Cadastro atualizado — N informação(ões) alterada(s): Campo: \"A\" → \"B\"\"\nEsse texto já está gravado no banco — não temos acesso direto pra\nreescrever o histórico, e a mensagem é salva como texto puro no momento\nda edição (não guarda os valores estruturados de antes/depois). Por isso\na \"tradução\" pro formato objetivo acontece aqui, na hora de exibir,\nsem tocar no dado original: eventos novos já nascem no formato objetivo\n(gerado pelo servidor) e passam por aqui sem qualquer alteração; só os\nantigos, no formato bruto reconhecido, são reescritos na tela.",
    "source_path": "src/lib/stakeholder-event-message.ts",
    "audience": [],
    "content_hash": "955f61e0beb3bdaa91d837fce14a2c28"
  },
  {
    "doc_key": "rule:maskDigitsIfLocked",
    "kind": "rule",
    "title": "Regra — maskDigitsIfLocked",
    "content": "Textos operacionais (portão, fechadura, chegada) podem conter o código\nescrito no meio da frase. Quando o guia está protegido por senha, qualquer\nsequência numérica é removida ANTES de virar chunk — assim o RAG nunca\ndevolve um código que o hóspede ainda não liberou.",
    "source_path": "src/lib/ai/indexing.server.ts",
    "audience": [],
    "content_hash": "44b97639ca10a736f8228bdaa9cada84"
  },
  {
    "doc_key": "rule:MultiLinkPicker",
    "kind": "rule",
    "title": "Regra — MultiLinkPicker",
    "content": "Seleção MÚLTIPLA de vínculos (imóveis dentro do proprietário/prestador,\nprestadores dentro do imóvel). Antes cada vínculo exigia abrir o menu,\nclicar, esperar o salvamento e abrir de novo — agora marca-se tudo de uma\nvez e confirma numa ação só.\n\n`initialSelected` já vem marcado: o mesmo diálogo serve para adicionar e\nremover vínculos (o pai recebe a lista final e calcula a diferença).",
    "source_path": "src/components/stakeholders/MultiLinkPicker.tsx",
    "audience": [],
    "content_hash": "a727491096c8c6fce6c8786ad5675422"
  },
  {
    "doc_key": "rule:MultiSelectFilterField",
    "kind": "rule",
    "title": "Regra — MultiSelectFilterField",
    "content": "Campo de filtro com busca e múltipla seleção — pensado para viver dentro\nde um Popover de \"Filtros\" (como em Stakeholders) e ser reaproveitado nos\ndemais filtros do sistema, mantendo sempre a mesma dinâmica: rótulo do\ncampo, contagem de selecionados com atalho para limpar, busca e uma lista\ncom checkbox por opção.",
    "source_path": "src/components/ui/multi-select-filter.tsx",
    "audience": [],
    "content_hash": "3f23654d4e9d0b45a1f15fd12d93653e"
  },
  {
    "doc_key": "rule:NAME_COL_BASE",
    "kind": "rule",
    "title": "Regra — NAME_COL_BASE",
    "content": "Mobile: exatamente 5 dias inteiros no visor.\nDesktop: o máximo de dias inteiros que couber na largura do quadrante,\nsem nunca cortar a bolinha do último dia.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "9c4874ae6312d801e917341e534c4da1"
  },
  {
    "doc_key": "rule:newThread",
    "kind": "rule",
    "title": "Regra — newThread",
    "content": "Começa uma conversa nova SEM LIMPAR A TELA.\n\nAntes esta função zerava a lista e reescrevia o cache com `messages: []` —\no passado continuava no banco, mas desaparecia da vista, que na prática é\na mesma coisa para quem está olhando. Agora ela só troca a thread onde a\npróxima pergunta entra (o que serve para dar contexto limpo à IA) e\nrecarrega o histórico, que volta com tudo e uma divisória marcando o\nponto onde a conversa recomeçou.",
    "source_path": "src/components/assistant/AssistantPanel.tsx",
    "audience": [],
    "content_hash": "1cef1addc3cc42100e5e9ab5109b8360"
  },
  {
    "doc_key": "rule:nextCheckin",
    "kind": "rule",
    "title": "Regra — nextCheckin",
    "content": "JANELA DA LIMPEZA (pedido explícito, 09/09/2026) — só na Fila de Limpeza.\n\nNos outros cards, \"Permitido\" é a janela CONTRATUAL daquele lado\n(chegada ou saída). No card de limpeza essa frase não servia para nada:\nela dizia a janela de saída do hóspede que JÁ SAIU. O que a pessoa que vai\nlimpar precisa saber é outra coisa — de que horas até que horas o imóvel\nestá vazio:\n\n início = quando o hóspede sai → horário PREVISTO de saída se alguém\n informou um; senão o limite de checkout do imóvel;\n fim = quando o próximo entra → horário PREVISTO de chegada da próxima\n reserva se houver; senão o mínimo de check-in do imóvel.\n\nPrevisão informada sempre ganha do padrão: o padrão é o contrato, a\nprevisão é o que vai acontecer de verdade — e é sobre o que vai acontecer\nque se organiza uma limpeza.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "05648f5e16f9b4b754a224a426e7c93e"
  },
  {
    "doc_key": "rule:nextCheckinByProperty",
    "kind": "rule",
    "title": "Regra — nextCheckinByProperty",
    "content": "PRÓXIMA CHEGADA de cada imóvel — o outro lado da janela da limpeza.\n\nO card de limpeza é a linha de SAÍDA de uma estadia; quem entra depois é\nOUTRA reserva, que ele não conhece. Este mapa faz a ponte: para cada\nimóvel, a chegada mais próxima ainda pendente, com o horário PREVISTO\nquando alguém informou um.\n\nBase = `kanbanCiRowsAll` (chegadas com alcance \"all\", a mesma fonte que\nelege a próxima limpeza) e não a lista filtrada da tela — senão filtrar\npor \"Hoje\" apagaria a chegada de amanhã, que é justamente a que fecha a\njanela.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "1d7f05f7b8435e8d0a63d4041d66dacc"
  },
  {
    "doc_key": "rule:nextCleaningKeyByProperty",
    "kind": "rule",
    "title": "Regra — nextCleaningKeyByProperty",
    "content": "Qual card de limpeza é a PRÓXIMA limpeza de cada imóvel (pedido\nexplícito, 07/09/2026): as pendências abertas do imóvel são exibidas no\ncard da limpeza mais próxima, e só nele.\n\nIsto é CALCULADO a cada render, nunca gravado: se entrar uma reserva\nrepentina com limpeza pro dia 8, ela simplesmente passa a ser a mais\npróxima e as pendências aparecem lá — sem ninguém \"mover\" nada, sem\nrotina de correção, sem estado que possa ficar errado. Se essa limpeza\ndo dia 8 for cancelada, tudo volta pro dia 10 pelo mesmo caminho.\n\nA base é `kanbanCoRowsAll` (checkouts com alcance \"all\", ver a query\nacima) e NÃO a lista já filtrada por período/cidade/proprietário — senão\nfiltrar a tela por \"Hoje\" faria o sistema eleger a limpeza errada como\n\"próxima\". Só cards ainda não concluídos entram na disputa.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "d5418ec6488d6c103f452ea45dca235f"
  },
  {
    "doc_key": "rule:nextRecordName",
    "kind": "rule",
    "title": "Regra — nextRecordName",
    "content": "Próximo nome disponível para este imóvel. A contagem vem do banco, então\ndois envios simultâneos podem repetir o número — é rótulo, não chave, e\nrepetir é preferível a segurar o envio numa transação.\n\nConta SITUAÇÕES, não arquivos: as linhas principais são aquelas em que\n`id = group_id`, então uma situação com 4 fotos consome UM número. As três\nmídias extras herdam o nome da principal (ver `createRecordSituation`).",
    "source_path": "src/lib/reservation-records.functions.ts",
    "audience": [],
    "content_hash": "567222989a93b127cef6109bb24609dd"
  },
  {
    "doc_key": "rule:normalizeText",
    "kind": "rule",
    "title": "Regra — normalizeText",
    "content": "Preserva quebras de parágrafo (ex.: passo a passo de check-in) — só colapsa\nespaços/tabs redundantes dentro de cada linha, não achata tudo num bloco só.",
    "source_path": "src/lib/ai/indexing.server.ts",
    "audience": [],
    "content_hash": "75d80e82843db0378e9d38e60c3c64dd"
  },
  {
    "doc_key": "rule:OccupancyPanel",
    "kind": "rule",
    "title": "Regra — OccupancyPanel",
    "content": "Agenda macro: ocupação de todos os imóveis nos próximos dias.\n\nOs filtros de Período/Proprietário/Cidade não vivem mais aqui como\nbotões separados — viraram um botão único (`CalendarFiltersButton`, ao\nlado do título) dentro do cabeçalho deste painel. O ESTADO continua\nvivendo no OperationWorkspace (o pai), porque também precisa afetar os\ncards \"Limpezas Realizadas\"/\"Custo Total Limpeza\" (que são irmãos deste\npainel, na aba \"Limpeza\") — por isso os valores/opções e os callbacks de\nmudança chegam tudo via props. `properties` já chega FILTRADA.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "b9d2e597086f026243bb1c43e760fdbf"
  },
  {
    "doc_key": "rule:occupiedOnDay",
    "kind": "rule",
    "title": "Regra — occupiedOnDay",
    "content": "IMÓVEIS LIVRES DO DIA ABERTO (pedido explícito, 08/09/2026):\n\"ao abrir o dia, esse indicador já precisa mostrar QUANTOS imóveis não\ntêm reserva com entrada (ou estadia) naquele dia\".\n\nA conta é do DIA, e só do dia: um imóvel está ocupado quando alguma\nestadia ENTRA nele naquele dia ou ATRAVESSA aquele dia. O dia da saída\nnão conta como ocupado — o imóvel fica disponível para receber alguém.\nSe de fato entra alguém nesse mesmo dia (giro), a própria estadia nova\njá marca o imóvel como ocupado pela primeira condição.\n\nO que saiu daqui, e por quê: havia um relógio de parede fixo em 11h\n(America/Sao_Paulo) que segurava o imóvel como \"ocupado\" até aquela\nhora no dia do checkout. Isso amarrava um indicador de DIA ao HORÁRIO\ndos checkouts pendentes — abrir um dia e ver o número mudar sozinho às\n11h, ou ver um imóvel como ocupado depois de o hóspede já ter saído às\n9h. Um número por dia não pode depender de que horas são.",
    "source_path": "src/lib/dashboard.functions.ts",
    "audience": [],
    "content_hash": "e668d0cb202c0a9275b5fcfee24d5f43"
  },
  {
    "doc_key": "rule:onGuestAudio",
    "kind": "rule",
    "title": "Regra — onGuestAudio",
    "content": "Áudio do hóspede (07/09/2026).\n\nFalando com a IA, o áudio é transcrito e o TEXTO é enviado como uma\nmensagem qualquer — a IA responde com o contexto de sempre, sem saber que\nveio de voz. Antes disso o microfone só existia no atendimento humano, e\nmesmo lá o áudio virava um anexo que a IA nunca ouvia: quem falava com ela\nmandava uma mensagem vazia.\n\nNo atendimento humano o comportamento antigo continua: quem está do outro\nlado é uma pessoa, e ouvir a voz do hóspede — o tom, a pressa — diz coisas\nque a transcrição perde.",
    "source_path": "src/components/GuideAiChat.tsx",
    "audience": [],
    "content_hash": "2395946079ad4fe4ac673dfb72ddccda"
  },
  {
    "doc_key": "rule:onRecorded",
    "kind": "rule",
    "title": "Regra — onRecorded",
    "content": "Áudio vira texto e segue como qualquer pergunta digitada — inclusive o\ncartão de confirmação, quando é um pedido de ação. Falar é outra forma de\nescrever, não um segundo caminho com regras próprias.",
    "source_path": "src/components/assistant/AssistantPanel.tsx",
    "audience": [],
    "content_hash": "4d19f38c974bfc49a8cba94305612c3b"
  },
  {
    "doc_key": "rule:OVERLAY_COLLISION_PADDING",
    "kind": "rule",
    "title": "Regra — OVERLAY_COLLISION_PADDING",
    "content": "REGRA GLOBAL DE ABERTURA DE TOOLTIPS, POPOVERS E MENUS.\n\nPedido explícito (08/09/2026): \"nenhum tooltip/quadrante pode ser aberto para\no lado que estiver mais propício a ficar escondido — se houver qualquer\nchance, então a abertura tem que ser para o lado oposto\".\n\nO Radix já vira o painel para o lado oposto sozinho quando não cabe. O que\nele não sabe é que a tela NÃO termina onde o viewport termina: o app tem uma\nbarra de navegação fixa embaixo e um cabeçalho fixo em cima, e os dois ficam\nPOR CIMA de qualquer painel. Para o Radix havia espaço; para os olhos, o\ncalendário abria por baixo da barra e ficava cortado (caso real: o seletor de\ndata prevista, aberto num card do fim da lista).\n\nA correção é contar essas faixas como se fossem borda da tela. Com elas na\nconta, \"não cabe embaixo\" passa a ser verdade antes de o painel encostar na\nbarra — e o Radix abre para cima, que é exatamente a regra pedida.\n\nOs valores são folgados de propósito. Errar para o lado de virar cedo demais\ncusta um painel abrindo para cima sem precisar; errar para o outro lado custa\num painel ilegível.",
    "source_path": "src/components/ui/overlay-collision.ts",
    "audience": [],
    "content_hash": "4fb6d297dbb127283bd87636f544fec2"
  },
  {
    "doc_key": "rule:own",
    "kind": "rule",
    "title": "Regra — own",
    "content": "A linha DAQUELE lado, quando ela existe. Quando NÃO existe (a coluna\nde Checkouts pode estar vazia, por exemplo), caímos na linha do card\nsó para as informações da RESERVA e do IMÓVEL — datas confirmadas,\nhorários padrão, identificadores. Nunca para a previsão.\n\nBug real, corrigido em 08/09/2026: sem essa distinção, abrir o\neditor num card de chegada mostrava a data e a hora da CHEGADA também\nno bloco \"Saída\", porque o fallback era a própria linha de chegada e\nela carrega o override dela. Ficava parecendo que uma previsão tinha\nsido copiada para a outra — e bastaria confirmar para que virasse\nverdade no banco.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "41de04fe58496c5c97ddd80d912e025f"
  },
  {
    "doc_key": "rule:PageHeader",
    "kind": "rule",
    "title": "Regra — PageHeader",
    "content": "Cabeçalho padrão de página do Sistema de Design.\n- Page Title: Sora 700 22px\n- Page Subtitle: Manrope 400 13px (muted)\n- Ações à direita, nunca quebrando em 2ª linha (rolagem horizontal no mobile)\n- 40px de respiro até o primeiro conteúdo",
    "source_path": "src/components/ds/PageHeader.tsx",
    "audience": [],
    "content_hash": "ffaf52c027cb534edf3565ba11b98e42"
  },
  {
    "doc_key": "rule:parseGuestSummary",
    "kind": "rule",
    "title": "Regra — parseGuestSummary",
    "content": "Extrai os quatro números do subtítulo \"7 hóspedes · 3 quartos · 4 camas ·\n 2 banheiros\" (aceita separadores variados e \"studio\"/\"sem quarto\" como 0\n quartos). Cada número fica null se aquele item não aparecer no texto.",
    "source_path": "src/lib/airbnb.functions.ts",
    "audience": [],
    "content_hash": "7af0fc321dd9f88de0f5b7f2156247e0"
  },
  {
    "doc_key": "rule:parseISODateLocal",
    "kind": "rule",
    "title": "Regra — parseISODateLocal",
    "content": "ISO \"YYYY-MM-DD\" → Date ao meio-dia LOCAL (não UTC) — evita cair no dia\nerrado perto da meia-noite dependendo do fuso do navegador. Mesma\nconvenção já usada alhures neste arquivo (ex.: `${row.date}T12:00:00`).",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "f35bf384dbc8476068735e46ff6c7bb5"
  },
  {
    "doc_key": "rule:PayerKind",
    "kind": "rule",
    "title": "Regra — PayerKind",
    "content": "DIÁLOGO DE RESOLUÇÃO (pedido explícito, 10/09/2026).\n\nFechar uma pendência levanta duas perguntas que a operação sempre faz\ndepois, quando já esqueceu a resposta: HOUVE CUSTO? e QUEM PAGA? Perguntar\nno momento em que se resolve é o único jeito de ter isso preenchido.\n\n\"Quem paga\" NÃO é \"quem resolveu\" — o prestador conserta, mas a conta pode\nir para o proprietário ou ficar com a empresa. São duas colunas separadas\nem `tasks` (`cost_payer` / `cost_payer_id` e `resolved_by_provider_id`).\n\nTudo é opcional: dá para resolver sem informar nada, como antes.",
    "source_path": "src/components/dashboard/RecordsWorkspace.tsx",
    "audience": [],
    "content_hash": "fd01a58493176eaa4dec1255ff1882bb"
  },
  {
    "doc_key": "rule:PENDING_CATEGORIES",
    "kind": "rule",
    "title": "Regra — PENDING_CATEGORIES",
    "content": "O QUE SOBE PARA \"A RESOLVER\" (pedido explícito, 10/09/2026): DANO e\nMANUTENÇÃO. Objeto esquecido também abre pendência no Kanban, mas ficou\nde fora daqui — é devolução, não conserto; continua no acervo e na tela de\nPendências. Para incluí-lo, basta acrescentar \"forgotten\" nesta lista.\nAuditoria de limpeza nunca gera tarefa: é prova, não trabalho.",
    "source_path": "src/components/dashboard/RecordsWorkspace.tsx",
    "audience": [],
    "content_hash": "720cb79ebe32956b8c460816124906fd"
  },
  {
    "doc_key": "rule:PendingAttachment",
    "kind": "rule",
    "title": "Regra — PendingAttachment",
    "content": "Anexos de PENDÊNCIA (pedido explícito, 07/09/2026) — os mesmos quatro\nbotões dos registros da reserva, reaproveitados na criação de uma\npendência e na comprovação da resolução.\n\nDiferença importante em relação aos registros de reserva: aqui os\narquivos ficam RETIDOS EM MEMÓRIA até a ação principal terminar. Na\ncriação, a pendência ainda não existe (não há id pra vincular); na\nconclusão, o envio só faz sentido se a conclusão de fato for gravada.\nPor isso o fluxo é: escolher arquivos → salvar/concluir → só então subir\nos anexos (ver `uploadPendingAttachments`). Nada de arquivo órfão no\nstorage quando a pessoa desiste no meio.\n\nTambém não há seletor de categoria aqui: a categoria de um anexo de\npendência é a da própria pendência — perguntar de novo seria fricção à\ntoa.",
    "source_path": "src/components/dashboard/TaskAttachments.tsx",
    "audience": [],
    "content_hash": "b217301f9e76ab67b8cc8245fd323cea"
  },
  {
    "doc_key": "rule:PendingRow",
    "kind": "rule",
    "title": "Regra — PendingRow",
    "content": "Uma pendência do cartão: miniatura, título legível, data — e, ABAIXO DA\nDATA, o quadradinho que resolve (pedido explícito, 10/09/2026).\n\nA linha deixou de ser um botão só: um checkbox dentro de um botão não é\nclicável de forma previsível (nem é HTML válido). Agora são dois alvos\nlado a lado — o corpo abre o registro, o quadradinho abre a resolução.",
    "source_path": "src/components/dashboard/RecordsWorkspace.tsx",
    "audience": [],
    "content_hash": "b6caeac52c7bb668e7f81507b5f92e5a"
  },
  {
    "doc_key": "rule:PER_PROPERTY_FIELDS",
    "kind": "rule",
    "title": "Regra — PER_PROPERTY_FIELDS",
    "content": "Campos que são EXCLUSIVOS de cada residência (senhas, Wi-Fi, endereço, links\nde mapa). Aplicá-los em vários guias de uma vez faria um imóvel receber o\ncódigo de outro — por isso são bloqueados quando há mais de um selecionado.",
    "source_path": "src/lib/properties.functions.ts",
    "audience": [],
    "content_hash": "572d994cd4cf545f5b4b3d76419d0a86"
  },
  {
    "doc_key": "rule:PERMISSION_FEATURE",
    "kind": "rule",
    "title": "Regra — PERMISSION_FEATURE",
    "content": "Mapa permissão → feature do plano. Quando a feature não está presente no\nplano do dono, o toggle é ocultado/desabilitado e o servidor recusa gravar.\nPermissões sem mapeamento (null) são liberadas em qualquer plano.",
    "source_path": "src/lib/member-permissions.functions.ts",
    "audience": [],
    "content_hash": "3577b78cfb9e8a17b01a46b8b152349e"
  },
  {
    "doc_key": "rule:PERMISSIONABLE_ROUTE_PREFIXES",
    "kind": "rule",
    "title": "Regra — PERMISSIONABLE_ROUTE_PREFIXES",
    "content": "ALLOWLIST — apenas estas famílias de rota geram recursos permissionáveis.\nTodo o resto (marketing, autenticação, legal, landing, guia público de\nleitura, APIs) é catalogado como NÃO permissionável.",
    "source_path": "src/lib/permissions/permission.slugs.ts",
    "audience": [],
    "content_hash": "3bc47737bee0a4254d101a097576b13a"
  },
  {
    "doc_key": "rule:PermissionGate",
    "kind": "rule",
    "title": "Regra — PermissionGate",
    "content": "`<PermissionGate>` — exibe o conteúdo apenas quando o backend autoriza.\n\nEstado seguro por construção: durante o carregamento ou em caso de falha\nna verificação, o conteúdo protegido NÃO é renderizado.",
    "source_path": "src/lib/permissions/PermissionGate.tsx",
    "audience": [],
    "content_hash": "abf882f0e67f7caefaf481ef6ee7a63c"
  },
  {
    "doc_key": "rule:PhoneActionButton",
    "kind": "rule",
    "title": "Regra — PhoneActionButton",
    "content": "Botão único e padronizado para telefones em todo o app: ícone verde de\nmensagem que abre as opções \"WhatsApp\" e \"Copiar\". Nunca exibe o número.",
    "source_path": "src/components/PhoneActionButton.tsx",
    "audience": [],
    "content_hash": "d3b7ef85e34907c66fd245f5482bc138"
  },
  {
    "doc_key": "rule:PlanKey",
    "kind": "rule",
    "title": "Regra — PlanKey",
    "content": "Feature Access — gating por plano do SaaS.\n\nFASE 1: estrutura apenas. NÃO integra com billing e NÃO altera nenhuma\nregra atual de plano (`plan-guard.server.ts` continua sendo a fonte em uso).",
    "source_path": "src/lib/permissions/feature.access.ts",
    "audience": [],
    "content_hash": "ac3b24999636d5bba4bcaafa627526f7"
  },
  {
    "doc_key": "rule:postResponses",
    "kind": "rule",
    "title": "Regra — postResponses",
    "content": "`onTextDelta` repassa cada pedaço de texto ASSIM QUE ELE CHEGA.\n\nOs eventos já chegavam — `response.output_text.delta`, token a token — e\neram jogados num buffer que só era lido no fim. Era exatamente por isso que\na resposta parecia lenta comparada ao ChatGPT: não é que lá o modelo seja\nmais rápido, é que lá a primeira palavra aparece em ~300ms e continua\nsaindo, enquanto aqui a tela ficava vários segundos em branco e depois\ndespejava o texto pronto. Mesmo tempo total, percepção oposta.\n\nO callback nunca pode derrubar a chamada: quem escuta é uma conexão SSE que\npode cair no meio (o hóspede fecha a aba). Por isso o try/catch mudo.",
    "source_path": "src/lib/ai/gateway.server.ts",
    "audience": [],
    "content_hash": "7b894cf3043849af7809df9e34a4754c"
  },
  {
    "doc_key": "rule:predictionDayLabel",
    "kind": "rule",
    "title": "Regra — predictionDayLabel",
    "content": "O DIA da previsão, em palavra quando dá — \"hoje\", \"amanhã\", \"ontem\" — e na\ndata cheia quando não dá.\n\nExiste porque um horário sozinho é ambíguo: \"20:00\" de que dia? A previsão\ntem data própria (`arrival_date_override`), separada do horário, e ela pode\ncair num dia diferente do da reserva — o hóspede avisa que só chega amanhã,\na saída é antecipada. Sem esta linha, o card mostraria um horário sem dizer\nde quando ele é.\n\nPedido explícito (08/09/2026): quando é HOJE — o caso da maioria dos cards —\na palavra fica apagada, porque uma informação que se repete em quinze cards\nseguidos deixa de ser lida. Qualquer outro dia ganha destaque, e um dia que\njá passou fica vermelho: é exceção, e é o que precisa ser visto.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "cde06f233f84f524d3aaf701761567af"
  },
  {
    "doc_key": "rule:PredictionSide",
    "kind": "rule",
    "title": "Regra — PredictionSide",
    "content": "O EDITOR DE PREVISÃO — data e horário, dos DOIS lados da estadia.\n\nPedido explícito (08/09/2026): \"o usuário precisa conseguir editar a data +\nhorário da previsão (tanto de checkin quanto de checkout)... e essas duas\ninformações não podem conflitar... porém, cada informação deve ser mostrada\nno status correto\".\n\nCOMO AS DUAS CONVIVEM SEM CONFLITAR\n\nElas nunca disputam o mesmo campo: `guest_arrival_status` guarda UMA LINHA\nPOR LADO da estadia (`kind` \"checkin\" e \"checkout\"), e cada linha tem o seu\npróprio `arrival_date_override` e `arrival_time_override`. São registros\ndiferentes da mesma reserva. A leitura já é filtrada por lado — a lista de\nchegadas não enxerga a linha de saída — então \"cada uma aparece no status\ncerto\" é consequência do modelo, não de uma regra de tela.\n\nPOR QUE O TOOLTIP TEM OS DOIS, SE O CARD MOSTRA UM\n\nPorque quem opera costuma saber os dois de uma vez (\"chego dia 8 às 20h e\nsaio dia 14 às 8h\"), e o card onde ele está só oferece um. Sem o segundo\nbloco, registrar a saída exigiria esperar o card mudar de coluna, ou abrir o\nhistórico — dois caminhos mais longos para o caso mais comum. Então: o lado\ndo card vem aberto, o outro fica numa linha recolhida a um clique. Quem só\nsabe um lado nem percebe que o outro está ali.\n\nA MECÂNICA DE CADA BLOCO NÃO MUDOU (regra do projeto: não mexer na estrutura\ndos tooltips). Continua sendo data + horário no MESMO popover, com o commit\nacontecendo só quando o popover inteiro fecha — nunca no meio da escolha da\ndata, senão o card se move antes de a pessoa conseguir ajustar o horário\n(bug real corrigido em 05/09/2026). O que existe agora são DOIS desses\nblocos, não um bloco diferente.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "9214a9eb138c4f18d96cd25f17527859"
  },
  {
    "doc_key": "rule:predKind",
    "kind": "rule",
    "title": "Regra — predKind",
    "content": "A previsão que a coluna mostra é a do que vem A SEGUIR — não a do lado\nde onde a lista veio. \"Em Estadia\" é o caso que revela a diferença: o\ncard sai da lista de chegadas, mas a chegada já aconteceu; o que falta\nprever ali é a saída.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "a3f929b66db18b667b0c0ce1749f9e68"
  },
  {
    "doc_key": "rule:ProactiveAutonomy",
    "kind": "rule",
    "title": "Regra — ProactiveAutonomy",
    "content": "Proactive Rules Engine — regras declarativas de antecipação.\n\nCada regra define o gatilho, a ação recomendada e o LIMITE DE AUTONOMIA:\n low → executa automaticamente\n medium → executa após validação humana\n high → sempre exige humano",
    "source_path": "src/lib/ai/agents/proactive/rules.ts",
    "audience": [],
    "content_hash": "562deeb16089ca5cb76577d8936f84c7"
  },
  {
    "doc_key": "rule:PropertyCard",
    "kind": "rule",
    "title": "Regra — PropertyCard",
    "content": "O CARTÃO DO IMÓVEL EM DOIS ANDARES (mockup B, aprovado 10/09/2026).\n\nAntes era uma fileira de quadrados cinzentos com um ponto de 6px: um dano\nsem conserto e uma foto de auditoria eram visualmente o mesmo quadrado. O\ncartão passa a admitir que há duas naturezas ali dentro —\n\n A RESOLVER o que abriu pendência e ela ainda está de pé (dano,\n manutenção, objeto esquecido). Vira LINHA, com título\n legível, porque é trabalho e trabalho precisa de nome.\n REGISTROS o resto. Continua miniatura, porque é prova.\n\nSem nada em aberto o primeiro andar não existe e o cartão fica igual ao de\nantes — a mesma regra de sempre: o aviso só aparece quando há aviso.",
    "source_path": "src/components/dashboard/RecordsWorkspace.tsx",
    "audience": [],
    "content_hash": "72837b77a75bd1a28f3d2fa466a2fb29"
  },
  {
    "doc_key": "rule:propertyCityById",
    "kind": "rule",
    "title": "Regra — propertyCityById",
    "content": "Listas do Kanban, filtradas pelo botão \"Filtros\" (Período/Cidade/\nProprietário) — ver kanbanCheckinListQ/kanbanCheckoutListQ acima.\n`cleaningPendingPropIds` (bloqueio de check-in) continua vindo do\n`coRows`/`stayRows` de HOJE, de propósito: reflete o estado ATUAL do\nimóvel, não deve mudar só porque a pessoa navegou pra outro período no\nKanban.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "d836f92dfc9b771a74094215ed3616ad"
  },
  {
    "doc_key": "rule:RATE_WINDOW_MS",
    "kind": "rule",
    "title": "Regra — RATE_WINDOW_MS",
    "content": "Freio simples por origem: o endpoint é público (o hóspede não tem login),\nentão limitamos a quantidade de lotes por minuto para que ninguém consiga\ninflar a trilha de auditoria.",
    "source_path": "src/lib/trail.functions.ts",
    "audience": [],
    "content_hash": "7165923d3017b91ea79fb6a16843344d"
  },
  {
    "doc_key": "rule:ReasoningEffort",
    "kind": "rule",
    "title": "Regra — ReasoningEffort",
    "content": "Quanto a IA pensa antes de responder — política única das duas IAs.\n\nPedido explícito (07/09/2026): \"quero que ela seja altamente inteligente,\ncomo se o usuário estivesse conversando com o ChatGPT, com o Gemini\".\n\nO QUE ESTAVA ERRADO\n\nOs dois agentes rodavam com `reasoningEffort: \"low\"` em praticamente toda\nconversa — o atendimento só subia para \"medium\" quando a mensagem era urgente\nou arriscada, e o assistente do painel estava fixo em \"low\". Num modelo de\nraciocínio, \"low\" não é uma economia inofensiva: é a diferença entre pensar\nno problema e responder de bate-pronto. Era o que fazia as respostas\nparecerem rasas mesmo com todo o contexto certo na mão — não faltava\ninformação, faltava pensar.\n\nO QUE MUDA\n\nO esforço passa a depender do que foi PERGUNTADO, e não só de urgência:\n\n · alto — a pessoa pediu comparação, recomendação, um porquê, um plano,\n ou mandou um texto longo com várias perguntas juntas. É o tipo\n de resposta que só fica boa se o modelo pensar antes.\n · médio — o padrão de qualquer conversa de verdade. Vale também para todo\n pedido de AÇÃO: gravar a coisa errada custa mais caro do que os\n segundos a mais de raciocínio.\n · baixo — só o que é genuinamente trivial: saudação, \"ok\", \"obrigado\",\n uma confirmação de uma linha.\n\nO CUSTO, DITO NA CARA\n\nPensar mais custa mais tempo e mais tokens. A escolha aqui é deliberada:\npagar isso nas perguntas que merecem e não pagar nas que não merecem — em\nvez de economizar em todas, que era o comportamento anterior e o motivo da\nreclamação.",
    "source_path": "src/lib/ai/reasoning.ts",
    "audience": [],
    "content_hash": "d0e0dc85d2d00b3333b56e00d4fb8d64"
  },
  {
    "doc_key": "rule:reasoningFor",
    "kind": "rule",
    "title": "Regra — reasoningFor",
    "content": "Decide o esforço para uma mensagem.\n\n`isAction` cobre o caso em que a pessoa está mandando o sistema FAZER algo\n(criar pendência, marcar não comparecimento): ali o piso é médio mesmo que a\nfrase seja curta, porque interpretar errado grava dado errado.",
    "source_path": "src/lib/ai/reasoning.ts",
    "audience": [],
    "content_hash": "21463f078baac3321475523c21c8b704"
  },
  {
    "doc_key": "rule:RECORD_TITLE_MAX",
    "kind": "rule",
    "title": "Regra — RECORD_TITLE_MAX",
    "content": "TÍTULO + DESCRIÇÃO em um campo só.\n\nO banco tem `body` e mais nada. A regra da casa (10/09/2026) é que todo\nregistro tenha um título curto e uma descrição, e a página principal mostre\no TÍTULO — nunca o nome do arquivo. Guardamos os dois no mesmo `body`, com\no título na primeira linha, que é exatamente como a leitura já funciona.",
    "source_path": "src/lib/reservation-records.functions.ts",
    "audience": [],
    "content_hash": "df641bb81f7c32ac1675b5782d443770"
  },
  {
    "doc_key": "rule:recordAssistantAction",
    "kind": "rule",
    "title": "Regra — recordAssistantAction",
    "content": "Registra no histórico que uma ação foi EXECUTADA.\n\nSem isto, \"todas as decisões\" não se sustentava: o cartão de confirmação era\num objeto de tela: sumia ao confirmar e não deixava rastro nenhum na\nconversa. Depois de recarregar, a pergunta \"isso chegou a ser feito?\" não\ntinha resposta ali dentro — e com a confirmação automática ligada nem cartão\nexiste para ver.\n\nVira uma mensagem do assistente com `meta.executedAction`, na mesma thread.\nFica no histórico como qualquer outra, para sempre.",
    "source_path": "src/lib/assistant.functions.ts",
    "audience": [],
    "content_hash": "20ddcef6f60560e7ea8f0e5b6257eef1"
  },
  {
    "doc_key": "rule:RecordsFiltersButton",
    "kind": "rule",
    "title": "Regra — RecordsFiltersButton",
    "content": "FILTRO ÚNICO (pedido explícito): os dois seletores que viviam soltos abaixo\ndos contadores — agrupar e período — mudaram-se para DENTRO deste botão,\njunto com proprietário e imóvel. Uma faixa horizontal inteira de controles\nsome da tela, e o lugar do filtro passa a ser o mesmo das outras páginas:\no quadrado ao lado do título.\n\nA mecânica é a MESMA do `CalendarFiltersButton`: um resumo com uma linha\npor filtro (rótulo à esquerda, valor atual à direita) e uma tela interna\npara cada um, com \"voltar\" no topo. Nada de menu-dentro-de-menu.",
    "source_path": "src/components/dashboard/RecordsWorkspace.tsx",
    "audience": [],
    "content_hash": "640ff124c5e3c649ef223f4f69769c0c"
  },
  {
    "doc_key": "rule:RecordTextEditor",
    "kind": "rule",
    "title": "Regra — RecordTextEditor",
    "content": "EDITAR O TEXTO DE UM REGISTRO JÁ GRAVADO.\n\nDecisão do cliente (10/09/2026): \"pode manter 'Sem título informado', mas\ncom a possibilidade do usuário/prestador editar posteriormente\". Os mesmos\ndois campos da folha da situação, com o mesmo microfone — quem registrou\nfalando não tem por que ter de digitar para corrigir.",
    "source_path": "src/components/dashboard/RecordsWorkspace.tsx",
    "audience": [],
    "content_hash": "2946b906bda28e9b1f75ac33d5ac658e"
  },
  {
    "doc_key": "rule:refreshStaleAirbnbListings",
    "kind": "rule",
    "title": "Regra — refreshStaleAirbnbListings",
    "content": "Compara o anúncio público (via Firecrawl) com o que está salvo e aplica\n só o que de fato mudou. Chamada uma vez por dia por\n `/api/public/cron/refresh-airbnb-listings` (agendado no pg_cron — ver\n migration correspondente) — mesmo mecanismo de leitura do botão manual\n \"Importar\" (scrapeAirbnbListing), só que percorrendo sozinho todos os\n imóveis com um link do Airbnb cadastrado, dos menos verificados\n recentemente pra frente, e aplicando a mudança direto (sem precisar de\n alguém clicar \"Salvar\"). Cada imóvel grava seu próprio horário/erro da\n última tentativa em `airbnb_listing_last_synced_at`/`_last_error`, e um\n resumo em português do que mudou em `airbnb_listing_last_sync_note`\n (nulo quando a checagem não achou nada novo).\n\n Também compara, campo a campo, o resultado de hoje com o que já estava\n salvo: se um campo que tinha conteúdo (principalmente os \"ampliados\",\n que dependem de cliques simulados em botões que o Airbnb pode mudar sem\n aviso — ver AIRBNB_EXPAND_ACTIONS) vier vazio numa leitura que não deu\n erro, isso é registrado como possível falha silenciosa. No fim da\n varredura, se algum imóvel apresentou isso, um único push é enviado aos\n admins do SaaS (notifySaasAdmins) resumindo o que sumiu — pedido do\n cliente em 03/09/2026 pra não deixar essas quebras passarem batido.",
    "source_path": "src/lib/airbnb.functions.ts",
    "audience": [],
    "content_hash": "64c0ef8e90979566cdb9350608f54067"
  },
  {
    "doc_key": "rule:requireAccess",
    "kind": "rule",
    "title": "Regra — requireAccess",
    "content": "`requireAccess` — valida e lança `PermissionEnforcementError` quando negado.\nPonto obrigatório de entrada de qualquer operação protegida do backend.",
    "source_path": "src/lib/permissions/permission.enforce.server.ts",
    "audience": [],
    "content_hash": "7c028baaf21a7715c3cd4284a0d953f2"
  },
  {
    "doc_key": "rule:resolveAccessPinWindow",
    "kind": "rule",
    "title": "Regra — resolveAccessPinWindow",
    "content": "Verifica se \"agora\" está dentro da janela [check-in - 24h, check-out] de\nQUALQUER reserva vigente/próxima da propriedade (o PIN é único por imóvel,\ncompartilhado com quem quer que seja o hóspede atual — não há, neste\ncaminho, identificação de qual hóspede está acessando).",
    "source_path": "src/lib/access-pin-window.server.ts",
    "audience": [],
    "content_hash": "2609d73eee708157058d5f5975617b5e"
  },
  {
    "doc_key": "rule:resolveEffectivePlan",
    "kind": "rule",
    "title": "Regra — resolveEffectivePlan",
    "content": "Resolve o plano EFETIVO para uma operação. Diferente de `resolveUserPlan`\n(que sempre olha a assinatura do próprio caller), este helper considera o\ncontexto da operação:\n\n - Se `ownerId` (ou `propertyId`) apontar para outra conta e o caller for\n membro ativo dessa conta, retornamos o plano do DONO daquela conta.\n - Caso contrário, retornamos o plano do próprio caller.\n\nIsso garante que membros convidados operem sob o plano da conta\n(Enterprise / Business / Pro) — nunca caindo em Free silenciosamente.",
    "source_path": "src/lib/plan-guard.server.ts",
    "audience": [],
    "content_hash": "45409f955af44f7dfff10b79ad52b439"
  },
  {
    "doc_key": "rule:resolveProfileOwnerId",
    "kind": "rule",
    "title": "Regra — resolveProfileOwnerId",
    "content": "Perfil pessoal: nunca herda a conta por vínculo implícito de equipe.\nSó usa outro titular quando explicitamente solicitado (impersonação) e autorizado.",
    "source_path": "src/lib/account-scope.server.ts",
    "audience": [],
    "content_hash": "278ccadef654cab57bea75a8bba7c7eb"
  },
  {
    "doc_key": "rule:resolveReservationTarget",
    "kind": "rule",
    "title": "Regra — resolveReservationTarget",
    "content": "Mesmo critério de statusTarget/resolveTarget (advanceArrival, markNoShow,\nauto-checkout): `logId` só é um UUID real quando não é o placeholder\n\"ical:<reservation_id>\" usado por reservas só-iCal.",
    "source_path": "src/components/dashboard/ReservationRecords.tsx",
    "audience": [],
    "content_hash": "3b9d584bced33dc8cbc4df70c9c8b03d"
  },
  {
    "doc_key": "rule:resolveTarget",
    "kind": "rule",
    "title": "Regra — resolveTarget",
    "content": "Resolve `logId`/`reservationId` pro formato que `runAdvanceArrival` espera\na partir de um `ArrivalRow`. Mesmo critério de `statusTarget` (em\n`OperationWorkspace.tsx`): `logId` só é aceito quando é um UUID real de\n`guide_access_logs` — uma reserva só-iCal (sem log/formulário do hóspede)\nusa o prefixo sintético \"ical:<reservation_id>\" no lugar de um log de\nverdade, e nesse caso é o `reservation_id` embutido que deve ser usado.",
    "source_path": "src/lib/auto-checkout.server.ts",
    "audience": [],
    "content_hash": "fe2e5ad544b27a3d48da06b869ebd467"
  },
  {
    "doc_key": "rule:rowByStay",
    "kind": "rule",
    "title": "Regra — rowByStay",
    "content": "As linhas das duas esteiras indexadas pela ESTADIA, para um card de um\nlado conseguir alcançar a previsão do outro.\n\nA chave `reservationId ?? logId` é a mesma que o resto do quadro já usa\npara casar card com card. Ela é necessária porque o card de \"Em Estadia\"\nnasce da lista de CHEGADAS e, por isso, não carrega o `arrival_*_override`\ndo lado da saída — que é justamente o que ele precisa mostrar.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "17bfb9b914e0facf3b74e9ae9d8842d4"
  },
  {
    "doc_key": "rule:runAdvanceArrival",
    "kind": "rule",
    "title": "Regra — runAdvanceArrival",
    "content": "Corpo de `advanceArrival`, extraído pra função independente (pedido\nexplícito, 06/09/2026): reaproveitado tanto pelo clique manual em\n\"Confirmar checkout\" (via `advanceArrival` abaixo, com o client de sessão\ndo usuário) quanto pela confirmação automática de checkout no horário\nprevisto (`runAutoCheckoutScan`, em `auto-checkout.server.ts`, com\n`supabaseAdmin` — sem sessão de usuário, roda por cron). Aceita qualquer\n`SupabaseClient<Database>`: um client de sessão (RLS do usuário) ou o\nadmin (bypassa RLS, usado pelo cron). `byUserId` só é usado no avanço de\nlimpeza (`from: \"cleaning\"`), pra registrar quem concluiu — omitido no\ncron, que não tem um usuário humano por trás da ação.",
    "source_path": "src/lib/dashboard.functions.ts",
    "audience": [],
    "content_hash": "6179d27ee6532400603d7ae8a7bc5b1c"
  },
  {
    "doc_key": "rule:runAutoCheckoutScan",
    "kind": "rule",
    "title": "Regra — runAutoCheckoutScan",
    "content": "Confirma automaticamente o checkout de um card assim que o horário\nPREVISTO chega — pedido explícito (06/09/2026): \"se um usuário colocar\n4h00 da manhã como prevista, então o card será dado como checkout\nconfirmado nesse horário (sempre horário local do guia — usando o\nprincipal horário do país em questão)\". Roda por cron (`cron.auto-\ncheckout`, a cada 5 minutos) — não depende de ninguém abrir o app.\n\nSÃO DOIS GATILHOS, e a diferença entre eles importa:\n\n 1. HÁ PREVISÃO — o anfitrião definiu horário de saída\n (`arrivalTimeOverride`). Confirma nesse horário. É o gatilho original.\n\n 2. NÃO HÁ PREVISÃO NENHUMA — nem data (`arrivalDateOverride`) nem horário\n previstos. Confirma no horário de checkout CONFIGURADO do imóvel\n (`properties.checkout_time`, que chega aqui como `standardTime`).\n Pedido explícito (09/09/2026): \"liberação para limpeza automática, ou\n seja, o check automático no checkout, quando chegar a hora exata do\n horário de checkout configurado em sistema — quando NÃO HOUVER data de\n checkout prevista inserida\".\n\nO comentário antigo aqui dizia que o horário padrão do imóvel \"nunca entra\"\n— e essa regra acabava de ser invertida de propósito, não por descuido. O\nraciocínio antigo era não confirmar nada que ninguém tivesse afirmado. Na\nprática ele deixava a fila de limpeza parada esperando um clique humano\njustamente no caso mais comum, que é o hóspede saindo no horário padrão sem\nninguém registrar nada. O horário contratual do imóvel É uma afirmação —\nestá no anúncio e o hóspede concordou com ele.\n\nO que continua valendo: uma previsão EXPLÍCITA sempre manda. Se o anfitrião\ninformou data ou horário de saída, o padrão do imóvel não entra — quem\ndisse \"esse hóspede sai às 15h\" não pode ter o card fechado às 11h. Por isso\no gatilho 2 exige que os DOIS overrides estejam vazios: com uma data\nprevista informada e sem horário, a confirmação continua manual, porque a\npessoa sinalizou que aquela saída foge do padrão.\n\nO fuso usado é o do IMÓVEL (`propertyTimeZone`, cidade/país cadastrados),\na mesma função já usada pro guia do hóspede — nunca um fuso fixo de\nservidor. Isso cobre \"o principal horário do país em questão\" mesmo pra\nimóveis fora do Brasil.\n\nA ação em si",
    "source_path": "src/lib/auto-checkout.server.ts",
    "audience": [],
    "content_hash": "3ec61b28b3d44ab66ba3c24cf1cc984a"
  },
  {
    "doc_key": "rule:runOpsPushScan",
    "kind": "rule",
    "title": "Regra — runOpsPushScan",
    "content": "Varredura operacional. Deve rodar a cada 30 minutos.\nA fonte de verdade é EXATAMENTE a mesma esteira (Kanban) do dashboard:\nusamos `buildArrivalRows` e consideramos apenas os cards pendentes.\nRegras:\n 1. 20h — quantos check-outs ocorrem amanhã\n 2. 07h — quantos check-ins ocorrem hoje\n 3. a cada 30min — check-outs atrasados (passou do horário oficial, sem \"check\")\n 4. a cada 1h após o horário de check-in — check-ins ainda pendentes\n 5. a cada 2h (em hora cheia), o dia todo — cards \"Em Limpeza\" ainda sem\n confirmação, independentemente de horário de checkin/checkout.\n 6. atraso grave (check-out +2h / check-in +3h) vira alerta crítico — e nesse\n caso o aviso \"normal\" correspondente NÃO é enviado (evita push duplicado).",
    "source_path": "src/lib/ops-push.server.ts",
    "audience": [],
    "content_hash": "cc8a24bdff35842e5a13d7218b5c910c"
  },
  {
    "doc_key": "rule:ScopeInput",
    "kind": "rule",
    "title": "Regra — ScopeInput",
    "content": "Ponte frontend → Authorization Runtime (FASE 4.1).\n\nAs decisões vêm EXCLUSIVAMENTE de `permission.guard.server.ts` /\n`permission.enforce.server.ts`. Nenhuma regra de permissão é reimplementada\nno cliente: aqui só trafega a decisão já tomada pelo backend.",
    "source_path": "src/lib/permissions/permission.access.functions.ts",
    "audience": [],
    "content_hash": "77f55cc1bfc89c6b8f18159ec0e98f57"
  },
  {
    "doc_key": "rule:ScreenshotTarget",
    "kind": "rule",
    "title": "Regra — ScreenshotTarget",
    "content": "Botão \"tirar um print\" (pedido explícito) — captura o container apontado\npor `targetRef` como PNG. Ao clicar, abre um menu com duas opções:\n\"Salvar Imagem\" (baixa o PNG) e \"Copiar Imagem\" (vai pra área de\ntransferência, pra colar direto em outro lugar). Usa `html-to-image`\n(já não existia nenhuma lib de captura no projeto).\n\nQuando `receiptRows` é passado (listas de hóspedes), o print NÃO captura\no card grande da tela — monta o layout \"comprovante\" compacto (pedido\nexplícito) num node à parte, fora da tela, só pra gerar a imagem; a tela\ndo usuário continua com os cards normais, clicáveis. Sem `receiptRows`\n(ex.: lista de imóveis do tooltip de Limpeza), continua capturando o\n`targetRef` como antes.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "38042bdced92383417a7063446272cfb"
  },
  {
    "doc_key": "rule:scrubPossibleCode",
    "kind": "rule",
    "title": "Regra — scrubPossibleCode",
    "content": "Remove qualquer trecho que pareça senha/código (letra + número colados, 4+ caracteres).\nDefesa extra: mesmo indicando só TÍTULOS de itens do manual/FAQ (nunca o corpo/resposta),\num anfitrião pode ter escrito o próprio código no título por engano.",
    "source_path": "src/lib/ai/guest-safety.server.ts",
    "audience": [],
    "content_hash": "2ab18fe3d9bc2ec32787bb74d9d3542f"
  },
  {
    "doc_key": "rule:searchBrAddress",
    "kind": "rule",
    "title": "Regra — searchBrAddress",
    "content": "Autocompletar de endereço enquanto a pessoa digita — usado tanto pelo\ncampo de endereço de Prestadores/Proprietários quanto pelo campo\n\"Endereço\" do imóvel (ver `AddressAutocomplete`, compartilhado pelos dois).\nPedido explícito (06/09/2026): trocar o provedor de Nominatim/OpenStreetMap\npelo Google Places, o mesmo já usado no resto do sistema (recomendações,\nlink do Maps do imóvel) — resultado mais preciso e consistente, e já traz\nlat/lng prontos (sem precisar de uma segunda chamada de geocodificação).",
    "source_path": "src/lib/address-lookup.functions.ts",
    "audience": [],
    "content_hash": "6c37cd837b82baaf367a78a79f51090a"
  },
  {
    "doc_key": "rule:SectionGroup",
    "kind": "rule",
    "title": "Regra — SectionGroup",
    "content": "Agrupa Sections colapsáveis permitindo apenas uma aberta por vez.\nPor padrão é não controlado (guarda o próprio estado). Passando `openId` +\n`onOpenIdChange`, quem chama passa a decidir qual seção fica aberta — usado\nquando algo de fora precisa abrir uma seção específica (ex.: validação de\nformulário abrindo a seção com o campo inválido e rolando até ele).",
    "source_path": "src/components/editor/Section.tsx",
    "audience": [],
    "content_hash": "6a2193bf9ba397b363b2f989f892d79e"
  },
  {
    "doc_key": "rule:SEG_TAB",
    "kind": "rule",
    "title": "Regra — SEG_TAB",
    "content": "Aba do segmented control: adapta-se à largura da tela (anti-corte), 46px.\n !flex-none sobrescreve o !flex-1 padrão de TabsTrigger (ui/tabs.tsx) — aqui\n cada aba precisa manter a largura do próprio rótulo (min-w-max) e deixar o\n ds-segmented rolar na horizontal quando não couberem todas, em vez de\n espremer/cortar \"Acessos\" tentando dividir a largura em partes iguais.",
    "source_path": "src/components/stakeholders/StakeholderDetailSheet.tsx",
    "audience": [],
    "content_hash": "cc1ee53bc55458f9e9727b4d80fc231d"
  },
  {
    "doc_key": "rule:sendBrandedAccountInvite",
    "kind": "rule",
    "title": "Regra — sendBrandedAccountInvite",
    "content": "Envia o convite de equipe usando o e-mail branded do app.\n\nNão usamos mais o e-mail nativo de convite/magic link do Supabase (sujeito a\nlimites de taxa e sem identidade visual). Geramos apenas o link de ação com\na API admin (que NÃO dispara e-mail) e enviamos pela fila do app.",
    "source_path": "src/lib/team-invite-email.server.ts",
    "audience": [],
    "content_hash": "c359bacdda8b28734325434cf24f7d95"
  },
  {
    "doc_key": "rule:sendGuestReplyPush",
    "kind": "rule",
    "title": "Regra — sendGuestReplyPush",
    "content": "Push pra CADA mensagem nova do hóspede numa conversa que já está com um\nhumano (assigned_to preenchido). Antes, só a mensagem que DISPARAVA o\nhandoff gerava push — qualquer mensagem seguinte do hóspede na mesma\nconversa (já assumida) não avisava ninguém, mesmo com o atendente\nesperando resposta. Se a conversa tem um responsável específico\n(assigned_to), só ele é notificado — não o time inteiro.",
    "source_path": "src/lib/handoff.server.ts",
    "audience": [],
    "content_hash": "64c86e46d768769353b7ca42581cd670"
  },
  {
    "doc_key": "rule:sendOpenConversationReminders",
    "kind": "rule",
    "title": "Regra — sendOpenConversationReminders",
    "content": "Lembrete horário: conversas assumidas por um humano (assigned_to) que\ncontinuam abertas (não resolvidas) recebem um push a cada ~1h avisando\nque a conversa com o hóspede continua em aberto. Chamado por um cron.\n\nUsa `last_reminder_at` (não só `handoff_at`) pra saber quando foi o\nÚLTIMO lembrete — sem isso, rodar o cron a cada 15min mandaria push a\ncada 15min pra qualquer conversa aberta há mais de 1h, não de hora em\nhora de verdade.",
    "source_path": "src/lib/handoff.server.ts",
    "audience": [],
    "content_hash": "f10f71c9dd876dca05bd6f0512519a77"
  },
  {
    "doc_key": "rule:shape",
    "kind": "rule",
    "title": "Regra — shape",
    "content": "Endereço já com o link do mapa pronto (pedido explícito, 07/09/2026):\nquem pergunta o endereço de um imóvel quase sempre vai abrir o mapa em\nseguida. Quando o imóvel não tem `maps_url` cadastrado, monta a busca pelo\npróprio endereço — melhor um mapa pesquisado que nenhum.",
    "source_path": "src/lib/ai/assistant-tools.server.ts",
    "audience": [],
    "content_hash": "57ffb747f784d1d6a181a9b2bfc660ab"
  },
  {
    "doc_key": "rule:showPrediction",
    "kind": "rule",
    "title": "Regra — showPrediction",
    "content": "A PREVISÃO que este card mostra e edita — a do que vem A SEGUIR, não a da\nlista de origem (pedido explícito, 08/09/2026).\n\nA diferença aparece em \"Em Estadia\": o card vem da lista de CHEGADAS, mas\na chegada já aconteceu. Editar ali a previsão de check-in de quem já fez\ncheck-in não serve para nada — e o caso mais comum da operação é\nexatamente o oposto: o hóspede está dentro do imóvel e avisa a que horas\nvai sair. Por isso Em Estadia, Checkouts e Fila de Limpeza mostram a\nprevisão de SAÍDA, e só Chegadas mostra a de chegada.\n\nConcluído e Não Compareceu não têm previsão a exibir: não há próxima ação\npara prever.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "d4a1553d30fff796e6c716e62036fc7c"
  },
  {
    "doc_key": "rule:SLACK_MIN",
    "kind": "rule",
    "title": "Regra — SLACK_MIN",
    "content": "FOLGA DE 3 HORAS PARA CADA LADO da janela configurada do imóvel\n(pedido explícito, 09/09/2026).\n\nA janela do imóvel é o horário CONTRATADO, e a previsão é outra coisa:\né o que de fato vai acontecer. Hóspede pedindo late checkout, voo de\nmadrugada, chegada adiantada — a realidade fica fora da janela com\nfrequência, e a lista travada nela obrigava a não registrar previsão\nnenhuma justamente nos casos que mais precisam de uma.\n\nTrês horas, e não \"liberar tudo\", porque a janela ainda é a referência:\nela continua sendo o que a lista mostra primeiro e o que a frase\n\"Permitido: entre X e Y\" no card afirma. A folga é margem, não a\nremoção do limite.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "cb59db27e42cbf1f9aef3754cda8e7b6"
  },
  {
    "doc_key": "rule:sortCheckinRows",
    "kind": "rule",
    "title": "Regra — sortCheckinRows",
    "content": "Ordenação dos cards de chegada:\n1) imóveis já liberados para check-in acima de qualquer um ainda com\n checkout/limpeza pendente — bloqueado NUNCA compete por horário, fica\n sempre abaixo dos liberados (mesmo racional do botão bloqueado no\n Kanban: enquanto o imóvel não libera, o check-in nem entra na\n \"disputa\" de prioridade).\n2) horário previsto de chegada (mais cedo primeiro; sem horário vai por último)\n3) proprietário A→Z\n4) nome do anúncio A→Z",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "367bbce32cff19183527900ba874e2a6"
  },
  {
    "doc_key": "rule:sortCheckoutRows",
    "kind": "rule",
    "title": "Regra — sortCheckoutRows",
    "content": "Ordenação dos checkouts (pedido explícito), em ordem de prioridade:\n1) imóvel com check-in previsto no MESMO dia (giro) sobe pro topo;\n2) dentro do giro, pelo horário previsto do check-in que está chegando\n (mais cedo primeiro);\n3) o que sobrar (inclusive quem não tem giro) pelo horário previsto do\n próprio checkout (mais cedo primeiro);\n4) o que ainda estiver empatado, por proximidade de endereço — encadeado\n pelo vizinho mais próximo do ÚLTIMO imóvel já ordenado (rota curta),\n não pelo tamanho do grupo de imóveis vizinhos.\n`checkinRowSources` recebe TODAS as fontes de check-in relevantes pro\nmesmo período das linhas de checkout (não só as pendentes: um giro conta\nmesmo que o check-in já tenha sido marcado feito).",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "6e7d3457843ef1461150aef8b52b1c7f"
  },
  {
    "doc_key": "rule:sortItems",
    "kind": "rule",
    "title": "Regra — sortItems",
    "content": "Ordenação DENTRO do grupo. Em todas, a urgência entra como desempate —\nduas pendências de mesma prioridade não podem ficar em ordem arbitrária, e\na mais próxima de vencer é sempre a que se resolve primeiro.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "569b0cf603661abb00379cbdb1c68758"
  },
  {
    "doc_key": "rule:SOURCE_CONFIDENCE",
    "kind": "rule",
    "title": "Regra — SOURCE_CONFIDENCE",
    "content": "Ranking Permanente de Fontes.\n\nPesos fixos e auditáveis por fonte. Em caso de conflito entre informações,\na fonte de maior peso SEMPRE prevalece — e fontes conflitantes nunca são\nmisturadas na mesma resposta.\n\nAlterar um peso aqui muda o comportamento de todo o agente: mantenha a\nordem hierárquica (oficial > curado > externo > inferido).",
    "source_path": "src/lib/ai/sources.ts",
    "audience": [],
    "content_hash": "f853da0ed1e11d46dea9ccc6fc7de1c4"
  },
  {
    "doc_key": "rule:src/components/ai/AiMarkdown.tsx:0",
    "kind": "rule",
    "title": "Regra em AiMarkdown.tsx",
    "content": "Renderização do texto que a IA escreve (pedido explícito, 07/09/2026).\n\nOs modelos escrevem em Markdown por conta própria — `**assim**` para\ndestacar um número, listas com hífen. Exibindo como texto puro, o leitor vê\nos asteriscos crus, que é exatamente o oposto do destaque pretendido.\n\nDuas armadilhas que este componente resolve e que justificam ele existir em\nvez de um `<ReactMarkdown>` solto em cada tela:\n\n 1. O preflight do Tailwind zera marcador e recuo de `ul`/`ol`. Sem estilo\n explícito, uma lista da IA vira um bloco de linhas coladas, sem bullet.\n Por isso cada elemento abaixo é estilizado à mão — o projeto não usa o\n plugin de typography.\n\n 2. Em Markdown, uma quebra de linha simples é \"quebra suave\" e some na\n renderização — mas a IA escreve uma frase por linha esperando ver uma\n frase por linha. O chat do hóspede resolve isso trocando toda quebra\n por linha em branco antes de renderizar; aqui não dá, porque a mesma\n troca destruiria tabela (que exige linhas adjacentes) e afrouxaria as\n listas. A saída é `whitespace-pre-line` no parágrafo: a quebra suave\n chega como \"\\n\" no texto e o CSS a exibe, sem tocar no Markdown.\n\nHerda tamanho e cor de quem o envolve, então serve tanto num balão claro\nquanto num escuro.",
    "source_path": "src/components/ai/AiMarkdown.tsx",
    "audience": [],
    "content_hash": "2cc9bc470dd974359ec18d1ab3e41539"
  },
  {
    "doc_key": "rule:src/components/ai/AiMarkdown.tsx:2740",
    "kind": "rule",
    "title": "Regra em AiMarkdown.tsx",
    "content": "Substituições pontuais de quem usa. O chat do hóspede precisa de duas: um\n`code` com botão de copiar (senha de Wi-Fi se copia, não se digita) e um\n`img` que some quando a foto do lugar expira, em vez de mostrar ícone\nquebrado. O resto do padrão continua valendo para os dois chats.",
    "source_path": "src/components/ai/AiMarkdown.tsx",
    "audience": [],
    "content_hash": "9db42d9f3fbd87da800a39425e70c95a"
  },
  {
    "doc_key": "rule:src/components/assistant/AssistantPanel.tsx:0",
    "kind": "rule",
    "title": "Regra em AssistantPanel.tsx",
    "content": "Painel do Assistente do Painel (pedido explícito, 07/09/2026).\n\nA parte que merece atenção é a confirmação de ação. Quando a resposta vem\ncom uma `pendingAction`, o painel mostra o cartão com os campos exatos que\nserão gravados e só grava no clique — chamando a MESMA server function que\na tela correspondente usaria (`createTask`, `setTaskStatus`, `markNoShow`).\nNada de um caminho de escrita paralelo: se a regra de criação de pendência\nmudar amanhã, o assistente acompanha sem ninguém lembrar dele.\n\nPor isso também as queries do painel são invalidadas depois de confirmar —\no quadro atrás precisa refletir o que acabou de acontecer.",
    "source_path": "src/components/assistant/AssistantPanel.tsx",
    "audience": [],
    "content_hash": "1d6019faf67077787112e40ec8da6346"
  },
  {
    "doc_key": "rule:src/components/assistant/AssistantPanel.tsx:13032",
    "kind": "rule",
    "title": "Regra em AssistantPanel.tsx",
    "content": "Uma chamada só para a lista inteira — não um laço de N chamadas como\nna criação em lote. Ali cada imóvel é uma linha nova e um erro no\nmeio não pode derrubar o que já entrou; aqui é um único `IN (...)`\nsobre linhas que já existem, então o banco resolve de uma vez e o\nresultado é tudo-ou-nada, que é o que se espera de \"apague estas\".",
    "source_path": "src/components/assistant/AssistantPanel.tsx",
    "audience": [],
    "content_hash": "4fba9ff5bf0bc6d6c1139ad34a9b7f77"
  },
  {
    "doc_key": "rule:src/components/assistant/AssistantPanel.tsx:23674",
    "kind": "rule",
    "title": "Regra em AssistantPanel.tsx",
    "content": "Uma DECISÃO não é uma fala — e não pode se parecer com uma.\n\n\"Criar em 9 imóveis\" dito pela IA é uma proposta; gravado no histórico é\num fato. Como bolha de conversa os dois ficariam idênticos, e depois de\nmeses ninguém saberia distinguir o que foi sugerido do que foi feito. Por\nisso o registro de execução sai como uma linha própria, com o ✓ na cor de\nconfirmado e a lista do que foi gravado embaixo.",
    "source_path": "src/components/assistant/AssistantPanel.tsx",
    "audience": [],
    "content_hash": "4ba661e6477dca474d48ff7716a78aaf"
  },
  {
    "doc_key": "rule:src/components/assistant/AssistantPanel.tsx:4275",
    "kind": "rule",
    "title": "Regra em AssistantPanel.tsx",
    "content": "HISTÓRICO PERMANENTE (pedido explícito, 09/09/2026).\n\nO servidor devolve a última página e diz se existem mensagens anteriores;\n`older` guarda as páginas já buscadas, na ordem certa. Nada é descartado —\no que existe é uma janela que a pessoa vai abrindo para trás.\n\nCarregar tudo de uma vez seria a única maneira de \"mostrar tudo\" que\ntrava o navegador depois de alguns meses de uso.",
    "source_path": "src/components/assistant/AssistantPanel.tsx",
    "audience": [],
    "content_hash": "94590587e43020d767e9efd1ae3422b1"
  },
  {
    "doc_key": "rule:src/components/assistant/AssistantPanel.tsx:6272",
    "kind": "rule",
    "title": "Regra em AssistantPanel.tsx",
    "content": "CONFIRMAÇÃO AUTOMÁTICA (pedido explícito, 09/09/2026: \"se o usuário\npedir 'dispense a confirmação', então ela tem que acatar e manter isso\nmemorizado para aquele usuário específico\").\n\nA ação segue exatamente o mesmo caminho de sempre — a mutation\n`confirm`, as mesmas server functions das telas, o mesmo RLS. O que\nmuda é só quem dispara: o clique da pessoa ou esta linha. Por isso a\nautonomia não vira privilégio: se ela não pode gravar aquilo, falha\naqui igual falharia no cartão, com o mesmo erro.\n\n`res.autoConfirm` é lido no servidor DEPOIS do turno, então \"dispense\na confirmação\" já vale para a ação preparada nesta mesma mensagem.",
    "source_path": "src/components/assistant/AssistantPanel.tsx",
    "audience": [],
    "content_hash": "5c2c5b13052a34cbf91c67dae6cfa570"
  },
  {
    "doc_key": "rule:src/components/chat/composer-styles.ts:0",
    "kind": "rule",
    "title": "Regra em composer-styles.ts",
    "content": "As medidas da barra de mensagem e do cabeçalho — um lugar só, para os três\nchats do produto: Atendimento, Assistente do Painel e o guia do hóspede.\n\nPedido explícito (08/09/2026), depois de eu errar duas vezes: \"precisamos que\no layout de ambos os chats sejam iguais, use como referência o layout do chat\ncom assistente, os mínimos detalhes\".\n\nPOR QUE ISTO EXISTE EM VEZ DE EU SÓ AJUSTAR AS CLASSES DE NOVO\n\nJá ajustei essas medidas à mão duas vezes e elas voltaram a divergir — porque\n\"igual\" escrito em três arquivos diferentes é só uma coincidência esperando\npara acabar. Com as classes vindo daqui, dois chats só ficam diferentes se\nalguém mudar ESTE arquivo, e aí mudam juntos.\n\nOs valores são os do Assistente do Painel, que é a referência combinada:\nbarra de 32px, pílula de borda fina, botões redondos de 32px, cabeçalho de\n48px com botões de 28px.",
    "source_path": "src/components/chat/composer-styles.ts",
    "audience": [],
    "content_hash": "914091bc096eea511759c33fbaa6d179"
  },
  {
    "doc_key": "rule:src/components/dashboard/card-colors.ts:0",
    "kind": "rule",
    "title": "Regra em card-colors.ts",
    "content": "AS CORES DAS INFORMAÇÕES DE UM CARD — um lugar só, para todos os cards.\n\nPedido explícito (08/09/2026): \"a cor das informações precisa ser replicada\nem TODOS os demais cards... exemplo: proprietário no pink, período nas cores\ndos status\".\n\nO padrão nasceu no card do Kanban e é este:\n\n · PROPRIETÁRIO — rosa da marca (`--accent`). É a única linha colorida por\n IDENTIDADE, não por estado: serve para achar o card do proprietário\n certo passando o olho por uma coluna inteira.\n · IMÓVEL — cor de texto cheia, com a tipografia de título do card. É o\n nome que a pessoa lê primeiro.\n · PERÍODO / DATAS — cor de ESTADO (ver `periodColorClass`): vermelho para\n atrasado, laranja para saída, verde para estadia em curso, azul para\n chegada pendente. É a cor que substituiu as antigas etiquetas\n \"Atrasado\"/\"Data futura\".\n · HÓSPEDE, CÓDIGO E DEMAIS APOIOS — cinza. Informação de contexto não\n compete com as três acima.\n\nPor que constantes e não classes escritas em cada tela: o padrão já existia\nde fato no Kanban, mas só lá — nos outros cards cada linha tinha ganhado uma\ncor por conta própria. Com o padrão vindo daqui, um card novo herda o\nsignificado das cores em vez de reinventá-lo, e mudar o padrão é mudar UM\narquivo.",
    "source_path": "src/components/dashboard/card-colors.ts",
    "audience": [],
    "content_hash": "5659909501ffd7e0b67da654b7615957"
  },
  {
    "doc_key": "rule:src/components/dashboard/card-colors.ts:1770",
    "kind": "rule",
    "title": "Regra em card-colors.ts",
    "content": "Cor do PERÍODO/data conforme o estado da estadia.\n\n`overdue` vence tudo: uma data que já passou sem a ação feita é o único\nestado que precisa gritar. Depois disso, a cor diz em que ponto da esteira\no card está.",
    "source_path": "src/components/dashboard/card-colors.ts",
    "audience": [],
    "content_hash": "ef3c1c66c3ef578b9b9e0522f86a4558"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:142459",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "A Limpeza tem DUAS janelas na MESMA tela (últimos 7d / próximos 7d) e o\ntítulo precisa dizer qual está no ar (pedido explícito). Só o texto muda;\no resto da página é idêntico.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "df381f0b82c9a345baeae12ba649c01f"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:142693",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "AS AÇÕES DA TELA MORAM AQUI (mockup aprovado, 09/09/2026).\n\nAs três telas gastavam uma faixa horizontal inteira só com dois ou três\nbotões, e essa faixa empurrava o conteúdo para baixo justamente onde a\ntela é mais estreita. Encostadas à direita do bloco título+subtítulo elas\nnão custam altura nenhuma — e, de quebra, passam a estar SEMPRE no mesmo\ncanto nas três telas, que é o que faz a mão aprender um lugar só.\n\n`items-center`: alinhadas ao centro do bloco de duas linhas, não ao topo.\nAlinhado ao topo, o botão encosta no título e a dupla fica torta quando o\nsubtítulo quebra.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "9fe3ad8ae446109e5ae90b0e1d1fb01d"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:155095",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "Destaque visual opt-in (só usado hoje por \"Fila de Limpeza\"): borda +\ngradiente âmbar + acento lateral + ícone em caixinha, sem negrito.\nNão afeta nenhum outro uso do KpiCard (compact ou não).",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "ec0f34c7bfc0754666d9cc96f2f2a568"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:155330",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "Cards que devem continuar visíveis no popup mesmo que já não pertençam\nmais à lista — hoje só os que tiveram HORÁRIO/DATA PREVISTOS ajustados.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "4b33a44930f947dea6060da94f816439"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:155522",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "Pedido explícito: os cards dentro do popup precisam ficar IDÊNTICOS ao\ncard do Kanban — em vez de manter uma segunda implementação (que já\ndivergiu do Kanban antes, ver o bug do bloqueio de check-in), o popup\nagora renderiza o MESMO <ArrivalGroup>/<ArrivalCard> do Kanban, com os\nMESMOS handlers. Vem de arrivalGroupPropsFor(colMode, rows) — a mesma\nfunção que já alimenta as colunas do Kanban.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "dfd7cbf815d96bcf7c9214257a5e2387"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:197001",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "Rótulo de seção do formulário de pendência — dá hierarquia ao que antes\nera uma pilha de campos do mesmo tamanho (pedido explícito, 07/09/2026).",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "56b708e624e12bb9a26b2593234ea4c6"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:206827",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "Padrão = IMÓVEL, que é o que os dois mockups aprovados mostram selecionado.\nUrgência continua a um toque de distância, e é a escolha certa quando a\npergunta é \"o que eu resolvo agora\" — mas a operação abre esta tela quase\nsempre pensando num imóvel, e agrupada ela cabe muito mais no olho: nove\npendências iguais em nove imóveis viram nove cabeçalhos com uma linha cada,\nem vez de nove linhas repetindo o mesmo título.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "59042beafabc7c04c6cad6bab466aea1"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:279820",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "Pedido explícito: os filtros (Período/Cidade/Proprietário) que antes\nficavam numa linha própria acima deste card viraram um botão único\n(`CalendarFiltersButton`) dentro do cabeçalho, ao lado do título — por\nisso o estado/opções continuam vindo do pai (`OperationWorkspace`),\nque é quem também usa esses mesmos filtros pros cards de limpeza.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "67345afec21e651284020dbb8b2f7803"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:311665",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "Dialog de detalhe (quem viu / quem não viu) — extraído do BarRow original\npra poder ser reaproveitado também pelo EngagementCard (cards separados do\ndesktop), sem duplicar esse JSX nos dois lugares.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "191a73d470b9e71e3339a0db344ffb5a"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:319632",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "Controlado de fora (pela coluna do Kanban) quando presente — permite\nrecolher os \"Detalhes da operação\" ao rolar a coluna. Sem isso, cai de\nvolta pro estado local de sempre.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "1420a71a82d71664b9b9257192bc6178"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:323228",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "Marca este card (Check-ins) como \"Não Compareceu\" — pedido explícito,\n05/09/2026: opção no menu \"⋮\", só nos cards de check-in ainda pendentes.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "b858b5d3155e42847ae34a889b4053e2"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:324241",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "Modo \"Lista\" (pedido explícito): mostra só proprietário, imóvel e os\n botões de ação (bem menores) — some com nome do hóspede, código,\n período, previsto e alertas de iCal. Reaproveita o mesmo card e os\n mesmos handlers; só a apresentação muda.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "943bbf38018e813c04eeb6799825fda6"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:337066",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "Lista + Concluídos/Não Compareceu = card mínimo (pedido explícito,\n08/09/2026): \"não deve ser apresentada qualquer info que não seja o nome\ndo proprietário, título do anúncio e botões\".\n\nSão as duas listas de ARQUIVO do quadro. Ali ninguém está operando nada:\nestá procurando um card específico para desfazer ou conferir. Período,\nprevisão, nota e alertas de iCal só alongam a linha e atrasam a busca —\no histórico completo continua a um clique (ver o popup de histórico).\n\nA etiqueta ALERTA é a exceção deliberada, por pedido explícito no mesmo\ndia: ela aparece em todo e qualquer card, inclusive aqui.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "1b25cf359cf9c187087b403bc46fefe6"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:337735",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "CARD SEMPRE COMPACTO, QUE ABRE NO TOQUE (pedido explícito, 09/09/2026,\nmockup aprovado).\n\nO botão de trocar visualização saiu do sistema. No lugar de uma escolha\nglobal entre \"Completo\" e \"Lista\" — que obrigava a pessoa a decidir de\nantemão, para TODOS os cards, quanta informação queria ver —, cada card\nnasce compacto e abre sozinho quando você toca nele. A escolha deixa de\nser uma configuração e passa a ser um gesto, card a card.\n\n`compact` continua sendo a mesma variável de antes e continua governando o\nmesmo conjunto de detalhes; o que mudou é quem a define. A prop recebida\n(`compactProp`) segue valendo como PADRÃO, e o estado local só a sobrepõe\nquando a pessoa abre aquele card.\n\nO estado NÃO é lembrado entre aberturas da tela: tudo volta compacto.\nLembrar significaria reabrir o quadro com metade dos cards expandidos, o\nque desfaz exatamente o ganho de espaço que motivou a mudança.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "74aa32f170f1ad76a18f288788d2b4cf"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:342479",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "HISTÓRICO DA RESERVA (pedido explícito, 08/09/2026).\n\nNa visão Lista, o clique no próprio card abre a jornada completa — é o\ngesto natural quando o card mostra pouca coisa. No modo Completo o card\nestá cheio de controles e um clique global roubaria o clique de todos\neles, então ali o caminho é o item do menu \"⋮\". Os dois abrem exatamente\na mesma tela.\n\nSó identificador real: a chave sintética \"ical:<id>\" não é um uuid de\nlog — nesses cards a reserva é quem identifica a estadia.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "91b0393d11ad3250d65978789bbf0665"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:387886",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "Restringe de verdade os horários selecionáveis (inclusive) ao horário\n configurado do imóvel — pedido explícito do cliente (04/09/2026): antes\n só existia um aviso visual (âmbar) depois de já ter escolhido um\n horário fora da janela; agora o horário nem aparece como opção. `null`/\n omitido = sem limite (imóvel sem esse horário configurado).",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "8ebe1ab97a0756cd4e0279b3025812c8"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:390650",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "Data e horário previstos são dois campos SEPARADOS de novo (pedido\nexplícito, 05/09/2026: \"quero que fiquem separados como antes, porém\nambos no layout padrão dos tooltips\") — cada botão abre seu próprio\ntooltip (só calendário / só horário, cada um com o mesmo visual dos\ntooltips padrão do sistema), não mais um painel único com os dois juntos.\n\nMas por baixo dos panos continua sendo UMA ÚNICA sessão de edição\n(`open`/pendingDate/pendingTime compartilhados): os dois botões só trocam\nQUAL conteúdo aparece dentro do mesmo Popover (ver `openField`), sem abrir\ne fechar de verdade um popover por vez. Isso é o que preserva o ajuste\nanterior (pedido explícito, mesma data): \"não é mover depois de fechar o\ncalendário, é mover depois de fechar o TOOLTIP inteiro\" — se cada campo\ntivesse seu próprio Popover independente, fechar o de Data já confirmaria\ne moveria o card antes do usuário conseguir abrir o de Horário, voltando\nao bug original. Nada é gravado (nem o card se move) enquanto QUALQUER um\ndos dois estiver \"aberto\" — só quando o usuário clica fora dos dois\nbotões (ou aperta \"Concluir\"/Esc) é que a data e o horário pendentes são\nconfirmados juntos, numa única leva.\n\nO piso/teto do horário reage à data QUE ESTÁ SENDO escolhida (ainda não\nconfirmada) — mesma regra de \"dia mudou → sem piso/teto\" do card, só que\ncalculada aqui em cima do valor pendente, senão a lista de horários\nficaria com a janela do dia errado enquanto o usuário ainda decide.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "2b5d3cc828947c9353140290107ef27c"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:43543",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "Cards \"fixados\" no popup aberto: SÓ ajustes de data/horário previsto\nseguram o card na lista até o usuário fechar o popup no \"X\". Qualquer\noutra ação (check, não compareceu, limpeza não será realizada, desfazer)\ntira o card da tela na hora.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "edce2904f3ccf71032151d09f19ecae0"
  },
  {
    "doc_key": "rule:src/components/dashboard/OperationWorkspace.tsx:61570",
    "kind": "rule",
    "title": "Regra em OperationWorkspace.tsx",
    "content": "A tela de Limpeza tem DUAS janelas, e é a MESMA tela nas duas (pedido\nexplícito, 09/09/2026: \"não quero que abra um tooltip ao clicar em\ntendência; quero que a tela seja a mesma da visão oficial, mas que os\ndados sejam mudados para os próximos 7 dias\").\n\nAntes a previsão vivia num popup com layout próprio — outra moldura, outra\ndensidade, outro jeito de ler os mesmos gráficos. Agora só a FONTE dos\ndados muda; cards, gráficos e ranking são os mesmos componentes.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "a094d0063ac14a38e9749905f4336c1b"
  },
  {
    "doc_key": "rule:src/components/dashboard/record-categories.ts:0",
    "kind": "rule",
    "title": "Regra em record-categories.ts",
    "content": "Vocabulário compartilhado dos REGISTROS (categorias, etapa de origem e o\nrótulo de dia), fora do componente porque duas telas o consomem: a linha\ndo tempo dentro da reserva (ReservationRecords) e a aba \"Registros\"\n(RecordsWorkspace). Mesmo motivo de `card-colors.ts` existir separado.",
    "source_path": "src/components/dashboard/record-categories.ts",
    "audience": [],
    "content_hash": "1b50fd69dd824cce84da89a6a3bd6fb7"
  },
  {
    "doc_key": "rule:src/components/dashboard/RecordsWorkspace.tsx:6415",
    "kind": "rule",
    "title": "Regra em RecordsWorkspace.tsx",
    "content": "A FAIXA DA CATEGORIA dentro do quadrante (pedido explícito, 10/09/2026):\nmesma cor da categoria, translúcida, com o texto na versão clara dela. Fica\nde ponta a ponta no topo do quadrado, centralizada — sobre foto ou vídeo a\ntranslucidez deixa a imagem aparecer por baixo.",
    "source_path": "src/components/dashboard/RecordsWorkspace.tsx",
    "audience": [],
    "content_hash": "1ab915fd3496a9a1fb5383c22880b593"
  },
  {
    "doc_key": "rule:src/components/dashboard/ReservationJourneyDialog.tsx:0",
    "kind": "rule",
    "title": "Regra em ReservationJourneyDialog.tsx",
    "content": "O HISTÓRICO DA RESERVA, na mesma moldura dos outros popups do quadro\n(Pendências, Limpeza Prevista 7d): largura `sm:max-w-lg`, cabeçalho com\n`ds-page-title` + `ds-page-subtitle`, corpo rolável em `sg-elegant-scroll`.\nPedido explícito (08/09/2026): \"precisa seguir o mesmo layout padrão que já\nimplementamos\".\n\nAs cores das linhas vêm de `card-colors.ts` — as MESMAS do card que abriu\neste popup: proprietário no rosa, período na cor do estado. Um histórico\npintado com outra régua faria a pessoa reaprender o significado das cores\nao atravessar dois cliques.",
    "source_path": "src/components/dashboard/ReservationJourneyDialog.tsx",
    "audience": [],
    "content_hash": "dc0da3da58aa3722f69ddc52964edb30"
  },
  {
    "doc_key": "rule:src/components/dashboard/ReservationJourneyDialog.tsx:3227",
    "kind": "rule",
    "title": "Regra em ReservationJourneyDialog.tsx",
    "content": "Chegada e saída, as duas editáveis (pedido explícito, 08/09/2026).\n\nChega pronto do card, como nó já montado, e não como dados: o editor de\nprevisão vive dentro do quadro (é lá que estão as duas listas da esteira\ne a gravação otimista), e importá-lo daqui criaria um ciclo — o quadro já\nimporta este diálogo. Passar o nó pronto mantém uma única implementação\nde gravação, que é a mesma regra que vale para as ações do assistente.",
    "source_path": "src/components/dashboard/ReservationJourneyDialog.tsx",
    "audience": [],
    "content_hash": "05695c4506d7fc3e0183fd55b62a5aae"
  },
  {
    "doc_key": "rule:src/components/dashboard/TaskAttachments.tsx:2044",
    "kind": "rule",
    "title": "Regra em TaskAttachments.tsx",
    "content": "Sobe os anexos retidos e grava cada um como registro da pendência. Chamar\nDEPOIS que a pendência existe (criação) ou foi concluída (comprovação).\nFalha de um arquivo não derruba os outros — nem a ação principal, que já\naconteceu.",
    "source_path": "src/components/dashboard/TaskAttachments.tsx",
    "audience": [],
    "content_hash": "abda222d5c7f7b14809f0a094bc3ec59"
  },
  {
    "doc_key": "rule:src/components/FloatingDock.tsx:0",
    "kind": "rule",
    "title": "Regra em FloatingDock.tsx",
    "content": "Botão flutuante único do painel (pedido explícito, 07/09/2026).\n\nAntes o canto tinha o botão do Atendimento e nada mais. Com a chegada do\nAssistente, empilhar um segundo botão bagunçaria o canto — e o dock já é\narrastável, então os dois teriam que se mover juntos. A decisão foi um botão\nsó, na cor de destaque, que abre um menu com as duas opções.\n\nA movimentação é a mesma de antes, de propósito: arrastar na vertical, com a\nposição guardada no aparelho. Quem já tinha o hábito de subir o botão para\nele não cobrir um card continua conseguindo.\n\nO Atendimento não é reimplementado aqui: escolher \"Atendimento\" dispara o\nmesmo evento (`handoff-dock:open`) que os cards já usam para abrir uma\nconversa, e o FloatingHandoffDock — que segue montado, só que sem botão\npróprio — responde. Uma porta de entrada, uma implementação.",
    "source_path": "src/components/FloatingDock.tsx",
    "audience": [],
    "content_hash": "f16ed5d69a4cb9d16877ddc6f8455d00"
  },
  {
    "doc_key": "rule:src/components/guide/BottomNav.tsx:448",
    "kind": "rule",
    "title": "Regra em BottomNav.tsx",
    "content": "Quando definido, só o item com esta key responde a toque — os demais\nficam visualmente apagados e travados. Usado durante o onboarding\npós-formulário: o hóspede vê o menu real, com \"Chegada\" selecionado,\nmas não consegue navegar pra outra aba até concluir as etapas.",
    "source_path": "src/components/guide/BottomNav.tsx",
    "audience": [],
    "content_hash": "7fa56c1c8d21bcdba236dfb5c4726edf"
  },
  {
    "doc_key": "rule:src/components/GuideAccessGate.tsx:35896",
    "kind": "rule",
    "title": "Regra em GuideAccessGate.tsx",
    "content": "Datas confirmadas da reserva (yyyy-MM-dd) — limites da previsão de\nchegada/saída: chegada nunca antes de `checkinISO`; saída nunca depois\nde `checkoutISO`.",
    "source_path": "src/components/GuideAccessGate.tsx",
    "audience": [],
    "content_hash": "c84a0e7b0fea8e95741bd6e26746f9f2"
  },
  {
    "doc_key": "rule:src/components/GuideAccessGate.tsx:5445",
    "kind": "rule",
    "title": "Regra em GuideAccessGate.tsx",
    "content": "Itens do menu inferior real do guia — mostrado em tela cheia por trás\ndo formulário, com \"Chegada\" travado (o hóspede não navega pra outra\naba antes de se identificar).",
    "source_path": "src/components/GuideAccessGate.tsx",
    "audience": [],
    "content_hash": "a01a4d9f91ff2ee14ed37a261a0e63ae"
  },
  {
    "doc_key": "rule:src/components/GuideAccessGate.tsx:6433",
    "kind": "rule",
    "title": "Regra em GuideAccessGate.tsx",
    "content": "Horário máximo de check-in do imóvel — teto da previsão de chegada\n(pedido explícito, 05/09/2026, mesma regra já aplicada no painel do\nanfitrião).",
    "source_path": "src/components/GuideAccessGate.tsx",
    "audience": [],
    "content_hash": "a316426ba5b0c0ef8c0a2216d094e32c"
  },
  {
    "doc_key": "rule:src/components/GuideAiChat.tsx:7440",
    "kind": "rule",
    "title": "Regra em GuideAiChat.tsx",
    "content": "true quando qualquer outro popup/onboarding já está na tela (tour de\nprimeiro acesso, diálogo de PIN, etc.) — nesse caso o popup sugestivo\nnunca aparece por cima; só quando a tela estiver limpa.",
    "source_path": "src/components/GuideAiChat.tsx",
    "audience": [],
    "content_hash": "872221f36316c88d42026deaec7339ff"
  },
  {
    "doc_key": "rule:src/components/handoff/AudioRecorderButton.tsx:352",
    "kind": "rule",
    "title": "Regra em AudioRecorderButton.tsx",
    "content": "Começa a gravar sozinho ao montar, sem esperar o clique no microfone.\nUsado pelos \"Registros da reserva\" (07/09/2026): lá a categoria é\nperguntada ANTES, e a gravação precisa começar assim que a pessoa\nescolhe — sem um segundo toque. O chat com hóspede não passa esta prop\ne segue exatamente como antes (só grava ao tocar no microfone).",
    "source_path": "src/components/handoff/AudioRecorderButton.tsx",
    "audience": [],
    "content_hash": "72ecc10611abbec39b47addf405d3ed6"
  },
  {
    "doc_key": "rule:src/components/ResponsiveDialog.tsx:1117",
    "kind": "rule",
    "title": "Regra em ResponsiveDialog.tsx",
    "content": "true (padrão, comportamento inalterado): o conteúdo inteiro (cabeçalho +\ncorpo + rodapé) rola como um bloco único — é preciso descer até o fim\npara alcançar o rodapé.\nfalse: o próprio conteúdo controla o scroll internamente (ex.: cabeçalho\ne rodapé fixos, só a área do meio rola) — use quando o rodapé precisa\nficar sempre visível na tela.",
    "source_path": "src/components/ResponsiveDialog.tsx",
    "audience": [],
    "content_hash": "d8d103f972a9c212fdf3caff1c946ead"
  },
  {
    "doc_key": "rule:src/lib/access-pin-window.server.ts:0",
    "kind": "rule",
    "title": "Regra em access-pin-window.server.ts",
    "content": "Janela de liberação do código de acesso (Wi-Fi/portão/fechadura) protegido\npor `access_codes_pin`.\n\nRegra de negócio já existente e correta no agente de IA\n(`src/lib/ai/context.server.ts`, `pinReleaseAt`): o código só deve ficar\ndisponível a partir de 24h antes do horário de check-in até o horário de\ncheck-out da reserva vigente. Este módulo replica exatamente a mesma\nfórmula (mesmo cálculo de 24h antes do check-in, mesmo horário de\ncheck-out como fechamento) para aplicá-la também no caminho que\nefetivamente libera os dados para o hóspede (`getPublicGuide` /\n`submitAccessPin`, em `src/lib/guide.functions.ts`) — hoje esse caminho só\nconfere se o PIN digitado bate com o cadastrado, sem nenhuma checagem de\ndata, permitindo acesso fora da janela sempre que o PIN correto é\ninformado (ex.: código reutilizado após o check-out, ou compartilhado\nantes da liberação prevista).\n\nQuando a propriedade não tem NENHUMA reserva/registro de chegada\ncadastrado (nem `guide_access_logs`, nem `property_reservations`\nsincronizada do Airbnb), não há dado real contra o qual aplicar a janela —\nnesse caso mantemos o comportamento atual (liberado só pelo PIN), para não\nquebrar anfitriões que usam esse campo sem registrar chegadas no sistema.",
    "source_path": "src/lib/access-pin-window.server.ts",
    "audience": [],
    "content_hash": "23c6602aec44cbe86c742c522f47ed75"
  },
  {
    "doc_key": "rule:src/lib/ai-learning.functions.ts:0",
    "kind": "rule",
    "title": "Regra em ai-learning.functions.ts",
    "content": "API interna do Continuous Learning Loop.\n\nToda função é autenticada e opera dentro do tenant do chamador. Aprovação de\nconhecimento é sempre humana e registra o revisor.",
    "source_path": "src/lib/ai-learning.functions.ts",
    "audience": [],
    "content_hash": "52bbdaf6fc74295782c61c55e989d1b0"
  },
  {
    "doc_key": "rule:src/lib/ai-ops.functions.ts:0",
    "kind": "rule",
    "title": "Regra em ai-ops.functions.ts",
    "content": "API interna (admin/anfitrião) das camadas de Avaliação, Observabilidade,\nCanais e Inteligência Proativa. Toda função é autenticada e sempre opera\ndentro do tenant do chamador — nunca aceita tenant vindo do cliente.",
    "source_path": "src/lib/ai-ops.functions.ts",
    "audience": [],
    "content_hash": "f1fc91a7861b441ff498990f643b577b"
  },
  {
    "doc_key": "rule:src/lib/ai-supervision.functions.ts:0",
    "kind": "rule",
    "title": "Regra em ai-supervision.functions.ts",
    "content": "Supervisão da IA (backend): fila de perguntas ao humano e aprovação de\nconhecimento aprendido. Sem UI — apenas a camada de dados/RPC.\n\nSTATUS (auditoria de continuidade — ver AUDITORIA_IA_CONCIERGE.md):\n- `answerEscalation` está REDUNDANTE desde a correção em `handoff.functions.ts`\n (`sendHandoffMessage`), que já marca escalonamentos pendentes como respondidos\n automaticamente quando um humano responde pelo dock — sem precisar desta rota.\n- `listLearningCandidates`/`reviewLearningCandidate` duplicam, sem nenhum\n consumidor de UI confirmado, a pipeline REAL de aprovação de conhecimento\n que já existe em `@/lib/ai-learning.functions.ts` (essa sim usada por\n `admin.ia.tsx`) — que por sua vez lê a mesma tabela `ai_learning_candidates`\n e já cobre corretamente as candidatas criadas por `queueLearningCandidate`\n (via fallback `row.extracted_information ?? row.proposed_memory`).\n- Não removemos este arquivo agora por não ser possível confirmar com 100% de\n certeza que nenhum consumidor externo (app mobile, cron, integração) o chama\n diretamente pelo nome da server function. Antes de apagar de vez, confirme\n isso no seu ambiente e então remova este arquivo e as duas funções análogas\n em `human-loop/learning.server.ts` (`approveLearningCandidate`/`rejectLearningCandidate`).",
    "source_path": "src/lib/ai-supervision.functions.ts",
    "audience": [],
    "content_hash": "5de840274d54a5d2545a7d5a67e1386a"
  },
  {
    "doc_key": "rule:src/lib/ai/agents/proactive/engine.server.ts:0",
    "kind": "rule",
    "title": "Regra em engine.server.ts",
    "content": "Event Intelligence Engine + execução das ações proativas.\n\nVarre reservas, memória operacional e memória de hóspede para produzir\nsinais; cruza os sinais com o Proactive Rules Engine; grava as ações em\n`ai_proactive_actions` respeitando o limite de autonomia.\n\nNada é enviado ao hóspede aqui: ações de autonomia baixa ficam prontas para\nexecução, médias aguardam validação e altas sempre exigem humano.",
    "source_path": "src/lib/ai/agents/proactive/engine.server.ts",
    "audience": [],
    "content_hash": "b7f0457e583c8634aea4e1710a3912e9"
  },
  {
    "doc_key": "rule:src/lib/ai/agents/proactive/sender.server.ts:0",
    "kind": "rule",
    "title": "Regra em sender.server.ts",
    "content": "Execução real das ações proativas de baixa autonomia (FASE — envio real).\n\n`engine.server.ts` já grava, em `ai_proactive_actions`, ações de autonomia\n\"low\" já como `status: \"approved\"` (aprovação automática — é a própria\nregra que decide que dispensa humano, ver `approvalFor` em `./rules`).\n`markActionExecuted` já existia para marcar uma ação como executada, mas\nnada nunca chamava nem essa função nem disparava a mensagem em si — as\nações ficavam para sempre \"aprovadas\" e nunca chegavam ao hóspede. Este\nmódulo fecha esse último passo, só para as regras que são, de fato,\nmensagens ao hóspede (não para \"reservation_briefing\"/\"returning_guest_\nrecognition\", que são anotações internas, não texto a enviar).\n\nCanal: reaproveita o WhatsApp já conectado pelo anfitrião\n(`sendWhatsappText`, mesma credencial usada no atendimento humano/IA).\nSem WhatsApp conectado, ou sem telefone do hóspede localizado, a ação é\nmarcada como falha com o motivo — nunca fica reprocessando para sempre,\nmas também nunca finge ter enviado algo que não foi.\n\nTelefone do hóspede: reservas sincronizadas do Airbnb (`property_reservations`,\nfonte do gatilho checkin/checkout) não trazem telefone — o iCal do Airbnb\nnão expõe isso. O telefone só existe quando o hóspede preencheu o\nformulário de chegada no próprio guia (`guide_access_logs`). Por isso\ncruzamos pela MESMA janela de datas (check-in/check-out) do mesmo imóvel —\ncomo um imóvel só tem uma estadia ativa por vez, esse cruzamento é seguro.\nSem log correspondente com telefone, não há para quem enviar.",
    "source_path": "src/lib/ai/agents/proactive/sender.server.ts",
    "audience": [],
    "content_hash": "1517a837b46b66e93ebfeb037cc04b36"
  },
  {
    "doc_key": "rule:src/lib/ai/alerts/engine.server.ts:0",
    "kind": "rule",
    "title": "Regra em engine.server.ts",
    "content": "Intelligent Alerts Engine.\n\nCompara a janela recente com a janela anterior e materializa alertas em\n`ai_alerts`. Roda no cron — nunca no caminho de resposta ao hóspede.",
    "source_path": "src/lib/ai/alerts/engine.server.ts",
    "audience": [],
    "content_hash": "26fcaa1a003bd2af6a02268f23225aae"
  },
  {
    "doc_key": "rule:src/lib/ai/assistant-tools.server.ts:0",
    "kind": "rule",
    "title": "Regra em assistant-tools.server.ts",
    "content": "Ferramentas do Assistente do Painel (07/09/2026).\n\nDuas famílias, com garantias diferentes:\n\n LEITURA — consultam os dados reais da conta. Todas usam o cliente Supabase\n DO USUÁRIO (nunca o admin), então o RLS decide o que cada pessoa enxerga.\n É isso que faz \"prestador só recebe resposta sobre o que ele já podia ver\"\n ser verdade por construção, e não por uma regra escrita no prompt — que o\n modelo poderia ignorar.\n\n PREPARAÇÃO — resolvem uma intenção (\"abre uma pendência no 105\") em um\n payload pronto, mas NÃO gravam. Devolvem a ação e o texto do cartão de\n confirmação; quem grava é o clique da pessoa, na interface. Ver o comentário\n de `assistant-types.ts` para o porquê.",
    "source_path": "src/lib/ai/assistant-tools.server.ts",
    "audience": [],
    "content_hash": "c1ce0cdb28e49031425478368dfab246"
  },
  {
    "doc_key": "rule:src/lib/ai/assistant-tools.server.ts:21221",
    "kind": "rule",
    "title": "Regra em assistant-tools.server.ts",
    "content": "PENDÊNCIA PARECIDA JÁ EXISTENTE — pedido explícito (08/09/2026):\n\"se tiver uma pendência parecida com essa que está sendo solicitada,\nvocê não tem que gravar uma nova. Você precisa perguntar para o\nusuário se ele quer gravar mesmo assim\".\n\n\"Parecida\" é comparação do TÍTULO normalizado (sem acento, sem\ncaixa, sem espaço sobrando) entre as pendências ABERTAS do imóvel:\né o que a pessoa reconhece como \"essa já existe\". Comparar por\nsemelhança semântica seria mais esperto e menos previsível — e aqui\nprevisibilidade vale mais, porque o custo do erro é duplicar\nsilenciosamente uma rotina em dezenas de imóveis.",
    "source_path": "src/lib/ai/assistant-tools.server.ts",
    "audience": [],
    "content_hash": "387889c0801095ecc9769eaf2fb9135f"
  },
  {
    "doc_key": "rule:src/lib/ai/assistant-tools.server.ts:25234",
    "kind": "rule",
    "title": "Regra em assistant-tools.server.ts",
    "content": "VÁRIAS pendências, UM cartão — arquivar, reabrir ou EXCLUIR de vez.\n\nPedido explícito (09/09/2026): \"remova todas as pendências que você\ncriou agora, de todos os imóveis\" e, na sequência, \"exclua\ndefinitivamente, não quero arquivar\". A IA respondeu que não conseguia\n— e estava certa: não havia ferramenta. Mesma lição da criação em\nlote: o que limita a autonomia quase nunca é o cartão de confirmação,\né a COBERTURA. Sem ação em lote, desfazer uma criação em quinze\nimóveis eram quinze cartões; sem exclusão, \"desfazer\" deixava quinze\nlinhas mortas atrás de um filtro.\n\nA busca é por TÍTULO normalizado (sem acento, sem caixa) porque é\nassim que a pessoa se refere a elas — \"as de limpeza dos filtros\" — e\nporque foi assim que o lote as criou. Sem busca, pega todas as abertas\ndo escopo visível.",
    "source_path": "src/lib/ai/assistant-tools.server.ts",
    "audience": [],
    "content_hash": "f2e918e1f71ceaccd888a58bc4aeba73"
  },
  {
    "doc_key": "rule:src/lib/ai/assistant-tools.server.ts:42790",
    "kind": "rule",
    "title": "Regra em assistant-tools.server.ts",
    "content": "A ÚNICA ferramenta que grava na hora, sem cartão — e por um motivo\nlógico, não por exceção: ela É o cartão. Pedir confirmação para\ndesligar a confirmação seria uma piada.\n\nPedido explícito (09/09/2026): \"se o usuário pedir 'dispense a\nconfirmação', então ela tem que acatar e manter isso memorizado para\naquele usuário específico\".\n\nO que ela NÃO faz: ampliar permissão. Com a chave ligada, cada\ngravação continua passando pela MESMA server function da tela e pelo\nMESMO RLS — quem não pode arquivar uma pendência continua não podendo,\ne a falha aparece igual. O que sai é o clique, não a checagem.\n\nEscreve em `profiles` com o cliente do PRÓPRIO usuário: o RLS\n(\"profiles update own\") garante sozinho que ninguém mude a preferência\nde outra pessoa, sem nenhuma checagem extra aqui.",
    "source_path": "src/lib/ai/assistant-tools.server.ts",
    "audience": [],
    "content_hash": "43a4dc370011c06bfb8946cd8f24d2b8"
  },
  {
    "doc_key": "rule:src/lib/ai/audit/events.server.ts:0",
    "kind": "rule",
    "title": "Regra em events.server.ts",
    "content": "Enterprise Audit Trail — Event Log Engine.\n\nÚnico ponto autorizado a gravar em `ai_system_events`. Registra QUEM fez,\nQUANDO, EM QUAL CONTA, COM QUAL PERMISSÃO, POR QUE, DE ONDE e O RESULTADO.\n\nPolítica de privacidade do raciocínio: nunca gravamos chain-of-thought.\nSomente motivo estruturado, classificação e evidências utilizadas.",
    "source_path": "src/lib/ai/audit/events.server.ts",
    "audience": [],
    "content_hash": "5eccbe5fbb591ffefc1ba818481afcd1"
  },
  {
    "doc_key": "rule:src/lib/ai/audit/platform.server.ts:0",
    "kind": "rule",
    "title": "Regra em platform.server.ts",
    "content": "Atalhos de auditoria para o SaaS INTEIRO (não só IA).\n\nQualquer módulo server-side pode registrar um evento sem se preocupar com\ncliente Supabase ou com o formato da tabela. Auditoria nunca derruba a\noperação principal — todos os helpers engolem erros.",
    "source_path": "src/lib/ai/audit/platform.server.ts",
    "audience": [],
    "content_hash": "5c4af37b492d3fcb3ccec39e03e3fbb4"
  },
  {
    "doc_key": "rule:src/lib/ai/channels/gateway.server.ts:0",
    "kind": "rule",
    "title": "Regra em gateway.server.ts",
    "content": "Channel Gateway — abstração de origem da mensagem.\n\nRegistra o canal de cada conversa (`ai_conversation_channels`) e entrega ao\nnúcleo apenas o formato normalizado. Novos canais (WhatsApp, Airbnb Inbox,\nBooking, e-mail, app próprio) entram registrando um adaptador aqui — nenhuma\nlinha do Agent Core precisa mudar.",
    "source_path": "src/lib/ai/channels/gateway.server.ts",
    "audience": [],
    "content_hash": "ab397c63c0753e79b1b0f2a6c74c58f9"
  },
  {
    "doc_key": "rule:src/lib/ai/context.server.ts:2349",
    "kind": "rule",
    "title": "Regra em context.server.ts",
    "content": "O nome do imóvel é a resposta para \"qual é o meu apartamento\".\n\nUm guia pertence a UM imóvel, e o hóspede que está conversando abriu o\nguia daquele imóvel: não existe ambiguidade sobre em que unidade ele está.\nA frase abaixo diz isso ao modelo em vez de deixar que ele deduza —\nporque, deduzindo, ele já preferiu um número solto no meio das instruções\ndo anfitrião ao nome cadastrado, e devolveu uma pergunta a quem só queria\no número da porta (caso real, 08/09/2026).",
    "source_path": "src/lib/ai/context.server.ts",
    "audience": [],
    "content_hash": "7fd994f604a5935503b16bbd026b35bf"
  },
  {
    "doc_key": "rule:src/lib/ai/conversation/core.server.ts:0",
    "kind": "rule",
    "title": "Regra em core.server.ts",
    "content": "Omnichannel Conversation Core.\n\nUma única Conversation Entity por hóspede/imóvel, independentemente do canal.\nWhatsApp e chat da plataforma escrevem no MESMO registro (`ai_conversations`)\ne no MESMO histórico (`ai_messages`). O canal só define para onde a resposta\nvolta — nunca cria uma conversa paralela.\n\nEste módulo é aditivo: as tabelas legadas (`property_chat_*`) continuam\nfuncionando e são espelhadas aqui via `legacy_conversation_id`.",
    "source_path": "src/lib/ai/conversation/core.server.ts",
    "audience": [],
    "content_hash": "53d44b263dd90413c1da2d1847a20e4a"
  },
  {
    "doc_key": "rule:src/lib/ai/evaluation/engine.server.ts:0",
    "kind": "rule",
    "title": "Regra em engine.server.ts",
    "content": "AI Agent Evaluation Engine.\n\nExecuta a biblioteca de cenários contra o pipeline REAL (mesmo orquestrador\nusado em produção), compara com o comportamento esperado, calcula o Agent\nQuality Score e persiste tudo em `ai_agent_evaluations`.\n\nNunca envia mensagem ao hóspede: roda em superfície isolada (\"evaluation\").",
    "source_path": "src/lib/ai/evaluation/engine.server.ts",
    "audience": [],
    "content_hash": "c42e1252519cbdc4bb69c18abd97ad4a"
  },
  {
    "doc_key": "rule:src/lib/ai/evaluation/regression.server.ts:0",
    "kind": "rule",
    "title": "Regra em regression.server.ts",
    "content": "Regression Testing.\n\nCompara cada execução de cenário com a última execução registrada do mesmo\ncaso no mesmo tenant. Toda mudança de prompt, modelo, ferramenta, regra de\nagente ou memória passa por aqui antes de ir para produção.",
    "source_path": "src/lib/ai/evaluation/regression.server.ts",
    "audience": [],
    "content_hash": "8e948ef1fef50aa5eb76b9a25449d422"
  },
  {
    "doc_key": "rule:src/lib/ai/gateway.server.ts:11418",
    "kind": "rule",
    "title": "Regra em gateway.server.ts",
    "content": "Recebe o texto da resposta conforme ele é escrito, para a interface poder\nmostrar em vez de esperar. Ver `postResponses`.\n\nO agente pode dar VÁRIAS voltas (uma por rodada de ferramentas), e cada\nvolta pode escrever texto. Por isso vem junto o número do passo: quem\nescuta descarta o que veio de um passo anterior quando um novo começa a\nescrever — senão o preâmbulo de uma rodada intermediária ficaria colado na\nresposta final.",
    "source_path": "src/lib/ai/gateway.server.ts",
    "audience": [],
    "content_hash": "0500caf69496790cae2bb38de2112e6c"
  },
  {
    "doc_key": "rule:src/lib/ai/governance/tenant-knowledge.server.ts:0",
    "kind": "rule",
    "title": "Regra em tenant-knowledge.server.ts",
    "content": "Knowledge Governance — Conhecimento da Operação (`ai_tenant_knowledge`).\n\nRegras internas da empresa: políticas, procedimentos, fornecedores.\nNão duplica dados do imóvel (PROPERTY_DATA continua sendo a fonte oficial).",
    "source_path": "src/lib/ai/governance/tenant-knowledge.server.ts",
    "audience": [],
    "content_hash": "4364d0d847f392156d08c8d8c3379325"
  },
  {
    "doc_key": "rule:src/lib/ai/human-loop/escalations.server.ts:0",
    "kind": "rule",
    "title": "Regra em escalations.server.ts",
    "content": "Human-in-the-Loop — a IA pergunta ao supervisor humano quando não sabe.\n\nFluxo: a IA registra a dúvida (`ai_human_escalations`), avisa o hóspede que\nestá confirmando com a equipe e NUNCA inventa a resposta. Quando um humano\nresponde, a decisão volta para a conversa e vira candidata a conhecimento.",
    "source_path": "src/lib/ai/human-loop/escalations.server.ts",
    "audience": [],
    "content_hash": "49bc16f58184112976389f837099bfc2"
  },
  {
    "doc_key": "rule:src/lib/ai/human-loop/learning.server.ts:0",
    "kind": "rule",
    "title": "Regra em learning.server.ts",
    "content": "Knowledge Distillation + Approval Flow.\n\nToda decisão humana vira candidata a conhecimento (`ai_learning_candidates`).\nNada entra na memória de longo prazo sem aprovação explícita de um humano —\ne uma exceção pontual nunca vira regra permanente (vira exceção temporária).",
    "source_path": "src/lib/ai/human-loop/learning.server.ts",
    "audience": [],
    "content_hash": "ae972fa05a8b175c30900b6a3b5196a6"
  },
  {
    "doc_key": "rule:src/lib/ai/learning/conversation-analyzer.server.ts:0",
    "kind": "rule",
    "title": "Regra em conversation-analyzer.server.ts",
    "content": "FASE 1 — Conversation Analyzer.\n\nApós uma conversa encerrada, reconstrói o que aconteceu a partir do rastro\njá existente (`ai_agent_logs`, `ai_human_escalations`, feedback do hóspede)\ne classifica o desfecho: SUCCESS, PARTIAL, FAILURE ou LEARNING_OPPORTUNITY.\n\nNunca lança: análise jamais pode quebrar o atendimento.",
    "source_path": "src/lib/ai/learning/conversation-analyzer.server.ts",
    "audience": [],
    "content_hash": "267ad7c02826c8cd3d30ffb8adaa3d29"
  },
  {
    "doc_key": "rule:src/lib/ai/learning/gaps.server.ts:0",
    "kind": "rule",
    "title": "Regra em gaps.server.ts",
    "content": "FASE 7 — Automatic Knowledge Gap Detection.\n\nConsolida perguntas recorrentes que a IA não soube responder em\n`ai_knowledge_gaps`, para o anfitrião ver o que falta na base.",
    "source_path": "src/lib/ai/learning/gaps.server.ts",
    "audience": [],
    "content_hash": "a8ca9f55200a220bb0dc42ae2392a4aa"
  },
  {
    "doc_key": "rule:src/lib/ai/learning/knowledge-extraction.server.ts:0",
    "kind": "rule",
    "title": "Regra em knowledge-extraction.server.ts",
    "content": "FASE 2 — Knowledge Extraction Engine.\n\nLê a conversa analisada e extrai conhecimento reutilizável: regras implícitas\nditas por humanos, instruções operacionais e lacunas de base. Nunca grava\nmemória — apenas propõe candidatos.",
    "source_path": "src/lib/ai/learning/knowledge-extraction.server.ts",
    "audience": [],
    "content_hash": "197b0f3627004a3b3eb0041ec8f9812e"
  },
  {
    "doc_key": "rule:src/lib/ai/learning/loop.server.ts:0",
    "kind": "rule",
    "title": "Regra em loop.server.ts",
    "content": "Continuous Learning Loop — orquestrador.\n\nEncadeia: Analyzer → Extraction → Validation → Candidate → Gaps → Memory\nIntelligence. Assíncrono e tolerante a falhas: nunca afeta o atendimento.\n\nSEGURANÇA (FASE 11): todo conhecimento nasce com origem rastreável\n(conversa + tenant), passa por validação de risco/escopo e só entra na\nmemória de longo prazo após aprovação humana explícita.",
    "source_path": "src/lib/ai/learning/loop.server.ts",
    "audience": [],
    "content_hash": "fe100de0c302503c5f4368e3e579dcc6"
  },
  {
    "doc_key": "rule:src/lib/ai/learning/memory-intelligence.server.ts:0",
    "kind": "rule",
    "title": "Regra em memory-intelligence.server.ts",
    "content": "FASE 8 — Memory Intelligence.\n\nMemórias ganham peso quando ajudam e perdem quando aparecem em conversas\nmalsucedidas. Memórias com falha recorrente expiram para revisão humana.",
    "source_path": "src/lib/ai/learning/memory-intelligence.server.ts",
    "audience": [],
    "content_hash": "23c45883d8ce10f5ab52fe7db20dcf3e"
  },
  {
    "doc_key": "rule:src/lib/ai/learning/prompt-optimizer.server.ts:0",
    "kind": "rule",
    "title": "Regra em prompt-optimizer.server.ts",
    "content": "FASE 6 — Prompt Improvement Engine.\n\nDetecta padrões repetidos de falha e propõe ajustes de prompt em\n`ai_prompt_change_candidates`. NUNCA altera prompt automaticamente:\n`prompts.ts` continua sendo a única fonte de verdade, editada por humanos.",
    "source_path": "src/lib/ai/learning/prompt-optimizer.server.ts",
    "audience": [],
    "content_hash": "e8b7a1c5c66213a66c9b64805adf47c0"
  },
  {
    "doc_key": "rule:src/lib/ai/learning/validation.server.ts:0",
    "kind": "rule",
    "title": "Regra em validation.server.ts",
    "content": "FASE 4 — Knowledge Validation Agent.\n\nAntes de qualquer candidato virar conhecimento, um segundo agente avalia\nrisco, escopo e conflito com memórias já existentes. Ele só pode RESTRINGIR\n(rebaixar escopo, exigir humano) — nunca ampliar.",
    "source_path": "src/lib/ai/learning/validation.server.ts",
    "audience": [],
    "content_hash": "742b416d97aad769f237909e8fa03d20"
  },
  {
    "doc_key": "rule:src/lib/ai/memory/guest-context.server.ts:0",
    "kind": "rule",
    "title": "Regra em guest-context.server.ts",
    "content": "Guest Context Engine.\n\nMonta automaticamente, antes do Planner Agent, tudo que um operador\nexperiente saberia sobre o atendimento:\n identidade do hóspede → reserva atual → imóvel → histórico recente →\n problemas anteriores → preferências → idioma → sentimento.\n\nO contexto é injetado no raciocínio do agente, NUNCA exposto ao hóspede.",
    "source_path": "src/lib/ai/memory/guest-context.server.ts",
    "audience": [],
    "content_hash": "74029b0b7b5610788296c352c440e601"
  },
  {
    "doc_key": "rule:src/lib/ai/memory/policy.server.ts:0",
    "kind": "rule",
    "title": "Regra em policy.server.ts",
    "content": "Política de gravação de memória.\n\nNem toda mensagem vira memória. Uma classificação decide o que merece\npersistir:\n\n SIM: preferência explícita do hóspede, problema operacional, solução\n aplicada, informação relevante do imóvel, decisão operacional.\n NÃO: conversa casual, dúvida pontual sem valor futuro, informação efêmera,\n dado sensível desnecessário (documento, cartão, senha, endereço\n completo de terceiros).\n\nA classificação usa um modelo rápido, com heurística de segurança por cima:\nnada sensível é gravado, mesmo que o modelo sugira.",
    "source_path": "src/lib/ai/memory/policy.server.ts",
    "audience": [],
    "content_hash": "920957bc854f617ec6f06bc14c329fe0"
  },
  {
    "doc_key": "rule:src/lib/ai/memory/retrieval.server.ts:0",
    "kind": "rule",
    "title": "Regra em retrieval.server.ts",
    "content": "Memory Retrieval System — recuperação inteligente e pontuada de memórias.\n\nNunca carrega o histórico inteiro. Recupera candidatas por similaridade\nsemântica (pgvector) + busca textual, e as pontua por:\n\n Tier 1 contexto da reserva atual (mesmo hóspede, mesma estadia)\n Tier 2 problemas recentes do mesmo imóvel\n Tier 3 preferências do hóspede\n Tier 4 histórico antigo relevante\n Tier 5 memórias genéricas\n\nFatores adicionais: relevância semântica, decaimento temporal, confiança da\norigem, importância e relação com a categoria da solicitação.\n\nREGRA DE OURO: memória NUNCA é verdade absoluta. Toda memória entregue ao\nagente vem carimbada com origem, data e confiança, e é explicitamente\nsubordinada às fontes oficiais no Ranking Permanente de Fontes.",
    "source_path": "src/lib/ai/memory/retrieval.server.ts",
    "audience": [],
    "content_hash": "bfb758d33d6015319ee1646cf7e767f5"
  },
  {
    "doc_key": "rule:src/lib/ai/memory/shortterm.server.ts:0",
    "kind": "rule",
    "title": "Regra em shortterm.server.ts",
    "content": "Short-Term Memory — memória viva da conversa atual.\n\nGuarda, por conversa: mensagens recentes, intenção corrente, entidades\nidentificadas, ferramentas chamadas e seus resultados, decisões do planner\ne contexto temporário da sessão. Permite continuidade dentro da mesma\ninteração (\"meu ar parou\" → \"é no quarto principal\").\n\nPersistência: cache em processo com TTL. Como o runtime é serverless e pode\nreciclar isolates, a camada é sempre reconstruída de forma resiliente a\npartir do histórico da conversa (`seedFromHistory`) — nunca é fonte única\nde verdade nem substitui a Long-Term Memory.",
    "source_path": "src/lib/ai/memory/shortterm.server.ts",
    "audience": [],
    "content_hash": "ebcb5115e572b1b9e6479729def45d01"
  },
  {
    "doc_key": "rule:src/lib/ai/models.ts:1382",
    "kind": "rule",
    "title": "Regra em models.ts",
    "content": "Assistente do Painel — o concierge interno dos operadores.\n\nPrecisa ser um modelo OpenAI: ele é o único caminho de tool calling nesta\narquitetura (`runAgent` fala com a Responses API), e o assistente depende\nde ferramentas tanto para ler a operação quanto para montar uma ação. Um\nmodelo mais barato aqui não é uma troca de qualidade por custo — é ficar\nsem ferramenta nenhuma.",
    "source_path": "src/lib/ai/models.ts",
    "audience": [],
    "content_hash": "12e9246567a67eb7f39dc17f1206515f"
  },
  {
    "doc_key": "rule:src/lib/ai/observability/metrics.server.ts:0",
    "kind": "rule",
    "title": "Regra em metrics.server.ts",
    "content": "AI Observability Platform — métricas operacionais.\n\nAgrega `ai_agent_logs`, `ai_operational_memory`, `ai_human_escalations` e\n`ai_agent_evaluations` em séries persistidas em `ai_agent_metrics`.\nTudo é sempre calculado dentro do tenant.",
    "source_path": "src/lib/ai/observability/metrics.server.ts",
    "audience": [],
    "content_hash": "16efad27041a3cadd984207eed26d5d1"
  },
  {
    "doc_key": "rule:src/lib/ai/observability/root-cause.server.ts:0",
    "kind": "rule",
    "title": "Regra em root-cause.server.ts",
    "content": "Root Cause Analysis — \"por que essa resposta aconteceu?\".\n\nMonta (e depois recupera) o rastro completo de uma interação: agente\nescolhido, contexto usado, memórias recuperadas, ferramentas chamadas,\nfontes consultadas e a decisão final.",
    "source_path": "src/lib/ai/observability/root-cause.server.ts",
    "audience": [],
    "content_hash": "d83a74c35e881710671cd72249217e20"
  },
  {
    "doc_key": "rule:src/lib/ai/orchestrator.server.ts:29377",
    "kind": "rule",
    "title": "Regra em orchestrator.server.ts",
    "content": "A RESPOSTA PARCIAL DE UMA ESCALAÇÃO TAMBÉM PASSA PELO VALIDADOR.\n\nO bloco grande acima roda com `!handoffReason`: quando o modelo escala, a\nchecagem anti-alucinação e a autoavaliação eram puladas inteiras e a\nconfiança virava 1 por decreto. Só que o prompt MANDA responder\nparcialmente antes de escalar — então justamente o texto entregue no\nmomento mais delicado era o único que ninguém revisava.\n\nFoi assim que saiu, para um hóspede que perguntou em que apartamento\nestava, um \"não consegui localizar sua reserva\" que o contexto\ndesmentia (08/09/2026). A checagem é barata perto do estrago.\n\nReprovado, o texto não é remendado: cai para uma frase curta e honesta.\nQuem continua a conversa é a pessoa que recebeu a escalação.",
    "source_path": "src/lib/ai/orchestrator.server.ts",
    "audience": [],
    "content_hash": "6421e59807ab173ca9d54a11e289e332"
  },
  {
    "doc_key": "rule:src/lib/ai/orchestrator.server.ts:4312",
    "kind": "rule",
    "title": "Regra em orchestrator.server.ts",
    "content": "Opções curtas de resposta rápida (botões) — [] quando a resposta não é\numa pergunta de múltipla escolha. O hóspede sempre pode digitar livre.",
    "source_path": "src/lib/ai/orchestrator.server.ts",
    "audience": [],
    "content_hash": "b363c30ad7d651fa7ca1b6cfc775680f"
  },
  {
    "doc_key": "rule:src/lib/ai/orchestrator.server.ts:5535",
    "kind": "rule",
    "title": "Regra em orchestrator.server.ts",
    "content": "Datas da reserva — usadas para vincular o roteiro (itinerário) à\nRESERVA, não ao hóspede individual: mais de uma pessoa pode estar\nconversando sobre a mesma reserva (casal, cada um pelo próprio\ncelular), e todos precisam ver o mesmo roteiro compartilhado.",
    "source_path": "src/lib/ai/orchestrator.server.ts",
    "audience": [],
    "content_hash": "b2317eaba815caf04ea6f76f3bff779e"
  },
  {
    "doc_key": "rule:src/lib/ai/planner.server.ts:0",
    "kind": "rule",
    "title": "Regra em planner.server.ts",
    "content": "Planner Agent — etapa anterior ao Tool Calling.\n\nDecide o plano mínimo de investigação: quais ferramentas realmente precisam\nser usadas, se podem rodar em paralelo e se o caso já nasce para humano.\nRoda em modelo rápido e barato; falhas nunca bloqueiam o atendimento\n(o agente principal continua com autonomia total de tool calling).",
    "source_path": "src/lib/ai/planner.server.ts",
    "audience": [],
    "content_hash": "db39445307d3c91ddfc488cf5460abca"
  },
  {
    "doc_key": "rule:src/lib/ai/prompts.ts:67",
    "kind": "rule",
    "title": "Regra em prompts.ts",
    "content": "Registro versionado de prompts (Prompt Versioning).\n\nTodo prompt usado pelo agente vive aqui com uma versão explícita. A versão\n(e o hash do conteúdo) é registrada em `ai_agent_logs` a cada interação,\npermitindo auditoria, comparação entre versões e evolução controlada.\n\nREGRA: ao editar o texto de um prompt, incremente a `version` correspondente.",
    "source_path": "src/lib/ai/prompts.ts",
    "audience": [],
    "content_hash": "5a509cc5762f76525f390cd4f786a869"
  },
  {
    "doc_key": "rule:src/lib/ai/reflection.server.ts:0",
    "kind": "rule",
    "title": "Regra em reflection.server.ts",
    "content": "Reflection Step — autoavaliação da resposta antes do envio ao hóspede.\n\nAvalia clareza, precisão, consistência e tom, e pode devolver uma versão\nmelhorada da redação (sem inventar informação nova). Falhas nunca bloqueiam\no atendimento: a resposta original segue com score neutro.",
    "source_path": "src/lib/ai/reflection.server.ts",
    "audience": [],
    "content_hash": "c74cb990d8b09b4ceeb514f126510d44"
  },
  {
    "doc_key": "rule:src/lib/ai/reservation-mode.server.ts:0",
    "kind": "rule",
    "title": "Regra em reservation-mode.server.ts",
    "content": "Modo da reserva: individual ou grupo — decidido pelos PRÓPRIOS hóspedes,\nnunca forçado pelo sistema. Quando mais de uma pessoa aparece vinculada à\nmesma reserva (mesmo imóvel + mesmas datas, nomes diferentes), a IA avisa\ne pergunta se querem tratar assuntos como roteiro em conjunto. Só vira\n\"grupo\" de verdade quando TODAS as pessoas que já apareceram nessa\nreserva votaram \"grupo\" — enquanto isso não acontece (ninguém votou,\nvotos incompletos, ou alguém prefere separado), cada um continua isolado.",
    "source_path": "src/lib/ai/reservation-mode.server.ts",
    "audience": [],
    "content_hash": "7b7e40ec6950949911fb9d07891c4feb"
  },
  {
    "doc_key": "rule:src/lib/ai/system-knowledge.server.ts:0",
    "kind": "rule",
    "title": "Regra em system-knowledge.server.ts",
    "content": "Conhecimento do Assistente do Painel sobre o próprio sistema (07/09/2026).\n\nDois lados:\n\n `reindexSystemKnowledge` — sobe o que o extrator gerou no build\n (`src/generated/system-knowledge.json`) para `ai_system_docs`. Compara\n `content_hash` antes de gastar embedding: numa entrega que mexe em três\n arquivos, só esses três trechos são reprocessados. É o que torna barato\n rodar isso a cada deploy — e é rodar a cada deploy que faz o assistente\n conhecer as novidades sem ninguém escrever documentação.\n\n `retrieveSystemKnowledge` — busca híbrida (vetorial + textual) sobre esse\n material. Mesmo desenho do `rag.server.ts` que serve o agente do hóspede,\n com uma diferença: aqui não há filtro por conta, porque o conhecimento do\n produto é o mesmo para todo mundo. Por isso ele mora numa tabela separada:\n se estivesse junto do conteúdo dos anfitriões, um bug de filtro exporia\n documentação interna numa conversa com hóspede.",
    "source_path": "src/lib/ai/system-knowledge.server.ts",
    "audience": [],
    "content_hash": "05f96a45622bfb4c5291b58140b1a8c1"
  },
  {
    "doc_key": "rule:src/lib/ai/tenant/context.server.ts:0",
    "kind": "rule",
    "title": "Regra em context.server.ts",
    "content": "Tenant Isolation Layer.\n\nToda leitura/escrita da IA acontece dentro de um tenant (empresa). O tenant\né o dono da conta (`owner_id` do imóvel): usuários, imóveis, hóspedes,\nmemórias, conhecimento e agentes de uma empresa nunca podem cruzar para\noutra. Este módulo é o único lugar autorizado a resolver e validar o tenant.",
    "source_path": "src/lib/ai/tenant/context.server.ts",
    "audience": [],
    "content_hash": "0c1676ec634fdec26972bb1388d049a3"
  },
  {
    "doc_key": "rule:src/lib/ai/tools.server.ts:0",
    "kind": "rule",
    "title": "Regra em tools.server.ts",
    "content": "Sistema de Ferramentas (Tool Calling).\nCada integração é uma ferramenta independente e auditável. O agente decide\nquais acionar antes de responder — nunca responde por conhecimento próprio.",
    "source_path": "src/lib/ai/tools.server.ts",
    "audience": [],
    "content_hash": "f593d0ae6b6b03cc73ecc50c0cee4c0e"
  },
  {
    "doc_key": "rule:src/lib/ai/tools.server.ts:7532",
    "kind": "rule",
    "title": "Regra em tools.server.ts",
    "content": "O IMÓVEL É SEMPRE CONHECIDO — e é ele que responde \"qual é o meu\napartamento\".\n\nUm guia pertence a UM imóvel. O hóspede que está conversando aqui\nabriu o guia daquele imóvel; não existe ambiguidade sobre em que\nunidade ele está. Antes esta ferramenta devolvia `{encontrada:false}`\ne mais nada quando não achava o FORMULÁRIO do hóspede, e o agente\nconcluía que não sabia nem em que apartamento a pessoa estava —\nrespondendo com uma pergunta de volta a quem só queria o número da\nporta (caso real, 08/09/2026).\n\nAgora a unidade vai sempre. O que pode faltar é o formulário — e a\nausência dele afeta apenas as DATAS, nunca a identidade do imóvel.",
    "source_path": "src/lib/ai/tools.server.ts",
    "audience": [],
    "content_hash": "28da5258f8c193c8ec21d8cf77c664eb"
  },
  {
    "doc_key": "rule:src/lib/ai/tools.server.ts:8784",
    "kind": "rule",
    "title": "Regra em tools.server.ts",
    "content": "A busca do formulário usa a MESMA cadeia tolerante do construtor de\ncontexto (ver context.server.ts): nome exato normalizado → primeiro\nnome → estadia que cobre hoje → mais recente.\n\nAntes era `.eq(\"guest_name\", name)`, igualdade byte a byte. Bastava um\nacento, uma caixa diferente ou um sobrenome faltando para o contexto\nACHAR a estadia e a ferramenta NÃO achar — e o agente recebia as duas\ncoisas ao mesmo tempo, dizendo ao hóspede que não localizou a reserva\nenquanto tinha as datas dela no próprio prompt.",
    "source_path": "src/lib/ai/tools.server.ts",
    "audience": [],
    "content_hash": "dc6fa20160c13570af7b0133e953133b"
  },
  {
    "doc_key": "rule:src/lib/ai/transcribe.server.ts:0",
    "kind": "rule",
    "title": "Regra em transcribe.server.ts",
    "content": "Transcrição de áudio — uma implementação para todas as IAs do produto.\n\nPedido explícito (07/09/2026): \"para todo áudio enviado para a IA, seja pelo\nhóspede, seja por um usuário, ela deve transcrever automaticamente e\nresponder com base em sua compreensão\".\n\nIsso é uma REGRA DA CASA aplicada em código, não só em prompt: falar tem que\nvaler o mesmo que digitar, nos dois chats. O áudio vira texto e segue pelo\ncaminho normal da conversa — com o mesmo contexto, as mesmas ferramentas e,\nno painel, o mesmo cartão de confirmação antes de gravar qualquer coisa.\nNenhuma das duas IAs tem um \"modo áudio\" com regras próprias.\n\nAntes desta unificação a transcrição existia solta em property-details, e o\náudio do hóspede não era transcrito em lugar nenhum — a IA recebia uma\nmensagem vazia com um anexo e literalmente não sabia o que tinha sido dito.",
    "source_path": "src/lib/ai/transcribe.server.ts",
    "audience": [],
    "content_hash": "70266f89178604a5d61ad21edef12790"
  },
  {
    "doc_key": "rule:src/lib/ai/validate.server.ts:0",
    "kind": "rule",
    "title": "Regra em validate.server.ts",
    "content": "Validação final (Gemini Flash) — última etapa antes de enviar ao hóspede.\nVerifica conflitos, alucinações, dados fora do contexto, idioma e políticas.\nSe houver qualquer inconsistência, a resposta NÃO é enviada automaticamente:\no atendimento é escalado para um humano.\n\nFAIL-SAFE: se o validador falhar (indisponível/erro/resposta vazia) em um\ncontexto de risco alto — categoria sensível (acesso/reserva/financeiro) ou\nplano marcado como risco alto — NÃO aprovamos por padrão. Aprovar \"às cegas\"\njustamente quando a checagem anti-alucinação está fora do ar é o pior momento\npossível para relaxar a guarda. Em contexto de risco normal/baixo, seguimos\nfalhando aberto (não travar o atendimento por uma instabilidade pontual).",
    "source_path": "src/lib/ai/validate.server.ts",
    "audience": [],
    "content_hash": "eb7ac9fc0427ac606871aaf01847f5fe"
  },
  {
    "doc_key": "rule:src/lib/airbnb.functions.ts:1005",
    "kind": "rule",
    "title": "Regra em airbnb.functions.ts",
    "content": "Descrição curta em texto livre. Grava em `properties.short_description`\n— NUNCA em `properties.tagline`, que é um seletor fixo de \"Tipo do\nguia\" (3 opções) e não texto livre; escrever a descrição ali deixava o\ncampo \"sem seleção\" na tela (bug encontrado em 03/09/2026).",
    "source_path": "src/lib/airbnb.functions.ts",
    "audience": [],
    "content_hash": "6d4da53872e2d063d01a89de0ea2c51f"
  },
  {
    "doc_key": "rule:src/lib/assistant-types.ts:0",
    "kind": "rule",
    "title": "Regra em assistant-types.ts",
    "content": "Tipos do Assistente do Painel (pedido explícito, 07/09/2026).\n\nA decisão central que estes tipos carregam: o assistente NUNCA grava nada\nsozinho. Quando a pessoa pede uma ação, o servidor apenas MONTA a ação —\nresolve \"o 105\" no id do imóvel, escolhe a categoria, calcula para qual\nlimpeza a pendência vai — e devolve uma `AssistantAction` junto de um\n`preview` legível. Quem executa é o clique de confirmação na interface,\nchamando exatamente a mesma server function que o resto do painel já usa\n(`createTask`, `setTaskStatus`, `markNoShow`, `upsertArrivalStatus`,\n`advanceArrival`).\n\nIsso evita o pior modo de falha de um agente com poder de escrita — gravar\nalgo que a pessoa não pediu por ter entendido errado — e ainda mantém uma\núnica implementação de cada gravação: se a regra de criação de pendência\nmudar, muda num lugar só e o assistente acompanha de graça.\n\nAUTONOMIA MÁXIMA (pedido explícito, 08/09/2026): \"quero que a IA interna\ntenha AUTONOMIA MÁXIMA e que consiga executar QUALQUER coisa solicitada\npelo usuário — caso este usuário tenha autonomia para fazer aquilo\".\n\nVale registrar como as duas coisas convivem, porque parecem brigar e não\nbrigam. O que limitava a IA não era o cartão de confirmação: era a lista\ncurta de ações que ela sabia montar. Quando o usuário pediu uma pendência\nrecorrente de 30 dias, a IA respondeu \"não consigo criar recorrência\" — e a\ncoluna `tasks.recurrence_days` existe desde sempre, o `createTask` já a\naceita, a tela de Pendências já a oferece. Faltava só a ferramenta expor o\ncampo. Autonomia, aqui, é COBERTURA: tudo que a tela faz, a IA monta.\n\nQuem decide o que cada pessoa PODE continua sendo o sistema, nunca a IA:\nas ferramentas de leitura usam o cliente Supabase do usuário (RLS), e a\ngravação passa pela mesma server function da tela, com a mesma checagem de\npermissão. Se a pessoa não pode, a gravação falha — do mesmo jeito que\nfalharia se ela clicasse no botão. A IA nunca é a guardiã da permissão, e\npor isso também nunca deve recusar por conta própria.",
    "source_path": "src/lib/assistant-types.ts",
    "audience": [],
    "content_hash": "fe8316e338c8baf8bad05976f4600f13"
  },
  {
    "doc_key": "rule:src/lib/assistant-types.ts:3001",
    "kind": "rule",
    "title": "Regra em assistant-types.ts",
    "content": "A MESMA pendência em VÁRIOS imóveis, com UMA confirmação só.\n\nPedido explícito (08/09/2026): \"crie a recorrência em todos os imóveis\nsem me pedir para confirmar a gravação de cada um deles\". Antes cada\nimóvel exigia um cartão, e criar uma rotina em quinze imóveis eram\nquinze confirmações — o assistente virava um formulário lento.\n\nO cartão de confirmação continua existindo: o que muda é o que ele\ncobre. Um cartão, a lista inteira, uma decisão. E `duplicados` traz os\nimóveis que JÁ têm pendência parecida — eles ficam de fora por padrão,\nporque duplicar em silêncio é pior do que não criar.",
    "source_path": "src/lib/assistant-types.ts",
    "audience": [],
    "content_hash": "ab61003ea290d8dbe120d9b53c57696f"
  },
  {
    "doc_key": "rule:src/lib/assistant-types.ts:4354",
    "kind": "rule",
    "title": "Regra em assistant-types.ts",
    "content": "VÁRIAS pendências de uma vez: arquivar, reabrir ou EXCLUIR.\n\nPedido explícito (09/09/2026): \"remova todas as pendências que você\ncriou agora… quero que exclua definitivamente, não arquivar\".\nA IA respondeu que não tinha ferramenta — e estava certa: não tinha.\nO que limitava não era o cartão de confirmação, era de novo a\nCOBERTURA. Sem ação em lote, desfazer uma criação em quinze imóveis\neram quinze cartões; sem exclusão, o \"desfazer\" deixava quinze linhas\nmortas atrás de um filtro.\n\n`delete` apaga a linha (ver `deleteTasks`); `canceled`/`pending`\narquivam e reabrem, como antes.",
    "source_path": "src/lib/assistant-types.ts",
    "audience": [],
    "content_hash": "7cee7f992f02ee273378e324bee34b3f"
  },
  {
    "doc_key": "rule:src/lib/assistant-types.ts:6849",
    "kind": "rule",
    "title": "Regra em assistant-types.ts",
    "content": "Conversa a que a mensagem pertence — a interface usa para desenhar a\ndivisória de \"nova conversa\" no histórico contínuo. Só vem do histórico\ngravado; mensagens recém-criadas na tela não precisam dele.",
    "source_path": "src/lib/assistant-types.ts",
    "audience": [],
    "content_hash": "322fda48734505a60f8aa0baac338d0f"
  },
  {
    "doc_key": "rule:src/lib/assistant-types.ts:7197",
    "kind": "rule",
    "title": "Regra em assistant-types.ts",
    "content": "O que foi EXECUTADO neste turno, em uma linha (\"Criar em 9 imóveis\").\n\nPedido explícito (09/09/2026): o histórico guarda \"todas as decisões\".\nO cartão de confirmação é objeto de tela — some ao confirmar e não deixa\nrastro. Isto é o rastro: fica gravado como mensagem e sobrevive a\nrecarregar, inclusive quando a confirmação automática está ligada e\ncartão nenhum chega a aparecer.",
    "source_path": "src/lib/assistant-types.ts",
    "audience": [],
    "content_hash": "0609b0237b4cc6e11e79f334a5777c85"
  },
  {
    "doc_key": "rule:src/lib/assistant-types.ts:7658",
    "kind": "rule",
    "title": "Regra em assistant-types.ts",
    "content": "A tela apontada pela resposta vira link dentro do próprio texto\n(07/09/2026) — não há mais um campo separado nem um chip embaixo da\nmensagem repetindo o mesmo caminho.",
    "source_path": "src/lib/assistant-types.ts",
    "audience": [],
    "content_hash": "aea6e0dd752ab44bafbf64ca31f3132f"
  },
  {
    "doc_key": "rule:src/lib/assistant-types.ts:7966",
    "kind": "rule",
    "title": "Regra em assistant-types.ts",
    "content": "A pessoa dispensou o cartão de confirmação (`profiles.assistant_auto_\nconfirm`). Com `true`, a interface executa a `pendingAction` na hora, em\nvez de esperar o clique.\n\nPedido explícito (09/09/2026): \"se o usuário pedir 'dispense a\nconfirmação', então ela tem que acatar e manter isso memorizado para\naquele usuário específico\".\n\nVem no envelope da resposta, e não de uma query separada, porque a\npreferência pode ter mudado NESTA mensagem — a IA tem uma ferramenta para\nligá-la, e o valor que interessa é o de depois da conversa.\n\nA autonomia é sobre o CLIQUE, não sobre permissão: a gravação continua\npassando pela mesma server function e pelo mesmo RLS da tela.",
    "source_path": "src/lib/assistant-types.ts",
    "audience": [],
    "content_hash": "dc6f62cd5f7d06901dc11bc3f49e4a2a"
  },
  {
    "doc_key": "rule:src/lib/assistant.functions.ts:0",
    "kind": "rule",
    "title": "Regra em assistant.functions.ts",
    "content": "Server functions do Assistente do Painel (pedido explícito, 07/09/2026).\n\nO caminho de uma pergunta:\n\n 1. Recupera o que o sistema sabe sobre si mesmo (`retrieveSystemKnowledge`)\n e injeta no prompt. Isso vai SEMPRE, antes de qualquer ferramenta: a\n maioria das perguntas é \"como faço X\" ou \"por que isso é assim\", e nessas\n o RAG já resolve sem gastar uma rodada de tool calling.\n\n 2. Roda o agente com as ferramentas de leitura e de preparação de ação.\n As de leitura usam o cliente do usuário, então o RLS limita o que cada\n pessoa recebe — inclusive prestadores.\n\n 3. Se alguma ferramenta preparou uma ação, ela volta como `pendingAction`.\n Nada foi gravado ainda: a gravação acontece quando a pessoa confirma na\n interface, que chama a mesma server function do resto do painel.\n\nMesmos padrões do resto do projeto: createServerFn + requireSupabaseAuth +\nzod, com AnyClient nas tabelas que ainda não estão no types.ts gerado.",
    "source_path": "src/lib/assistant.functions.ts",
    "audience": [],
    "content_hash": "5674b6fa53ea76be36860872abcb06e6"
  },
  {
    "doc_key": "rule:src/lib/assistant.functions.ts:13225",
    "kind": "rule",
    "title": "Regra em assistant.functions.ts",
    "content": "A preferência é lida DEPOIS do run, de propósito: a própria conversa\npode ter acabado de ligá-la (ver `definir_confirmacao_automatica`). Lida\nantes, o \"dispense a confirmação\" só valeria a partir da mensagem\nseguinte — e a pessoa veria um cartão logo depois de pedir para não ver\nmais cartões.",
    "source_path": "src/lib/assistant.functions.ts",
    "audience": [],
    "content_hash": "c26269ecadfeac7f7b283f7a4334219f"
  },
  {
    "doc_key": "rule:src/lib/assistant.functions.ts:1837",
    "kind": "rule",
    "title": "Regra em assistant.functions.ts",
    "content": "Imagem anexada, como data URL (pedido explícito, 07/09/2026). Vai junto da\npergunta para o modelo olhar — um print da tela costuma explicar melhor\nque qualquer descrição. Não é gravada em lugar nenhum: serve a esta\npergunta e acaba ali.",
    "source_path": "src/lib/assistant.functions.ts",
    "audience": [],
    "content_hash": "33dec6642968c2b0f4f777319ad37516"
  },
  {
    "doc_key": "rule:src/lib/audit-fn-labels.server.ts:0",
    "kind": "rule",
    "title": "Regra em audit-fn-labels.server.ts",
    "content": "Tradução de chamadas de servidor para linguagem humana no Audit Trail.\n\nObjetivo: nenhuma linha do log pode ser críptica. Toda ação vira uma frase\n(\"Criou a regra ...\", \"Moveu o card do hóspede ... para Em limpeza\").",
    "source_path": "src/lib/audit-fn-labels.server.ts",
    "audience": [],
    "content_hash": "d05d5b3fbcfbb14983fce0d3164c8d22"
  },
  {
    "doc_key": "rule:src/lib/audit-fn-middleware.ts:0",
    "kind": "rule",
    "title": "Regra em audit-fn-middleware.ts",
    "content": "Middleware global de auditoria de chamadas de servidor.\n\nToda chamada a um server function é registrada: quem chamou, qual função,\no que foi enviado, duração, resultado e erro (quando houver). Auditoria\nnunca derruba a operação — falhas de log são engolidas.",
    "source_path": "src/lib/audit-fn-middleware.ts",
    "audience": [],
    "content_hash": "fce7a2b3d9ddfaa599f282005fa3bef2"
  },
  {
    "doc_key": "rule:src/lib/dashboard-arrival-types.ts:1579",
    "kind": "rule",
    "title": "Regra em dashboard-arrival-types.ts",
    "content": "Preço vigente da limpeza normal/completa do imóvel, em centavos — usado\nsó pra decidir quais opções aparecem no diálogo \"Qual limpeza foi\nrealizada?\" (uma opção sem preço configurado, ou com preço 0, não\naparece).",
    "source_path": "src/lib/dashboard-arrival-types.ts",
    "audience": [],
    "content_hash": "cb02c1d074b4576f0be8291692385a9e"
  },
  {
    "doc_key": "rule:src/lib/dashboard-arrival-types.ts:371",
    "kind": "rule",
    "title": "Regra em dashboard-arrival-types.ts",
    "content": "Coordenadas do imóvel (quando cadastradas) — usadas só pra desempate por\nproximidade na ordenação dos checkouts (regra 4, pedido explícito).",
    "source_path": "src/lib/dashboard-arrival-types.ts",
    "audience": [],
    "content_hash": "c5d7c67ab36429e4ef7882a69012e930"
  },
  {
    "doc_key": "rule:src/lib/dashboard-arrival-types.ts:954",
    "kind": "rule",
    "title": "Regra em dashboard-arrival-types.ts",
    "content": "Horários padrão do IMÓVEL, sempre os dois, independente do `kind` da\nlinha. `standardTime`/`standardTimeMax` mudam de significado conforme a\nlinha é chegada ou saída; estes não mudam nunca.\n\nExistem porque a JANELA DA LIMPEZA precisa dos dois lados ao mesmo tempo\n(pedido explícito, 09/09/2026): ela começa quando o hóspede sai e termina\nquando o próximo pode entrar. Uma linha de checkout sozinha só conhece o\nlado da saída.",
    "source_path": "src/lib/dashboard-arrival-types.ts",
    "audience": [],
    "content_hash": "93c3dfccb774c6892f686a76e9058356"
  },
  {
    "doc_key": "rule:src/lib/dashboard.functions.ts:70422",
    "kind": "rule",
    "title": "Regra em dashboard.functions.ts",
    "content": "Completa o identificador que faltou (pedido explícito, 08/09/2026: o\ncard marcado como \"não compareceu\" continuava espelhado na Fila de\nLimpeza).\n\nO card de chegada e o de saída da MESMA estadia nem sempre carregam o\nmesmo identificador — o casamento formulário↔reserva é mais exigente\ndo lado da chegada (ver `findLogsForReservation`). Gravando só o que o\ncard clicado tinha, o outro lado ficava sem chave em comum e escapava\ndo filtro. Aqui procuramos o par pela estadia e gravamos os DOIS, de\nmodo que qualquer consumidor — não só o quadro — reconheça o\nnão comparecimento por qualquer um dos lados.",
    "source_path": "src/lib/dashboard.functions.ts",
    "audience": [],
    "content_hash": "47be47ef7e7c20587e5825edf22d4743"
  },
  {
    "doc_key": "rule:src/lib/permissions/feature.access.ts:1332",
    "kind": "rule",
    "title": "Regra em feature.access.ts",
    "content": "Valida Plano → Funcionalidade disponível.\n\nEnquanto a feature não estiver declarada no registry, a decisão é\npermissiva por design: esta fase não pode restringir nada.",
    "source_path": "src/lib/permissions/feature.access.ts",
    "audience": [],
    "content_hash": "89a84c8fa64a17190855966437902617"
  },
  {
    "doc_key": "rule:src/lib/permissions/index.ts:0",
    "kind": "rule",
    "title": "Regra em index.ts",
    "content": "Permission Engine — ponto de entrada público da camada de permissões.\n\nFASE 1 (estrutural): nada aqui está conectado às telas, rotas, menus ou\nregras de acesso atuais. O comportamento do ConciergeIA permanece idêntico.\n\nRegras estruturais já definidas:\n - OWNER sempre possui acesso total ao que estiver disponível para o tenant;\n suas permissões nunca podem ser editadas.\n - Nenhuma funcionalidade futura pode existir sem estar no Permission Registry.\n\nO repositório e o serviço são server-only e devem ser importados\ndiretamente de \"./permission.repository.server\" / \"./permission.service.server\".",
    "source_path": "src/lib/permissions/index.ts",
    "audience": [],
    "content_hash": "5e21d0791baec6357375b09c2fd393bf"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.areas.ts:0",
    "kind": "rule",
    "title": "Regra em permission.areas.ts",
    "content": "Áreas exibidas na página de Permissões — derivadas DIRETAMENTE do catálogo.\n\nCategoria = página do menu lateral (PAGE)\nSubcategoria = aba/subpágina (TAB | SUBPAGE)\nAtividade = ação dentro da aba (RESOURCE | SECTION | FIELD)\n\nNão existe lista paralela: mexer no catálogo muda esta tela automaticamente.",
    "source_path": "src/lib/permissions/permission.areas.ts",
    "audience": [],
    "content_hash": "8f8d10d1ca73b80d8f5f10a8b1f30938"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.bootstrap.ts:0",
    "kind": "rule",
    "title": "Regra em permission.bootstrap.ts",
    "content": "Permission Bootstrap — carrega o catálogo e o auto discovery no Registry.\n\nFASE 2: catalogação apenas. Executar o bootstrap não altera nenhuma\npermissão vigente, nenhum menu e nenhum fluxo — ele só popula a árvore\nem memória (e, quando sincronizado, a tabela `permission_nodes`).",
    "source_path": "src/lib/permissions/permission.bootstrap.ts",
    "audience": [],
    "content_hash": "20c24c23cb58ddcccda8cca7c7e1d05f"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.catalog.ts:0",
    "kind": "rule",
    "title": "Regra em permission.catalog.ts",
    "content": "Permission Catalog — árvore ÚNICA de permissões do ConciergeIA.\n\nREGRA ESTRUTURAL (definida pelo produto):\n 1. CATEGORIA = cada página do menu lateral esquerdo do SaaS\n (menu da conta do cliente `tenant.*` e menu Admin SaaS `admin.*`).\n 2. SUBCATEGORIA = cada aba existente dentro daquela página.\n 3. ATIVIDADE = cada ação possível dentro da aba (kanban, criar, editar,\n excluir, sincronizar, etc.).\n\nNada além disto entra na árvore. Rotas descobertas automaticamente pelo\nscanner ficam ocultas (apenas diagnóstico).",
    "source_path": "src/lib/permissions/permission.catalog.ts",
    "audience": [],
    "content_hash": "fec1d5a2139fe845aa1906a3b47a66f8"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.center.server.ts:0",
    "kind": "rule",
    "title": "Regra em permission.center.server.ts",
    "content": "Permission Center (FASE 4.2) — camada de leitura do centro administrativo\n\"Equipe e Permissões\".\n\nREGRAS DESTA FASE:\n - Nenhuma regra de autorização é criada, alterada ou reimplementada aqui.\n - Toda decisão vem de `permission.guard.server.ts` (via `checkAccess`, que\n respeita o modo de enforcement do tenant).\n - Somente leitura: nada é gravado, nenhum novo tipo de permissão é criado.",
    "source_path": "src/lib/permissions/permission.center.server.ts",
    "audience": [],
    "content_hash": "54b65db9a288ba30187b056afb7cf2a9"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.enforce.server.ts:0",
    "kind": "rule",
    "title": "Regra em permission.enforce.server.ts",
    "content": "Permission Enforcement Layer (FASE 3.7).\n\nCamada ÚNICA de aplicação das decisões produzidas pelo\n`permission.guard.server.ts`. Nenhuma validação paralela é criada aqui:\ntoda decisão continua vindo de `can()` / `evaluateWithSnapshot()`.\n\nModos de aplicação\n------------------\nO ConciergeIA ainda opera com o modelo legado (owner + account_members +\nmember_permissions). Para preservar 100% dos fluxos atuais, o enforcement\nroda em modo \"progressivo\":\n\n - OWNER / ADMIN_SAAS / SYSTEM / CRON → sempre autorizados (regra imutável).\n - Sujeito revogado ou pendente → SEMPRE bloqueado.\n - Tenant que já possui atribuições na nova árvore → decisão do guard vale.\n - Tenant SEM nenhuma atribuição (ainda não migrado) → a decisão negativa é\n registrada no diagnóstico (shadow) e a operação segue, exatamente como\n hoje. Assim nenhuma conta perde acesso antes da migração da Fase 4.\n\nA troca para o modo estrito é apenas uma constante (`ENFORCEMENT_MODE`).",
    "source_path": "src/lib/permissions/permission.enforce.server.ts",
    "audience": [],
    "content_hash": "2b31fe5d984d0e0b810bfda9ebe57a82"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.engine.ts:0",
    "kind": "rule",
    "title": "Regra em permission.engine.ts",
    "content": "Permission Engine — avaliação pura (sem I/O, sem banco, sem telas).\n\nFASE 1: implementado e testável, porém NÃO conectado a nenhuma rota,\npágina ou fluxo existente.",
    "source_path": "src/lib/permissions/permission.engine.ts",
    "audience": [],
    "content_hash": "b9520c99460a0b3ee517a8978ccf9449"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.features.ts:0",
    "kind": "rule",
    "title": "Regra em permission.features.ts",
    "content": "Permission Features — declaração das funcionalidades comercializáveis.\n\nMapeia Plano → Funcionalidade usando exatamente os mesmos planos do SaaS.\nServe para o gating automático da árvore de permissões (FASE 3).\nNÃO altera o `plan-guard.server.ts`, que continua sendo a fonte em uso\npara autorização real.",
    "source_path": "src/lib/permissions/permission.features.ts",
    "audience": [],
    "content_hash": "bed2fa1e1d48a03bcbda0651cd455daa"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.guard.server.ts:0",
    "kind": "rule",
    "title": "Regra em permission.guard.server.ts",
    "content": "Authorization Runtime Engine (FASE 3.6) — ponto ÚNICO de validação.\n\nModelo:\n Subject → Roles / Direct Grants → Permissions → Scope Resolution\n → Resource Validation → Decision\n\nToda decisão é padronizada (nunca apenas true/false) e toda negação é\nregistrada em um log interno para diagnóstico.\n\nNADA aqui está conectado a rotas, telas, menus ou papéis atuais.",
    "source_path": "src/lib/permissions/permission.guard.server.ts",
    "audience": [],
    "content_hash": "d141da89fd01da0800924736663c5699"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.guard.ts:0",
    "kind": "rule",
    "title": "Regra em permission.guard.ts",
    "content": "Permission Guard — middleware central de validação.\n\nFASE 1: interface pronta, NÃO conectada a nenhuma rota, server function\nou tela. As rotas continuam exatamente com as regras de hoje.",
    "source_path": "src/lib/permissions/permission.guard.ts",
    "audience": [],
    "content_hash": "a91a05eb7f232ae240a2393b17b8fc21"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.guardian.ts:0",
    "kind": "rule",
    "title": "Regra em permission.guardian.ts",
    "content": "Lovable Guardian — governança da árvore de permissões.\n\nFASE 2: apenas arquitetura. O Guardian detecta recursos novos que ainda não\npossuem Permission Node e prepara a proposta de decisão. NENHUMA interação\nvisual é implementada nesta fase e nada é registrado automaticamente sem\ndecisão explícita.",
    "source_path": "src/lib/permissions/permission.guardian.ts",
    "audience": [],
    "content_hash": "24d2f6563e5fba7149bb193d50e45e2d"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.migration.functions.ts:0",
    "kind": "rule",
    "title": "Regra em permission.migration.functions.ts",
    "content": "Endpoints para o SaaS admin operar, na prática, a máquina de estados já\nexistente em permission.migration.server.ts (FASE 3.8).\n\nO motor novo de permissões (permission.engine.ts + permission.enforce.server.ts)\njá roda em paralelo ao legado, mas nenhuma tela jamais chamava\nenableMonitoringMode/enableEnforcedMode/completeMigration — toda conta\nficava parada para sempre em \"legacy\" (modo padrão, sem bloqueio real),\ntornando o motor novo puramente decorativo. Este arquivo expõe, como\ncreateServerFn, exatamente as transições que já existiam prontas e\nprotegidas (um passo por vez, admin do SaaS obrigatório, nunca automático)\n— sem alterar nenhuma regra de negócio da máquina de estados em si.",
    "source_path": "src/lib/permissions/permission.migration.functions.ts",
    "audience": [],
    "content_hash": "265bc7c7a399549201d5d759b7218e84"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.migration.report.server.ts:0",
    "kind": "rule",
    "title": "Regra em permission.migration.report.server.ts",
    "content": "Relatório de migração de permissões (FASE 3.8).\n\nConsolida o estado da ativação por tenant: quem já migrou, quem está\npendente, divergências observadas, últimas negativas e riscos.\nSomente leitura — não altera nenhum modo.",
    "source_path": "src/lib/permissions/permission.migration.report.server.ts",
    "audience": [],
    "content_hash": "ad08b10260b3bdd6d45184d3dadaa4e8"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.migration.server.ts:0",
    "kind": "rule",
    "title": "Regra em permission.migration.server.ts",
    "content": "Permission Migration & Activation Control (FASE 3.8).\n\nControla, por tenant, QUAL modelo de autorização vale em runtime.\nA mudança de modo é SEMPRE explícita e exige um administrador do SaaS —\nnenhum tenant migra sozinho, nem por efeito colateral de outro fluxo.\n\nModos\n-----\n legacy → comportamento atual; o novo motor roda apenas para diagnóstico.\n monitoring → novo motor roda e registra divergências; nada é bloqueado.\n enforced → o guard passa a bloquear normalmente.\n completed → migração encerrada; somente o novo fluxo decide.",
    "source_path": "src/lib/permissions/permission.migration.server.ts",
    "audience": [],
    "content_hash": "fe2d00aa5c22b52ea30d3a240b3fe053"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.registry.ts:0",
    "kind": "rule",
    "title": "Regra em permission.registry.ts",
    "content": "Permission Registry — catálogo central de Permission Nodes.\n\nFASE 2: o catálogo completo do ConciergeIA é declarado e descoberto\nautomaticamente aqui. O registry continua desconectado das telas, menus e\nregras de acesso atuais — ele apenas cataloga a árvore.\n\nRegras:\n - slug único e padronizado (`pai.filho.neto`);\n - nunca criar duplicidade (registro é idempotente e faz merge);\n - nunca criar árvore quebrada (pais ausentes são criados automaticamente).",
    "source_path": "src/lib/permissions/permission.registry.ts",
    "audience": [],
    "content_hash": "14c6e18399786caec2a289dfbf8deb95"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.repository.server.ts:0",
    "kind": "rule",
    "title": "Regra em permission.repository.server.ts",
    "content": "Permission Repository — único ponto de acesso ao banco para permissões.\n\nFASE 1: implementado, porém nenhum fluxo existente o utiliza.\nUsa o cliente admin porque o engine roda server-side e faz o próprio\nisolamento por tenant em cada consulta.",
    "source_path": "src/lib/permissions/permission.repository.server.ts",
    "audience": [],
    "content_hash": "ffc5bc6584333f505d37917c1af9dae8"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.resolve.server.ts:0",
    "kind": "rule",
    "title": "Regra em permission.resolve.server.ts",
    "content": "Permission Resolve (FASE 3.6) — camada de resolução.\n\nTransforma \"usuário + contexto\" em \"permissões efetivas disponíveis\".\nNÃO decide nada: apenas carrega e normaliza o estado do sujeito\n(tenant, papéis, plano, status, atribuições e imóveis vinculados).\n\nNenhum fluxo, rota ou tela existente é alterado por este módulo.",
    "source_path": "src/lib/permissions/permission.resolve.server.ts",
    "audience": [],
    "content_hash": "726cf6ee364cc89a94d96f56ac8d0c7b"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.scanner.ts:0",
    "kind": "rule",
    "title": "Regra em permission.scanner.ts",
    "content": "Permission Scanner (Auto Discovery) — descobre automaticamente a estrutura\nnavegável do ConciergeIA e a traduz em Permission Nodes.\n\nFASE 3.5: o scanner passou a respeitar uma ALLOWLIST. Rotas públicas,\nde marketing, de autenticação, legais, landing pages, APIs e utilitários\ntécnicos continuam sendo catalogados para diagnóstico, porém marcados como\n`isPermissionable = false` — e nunca entram na árvore de permissões.",
    "source_path": "src/lib/permissions/permission.scanner.ts",
    "audience": [],
    "content_hash": "c7789104327689da6dd9c338f1f59900"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.scopes.ts:0",
    "kind": "rule",
    "title": "Regra em permission.scopes.ts",
    "content": "Permission Scopes — validação de escopo operacional (FASE 3.5).\n\nPrepara o suporte real a GLOBAL, TENANT, CLIENT, PROPERTY e RECORD.\nNenhuma autorização é aplicada nesta fase: o objetivo é garantir que toda\ngravação/consulta futura de permissão informe um escopo coerente.\n\nREGRA: um imóvel NUNCA vira nó da árvore de permissões. O imóvel é sempre\num ESCOPO (`scope_type = 'PROPERTY'`, `scope_id = <property_id>`) aplicado\nsobre um nó existente.",
    "source_path": "src/lib/permissions/permission.scopes.ts",
    "audience": [],
    "content_hash": "49a00207062d1401ae6b88d5923d54a0"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.selftest.server.ts:0",
    "kind": "rule",
    "title": "Regra em permission.selftest.server.ts",
    "content": "Testes internos do Authorization Runtime Engine (FASE 3.6).\n\nNão dependem de banco: usam snapshots fabricados e o núcleo determinístico\n`evaluateWithSnapshot`. Servem como verificação de sanidade antes de\nqualquer ativação do guard em produção (Fase 4).",
    "source_path": "src/lib/permissions/permission.selftest.server.ts",
    "audience": [],
    "content_hash": "d2f5ce59f622754d58abfef956db2350"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.sync.server.ts:0",
    "kind": "rule",
    "title": "Regra em permission.sync.server.ts",
    "content": "Permission Sync — rotina OFICIAL de sincronização do Registry com o banco.\n\nFASE 3.5. Substitui o \"lazy sync\" implícito. Características:\n - executa em ondas por profundidade (pai sempre antes do filho);\n - registra cada execução em `permission_sync_runs`;\n - aplica SOFT DELETE (`active = false`, `deactivated_at`) — nada é apagado;\n - preserva permissões existentes ao renomear slugs, migrando o nó antigo\n e registrando a mudança em `permission_node_slug_history`;\n - nunca lança para o chamador: devolve um relatório com os erros.",
    "source_path": "src/lib/permissions/permission.sync.server.ts",
    "audience": [],
    "content_hash": "c6fbcfab1d9fc279535b470e4227ca54"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.types.ts:3966",
    "kind": "rule",
    "title": "Regra em permission.types.ts",
    "content": "FASE 3.5 — quando `false`, o nó é catalogado apenas para diagnóstico e\nNUNCA entra na árvore de permissões (rotas públicas, legais, marketing,\nautenticação e landing pages).",
    "source_path": "src/lib/permissions/permission.types.ts",
    "audience": [],
    "content_hash": "9e71512ff43288fb1c345a76c7f342e2"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.types.ts:5763",
    "kind": "rule",
    "title": "Regra em permission.types.ts",
    "content": "O usuário é MEMBRO desta conta (não é o titular)? Nesse caso as\npermissões da conta valem mesmo que ele seja administrador do SaaS —\no bypass de `ADMIN_SAAS` fica restrito aos recursos `admin.*`.",
    "source_path": "src/lib/permissions/permission.types.ts",
    "audience": [],
    "content_hash": "39ac1cc28bf3f47a27a96d6e47eba592"
  },
  {
    "doc_key": "rule:src/lib/permissions/permission.ui.server.ts:0",
    "kind": "rule",
    "title": "Regra em permission.ui.server.ts",
    "content": "Permission UI (server) — camada de acesso da interface de gerenciamento.\n\nResolve o contexto (conta do cliente x Admin do SaaS), valida quem pode\ngerenciar, monta os usuários gerenciáveis e delega ao Permission Admin.\n\nNÃO autoriza requisições do produto: a autorização segue no sistema atual.",
    "source_path": "src/lib/permissions/permission.ui.server.ts",
    "audience": [],
    "content_hash": "33dd1ca1d1fca192de44f586a3c91084"
  },
  {
    "doc_key": "rule:src/lib/permissions/permissionClient.ts:0",
    "kind": "rule",
    "title": "Regra em permissionClient.ts",
    "content": "(arquivo nomeado sem \".client.\" por causa da proteção de imports do TanStack Start)\nCamada client-side de autorização (FASE 4.1).\n\nRegra inegociável: o frontend NUNCA decide permissão. Este módulo apenas\ntransporta, normaliza e cacheia as decisões produzidas pelo backend\n(`permission.guard.server.ts` / `permission.enforce.server.ts`).",
    "source_path": "src/lib/permissions/permissionClient.ts",
    "audience": [],
    "content_hash": "87a21b9c3c947e4e3469b3dd1bf3fdd2"
  },
  {
    "doc_key": "rule:src/lib/permissions/usePermission.ts:514",
    "kind": "rule",
    "title": "Regra em usePermission.ts",
    "content": "Compatibilidade: regra legada já existente na tela (ex.: `isAdmin`).\nEnquanto a conta não estiver em modo bloqueante, mantém o comportamento\natual sem duplicar regra de permissão no frontend.",
    "source_path": "src/lib/permissions/usePermission.ts",
    "audience": [],
    "content_hash": "8caf2363392c4b3031d09941442515b2"
  },
  {
    "doc_key": "rule:src/lib/recommendations-move.functions.ts:203",
    "kind": "rule",
    "title": "Regra em recommendations-move.functions.ts",
    "content": "Server functions para gerenciar movimentação de pontos entre\n`property_recommendations` (scope=nearby — \"Aqui Pertinho\") e\n`city_references` (compartilhado por cidade ou por grupo).\n\nRegras de auto-decisão (addPlaceAuto):\n - nearby : distância ≤ 1500 m OU ≤ 20 min a pé.\n - city : demais casos. Independe de avaliação para que o anfitrião\n consiga adicionar pontos novos manualmente; a regra de\n qualidade (rating ≥ 4.5 & ≥ 500 reviews) só limita a geração\n automática por IA, não a inserção manual.",
    "source_path": "src/lib/recommendations-move.functions.ts",
    "audience": [],
    "content_hash": "2d762dfcdb45caa052355bec80553cbd"
  },
  {
    "doc_key": "rule:src/lib/reservation-journey.functions.ts:0",
    "kind": "rule",
    "title": "Regra em reservation-journey.functions.ts",
    "content": "HISTÓRICO DA RESERVA — a jornada inteira de uma estadia, num lugar só.\n\nPedido explícito (08/09/2026), em duas frases que são a mesma coisa:\n · \"ao clicar em um card da visão lista no kanban, abrir um tooltip com o\n histórico de tudo relacionado àquela reserva\";\n · \"TODOS OS CARDS relacionados à mesma reserva precisam ser O MESMO\n CARD... no final, o card precisa apresentar toda a jornada/histórico da\n reserva, limpeza, etc\".\n\nO QUE JÁ ERA VERDADE, E O QUE FALTAVA\n\nO card já é o mesmo objeto ao longo da esteira: Check-ins e Em Estadia saem\nda MESMA lista (`kind: \"checkin\"`, separadas só por status), e Checkouts e\nFila de Limpeza saem da MESMA lista (`kind: \"checkout\"`) — o \"espelho\" da\nlimpeza nunca foi um card novo, é a mesma `ArrivalRow`, com os mesmos\nidentificadores, renderizada com outro `mode`. O que faltava não era\nunificar a identidade: era o card CONTAR essa jornada. Cada coluna mostrava\nsó o instante presente, e o que tinha acontecido antes ficava invisível.\n\nÉ isso que esta função devolve: a linha do tempo da estadia montada a\npartir do que o sistema de fato gravou — nunca inferida de \"onde o card\nestá agora\".\n\nCOMO A JORNADA É RECONSTRUÍDA\n\nA fonte é `guest_arrival_status`, que guarda uma linha por lado da estadia\n(`kind` \"checkin\" e \"checkout\") com os carimbos de tempo reais: `done_at`\n(a etapa aconteceu), `concluded_at` (o card saiu da esteira) e, no lado da\nsaída, `cleaning_type`/`cleaning_price_cents` (que limpeza foi feita e por\nquanto). Um passo só é dado como concluído quando existe carimbo — jamais\nporque o passo seguinte existe.\n\nA estadia é encontrada pelos DOIS identificadores (log do formulário e\nreserva do iCal) porque nem todo card carrega os dois: o casamento\nformulário↔reserva é mais exigente do lado da chegada (ver\n`findLogsForReservation`). Procurar pelos dois, e completar um pelo outro\natravés da estadia (imóvel + data de entrada), é o que garante que abrir o\nhistórico pelo card de Limpeza mostre o mesmo que abrir pelo de Check-in.",
    "source_path": "src/lib/reservation-journey.functions.ts",
    "audience": [],
    "content_hash": "8df8468b519bbea9643ac2223113b3c4"
  },
  {
    "doc_key": "rule:src/lib/reservation-records.functions.ts:32790",
    "kind": "rule",
    "title": "Regra em reservation-records.functions.ts",
    "content": "IDENTIDADE DA RESERVA — é por ela que a aba agrupa os registros no filtro\n\"Todos\". Vem de `guide_access_logs` (formulário do hóspede: nome, código\ne as duas datas) e, quando o registro só tem `reservation_id`, do próprio\n`property_reservations` (iCal: só a dica de nome e as datas).\n\n`reservationKey` vazio = registro preso apenas ao imóvel ou a uma\npendência. Esses caem no grupo \"Sem reserva\" — nada some.",
    "source_path": "src/lib/reservation-records.functions.ts",
    "audience": [],
    "content_hash": "23b7afe5ab85d98754e9b12e37d1bd4a"
  },
  {
    "doc_key": "rule:src/lib/reservation-records.functions.ts:33400",
    "kind": "rule",
    "title": "Regra em reservation-records.functions.ts",
    "content": "TODAS as mídias da situação, em ordem cronológica — a própria incluída.\nUma situação com quatro fotos é UMA linha na tela com quatro mídias\ndentro, não quatro linhas (ver `createRecordSituation`).",
    "source_path": "src/lib/reservation-records.functions.ts",
    "audience": [],
    "content_hash": "9107dae32eda662cf6cded7aa55ac39c"
  },
  {
    "doc_key": "rule:src/lib/tasks-types.ts:1356",
    "kind": "rule",
    "title": "Regra em tasks-types.ts",
    "content": "Vínculo pontual com uma estadia específica — quando presente, a\npendência é \"pontual\" (some quando a estadia termina). Sem nenhum dos\ndois, é \"recorrente\" (permanente do imóvel/proprietário).",
    "source_path": "src/lib/tasks-types.ts",
    "audience": [],
    "content_hash": "b7fc8eee61350eb3efcc2ea02add55ab"
  },
  {
    "doc_key": "rule:src/lib/tasks-types.ts:1842",
    "kind": "rule",
    "title": "Regra em tasks-types.ts",
    "content": "Repetição por tempo (independente do modelo \"recorrente por limpeza\"):\nao concluir, a pendência volta pendente com um novo prazo N dias à\nfrente, em vez de ficar marcada como feita pra sempre.",
    "source_path": "src/lib/tasks-types.ts",
    "audience": [],
    "content_hash": "8ed6b89b41faff137865671e57cb8069"
  },
  {
    "doc_key": "rule:src/lib/tasks.functions.ts:15816",
    "kind": "rule",
    "title": "Regra em tasks.functions.ts",
    "content": "QUEM ARCA COM O CUSTO (pedido explícito, 10/09/2026) — não é a mesma\npergunta que \"quem resolveu\": um dano pode ser consertado pelo prestador\ne cobrado do proprietário, ou absorvido pela empresa.",
    "source_path": "src/lib/tasks.functions.ts",
    "audience": [],
    "content_hash": "00b2a2ec57599d6e53701307f98a1a48"
  },
  {
    "doc_key": "rule:src/lib/trail.functions.ts:0",
    "kind": "rule",
    "title": "Regra em trail.functions.ts",
    "content": "Ingestão universal de rastro de uso.\n\nRecebe lotes de eventos do navegador (host, equipe e hóspede) e grava no\nEnterprise Audit Trail. Funciona autenticado ou anônimo: quando há sessão,\no evento é atribuído ao usuário; caso contrário fica como visitante/hóspede\nidentificado por um ID anônimo de dispositivo.",
    "source_path": "src/lib/trail.functions.ts",
    "audience": [],
    "content_hash": "1e96dc5eccd9bc146212251429a745d7"
  },
  {
    "doc_key": "rule:src/lib/trail.ts:0",
    "kind": "rule",
    "title": "Regra em trail.ts",
    "content": "Rastro de uso no cliente.\n\nCaptura absolutamente tudo o que a pessoa faz na interface (navegação,\ncliques, campos, envios, cópias, rolagem, foco de aba, erros) e envia em\nlotes para o Enterprise Audit Trail.\n\nPrivacidade: registramos O QUE foi tocado (rótulo do botão, nome do campo),\nnunca o conteúdo digitado. Campos de senha são totalmente ignorados.",
    "source_path": "src/lib/trail.ts",
    "audience": [],
    "content_hash": "6b410279c93cc87f14fef0f542338d1e"
  },
  {
    "doc_key": "rule:stage",
    "kind": "rule",
    "title": "Regra — stage",
    "content": "A ETAPA que a barra lateral pinta. Atraso sobrepõe a fase: uma data que já\npassou sem a ação feita é o único estado que precisa gritar mais alto que\n\"em que ponto da esteira eu estou\".",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "3b40e2414a6dfdd54dd553d8a087c251"
  },
  {
    "doc_key": "rule:StakeholderStatusControl",
    "kind": "rule",
    "title": "Regra — StakeholderStatusControl",
    "content": "Controle de situação do stakeholder — mesma regra em qualquer lugar que o\nusa (card compacto da lista/Kanban ou cabeçalho da ficha de detalhes):\nqualquer mudança de status exige a data real da efetivação, e \"Ativo\" com\ndata futura pede o estágio real (Documentação/Contrato/Assinatura) até lá.",
    "source_path": "src/components/stakeholders/StakeholderStatusControl.tsx",
    "audience": [],
    "content_hash": "4f4bdb312e07754d9b3c496e916632a9"
  },
  {
    "doc_key": "rule:StatDisplayCard",
    "kind": "rule",
    "title": "Regra — StatDisplayCard",
    "content": "Card de estatística pura (sem lista/detalhe por trás) — usado para\n\"Limpezas Realizadas\" e \"Custo Total Limpeza\". Mesmo visual dos KpiCards,\nmas não abre popup: é só um número agregado, \"Hoje\" (fuso de São Paulo).\nQuando `breakdown` vem preenchido, mostra o mesmo tooltip \"i\" usado na\nvisualização de engajamento, listando quais imóveis entraram na conta.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "545c4cb92effd8e79a487b3b34f797a6"
  },
  {
    "doc_key": "rule:subscriptionGrantsAccess",
    "kind": "rule",
    "title": "Regra — subscriptionGrantsAccess",
    "content": "Uma assinatura só concede acesso se o período for válido. Para trials, o\nlimite é `trial_ends_at` (o `current_period_end` costuma vir nulo em trials\ndo Paddle — sem esse teto o trial nunca expiraria).",
    "source_path": "src/lib/plan-guard.server.ts",
    "audience": [],
    "content_hash": "74a2b56781d896125dd9775c2010fac3"
  },
  {
    "doc_key": "rule:syncStaleIcals",
    "kind": "rule",
    "title": "Regra — syncStaleIcals",
    "content": "Ressincroniza iCals desatualizados (>10min) para que qualquer superfície\n(Kanban, KPIs, calendário de ocupação) leia sempre a reserva mais recente.",
    "source_path": "src/lib/arrival-board.server.ts",
    "audience": [],
    "content_hash": "cf9c8a225beeec84d35fd30b9001091c"
  },
  {
    "doc_key": "rule:SystemRole",
    "kind": "rule",
    "title": "Regra — SystemRole",
    "content": "Papéis internos do sistema.\n\nREGRA ESTRUTURAL DO OWNER (documentada aqui, ainda NÃO aplicada):\n - OWNER sempre possui acesso total ao que estiver disponível para o tenant.\n - As permissões do OWNER nunca podem ser editadas, removidas ou rebaixadas.\n - Qualquer tentativa de gravar assignment para um OWNER deve ser rejeitada\n pelo Permission Service nas fases seguintes.",
    "source_path": "src/lib/permissions/permission.types.ts",
    "audience": [],
    "content_hash": "e4b58a484510d22147108fa1b06b17c5"
  },
  {
    "doc_key": "rule:TASK_AGE_VISIBLE_DAYS",
    "kind": "rule",
    "title": "Regra — TASK_AGE_VISIBLE_DAYS",
    "content": "\"Aberta há N dias\" só entra na linha depois de uma semana.\n\nFoi a informação que o usuário pediu e a que mais poluiu quando apareceu em\ntudo: numa lista criada hoje, nove linhas dizendo \"aberta hoje\" não informam\nnada — só ocupam a linha de apoio. Data de abertura é sinal de pendência\nESQUECIDA, e uma pendência só começa a ser esquecida depois de um tempo.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "68c61871b8996a0cedf9af8707e53392"
  },
  {
    "doc_key": "rule:TASK_BUCKET_SELECTED",
    "kind": "rule",
    "title": "Regra — TASK_BUCKET_SELECTED",
    "content": "SELEÇÃO DO CONTADOR: um traço na borda DIREITA, e nada mais (pedido\nexplícito, 09/09/2026).\n\nAntes era um anel fechado em volta do contador — que, dentro de um diálogo\nque já é uma caixa, virava caixa dentro de caixa dentro de caixa. O traço\ndiz \"é este\" com um elemento só; o esfumado até ele existe para o traço não\nparecer um pedaço solto de borda.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "709febd5233eead2c4a01689dc766031"
  },
  {
    "doc_key": "rule:TASK_RULES",
    "kind": "rule",
    "title": "Regra — TASK_RULES",
    "content": "As três categorias que viram pendência no Kanban (pedido explícito): a\ntarefa nasce vinculada AO MESMO TEMPO à reserva (log_id/reservation_id) e\nao imóvel (property_id) — os três campos já existiam em `tasks`, nada\nprecisou mudar lá.\n\n`taskCategory` mapeia para as categorias que a tela de Pendências já\nconhece (ver TaskCategory em tasks-types.ts); `showInCleaning` só é\nligado em \"objeto esquecido\" — quem limpa é quem vai achar e separar o\nobjeto, enquanto dano e manutenção são pra operação resolver, não pra\nfaxina executar.",
    "source_path": "src/lib/reservation-records.functions.ts",
    "audience": [],
    "content_hash": "4a63227ae8b6e0fa00edd75f687643fe"
  },
  {
    "doc_key": "rule:TaskBucket",
    "kind": "rule",
    "title": "Regra — TaskBucket",
    "content": "QUATRO faixas, não cinco (mockup aprovado, 09/09/2026).\n\nUma versão anterior separava \"próximos 7 dias\" de \"depois\". A separação\nparecia mais informativa e não era: quem abre Pendências decide entre\n\"resolver agora\" e \"não é para agora\", e as duas faixas futuras respondiam a\nmesma coisa. Pior, elas obrigavam a um quinto contador que aparecia sozinho\nna barra com um rótulo — \"DEPOIS\" — que ninguém tinha visto antes. Uma\nfaixa \"A vencer\" cobre as duas e a soma continua fechando com o total.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "2c539d7907987fbd9b3419746ecfd83f"
  },
  {
    "doc_key": "rule:TaskChoiceMenu",
    "kind": "rule",
    "title": "Regra — TaskChoiceMenu",
    "content": "Seletor \"agrupar por\" / \"ordenar por\" — o mesmo botão para os dois, porque\nsão o mesmo gesto. O rótulo é sempre a escolha ATUAL: quem olha a barra sabe\ncomo a lista está organizada sem abrir nada, que era a vantagem desta opção\nsobre esconder tudo atrás de um botão só.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "7b21d5477bb8cf8fb021dacae42555a5"
  },
  {
    "doc_key": "rule:TaskCompletion",
    "kind": "rule",
    "title": "Regra — TaskCompletion",
    "content": "Uma marca de \"feito\" pra uma pendência RECORRENTE numa limpeza\nespecífica — não fecha a pendência, só registra que aquela ocorrência já\nfoi resolvida (ela volta pendente na próxima).",
    "source_path": "src/lib/tasks-types.ts",
    "audience": [],
    "content_hash": "ce380fc7778abe7ac0d0a342ab877beb"
  },
  {
    "doc_key": "rule:TaskFormGroup",
    "kind": "rule",
    "title": "Regra — TaskFormGroup",
    "content": "Título de seção do formulário de pendência. Usa `ds-eyebrow` — o rótulo\npequeno padrão do Design System, o mesmo dos cards de indicador — em vez de\num 9.5px extrabold inventado só aqui, que era o menor texto de toda a tela\ne não existia em nenhum outro lugar do sistema.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "cfe839b931d891cf965c39d6d5d493ec"
  },
  {
    "doc_key": "rule:TaskGroupBy",
    "kind": "rule",
    "title": "Regra — TaskGroupBy",
    "content": "PENDÊNCIAS — O RACIONAL DA TELA (pedido explícito, 09/09/2026, com mockups\naprovados).\n\nA tela antiga agrupava por proprietário / imóvel / imóvel+hóspede. Isso\nresponde \"de quem é isto\", que é uma pergunta de ARQUIVO. Quem abre\nPendências no meio do dia está perguntando outra coisa: \"o que eu resolvo\nagora\". Por isso o eixo padrão passou a ser TEMPO + PRIORIDADE, e imóvel /\nproprietário viraram uma escolha de agrupamento — continuam ali, só deixaram\nde mandar na ordem.\n\nO problema de agrupar por imóvel é que isso QUEBRA A FILA: numa fila única a\npior pendência do dia é sempre a primeira linha; agrupada, ela pode estar no\nterceiro grupo. A saída é o cabeçalho do grupo CARREGAR a urgência (barra na\ncor do pior caso + pílulas \"N atrasada\"/\"N hoje\") e os grupos virem\nordenados pelo pior caso de cada um. A fila continua existindo — só passa a\nser entre imóveis, não entre pendências.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "4f58358fdfda86f9671072a193dad782"
  },
  {
    "doc_key": "rule:TaskResolveDialog",
    "kind": "rule",
    "title": "Regra — TaskResolveDialog",
    "content": "Conclusão de pendência com prestação de contas (pedido explícito,\n07/09/2026): quem resolveu, quanto custou e a comprovação. Os três são\nOPCIONAIS — o botão \"Concluir\" funciona com tudo em branco, que é o\ncomportamento que existia antes.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "096e865828b5177e25ca656a7fd3aa81"
  },
  {
    "doc_key": "rule:TasksDialog",
    "kind": "rule",
    "title": "Regra — TasksDialog",
    "content": "Dialog \"PENDÊNCIAS\" do Kanban — 3 agrupamentos (Por Proprietário / Por\nImóvel / Imóvel + Hóspede) + formulário de criação. Toda pendência é\nobrigatoriamente vinculada a um imóvel e/ou a um proprietário (pedido\nexplícito) — nunca solta.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "467e94a80792c94f3d1d95de836383f6"
  },
  {
    "doc_key": "rule:transcribeAssistantAudio",
    "kind": "rule",
    "title": "Regra — transcribeAssistantAudio",
    "content": "Transcreve um áudio gravado no painel (pedido explícito, 07/09/2026).\n\nO áudio não vira anexo nem fica guardado: ele é convertido em texto e esse\ntexto entra na conversa como a pergunta da pessoa. Assim ditar \"abre uma\npendência de manutenção no 105, chuveiro pingando\" percorre exatamente o\nmesmo caminho de quem digitou — inclusive o cartão de confirmação antes de\ngravar. Falar vira só outra forma de escrever, não um segundo fluxo com\nregras próprias.\n\nMesmo endpoint de transcrição que os detalhes do imóvel já usam.",
    "source_path": "src/lib/assistant.functions.ts",
    "audience": [],
    "content_hash": "be9890b721f66bc4228625c302f59ca2"
  },
  {
    "doc_key": "rule:transcribeAudio",
    "kind": "rule",
    "title": "Regra — transcribeAudio",
    "content": "Converte áudio em texto. Recebe bytes, não base64: quem chama já tem o\nformato mais barato à mão (o guia tem o arquivo, o painel decodifica uma\nvez só) e evita uma cópia extra em memória para cada áudio.",
    "source_path": "src/lib/ai/transcribe.server.ts",
    "audience": [],
    "content_hash": "02b59ad68787e9d1c1e603b6c263328d"
  },
  {
    "doc_key": "rule:transcribeRecordAudio",
    "kind": "rule",
    "title": "Regra — transcribeRecordAudio",
    "content": "DITADO nos campos de título e descrição — o prestador fala, vira texto.\n\nUsa a MESMA transcrição das duas IAs (src/lib/ai/transcribe.server.ts), pelo\nmesmo motivo de sempre: falar tem que valer o mesmo que digitar. O áudio do\nditado é usado e descartado; áudio que a pessoa queira GUARDAR entra como\nmídia da situação, pelo botão \"+\".",
    "source_path": "src/lib/reservation-records.functions.ts",
    "audience": [],
    "content_hash": "416922cd1ecd46498049deaa1ef770bb"
  },
  {
    "doc_key": "rule:UNTITLED",
    "kind": "rule",
    "title": "Regra — UNTITLED",
    "content": "TÍTULO E DESCRIÇÃO a partir do ÚNICO campo de texto que existe.\n\nO banco guarda um `body` só — o que a pessoa digita junto com a mídia — e\no nome do arquivo. Não há dois campos. Então a PRIMEIRA LINHA do texto vira\ntítulo e o RESTO vira descrição. É reversível: no dia em que existir um campo\npróprio de título, ele simplesmente passa na frente daqui.\n\nREGRA DA CASA (pedido explícito, 10/09/2026): \"todo e qualquer registro\nprecisa ter um título curto e uma descrição sobre o assunto... deve-se\npriorizar mostrar o título e não o nome do arquivo na página principal\".\nPor isso o NOME DO ARQUIVO NUNCA vira título aqui — ele é identificador\n(CASACHARM-01), não assunto, e vive na meta do visualizador. Sem título\ngravado a linha diz \"Sem título\", que é a verdade e cobra o preenchimento.",
    "source_path": "src/components/dashboard/RecordsWorkspace.tsx",
    "audience": [],
    "content_hash": "9b0c205a1bbe5cfa06404953b651c945"
  },
  {
    "doc_key": "rule:updateRecordText",
    "kind": "rule",
    "title": "Regra — updateRecordText",
    "content": "EDITAR o texto de uma situação já gravada (decisão do cliente, 10/09/2026:\n\"pode manter 'Sem título informado', mas com a possibilidade do\nusuário/prestador editar posteriormente\").\n\nEscreve sempre na LINHA PRINCIPAL do grupo, mesmo que o id recebido seja o\nde uma mídia secundária — quem edita clica no que está vendo, não no que\nestá no banco. O título da pendência acompanha, senão o Kanban continua\ndizendo \"Dano/incidente registrado\" para sempre.",
    "source_path": "src/lib/reservation-records.functions.ts",
    "audience": [],
    "content_hash": "86984cd0a2defd2f6039fb8f38f266a1"
  },
  {
    "doc_key": "rule:upsertNodes",
    "kind": "rule",
    "title": "Regra — upsertNodes",
    "content": "Sincroniza definições do Registry com a tabela (upsert por slug).\nNenhum nó é apagado — compatibilidade total com o que já existe.\n\nO upsert é feito em ondas por profundidade do slug para que o `parent_id`\ndos filhos sempre encontre o pai já persistido (herança garantida).",
    "source_path": "src/lib/permissions/permission.repository.server.ts",
    "audience": [],
    "content_hash": "696f9de4c742c8c978e7d4f5ff8ca7bd"
  },
  {
    "doc_key": "rule:useAreaAccess",
    "kind": "rule",
    "title": "Regra — useAreaAccess",
    "content": "`useAreaAccess` — decisões do backend para VÁRIAS áreas em uma única consulta.\n\nRegra: o frontend nunca decide permissão; aqui só transportamos a decisão\njá tomada pelo Authorization Runtime. Enquanto carrega, `loading` é true e\na UI deve aguardar (não mostrar nem esconder prematuramente).",
    "source_path": "src/lib/permissions/useAreaAccess.ts",
    "audience": [],
    "content_hash": "7c3a001c065f98517444a3fd22165ca7"
  },
  {
    "doc_key": "rule:useScreenshotActions",
    "kind": "rule",
    "title": "Regra — useScreenshotActions",
    "content": "A captura virou HOOK (09/09/2026) porque ela deixou de ter um botão só.\n\nCom as ações das telas indo para a linha do título, \"tirar um print\" perdeu\no botão fixo e virou duas linhas dentro do menu de filtros — mas continua\nexistindo como botão próprio nos popups de indicador e no tooltip da\nLimpeza, que não têm linha de título. Duas superfícies, uma lógica: era isso\nou duplicar `html-to-image`, `toast` e o estado de ocupado em dois lugares.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "2e82de9931708dccf490fb14ed3f6d93"
  },
  {
    "doc_key": "rule:useWholeCardsMaxHeight",
    "kind": "rule",
    "title": "Regra — useWholeCardsMaxHeight",
    "content": "Limita a altura de uma lista em N cards INTEIROS — nunca corta um card ao\nmeio. Mede os itens de verdade e escolhe o maior corte que caiba na tela.",
    "source_path": "src/components/dashboard/OperationWorkspace.tsx",
    "audience": [],
    "content_hash": "b8aa4791c71d3daa3834c0ac42c3ea46"
  },
  {
    "doc_key": "rule:UUID_RE",
    "kind": "rule",
    "title": "Regra — UUID_RE",
    "content": "Convenção da esteira: nem todo card tem log de verdade. Reserva vinda do\niCal sem formulário preenchido carrega um `logId` sintético (\"ical:<id>\"),\nque só serve como chave de tela. Mandar isso para `markNoShow` — que valida\nuuid — daria erro de validação; o identificador utilizável nesse caso é o\n`reservationId`. Estas duas funções são o filtro.",
    "source_path": "src/lib/ai/assistant-tools.server.ts",
    "audience": [],
    "content_hash": "620175e88a29e2339d97f8d56ac3e92f"
  },
  {
    "doc_key": "rule:verifiedActor",
    "kind": "rule",
    "title": "Regra — verifiedActor",
    "content": "Identidade VERIFICADA do autor.\n\nAntes o token era apenas decodificado em base64 — qualquer pessoa poderia\nforjar `sub`/`email` e gravar rastro em nome de outro usuário. Agora o token\né validado pelo serviço de autenticação; se não for válido, o evento entra\ncomo visitante anônimo.",
    "source_path": "src/lib/trail.functions.ts",
    "audience": [],
    "content_hash": "45d0d9a247b1539b9f81ac2c1ae800cb"
  },
  {
    "doc_key": "rule:verifyEventDates",
    "kind": "rule",
    "title": "Regra — verifyEventDates",
    "content": "Confere no conteúdo real da fonte a data de cada item classificado como\n\"evento\". Só sobrevive o que tem data explícita e ainda não passou — nada de\ninferência. Sem confirmação, o item é descartado (nunca vira \"talvez\").",
    "source_path": "src/lib/city-news.functions.ts",
    "audience": [],
    "content_hash": "afca04ac8ec6f48953cefe9f6bcb2692"
  },
  {
    "doc_key": "rule:VIEWER_STAGE",
    "kind": "rule",
    "title": "Regra — VIEWER_STAGE",
    "content": "O VISUALIZADOR (mockup aprovado, 10/09/2026).\n\nTrês decisões moldam esta folha:\n\n 1. PALCO DE ALTURA FIXA. Vídeo vertical, vídeo horizontal, foto quadrada,\n áudio e nota abrem todos do mesmo tamanho. A folha parava de ser a\n mesma coisa a cada registro — pulava de altura e reposicionava os\n botões debaixo do dedo.\n 2. FUNDO FOSCO. A mídia entra INTEIRA (`object-contain`) e o vão que\n sobraria como tarja preta recebe uma cópia dela mesma, borrada e\n escurecida. Onde a mídia preenche o palco, não há fosco nenhum.\n 3. TÍTULO E DESCRIÇÃO ABAIXO da mídia, nunca por cima: sobre a imagem o\n texto some assim que o vídeo escurece.",
    "source_path": "src/components/dashboard/RecordsWorkspace.tsx",
    "audience": [],
    "content_hash": "4bc230b8c3f56be83018e0251fd78ff1"
  },
  {
    "doc_key": "rule:visiblePropertyIds",
    "kind": "rule",
    "title": "Regra — visiblePropertyIds",
    "content": "Recorte por residência (escopo PROPERTY).\n\nRegra do produto: um membro da equipe só enxerga as residências que ele\natende. Se nenhuma residência estiver marcada para ele, ele não vê NENHUMA —\nlistas, cards e indicadores ficam zerados, mesmo com permissão de edição.\n\nRetorna:\n - `null` quando não há recorte (titular da conta ou admin do SaaS fora de\n uma conta): enxerga tudo o que a RLS permitir.\n - `string[]` (possivelmente vazio) com os IDs permitidos.",
    "source_path": "src/lib/permissions/property-scope.server.ts",
    "audience": [],
    "content_hash": "6cd228872ece4097f6e2e36dc4e1397f"
  }
];
