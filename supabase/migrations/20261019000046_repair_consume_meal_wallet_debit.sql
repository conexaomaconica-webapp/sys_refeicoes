-- Corrige uma divergencia detectada na definicao remota de consume_meal.
-- O valor negativo do debito havia sido comentado, deixando o INSERT do
-- ledger com mais colunas do que expressoes. Em ambientes sem a divergencia,
-- esta migration apenas valida que a definicao ja esta correta.

DO $migration$
DECLARE
    v_signature REGPROCEDURE :=
        'public.consume_meal(uuid,text,uuid,text,text)'::REGPROCEDURE;
    v_definition TEXT;
    v_faulty_pattern CONSTANT TEXT :=
        '--[[:space:]]*v_student_price[[:space:]]*,';
    v_fixed_pattern CONSTANT TEXT :=
        '''meal_debit''[[:space:]]*,[[:space:]]*-v_student_price[[:space:]]*,';
BEGIN
    SELECT pg_get_functiondef(v_signature)
      INTO v_definition;

    IF v_definition ~ v_faulty_pattern THEN
        v_definition := regexp_replace(
            v_definition,
            v_faulty_pattern,
            '-v_student_price,'
        );
        EXECUTE v_definition;
    ELSIF v_definition !~ v_fixed_pattern THEN
        RAISE EXCEPTION
            'Definicao inesperada de %. Correcao automatica interrompida.',
            v_signature;
    END IF;

    SELECT pg_get_functiondef(v_signature)
      INTO v_definition;

    IF v_definition !~ v_fixed_pattern
       OR v_definition ~ v_faulty_pattern THEN
        RAISE EXCEPTION
            'Falha ao validar o debito da carteira em %.',
            v_signature;
    END IF;
END;
$migration$;

COMMENT ON FUNCTION public.consume_meal(UUID, TEXT, UUID, TEXT, TEXT) IS
    'Valida e registra consumo de refeicao; debitos de carteira sao lancados como valores negativos no ledger.';

NOTIFY pgrst, 'reload schema';
