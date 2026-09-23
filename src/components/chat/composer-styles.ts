/**
 * As medidas da barra de mensagem e do cabeçalho — um lugar só, para os três
 * chats do produto: Atendimento, Assistente do Painel e o guia do hóspede.
 *
 * Pedido explícito (08/09/2026), depois de eu errar duas vezes: "precisamos que
 * o layout de ambos os chats sejam iguais, use como referência o layout do chat
 * com assistente, os mínimos detalhes".
 *
 * POR QUE ISTO EXISTE EM VEZ DE EU SÓ AJUSTAR AS CLASSES DE NOVO
 *
 * Já ajustei essas medidas à mão duas vezes e elas voltaram a divergir — porque
 * "igual" escrito em três arquivos diferentes é só uma coincidência esperando
 * para acabar. Com as classes vindo daqui, dois chats só ficam diferentes se
 * alguém mudar ESTE arquivo, e aí mudam juntos.
 *
 * Os valores são os do Assistente do Painel, que é a referência combinada:
 * barra de 32px, pílula de borda fina, botões redondos de 32px, cabeçalho de
 * 48px com botões de 28px.
 */

/** Barra inteira: a faixa branca no rodapé do chat. */
export const COMPOSER_BAR =
  "flex shrink-0 items-center gap-2 border-t border-border bg-surface px-3 py-2";

/** A pílula que envolve o campo de texto. */
export const COMPOSER_FIELD =
  "flex h-8 min-w-0 flex-1 items-center rounded-full border border-border bg-background px-3";

/**
 * O campo em si. Altura de linha travada para a pílula não crescer sozinha —
 * era isso que deixava a barra do Atendimento mais alta que a do Assistente.
 */
export const COMPOSER_INPUT =
  // `min-h-0` e `border-0` são obrigatórios, não cosméticos: o <Textarea> base
  // do projeto (ui/textarea.tsx) vem com `min-h-[60px]` e borda própria. Como
  // `h-` e `min-h-` são propriedades diferentes, o merge de classes NÃO desfaz
  // aquele mínimo — o campo de 60px estourava a pílula de 32px e o placeholder
  // aparecia ACIMA dela, fora do quadro (08/09/2026).
  "block h-[1.2rem] min-h-0 max-h-20 w-full min-w-0 resize-none overflow-y-auto border-0 bg-transparent px-0 py-0 text-sm leading-[1.2rem] shadow-none outline-none focus-visible:ring-0 focus:ring-0";

/** Botão auxiliar (anexo, microfone): redondo, sem preenchimento. */
export const COMPOSER_ICON_BTN =
  "grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40";

/** Botão de enviar: mesmo tamanho, preenchido. A cor vem de quem usa. */
export const COMPOSER_SEND_BTN =
  "grid size-8 shrink-0 place-items-center rounded-full text-white disabled:opacity-40";

/** Cabeçalho do chat: 48px, título numa linha, contexto à direita. */
export const CHAT_HEADER =
  "flex h-12 shrink-0 items-center gap-2 border-b border-border bg-secondary/40 px-3";

/** Botão do cabeçalho: 28px, canto reto — distingue da barra de baixo. */
export const CHAT_HEADER_BTN =
  "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";
