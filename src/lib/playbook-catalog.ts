/**
 * PLAYBOOK DO IMÓVEL — catálogo de campos (mockup P01 aprovado, 21/10/2026).
 *
 * Cada linha do Playbook tem: seção, rótulo, a "Observação da IA" (texto
 * simples dizendo o que o dado é e se/quando a IA o usa — ou "IA não deve
 * usar."), a audiência (G = Hóspede Ativo, P = Público, I = Equipe Interna),
 * se pode ser copiada e se é segredo (mascarado). Os VALORES não moram aqui:
 * saem do cadastro do imóvel (ver `playbook-build.ts`).
 */
export type Audience = "G" | "P" | "I";
export const AUDIENCE_LABEL: Record<Audience, string> = { G: "Hóspede Ativo", P: "Público", I: "Equipe Interna" };

export type PlaybookSectionMeta = { id: string; num: string; title: string; desc: string };
export const PLAYBOOK_SECTIONS: PlaybookSectionMeta[] = [
  {
    "id": "s1",
    "num": "1",
    "title": "Identificação & Infraestrutura",
    "desc": "Quem é o imóvel, onde fica e quanto comporta."
  },
  {
    "id": "s2",
    "num": "2",
    "title": "Jornada de Acesso & Barreiras",
    "desc": "Do portão à porta, com check-in e check-out."
  },
  {
    "id": "s3",
    "num": "3",
    "title": "Aparelhos, Equipamentos & Manuais",
    "desc": "O que existe na casa e como usar."
  },
  {
    "id": "s4",
    "num": "4",
    "title": "Regras da Casa & FAQs",
    "desc": "O que vale durante a estadia e as dúvidas mais comuns."
  },
  {
    "id": "s5",
    "num": "5",
    "title": "Contingências & Utilidades Críticas",
    "desc": "O que fazer quando algo falha."
  }
];

