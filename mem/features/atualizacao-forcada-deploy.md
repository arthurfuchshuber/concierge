---
name: Atualização forçada a cada publicação — REGRA PERMANENTE
description: Toda publicação precisa recarregar automaticamente TODOS os usuários ativos (equipe e hóspedes) na versão nova, sem cache velho. Nunca remover nem enfraquecer este mecanismo.
type: feature
---
REGRA DO CLIENTE (24/09/2026): "cada vez que uma publicação for feita, o sistema precisa mandar um refresh GERAL para TODOS OS USUÁRIOS ATIVOS automaticamente, como se fosse um refresh no cache".

Como funciona (NÃO remover, NÃO desligar, NÃO trocar por outra coisa sem pedido explícito):
1. `vite.config.ts` → `define.__APP_BUILD_ID__ = String(Date.now())`: cada build/publicação ganha um ID novo. Não fixar esse valor.
2. `src/routes/api/public/version.ts` → devolve o ID da build no ar, com `cache-control: no-store`. Não cachear, não exigir login (hóspede também usa).
3. `src/lib/app-version.ts` → `useAppVersionWatcher()` confere a versão a cada 60s e sempre que a aba volta ao foco / volta a internet. Se o ID do servidor for diferente do carregado: apaga do aparelho o HTML e os arquivos da build antiga guardados pelo cache offline (`ci-html-*`, `ci-asset-*`), pede ao service worker que se atualize e recarrega a página. O trava-laço em sessionStorage (`sg-app-reloaded-for`) evita recarga infinita — manter.
4. `src/routes/__root.tsx` → o hook é chamado no ROOT (vale para painel, landing e guia do hóspede) e o `PersistQueryClientProvider` usa `buster: CLIENT_BUILD_ID`, então os dados guardados no aparelho da versão anterior são descartados na versão nova.
5. `public/sw-cache.js` → nunca cachear `/api/*` (inclusive `/api/public/version`). Ao mudar a lógica deste arquivo, subir a constante `VERSAO`.

Resultado esperado: até ~1 minuto depois de publicar, toda aba aberta recarrega sozinha na versão nova; aba em segundo plano recarrega ao voltar para ela.

Checklist ao mexer em qualquer um desses arquivos: o hook continua no `__root`, o `buster` continua ligado ao ID da build, a rota de versão continua pública e `no-store`, e o service worker continua deixando `/api` passar direto.
