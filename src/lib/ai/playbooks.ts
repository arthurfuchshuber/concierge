/**
 * PLAYBOOKS DE DIAGNÓSTICO (17/10/2026).
 *
 * Antes de acionar a equipe, a IA tenta resolver ou, no mínimo, investigar:
 * roteiros curtos para os problemas mais comuns de hospedagem. Servem de ponto
 * de partida — as instruções oficiais do imóvel (FAQ, manual, regras) SEMPRE
 * prevalecem, e a IA nunca inventa um procedimento que o imóvel não tenha
 * (ex.: localização do disjuntor) — se não souber, pergunta ao hóspede o que
 * ele vê e aciona a equipe com o diagnóstico já feito.
 *
 * Regras comuns: UMA pergunta/passo por vez, tom calmo, nada que exija
 * ferramenta, escada ou mexer em instalação elétrica/gás.
 */
export type Playbook = {
  id: string;
  title: string;
  match: RegExp;
  /** Passos de diagnóstico, na ordem. */
  steps: string[];
  /** Quando escalar para a equipe (com o diagnóstico no motivo). */
  escalateWhen: string;
  /** Risco: a equipe é acionada de imediato e a IA orienta segurança primeiro. */
  safety?: "immediate";
};

const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const PLAYBOOKS: Playbook[] = [
  {
    id: "gas",
    title: "Cheiro de gás",
    match: /\b(cheiro de gas|vazamento de gas|gas vazando|cheirando a gas)\b/,
    safety: "immediate",
    steps: [
      "Orientar com calma: não acender luz nem fósforo, não usar o celular perto do local, abrir portas e janelas e sair do ambiente.",
      "Se o cheiro for forte, ligar para a emergência (193, Corpo de Bombeiros) de fora do imóvel.",
    ],
    escalateWhen: "Sempre, de imediato, com urgência alta.",
  },
  {
    id: "vazamento",
    title: "Vazamento ou alagamento",
    match: /\b(vazamento|vazando|alagad[oa]|alagando|inundand|cano estourou|torneira nao fecha)\b/,
    safety: "immediate",
    steps: [
      "Perguntar onde está a água e se há tomadas ou aparelhos elétricos molhados; orientar a não tocar neles.",
      "Se o hóspede souber, pedir para fechar o registro ou a torneira de onde sai a água (só se estiver no manual do imóvel; senão, não improvisar).",
      "Pedir uma foto, se for seguro.",
    ],
    escalateWhen: "De imediato, urgência alta, com local e foto no motivo.",
  },
  {
    id: "energia",
    title: "Sem energia elétrica",
    match: /\b(sem (?:luz|energia)|acabou a (?:luz|energia)|caiu a (?:luz|energia)|disjuntor|desarmou)\b/,
    steps: [
      "Perguntar se a falta de energia é no imóvel inteiro ou só em alguns cômodos/tomadas, e se os vizinhos ou a rua também estão sem luz.",
      "Se o manual do imóvel indicar onde fica o quadro de disjuntores, orientar a verificar se algum está desligado (apenas religar um por vez; nunca mexer em fiação).",
      "Se o disjuntor desarmar de novo, parar e não insistir.",
    ],
    escalateWhen: "Falta total que persiste, disjuntor que desarma de novo, cheiro de queimado ou faísca (urgência alta).",
  },
  {
    id: "agua",
    title: "Sem água",
    match: /\b(sem agua|nao (?:tem|sai|esta saindo) agua|falta d agua|falta de agua)\b/,
    steps: [
      "Perguntar se falta água em todos os pontos ou só em um (torneira, chuveiro, descarga).",
      "Perguntar se os vizinhos também estão sem água (pode ser falta no abastecimento).",
      "Se o manual indicar registro ou bomba, orientar a conferir se o registro está aberto.",
    ],
    escalateWhen: "Falta em todos os pontos sem explicação, ou há mais de poucos minutos.",
  },
  {
    id: "agua_quente",
    title: "Chuveiro sem água quente",
    match: /\b(chuveiro|agua) (?:nao )?(?:esquenta|quente|gelad[ao]|fria)|sem agua quente|(?:nao|nunca) esquenta\b/,
    steps: [
      "Perguntar se a água não esquenta em nenhum ponto ou só no chuveiro, e se há água fria saindo normalmente.",
      "Chuveiro elétrico: orientar a deixar a água correr alguns segundos e conferir se a chave está na posição 'inverno' (ou na temperatura mais alta), sem mexer no resistor.",
      "Aquecedor central/boiler: se o manual descrever, conferir se está ligado; não abrir nem manipular o aparelho.",
    ],
    escalateWhen: "Sem água quente após os passos, ou chuveiro dando choque/cheiro de queimado (urgência alta).",
  },
  {
    id: "wifi",
    title: "Wi-Fi ou internet",
    match: /\b(wi-? ?fi|wifi|internet|sem sinal|sem conexao|nao conecta|caiu a internet)\b.*\b(nao|sem|caiu|lent|fora|problema)|\b(nao|sem)\b.*\b(wi-? ?fi|wifi|internet)\b/,
    steps: [
      "Perguntar se o aparelho enxerga a rede, se aparece erro de senha ou se conecta sem internet.",
      "Confirmar o nome da rede e a senha oficiais do imóvel (se liberados) e pedir para esquecer a rede e conectar de novo.",
      "Orientar a conferir se o roteador está com as luzes acesas; se o manual permitir, desligar da tomada por 30 segundos e religar, aguardando 2 minutos.",
    ],
    escalateWhen: "Roteador sem luzes mesmo na tomada, ou internet fora após o reinício.",
  },
  {
    id: "ar",
    title: "Ar-condicionado",
    match: /\b(ar condicionado|ar-condicionado|ar nao (?:gela|liga|funciona)|climatizador)\b/,
    steps: [
      "Perguntar se o aparelho liga, se o display acende e se sai ar, mas sem gelar.",
      "Orientar a conferir se está no modo 'frio' (cool), temperatura abaixo da do ambiente e janelas/portas fechadas; conferir pilhas do controle.",
      "Se houver instrução do imóvel sobre o disjuntor do ar, conferir; caso contrário, não mexer.",
    ],
    escalateWhen: "Não liga mesmo com controle e disjuntor conferidos, pinga água dentro do imóvel ou faz barulho forte.",
  },
  {
    id: "tv",
    title: "TV ou controle",
    match: /\b(tv|televisao|controle remoto|smart tv|netflix|chromecast)\b.*\b(nao|sem|problema|travou)|\b(nao|sem)\b.*\b(tv|televisao|controle)\b/,
    steps: [
      "Perguntar se a TV liga e o que aparece na tela (sem sinal, erro, tela preta).",
      "Orientar a trocar a entrada (HDMI/Input) e a conferir as pilhas do controle; se for streaming, conferir a rede Wi-Fi.",
      "Se o manual trouxer o passo a passo do aparelho, usá-lo.",
    ],
    escalateWhen: "Tela preta com a TV ligada, aparelho sem energia ou controle sem resposta com pilhas novas.",
  },
  {
    id: "geladeira",
    title: "Geladeira ou freezer",
    match: /\b(geladeira|freezer|refrigerador|frigobar)\b.*\b(nao|sem|gela|barulho|pingando)|\b(nao|sem)\b.*\b(geladeira|freezer)\b/,
    steps: [
      "Perguntar se está ligada na tomada, se a luz interna acende e se o motor liga.",
      "Orientar a conferir o botão de temperatura e se a porta está bem fechada.",
    ],
    escalateWhen: "Sem energia no aparelho ou sem gelar após conferir tomada e temperatura.",
  },
  {
    id: "entupimento",
    title: "Ralo, pia ou vaso entupido",
    match: /\b(entupid[oa]|entupiu|ralo|pia|vaso|privada)\b.*\b(entup|nao escoa|enchendo|transbord|cheiro)|\b(entupid[oa]|entupiu|transbordando)\b/,
    steps: [
      "Perguntar onde (pia, ralo, vaso) e se a água está subindo ou escoando devagar.",
      "Orientar a não dar descarga nem usar o ponto até a equipe verificar; sem produtos químicos.",
    ],
    escalateWhen: "Quase sempre — acionar a equipe com o local; urgência alta se houver transbordamento.",
  },
  {
    id: "barulho",
    title: "Barulho ou vizinhos",
    match: /\b(barulho|barulhento|som alto|festa|vizinh[oa]s?|incomod)\b/,
    steps: [
      "Acolher e perguntar de onde vem o barulho, desde quando e se é constante ou pontual.",
      "Orientar sobre o horário de silêncio do condomínio/imóvel, se constar nas regras.",
    ],
    escalateWhen: "Barulho persistente ou que impeça o descanso — acionar a equipe com horário e origem.",
  },
  {
    id: "limpeza",
    title: "Limpeza ou itens faltando",
    match: /\b(sujo|suja|sujeira|mal limpo|cheiro ruim|barata|formiga|inseto|falta(?:ndo)? (?:toalha|papel|lencol|travesseiro|cobertor)|sem (?:toalha|papel higienico|lencol))\b/,
    steps: [
      "Acolher sem se justificar, perguntar exatamente o que encontrou e em qual cômodo; pedir uma foto, se for confortável.",
      "Para item faltando, conferir no cadastro/manual se há reposição disponível (ex.: armário, local indicado).",
    ],
    escalateWhen: "Sempre que houver sujeira, praga ou item essencial faltando — a equipe resolve com o prestador.",
  },
];

