/**
 * Os 21 casos históricos de produção (B2.1: mensagens com padrão de código de acesso), reproduzidos
 * com a MESMA estrutura e valores SINTÉTICOS. Os valores reais nunca foram lidos nem copiados:
 * a auditoria consultou só o formato (dígitos trocados por 7 e palavras após rótulo mascaradas).
 *
 * `secrets`: valores sintéticos que NÃO podem sobrar. `keep`: trechos legítimos que precisam ficar.
 * `expect`: status mínimo esperado ("safe" = falso positivo a evitar).
 */
export interface HistoricalShape {
  id: number;
  speaker: "legacy_ai" | "guest" | "team" | "system";
  text: string;
  secrets: string[];
  keep: string[];
  expect: "sanitized" | "safe";
}

export const HISTORICAL_SHAPES: readonly HistoricalShape[] = [
  { id: 1, speaker: "legacy_ai", text: "A senha da fechadura eletrônica é 4821. Para o cadeado-cofre, a combinação será enviada pelo guia.", secrets: ["4821"], keep: ["fechadura eletrônica", "será enviada pelo guia"], expect: "sanitized" },
  { id: 2, speaker: "legacy_ai", text: "A rede é **Loft42** e a senha é **Foz90317**. Aproveite a sua conexão!", secrets: ["Foz90317"], keep: ["Loft42", "Aproveite a sua conexão!"], expect: "sanitized" },
  { id: 3, speaker: "legacy_ai", text: "Sim, você pode utilizar a rede Wi-Fi **Loft42** com senha **Foz90317** para o seu trabalho remoto. Para as crianças, a atração mais próxima é o parque.", secrets: ["Foz90317"], keep: ["Loft42", "trabalho remoto", "parque"], expect: "sanitized" },
  { id: 4, speaker: "legacy_ai", text: "A rede é **WiFi Arthur Tenorio**. A senha para acesso é **55128743**. Aproveite sua conexão!", secrets: ["55128743"], keep: ["WiFi Arthur Tenorio"], expect: "sanitized" },
  { id: 5, speaker: "legacy_ai", text: "A senha do Wi-Fi é `83920145`.\n\nGostaria de saber a rede Wi-Fi também?", secrets: ["83920145"], keep: ["Gostaria de saber a rede Wi-Fi também?"], expect: "sanitized" },
  { id: 6, speaker: "legacy_ai", text: "Olá, para liberar as informações de acesso, abra o guia, toque em **“Ver Senha”** e digite `Sigma3141`. Seu primeiro acesso exige a abertura virtual da fechadura.", secrets: ["Sigma3141"], keep: ["Ver Senha", "abertura virtual"], expect: "sanitized" },
  { id: 7, speaker: "legacy_ai", text: "O cofre fica no Studio 204 e contém as chaves e o controle. No guia, toque em **“Ver Senha”**, digite `Sigma3141` e consulte a senha do cofre; estou confirmando com a equipe.", secrets: ["Sigma3141"], keep: ["Studio 204", "confirmando com a equipe"], expect: "sanitized" },
  { id: 8, speaker: "legacy_ai", text: "Quando chegar, use a senha temporária 2718 no cadeado-cofre do portão de pedestres, com os números alinhados ao centro da linha horizontal.", secrets: ["2718"], keep: ["portão de pedestres", "linha horizontal"], expect: "sanitized" },
  { id: 9, speaker: "legacy_ai", text: "Gabriel, você já pode entrar; o check-in é a partir das 15h.\n\nA senha temporária do cadeado-cofre no portão de pedestres é 6624. Dentro está o controle.", secrets: ["6624"], keep: ["15h", "Dentro está o controle"], expect: "sanitized" },
  { id: 10, speaker: "legacy_ai", text: "Felipe, a senha temporária do cadeado-cofre do portão é 3305. O cofre fica no muro frontal e contém o controle do portão.\n\n", secrets: ["3305"], keep: ["muro frontal"], expect: "sanitized" },
  { id: 11, speaker: "guest", text: "Estou em frente e a senha 9182 a alavanca não desce, ta bem dura", secrets: ["9182"], keep: ["a alavanca não desce, ta bem dura"], expect: "sanitized" },
  { id: 12, speaker: "team", text: "🔒 Senha Cadeado-Cofre: 4471\n\nWiFi:  CasaAzul\nSenha:  girassolamarelo\n\n", secrets: ["4471", "girassolamarelo"], keep: ["CasaAzul"], expect: "sanitized" },
  { id: 13, speaker: "team", text: "No cadeado cofre de número 7, vocês podem inserir a senha 3390 para abri-lo.", secrets: ["3390"], keep: ["número 7", "para abri-lo"], expect: "sanitized" },
  { id: 14, speaker: "team", text: "Serviço terceirizado: R$ 45,90\n* Total: R$ 120,50\n\nInformações da postagem:\n\nCódigo de rastreamento: AB123456789BR\n\nAcompanhamento disponível no site oficial.", secrets: [], keep: ["R$ 45,90", "R$ 120,50", "AB123456789BR"], expect: "safe" },
  { id: 15, speaker: "team", text: "Coloque a senha temporária 5871 para retirar a chave, Andressa.", secrets: ["5871"], keep: ["retirar a chave, Andressa"], expect: "sanitized" },
  { id: 16, speaker: "team", text: "No portão de pedestre, você vai encontrar dois cadeados cofres, e vai inserir a senha 1478 no da esquerda.", secrets: ["1478"], keep: ["dois cadeados cofres", "no da esquerda"], expect: "sanitized" },
  { id: 17, speaker: "team", text: "Por favor, utilize o código Sigma3141 para visualizar as senhas aqui no Guia, ok?", secrets: ["Sigma3141"], keep: ["visualizar as senhas aqui no Guia"], expect: "sanitized" },
  { id: 18, speaker: "team", text: "A senha para visualizar é Sigma3141", secrets: ["Sigma3141"], keep: ["A senha para visualizar é"], expect: "sanitized" },
  { id: 19, speaker: "team", text: "No portaozinho de pedestres, haverá dois cadeados. Voce precisará abrir o cadeado da direita com a senha 2207.", secrets: ["2207"], keep: ["cadeado da direita"], expect: "sanitized" },
  { id: 20, speaker: "team", text: "Pois a senha é a informada no guia, 5512", secrets: ["5512"], keep: ["a informada no guia"], expect: "sanitized" },
  { id: 21, speaker: "system", text: "Código da Reserva: HMAB12X4Q", secrets: [], keep: ["HMAB12X4Q"], expect: "safe" },
];
