-- Garante o vinculo institucional obrigatorio no consumo de refeicao.
-- Substitui apenas a definicao da RPC; nenhum dado e removido.

DO $$
DECLARE
    v_signature REGPROCEDURE := 'public.consume_meal(uuid,text,uuid,text,text)'::REGPROCEDURE;
    v_definition TEXT;
    v_corrected TEXT;
BEGIN
    SELECT pg_get_functiondef(v_signature) INTO v_definition;
    v_corrected := replace(
        v_definition,
        E'        unit_id,\n        meal_type_id,',
        E'        unit_id,\n        institution_id,\n        meal_type_id,'
    );
    v_corrected := replace(
        v_corrected,
        E'        v_unit.id,\n        v_unit_meal.meal_type_id,',
        E'        v_unit.id,\n        v_unit.institution_id,\n        v_unit_meal.meal_type_id,'
    );

    IF v_corrected = v_definition THEN
        IF position('institution_id' IN v_definition) = 0
           OR position('v_unit.institution_id' IN v_definition) = 0 THEN
            RAISE EXCEPTION 'Trecho institucional nao encontrado em consume_meal.';
        END IF;
    ELSE
        IF position('v_unit.institution_id' IN v_corrected) = 0 THEN
            RAISE EXCEPTION 'Valor institucional nao foi incorporado em consume_meal.';
        END IF;
        EXECUTE v_corrected;
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
