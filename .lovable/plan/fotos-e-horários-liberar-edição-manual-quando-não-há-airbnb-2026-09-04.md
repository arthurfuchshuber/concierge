# Fotos e horários: liberar edição manual quando não há Airbnb

## O que confirmei no código

O achado é real, mas parcialmente:

- **Fotos (bloqueante):** a seção "Fotos da residência" hoje só exibe as imagens importadas (grade com cadeado) ou "Nenhuma foto importada ainda.". O `GalleryEditor` continua no arquivo, mas sem nenhum uso. Como `publish-requirements.ts` exige pelo menos 1 foto, um imóvel **sem link do Airbnb (ou cuja importação não trouxe fotos) nunca consegue publicar o guia** — não existe nenhuma outra tela para enviar fotos.
- **Horários (não bloqueante):** `checkin_time` e `checkout_time` são só-leitura, mas o formulário já nasce com "15:00" e "11:00" e esses valores são salvos, então a publicação não trava. O problema real é que o anfitrião **não consegue corrigir** o horário se ele for diferente e não houver Airbnb.

O bloqueio foi uma decisão sua ("campo com importação automática = só visualização", 03/09/2026), então não quero desfazê-la — só criar uma saída para quem não tem Airbnb.

## Proposta (mudança mínima, só de interface)

Regra nova: **o campo fica bloqueado apenas quando existe link do Airbnb no imóvel.** Sem link (ou seja, nada será sobrescrito pela checagem diária), o campo volta a ser editável à mão.

1. Um sinalizador único na tela: `airbnbLocked = !!form.property.airbnb_listing_url`.
2. **Fotos:** com Airbnb → grade só-leitura atual, sem mudanças. Sem Airbnb → volta o `GalleryEditor` (upload, reordenar, definir capa), que já existe e está pronto.
3. **Horários de check-in / "check-out até":** com Airbnb → `ReadOnlyValue` atual. Sem Airbnb → `TimePicker` editável, no mesmo `TimeInlineRow` (layout idêntico ao de "Check-out a partir de", que já é editável). Vale igualmente nas abas Airbnb e Check-in & Checkout, que espelham o mesmo estado.
4. Nada muda em regras de publicação, salvamento, importação ou banco de dados.

## Fora do escopo

- Não mexer no comportamento de imóveis que têm Airbnb conectado.
- Não alterar `publish-requirements.ts`.
