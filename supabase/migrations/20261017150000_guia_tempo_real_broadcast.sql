-- GUIA DO HÓSPEDE EM TEMPO REAL (17/10/2026)
-- O hóspede não tem sessão no banco (o código de reserva só abre a tela), então
-- ele não pode ler tabelas por Realtime. Em vez disso, o banco manda um AVISO
-- MÍNIMO por Broadcast no canal `guide:<slug>` ("algo mudou"), SEM nenhum dado.
-- Ao receber, o guia refaz as consultas que já existem e já validam o código.
--
-- Segurança:
--  · o payload é só {"k":"<tipo>"}: nenhum id, nome ou conteúdo;
--  · o trigger nunca bloqueia a gravação (qualquer erro é engolido);
--  · idempotente; só cria o trigger em tabela que existe.
CREATE OR REPLACE FUNCTION public.guide_live_ping() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, realtime AS $$
DECLARE
  rec jsonb;
  pid uuid;
  slug_v text;
BEGIN
  BEGIN
    rec := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    IF TG_TABLE_NAME = 'property_chat_messages' THEN
      SELECT c.property_id INTO pid FROM public.property_chat_conversations c
       WHERE c.id = NULLIF(rec->>'conversation_id', '')::uuid;
    ELSIF TG_TABLE_NAME = 'properties' THEN
      pid := NULLIF(rec->>'id', '')::uuid;
    ELSE
      pid := NULLIF(rec->>'property_id', '')::uuid;
    END IF;
    IF pid IS NULL THEN RETURN NULL; END IF;
    SELECT p.slug INTO slug_v FROM public.properties p WHERE p.id = pid;
    IF slug_v IS NULL OR slug_v = '' THEN RETURN NULL; END IF;
    PERFORM realtime.send(
      jsonb_build_object('k', TG_ARGV[0]),
      'ping',
      'guide:' || slug_v,
      false
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NULL;
END $$;

DO $$
DECLARE
  alvo text[][] := ARRAY[
    ARRAY['guest_arrival_status', 'stay'],
    ARRAY['property_reservations', 'stay'],
    ARRAY['guide_access_logs', 'stay'],
    ARRAY['tasks', 'stay'],
    ARRAY['properties', 'property'],
    ARRAY['property_chat_messages', 'chat']
  ];
  i int;
  tbl text;
  kind text;
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    RAISE NOTICE 'realtime.send indisponível: guia segue só com polling.';
    RETURN;
  END IF;
  FOR i IN 1 .. array_length(alvo, 1) LOOP
    tbl := alvo[i][1];
    kind := alvo[i][2];
    IF to_regclass('public.' || tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS guide_live_ping ON public.%I', tbl);
    EXECUTE format(
      'CREATE TRIGGER guide_live_ping AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guide_live_ping(%L)',
      tbl, kind
    );
  END LOOP;
END $$;
