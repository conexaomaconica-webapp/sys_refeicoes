-- Reaplica a inclusao de institution_id tolerando a formatacao da funcao remota.

DO $$
DECLARE
    v_signature REGPROCEDURE := 'public.consume_meal(uuid,text,uuid,text,text)'::REGPROCEDURE;
    v_definition TEXT;
    v_corrected TEXT;
BEGIN
    SELECT pg_get_functiondef(v_signature) INTO v_definition;

    v_corrected := regexp_replace(
        v_definition,
        '(INSERT INTO public\.meal_consumptions \([[:space:]]+id,[[:space:]]+tenant_id,[[:space:]]+unit_id,)([[:space:]]+meal_type_id,)',
        E'\\1\n        institution_id,\\2'
    );
    v_corrected := regexp_replace(
        v_corrected,
        '(\) VALUES \([[:space:]]+v_consumption_id,[[:space:]]+v_unit\.tenant_id,[[:space:]]+v_unit\.id,)([[:space:]]+v_unit_meal\.meal_type_id,)',
        E'\\1\n        v_unit.institution_id,\\2'
    );

    IF v_corrected !~ 'unit_id,[[:space:]]+institution_id,[[:space:]]+meal_type_id,'
       OR v_corrected !~ 'v_unit\.id,[[:space:]]+v_unit\.institution_id,[[:space:]]+v_unit_meal\.meal_type_id,' THEN
        RAISE EXCEPTION 'Nao foi possivel incluir institution_id no INSERT de meal_consumptions.';
    END IF;

    IF v_corrected <> v_definition THEN
        EXECUTE v_corrected;
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
