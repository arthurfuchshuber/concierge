# Plano — Recomendações SigmaGuide v2 + Impersonation

Trabalho dividido em 4 blocos. Cada bloco é entregável independente.

## Bloco 1 — Renomear e reformular o painel "Recomendações"

**Menu lateral:** "Recomendações SigmaGuide" → **"Recomendações"**.

**Criar pack por cidade (novo dialog):**
- Input de cidade com **Google Places Autocomplete (New)** via `PlaceAutocompleteElement`.
- Ao selecionar: capturamos `city_label`, `country`, `place_id`, `lat`, `lng` e geramos `city_key` normalizado.
- Validação: bloqueia cidade fora do Google (mesmo racional do `PlaceAutocomplete` de POIs).

**Editor da cidade (`/admin/recomendacoes-sigma/$cityKey`):**
- Aba **Pontos**: substitui o input livre atual pelo mesmo `PlaceAutocomplete` usado no guia — só permite POI vindo do Google, com lock visual de duplicidade. Cards e edição inline replicam `RecGroup`/POI list do editor do guia (categoria, tag, foto, descrição editável).
- Aba **Reservas** → renomear para **"Marketplace"**. Mantém CRUD atual.
- Aba **FAQ**: substituir UI atual por componente compartilhado com o guia (acordeon, 1 expandido por vez, drag-reorder, categoria/tags).

## Bloco 2 — Botão "Salvar Recomendações" no guia (admins)

No editor do guia, dentro do quadrante **"Referências na cidade"**:
- Renderizar botão **"Salvar Recomendações"** apenas para usuários com role `admin` (via `useIsAdmin`).
- Ao clicar: dialog confirma cidade detectada → cria/atualiza pack SigmaGuide com os POIs daquele quadrante (snapshot copy: nome, place_id, categoria, tag, foto, descrição, rating, etc.). Idem para Marketplace e FAQs do guia.
- Server fn nova: `saveGuideAsSigmaPack({ property_id })` — exige role admin.

## Bloco 3 — Import com lock no editor do guia

No quadrante "Pela cidade" do editor de POIs:
- Reduzir largura do campo de busca; ao lado, botão **"Importar do Sigma"** (substitui/complementa o `SigmaImportButton` atual).
- Ao importar: ativa pack para aquela cidade → POIs city_references, Marketplace e FAQs são substituídos pelo snapshot Sigma e ficam **visualmente bloqueados** (inputs disabled + ícone de cadeado + tooltip "Conteúdo SigmaGuide — desative para editar").
- **FAQs**: aparecem no quadrante "Perguntas Frequentes" da aba **Extras**, marcadas com `tags: ['sigma']`. Só essas ficam bloqueadas; as próprias do anfitrião permanecem editáveis.
- **Desativar**: remove TODO conteúdo Sigma (POIs city_references com `source='sigma'`, marketplace_links importados, FAQs com tag `sigma`) e restaura o snapshot anterior do anfitrião — já implementado parcialmente, vou completar para POIs.

**Schema:** adicionar coluna `source TEXT` em `city_references` (default `'user'`, `'sigma'` quando importado) para permitir remoção cirúrgica na desativação sem apagar pontos do próprio anfitrião.

## Bloco 4 — Impersonation de cliente (admin do SaaS)

No topo da sidebar (apenas para admins):
- Combobox com busca por e-mail (chama nova server fn `searchUsersByEmail`).
- Ao selecionar: salva `impersonated_user_id` em `sessionStorage` + cookie HTTP-only via server fn.
- Banner fixo no topo: "Visualizando como {email} — Sair da visualização".
- Server fns sensíveis (properties, biblioteca, assinatura) passam a aceitar `?as=<user_id>` quando o caller é admin, retornando dados do user-alvo.
- **Escopo**: somente leitura visual nesta primeira entrega (não permitir editar dados do cliente sob impersonation). Confirmar se ok ou se já quer edição também.

## Pós-blocos (os 3 itens pendentes da rodada anterior)
- Leitura pública do guia passa a ler do pack SigmaGuide quando ativo.
- Lock visual completo dos inputs no admin enquanto pack ativo.
- Tooltips de onboarding (primeira criação de guia).

---

### Dúvidas antes de começar
1. **Impersonation — escopo**: somente leitura ou já permitir editar como o cliente? (recomendo somente leitura nesta entrega por segurança/auditoria)
2. **Salvar guia como pack Sigma (Bloco 2)**: se já existir pack para a cidade, **sobrescrever** ou **mesclar** (adicionar só os POIs novos)?
3. **Lock visual no admin**: enquanto o pack Sigma estiver ativo no guia, o anfitrião pode **adicionar POIs próprios** ao lado dos Sigma ou tudo bloqueado?
