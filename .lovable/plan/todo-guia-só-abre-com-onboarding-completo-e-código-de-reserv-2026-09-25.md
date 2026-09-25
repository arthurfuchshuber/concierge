# Todo guia só abre com onboarding completo e código de reserva ativo

## O que muda para você
- O "Tipo do guia" passa a ter uma única opção: **Check-In & Check-Out**. Somem "Recomendações Locais" e "Informações do Espaço".
- Todo guia novo já nasce com esse tipo preenchido.
- Guias que hoje estão com outro tipo (ou sem tipo) passam automaticamente para Check-In & Check-Out.
- Para publicar, o calendário do Airbnb vira obrigatório em todo guia (já era para esse tipo).
- O hóspede só entra no guia depois de passar pelas etapas obrigatórias, incluindo um código de reserva **ativo** no calendário. Sem isso, nada do guia aparece.

## Atenção
Guias já publicados **sem** calendário do Airbnb ficam fechados para hóspedes até você ligar o calendário no editor. Antes de aplicar, vou listar quais são para você saber.

## Detalhes técnicos
- `EtiquetaSelect.tsx`: `ETIQUETA_OPTIONS` só com `ETIQUETA_CHECKIN_CHECKOUT`; remover "Sem etiqueta".
- Editor (`admin.properties.$id.tsx`): valor inicial de `tagline` = `ETIQUETA_CHECKIN_CHECKOUT` em guia novo; `require_access_gate` travado em true.
- Migração: `UPDATE properties SET tagline='Check-In & Check-Out', require_access_gate=true` onde diferente; default da coluna `tagline` = esse valor.
- `publish-requirements.ts`: `airbnb_ical_url` obrigatório sempre.
- `guest-access.server.ts` `isReservationGated`: retorna true para qualquer guia publicado real (não prévia/demo). Sem iCal → o guia fica bloqueado (não mais "acesso pelo link").
- `guide-access.functions.ts` `recordGuideAccess` (`requiresCode`) e `guide.functions.ts` (getPublicGuide, senhas, IA): mesma regra — sem código conferido e ativo, nenhum conteúdo sai do servidor; sem iCal, mensagem clara em português: "Este guia ainda não está liberado. Fale com o anfitrião."
- `guest-pass.functions.ts`: sem iCal, recusa emitir passe.
- Prévia do anfitrião e vitrine demo da landing continuam funcionando como hoje.
- Conferir com `tsgo` e um teste do gate em guia com e sem iCal.
