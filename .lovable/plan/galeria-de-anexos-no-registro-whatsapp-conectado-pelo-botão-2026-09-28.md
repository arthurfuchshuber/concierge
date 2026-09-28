# Galeria de anexos no registro + WhatsApp conectado pelo botão oficial da Meta

## 1. Anexos do registro: galeria rolável
- Tocar no "+2" (ou em qualquer quadradinho) abre uma **galeria** por cima do registro:
  - Fileira horizontal com **todos** os anexos do registro, em tamanho grande, que você arrasta para o lado (um por vez, encaixando).
  - Contador "2/4" e setas para passar.
  - Fotos já aparecem grandes. Vídeos aparecem parados, mostrando o primeiro quadro, e só tocam se você apertar o play. Nada toca sozinho.
  - Tocar numa foto ou vídeo **maximiza** em tela cheia. Tocar fora volta para a galeria e depois para o registro.
  - Embaixo, faixa de miniaturas pequenas para pular direto para um anexo.
- O "+2" do cartão fica mais legível: número em destaque sobre um fundo escuro limpo, sem a mancha colorida que aparece hoje.

## 2. WhatsApp: cada cliente conecta o próprio número, sem a Sinch
Na tela Integrações, o cliente vê um só botão, **"Conectar WhatsApp"**:
1. Abre uma janela oficial da Meta.
2. Ele entra com o Facebook, escolhe (ou cria) a conta comercial e confirma o número com um código por SMS.
3. Pronto: o número aparece como "Conectado". Mensagens de hóspedes chegam no atendimento e as respostas saem pelo número dele.
- Também dá para desconectar e trocar de número.
- Os clientes que já usam a Sinch continuam funcionando até trocarem.

### O que você precisa fazer uma única vez (fora do sistema)
Para esse botão existir, sua empresa precisa estar registrada na Meta como parceira de tecnologia:
1. Criar um app na Meta for Developers, com o produto WhatsApp.
2. Verificar a empresa no Gerenciador de Negócios da Meta (pede CNPJ e documentos, leva de alguns dias a 2 semanas).
3. Pedir a aprovação de "parceiro de tecnologia" e das permissões de mensagens.
4. Me passar três dados do app: o número do app, o código de configuração do cadastro e a chave secreta. Vou pedir esses dados numa janela segura.
- Enquanto a aprovação não sai, o botão já funciona, mas só com números de teste da sua própria empresa.
- Custos: a Meta cobra por conversa direto no cartão de cada cliente (as respostas a hóspedes dentro de 24h são gratuitas). Não há mensalidade da Sinch.

## Conferência
- Galeria: print no celular (393px) com 1 e 4 anexos, sem nada cortado.
- WhatsApp: testar a janela da Meta com um número de teste assim que os dados do app forem cadastrados.

## Detalhes técnicos
- Galeria: novo `RecordGallery` em `ReservationRecords.tsx` (Dialog registrado no overlay global), trilho `snap-x snap-mandatory` com `ds-scroll-x`, vídeos com `preload="metadata"`, sem `autoPlay`. Visualização maximizada como camada aninhada.
- WhatsApp: SDK do Facebook carregado só no navegador; `FB.login` com `config_id` e `featureType: whatsapp_business_app_onboarding` / Embedded Signup v3. O `code` retornado é trocado no servidor (`createServerFn`) por um token de negócio. Guardar `waba_id`, `phone_number_id` e o token criptografado por conta. Assinar o app na WABA (`/subscribed_apps`) e registrar o número (`/register`).
- Webhook único `src/routes/api/public/whatsapp/meta-webhook.ts`: verificação `hub.challenge` e assinatura `X-Hub-Signature-256` com a chave secreta do app; caixa de entrada durável e processamento idempotente; roteamento por `phone_number_id` até a conta.
- Camada de provedor em `src/lib/ai/channels/whatsapp/provider.server.ts`: novo provedor "meta_cloud" ao lado de "sinch"; o envio usa a Graph API com o token da conta.
- Secrets: `META_APP_ID`, `META_APP_SECRET` e `META_WA_CONFIG_ID`, pedidos só depois da sua aprovação. Tabela de config do WhatsApp ganha colunas do provedor Meta, com RLS por conta.
