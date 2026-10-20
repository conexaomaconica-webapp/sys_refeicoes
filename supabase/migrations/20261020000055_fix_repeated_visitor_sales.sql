-- Restaura o contrato de allow_multi_meal perdido por uma redefinicao posterior
-- de consume_meal. A migration preserva dados, RLS e a trava diaria existente.

CREATE OR REPLACE FUNCTION public.set_meal_consumption_multi_meal_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_allow_multi_meal BOOLEAN;
BEGIN
    SELECT category.allow_multi_meal OR category.code = 'visitante'
      INTO v_allow_multi_meal
      FROM public.student_categories AS category
     WHERE category.id = NEW.category_id
       AND category.tenant_id = NEW.tenant_id;

    IF v_allow_multi_meal IS NULL THEN
        RAISE EXCEPTION 'Categoria do consumo nao encontrada no tenant informado.';
    END IF;

    NEW.allow_multi_meal := v_allow_multi_meal;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_meal_consumption_multi_meal_scope()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_meal_consumptions_multi_meal_scope
ON public.meal_consumptions;

CREATE TRIGGER trg_meal_consumptions_multi_meal_scope
BEFORE INSERT OR UPDATE OF category_id, tenant_id
ON public.meal_consumptions
FOR EACH ROW
EXECUTE FUNCTION public.set_meal_consumption_multi_meal_scope();

-- Corrige somente a flag derivada em registros historicos. Nenhum consumo,
-- valor financeiro ou vinculo de auditoria e removido ou recriado.
UPDATE public.meal_consumptions AS consumption
   SET allow_multi_meal = category.allow_multi_meal OR category.code = 'visitante'
  FROM public.student_categories AS category
 WHERE category.id = consumption.category_id
   AND category.tenant_id = consumption.tenant_id
   AND consumption.allow_multi_meal IS DISTINCT FROM (
       category.allow_multi_meal OR category.code = 'visitante'
   );

-- Falha de forma segura se a protecao criada na migration 33 nao estiver ativa.
DO $$
DECLARE
    v_index_definition TEXT;
BEGIN
    SELECT indexdef
      INTO v_index_definition
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'idx_meal_consumptions_active_daily';

    IF v_index_definition IS NULL
       OR v_index_definition NOT ILIKE '%NOT allow_multi_meal%' THEN
        RAISE EXCEPTION
            'Indice diario de consumos ausente ou sem suporte a allow_multi_meal.';
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