/** Playbook que casa com a mensagem atual (e a anterior, para respostas curtas como "continua"). */
export function matchPlaybook(message: string, lastGuestMessages: string[] = []): Playbook | null {
  const texts = [message, ...lastGuestMessages.slice(-2)].map(n);
  for (const t of texts) {
    const hit = PLAYBOOKS.find((p) => p.match.test(t));
    if (hit) return hit;
  }
  return null;
}

export function playbookText(p: Playbook): string {
  return [
    `\n\nPLAYBOOK DE DIAGNÓSTICO — ${p.title} (use como roteiro; instruções oficiais do imóvel SEMPRE prevalecem; nunca invente procedimento nem localização que o imóvel não informou)`,
    "- Acolha em uma frase e conduza UM passo ou UMA pergunta por vez, aguardando a resposta do hóspede antes do passo seguinte. Nunca despeje todos os passos juntos.",
    ...p.steps.map((s, i) => `  ${i + 1}. ${s}`),
    `- Quando escalar: ${p.escalateWhen} Ao escalar, descreva no motivo o diagnóstico já feito (o que o hóspede viu e o que já foi tentado).`,
    p.safety === "immediate"
      ? "- RISCO: oriente primeiro a segurança do hóspede e chame request_human_handoff com urgência alta na mesma resposta; sem emoji."
      : "- Não acione a equipe antes de tentar o diagnóstico, exceto se houver risco, o hóspede pedir ou o problema já tiver persistido após os passos.",
  ].join("\n");
}