export type FieldMeta = { key: string; section: number; label: string; au: Audience; copy: boolean; secret: boolean; obs: string };
export const PLAYBOOK_FIELDS: FieldMeta[] = [
  {
    "key": "titulo_publico",
    "section": 1,
    "label": "Título público",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Nome comercial do imóvel, o que vem depois do hífen no título do anúncio, igual ao que o hóspede vê. A IA deve usar este nome, completo e sem abreviar, em toda saudação, confirmação de reserva e lembrete de chegada, e sempre que o hóspede perguntar o nome do imóvel. Se o hóspede usar outro nome ou tiver mais de uma reserva, confirmar de qual imóvel ele fala antes de passar qualquer dado de acesso. Nunca dizer o nome interno, que é a parte antes do hífen."
  },
  {
    "key": "tipo_de_espaco",
    "section": 1,
    "label": "Tipo de espaço",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Diz o que o hóspede ocupa: o imóvel inteiro, um quarto privativo ou um quarto compartilhado. A IA deve usar quando perguntarem se vão dividir com alguém, se há outros hóspedes ou se o anfitrião mora no local, respondendo de acordo com o valor ao lado. Não afirmar nada sobre moradores além do que consta neste documento."
  },
  {
    "key": "descricao_completa_anuncio",
    "section": 1,
    "label": "Descrição do anúncio no Airbnb",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Texto integral descritivo do espaço cadastrado na plataforma."
  },
  {
    "key": "endereco_rua_e_numero",
    "section": 1,
    "label": "Endereço (rua e número)",
    "au": "G",
    "copy": true,
    "secret": false,
    "obs": "Endereço da hospedagem (rua e número). A IA deve informar somente à pessoa com reserva confirmada, quando perguntar como chegar, ao enviar o roteiro de chegada ou quando o motorista de aplicativo precisar. Antes da confirmação, citar apenas bairro e cidade. Depois, enviar o endereço completo junto com o link do mapa, na mesma mensagem. Nunca fornecer a quem não consta na reserva."
  },
  {
    "key": "bairro",
    "section": 1,
    "label": "Bairro",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Bairro do imóvel. A IA deve usar para localizar o imóvel de forma geral, inclusive antes da reserva, e em dúvidas sobre a região. Para distâncias, usar apenas as que constam na descrição completa do anúncio; não estimar outras."
  },
  {
    "key": "cidade",
    "section": 1,
    "label": "Cidade",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Cidade da hospedagem. A IA deve usar como ponto de partida de qualquer rota, distância ou recomendação, e nunca a cidade de origem do hóspede."
  },
  {
    "key": "cep",
    "section": 1,
    "label": "CEP",
    "au": "G",
    "copy": true,
    "secret": false,
    "obs": "Código postal da hospedagem. A IA deve informar quando a pessoa com reserva confirmada precisar pedir comida, táxi, entrega ou transporte por aplicativo. Informar sempre junto com o endereço; nunca a quem não tem reserva."
  },
  {
    "key": "link_do_mapa",
    "section": 1,
    "label": "Link do mapa",
    "au": "G",
    "copy": true,
    "secret": false,
    "obs": "Link que abre a rota até o imóvel. A IA deve enviar quando o hóspede perguntar como chegar, disser que está perdido ou pedir a localização. Enviar sempre junto com o endereço por extenso, nunca sozinho. Se o link não abrir no aparelho do hóspede, reenviar o endereço e o CEP escritos."
  },
  {
    "key": "imovel_em_condominio",
    "section": 1,
    "label": "Imóvel em condomínio",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Indica se o imóvel fica em condomínio, com portaria e regras próprias. A IA deve usar quando o hóspede perguntar sobre portaria, controle de entrada ou regras de condomínio, respondendo de acordo com o valor ao lado."
  },
  {
    "key": "vagas_de_garagem",
    "section": 1,
    "label": "Vagas de garagem",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Descrição das vagas de garagem: quantidade, tamanho, custo e cobertura. A IA deve usar em qualquer dúvida de estacionamento (tem garagem, cabe meu carro, é coberta, é paga). Responder só com o que está descrito e não prometer mais vagas do que as informadas."
  },
  {
    "key": "maximo_de_veiculos",
    "section": 1,
    "label": "Máximo de veículos",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Limite de veículos aceitos. A IA deve usar quando o hóspede avisar que chegará com mais de um carro ou com veículo grande, informando o limite e que o excedente deve ficar em local que não bloqueie vizinhos."
  },
  {
    "key": "hospedes_maximo",
    "section": 1,
    "label": "Hóspedes (máximo)",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Capacidade máxima do imóvel, incluindo crianças. A IA deve usar ao receber pedido de reserva, aviso de visitantes ou grupo maior. Quando houver taxa por hóspede extra, informar conforme a seção 7. Não aceitar pedidos acima do limite."
  },
  {
    "key": "quartos",
    "section": 1,
    "label": "Quartos",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Número de quartos. A IA deve usar em dúvidas de acomodação e ao distribuir os hóspedes, sempre junto com a distribuição das camas."
  },
  {
    "key": "camas",
    "section": 1,
    "label": "Camas",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Número total de camas. A IA deve usar em dúvidas de acomodação, junto com a distribuição por cômodo. Não prometer camas extras."
  },
  {
    "key": "banheiros",
    "section": 1,
    "label": "Banheiros",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Número de banheiros. A IA deve usar quando perguntarem sobre banheiros, informando também se algum quarto tem banheiro próprio, conforme a distribuição das camas."
  },
  {
    "key": "distribuicao_das_camas",
    "section": 1,
    "label": "Distribuição das camas",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Que cama existe em cada cômodo. A IA deve usar quando o hóspede pedir ajuda para organizar quem dorme onde, descrevendo cada cômodo exatamente como consta e respeitando os cômodos sem ar-condicionado indicados na descrição do anúncio."
  },
  {
    "key": "voltagem_das_tomadas",
    "section": 1,
    "label": "Voltagem das tomadas",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Informa se as tomadas são 110V ou 220V, com destaque para eletrodomésticos que exigem adaptador. A IA deve usar quando o hóspede perguntar se pode ligar um aparelho. Enquanto estiver vazio, não afirmar a voltagem: dizer que vai confirmar com a equipe."
  },
  {
    "key": "descarte_de_lixo",
    "section": 1,
    "label": "Descarte de lixo",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Onde e quando o lixo deve ser descartado. A IA deve usar quando o hóspede perguntar onde jogar o lixo ou antes do check-out. Enquanto estiver vazio, orientar a seguir o checklist de saída e confirmar com a equipe."
  },
  {
    "key": "nome_interno",
    "section": 1,
    "label": "Nome interno",
    "au": "I",
    "copy": false,
    "secret": false,
    "obs": "IA não deve usar."
  },
  {
    "key": "modo_de_acesso",
    "section": 2,
    "label": "Modo de acesso",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Define como o hóspede entra no imóvel (fechadura eletrônica, cadeado-cofre, portaria, chaves). A IA deve usar em qualquer dúvida de entrada ('como eu entro?', 'preciso de chave?', 'tem senha?') e explicar o passo a passo da seção 2 na ordem. Nunca sugerir um meio de acesso que não conste aqui."
  },
  {
    "key": "ponto_de_acesso",
    "section": 2,
    "label": "Ponto de acesso",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Nome com que o hóspede reconhece o ponto de acesso. A IA deve usar exatamente este nome ao explicar a entrada e ao responder onde fica o ponto de acesso, para o hóspede associar à instrução."
  },
  {
    "key": "codigo_do_portao",
    "section": 2,
    "label": "Código do portão",
    "au": "G",
    "copy": true,
    "secret": true,
    "obs": "Senha de abertura do portão (mascarada neste documento). A IA só deve informar no dia da chegada e apenas a quem consta na reserva. Nunca antecipar, nunca repetir em conversa com terceiros, nunca colocar em FAQ. Se o hóspede errar, retomar as instruções do portão e conferir cada passo com ele."
  },
  {
    "key": "instrucoes_do_portao",
    "section": 2,
    "label": "Instruções do portão",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Passo a passo oficial para abrir o portão sem ajuda presencial. A IA deve usar quando o hóspede estiver na porta sem conseguir abrir ou pedir ajuda com o acesso. Enviar o texto na ordem, uma linha por vez, sem resumir nem reescrever. Se não funcionar, pedir uma foto do local e acionar a equipe."
  },
  {
    "key": "horario_de_check_in",
    "section": 2,
    "label": "Horário de check-in",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Horário mais cedo de entrada. A IA deve usar quando o hóspede pedir para chegar antes ou perguntar a partir de que horas pode entrar. Informar o horário, dizer que não é flexível e orientar a aguardar se chegar antes. Não prometer liberação antecipada."
  },
  {
    "key": "instrucoes_de_check_in",
    "section": 2,
    "label": "Instruções de check-in",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Roteiro oficial de chegada, um passo por linha. A IA deve usar na véspera, no dia da chegada e sempre que o hóspede estiver na porta. Enviar na ordem, sem pular passos, trocando a tag de senhas pela senha do dia somente no dia da chegada. Encerrar pedindo confirmação pelo chat assim que o hóspede entrar."
  },
  {
    "key": "aviso_de_check_in",
    "section": 2,
    "label": "Aviso de check-in",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Pedido para o hóspede avisar antes de chegar. A IA deve usar na véspera, no dia da chegada e quando o hóspede informar o horário previsto, lembrando do aviso para a equipe se organizar. Não prometer recepção presencial."
  },
  {
    "key": "horario_de_check_out",
    "section": 2,
    "label": "Horário de check-out",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Horário máximo de saída. A IA deve usar quando o hóspede pedir saída tardia ou perguntar o horário. Informar que não é flexível e que sair após o horário gera penalidade financeira."
  },
  {
    "key": "instrucoes_de_check_out",
    "section": 2,
    "label": "Instruções de check-out",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Roteiro oficial de saída, um passo por linha. A IA deve usar na véspera, na manhã da saída e sempre que o hóspede perguntar o que fazer ao sair. Enviar na ordem, sem resumir, e pedir a confirmação pelo chat ao concluir."
  },
  {
    "key": "checklist_de_saida",
    "section": 2,
    "label": "Checklist de saída",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Roteiro oficial de saída, um passo por linha. A IA deve usar na véspera, na manhã da saída e sempre que o hóspede perguntar o que fazer ao sair. Enviar na ordem, sem resumir, e pedir a confirmação pelo chat ao concluir."
  },
  {
    "key": "aviso_de_check_out",
    "section": 2,
    "label": "Aviso de check-out",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Regra sobre sair após o horário permitido. A IA deve usar quando o hóspede pedir saída mais tarde ou avisar que vai atrasar. Informar a regra e o horário limite. Não oferecer tolerância nem citar valor de multa que não conste aqui; pedidos especiais vão para a equipe."
  },
  {
    "key": "senhas_temporarias_por_reserva",
    "section": 2,
    "label": "Senhas temporárias por reserva",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Senhas geradas para cada reserva e liberadas só no dia da chegada. A IA deve usar quando o hóspede perguntar a senha de acesso, apenas no dia e apenas para quem consta na reserva. Se perguntarem antes, explicar que a senha é enviada no dia da chegada. Nunca reutilizar senha de outra reserva."
  },
  {
    "key": "fechadura_eletronica",
    "section": 2,
    "label": "Fechadura eletrônica",
    "au": "I",
    "copy": false,
    "secret": false,
    "obs": "IA não deve usar."
  },
  {
    "key": "nome_da_rede_wi_fi",
    "section": 3,
    "label": "Nome da rede Wi-Fi",
    "au": "G",
    "copy": true,
    "secret": false,
    "obs": "Nome do Wi-Fi do imóvel. A IA deve usar quando o hóspede com reserva ativa perguntar sobre internet. Informar exatamente como está escrito, respeitando maiúsculas, e nunca a quem não tem reserva ativa."
  },
  {
    "key": "senha_do_wi_fi",
    "section": 3,
    "label": "Senha do Wi-Fi",
    "au": "G",
    "copy": true,
    "secret": true,
    "obs": "Senha do Wi-Fi (mascarada neste documento). A IA só deve informar a hóspede com reserva ativa que pedir. Se a internet não funcionar, orientar a reiniciar o roteador e aguardar alguns minutos antes de acionar a equipe."
  },
  {
    "key": "climatizacao",
    "section": 3,
    "label": "Climatização",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Itens do grupo listados no anúncio. A IA deve usar quando o hóspede perguntar se há um item do grupo, respondendo só com os itens listados. Se o item não estiver na lista, dizer que não consta no anúncio e não prometer. Sala de estar sem ar-condicionado, conforme a descrição do anúncio."
  },
  {
    "key": "cozinha_e_sala_de_jantar",
    "section": 3,
    "label": "Cozinha e sala de jantar",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Itens do grupo listados no anúncio. A IA deve usar quando o hóspede perguntar se há um item do grupo, respondendo só com os itens listados. Se o item não estiver na lista, dizer que não consta no anúncio e não prometer."
  },
  {
    "key": "entretenimento",
    "section": 3,
    "label": "Entretenimento",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Itens do grupo listados no anúncio. A IA deve usar quando o hóspede perguntar se há um item do grupo, respondendo só com os itens listados. Se o item não estiver na lista, dizer que não consta no anúncio e não prometer."
  },
  {
    "key": "quarto_e_lavanderia",
    "section": 3,
    "label": "Quarto e lavanderia",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Itens do grupo listados no anúncio. A IA deve usar quando o hóspede perguntar se há um item do grupo, respondendo só com os itens listados. Se o item não estiver na lista, dizer que não consta no anúncio e não prometer."
  },
  {
    "key": "banheiro",
    "section": 3,
    "label": "Banheiro",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Itens do grupo listados no anúncio. A IA deve usar quando o hóspede perguntar se há um item do grupo, respondendo só com os itens listados. Se o item não estiver na lista, dizer que não consta no anúncio e não prometer."
  },
  {
    "key": "ausentes_no_anuncio",
    "section": 3,
    "label": "Ausentes no anúncio",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Itens que o anúncio declara que NÃO existem no imóvel. A IA deve usar quando o hóspede perguntar por algum deles ou planejar o que levar, dizendo com clareza que não constam e sugerindo levar o item. Nunca prometer que existem."
  },
  {
    "key": "manuais_de_equipamentos",
    "section": 3,
    "label": "Manuais de equipamentos",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Instrução de uso de um equipamento (ar-condicionado, máquina de lavar, fogão). A IA deve usar quando o hóspede não souber operar um aparelho. Se não houver manual, responder só com o que consta nas comodidades e acionar a equipe se o problema persistir. Não inventar passos de uso."
  },
  {
    "key": "chuveiros_e_aquecedores",
    "section": 3,
    "label": "Chuveiros e aquecedores",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Como ligar e ajustar a água quente dos banheiros. A IA deve usar quando o hóspede relatar água fria. Enquanto estiver vazio, orientar a aguardar alguns minutos e acionar a equipe se persistir."
  },
  {
    "key": "horario_de_silencio",
    "section": 4,
    "label": "Horário de silêncio",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Período de silêncio obrigatório. A IA deve usar quando houver reclamação de barulho ou pedido de som alto, informando o horário e lembrando as regras adicionais da casa sobre barulho."
  },
  {
    "key": "animais_de_estimacao",
    "section": 4,
    "label": "Animais de estimação",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Regra sobre pets: se são aceitos e quantos. A IA deve usar quando o hóspede perguntar se pode levar pet. Responder conforme o valor ao lado, informar o limite e a taxa da seção 7 e lembrar que os dejetos devem ser limpos pelo hóspede."
  },
  {
    "key": "fumar",
    "section": 4,
    "label": "Fumar",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Regra sobre fumar. A IA deve usar quando o hóspede perguntar se pode fumar, inclusive em varanda ou quintal, respondendo conforme o valor ao lado e sem abrir exceções."
  },
  {
    "key": "festas_e_eventos",
    "section": 4,
    "label": "Festas e eventos",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Regra sobre festas e eventos. A IA deve usar quando o hóspede perguntar sobre comemorações, reuniões ou convidados, respondendo com firmeza conforme o valor ao lado. Não sugerir exceções."
  },
  {
    "key": "criancas_e_bebes",
    "section": 4,
    "label": "Crianças e bebês",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Regra sobre crianças e bebês. A IA deve usar quando perguntarem, respondendo conforme o valor ao lado. Crianças contam no limite de hóspedes. Não oferecer berço ou cadeirão que não constem no anúncio."
  },
  {
    "key": "fotografia_comercial",
    "section": 4,
    "label": "Fotografia comercial",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Regra sobre ensaios e filmagens comerciais. A IA deve usar quando o hóspede pedir ensaio, gravação ou produção profissional. Responder conforme o valor ao lado e encaminhar pedidos especiais à equipe, sem prometer autorização."
  },
  {
    "key": "maximo_de_hospedes",
    "section": 4,
    "label": "Máximo de hóspedes",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Limite de pessoas pelas regras da casa. A IA deve usar quando houver visitas ou grupos maiores, informando que visitantes não incluídos na reserva não são permitidos."
  },
  {
    "key": "cameras_aviso_ao_hospede",
    "section": 4,
    "label": "Câmeras (aviso ao hóspede)",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Declaração do anúncio sobre câmeras: quantas, onde ficam e se gravam áudio. A IA deve usar quando o hóspede perguntar sobre privacidade ou câmeras, informando só o que está escrito. Lembrar que é proibido desligar, cobrir ou interferir nelas."
  },
  {
    "key": "texto_de_seguranca",
    "section": 4,
    "label": "Texto de segurança",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Avisos de segurança publicados no anúncio (alarmes, câmeras, detectores). A IA deve usar em dúvidas sobre segurança, alarmes ou câmeras, respondendo com exatidão o que está escrito, sem suavizar e sem afirmar equipamentos que não constam."
  },
  {
    "key": "politica_de_cancelamento",
    "section": 4,
    "label": "Política de cancelamento",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Política de cancelamento oficial do anúncio. A IA deve usar quando o hóspede perguntar sobre cancelar ou alterar a reserva, informando só o que está escrito e encaminhando exceções à equipe."
  },
  {
    "key": "taxa_de_limpeza",
    "section": 4,
    "label": "Taxa de limpeza",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Valor da taxa de limpeza cobrada pelo anúncio. A IA deve usar quando o hóspede perguntar sobre custos extras, informando só o que está escrito."
  },
  {
    "key": "taxa_hospede_adicional",
    "section": 4,
    "label": "Taxa de hóspede adicional",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Hóspedes incluídos na diária e valor por hóspede adicional. A IA deve usar quando houver dúvida sobre quantas pessoas cabem no valor ou custo por pessoa extra."
  },
  {
    "key": "taxa_pet",
    "section": 4,
    "label": "Taxa de pet",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Valor cobrado por animal de estimação, quando o anúncio tem essa taxa. A IA deve usar junto da regra de animais de estimação."
  },
  {
    "key": "regras_adicionais_da_casa",
    "section": 4,
    "label": "Regras adicionais da casa",
    "au": "P",
    "copy": false,
    "secret": false,
    "obs": "Regras próprias do anfitrião, uma por linha. A IA deve usar em qualquer dúvida de conduta, aplicando junto com as regras do anúncio; em caso de dúvida, vale a mais restritiva."
  },
  {
    "key": "contatos_de_emergencia",
    "section": 5,
    "label": "Contatos de emergência",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Número acionável em emergência, com rótulo de quem é. A IA deve usar apenas em emergência real (incêndio, saúde, segurança). Se não houver contato, orientar a ligar para os números públicos de emergência do país e acionar imediatamente a equipe."
  },
  {
    "key": "telefone_do_anfitriao",
    "section": 5,
    "label": "Telefone do anfitrião",
    "au": "G",
    "copy": true,
    "secret": false,
    "obs": "Telefone de urgência do anfitrião. A IA só deve informar em urgência real (sem acesso ao imóvel, falta de água ou luz, risco à segurança) quando o chat não resolver. Se estiver vazio, não prometer ligação: registrar o caso, acionar a equipe e avisar que o retorno será pelo chat."
  },
  {
    "key": "localizacao_dos_disjuntores",
    "section": 5,
    "label": "Localização dos disjuntores",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Onde fica o quadro de energia e como religar um disjuntor. A IA deve usar quando faltar energia em parte da casa. Enquanto estiver vazio, orientar a verificar o que estava ligado e acionar a equipe."
  },
  {
    "key": "registro_de_agua",
    "section": 5,
    "label": "Registro de água",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Onde fecar ou abrir a água em caso de vazamento. A IA deve usar em vazamentos ou falta de água. Enquanto estiver vazio, pedir foto do problema e acionar a equipe imediatamente."
  },
  {
    "key": "chave_do_gas",
    "section": 5,
    "label": "Chave do gás",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Onde fecha o gás do fogão. A IA deve usar quando o hóspede sentir cheiro de gás: orientar a abrir as janelas, não acionar interruptores e acionar a equipe e os Bombeiros."
  },
  {
    "key": "procedimento_se_faltar_energia",
    "section": 5,
    "label": "Procedimento se faltar energia",
    "au": "G",
    "copy": false,
    "secret": false,
    "obs": "Passo a passo para queda de energia. Enquanto estiver vazio, a IA deve orientar a conferir o quadro de energia e acionar a equipe."
  },
  {
    "key": "bateria_da_fechadura",
    "section": 5,
    "label": "Bateria da fechadura",
    "au": "I",
    "copy": false,
    "secret": false,
    "obs": "IA não deve usar."
  }
];

/** Observação padrão das perguntas frequentes (uma linha por FAQ cadastrada). */
export const FAQ_OBS = "Pergunta frequente com resposta oficial da equipe. A IA deve usar quando o hóspede fizer a mesma pergunta ou parecida, respondendo com este texto antes de improvisar. Senhas e códigos só no dia da chegada.";
/** Observação padrão dos prestadores de apoio vinculados ao imóvel. */
export const PROVIDER_OBS = "Prestador de serviço vinculado ao imóvel (limpeza, lavanderia, elétrica, chaveiro). A IA deve usar somente com usuários internos, para dizer quem faz o serviço e como contatar. Nunca passar nome, telefone ou e-mail de prestador a hóspedes; se o hóspede precisar de reparo, registrar o caso e acionar a equipe.";
/** Observação padrão de uma linha criada à mão (o anfitrião ajusta na Nota). */
export const CUSTOM_OBS = "Linha criada pelo anfitrião para este imóvel. A IA deve usar somente conforme a audiência indicada ao lado e a Nota do anfitrião.";
