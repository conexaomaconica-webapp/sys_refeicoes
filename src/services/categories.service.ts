import { createClient as createBrowserClient } from '@/lib/supabase/client';
import type { StudentCategory } from '@/types/student';

export interface MealTypeOption {
  id: string;
  code: string;
  name: string;
}

/**
 * Consulta a lista de categorias do tenant autenticado via RPC
 */
export async function adminListCategories(): Promise<{
  success: boolean;
  categories: StudentCategory[];
  error?: string;
}> {
  try {
    const supabase = createBrowserClient();
    const { data, error } = await (
      supabase as unknown as {
        rpc: (fn: string) => Promise<{ data: { success: boolean; categories: StudentCategory[]; message?: string } | null; error: { message: string } | null }>;
      }
    ).rpc('admin_list_categories');

    if (error) {
      return { success: false, categories: [], error: error.message };
    }

    if (data && data.success) {
      return { success: true, categories: data.categories || [] };
    }

    return { success: false, categories: [], error: data?.message || 'Falha ao listar categorias.' };
  } catch (err) {
    return { success: false, categories: [], error: (err as Error).message };
  }
}

/**
 * Cria ou atualiza uma categoria com regras de precificação e refeições
 */
export async function adminSaveCategory(category: Partial<StudentCategory>): Promise<{
  success: boolean;
  category?: StudentCategory;
  error?: string;
}> {
  try {
    const supabase = createBrowserClient();
    const { data, error } = await (
      supabase as unknown as {
        rpc: (
          fn: string,
          args: { p_category: Partial<StudentCategory> }
        ) => Promise<{ data: { success: boolean; category?: StudentCategory; message?: string } | null; error: { message: string } | null }>;
      }
    ).rpc('admin_save_category', {
      p_category: category,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (data && data.success) {
      return { success: true, category: data.category };
    }

    return { success: false, error: data?.message || 'Falha ao salvar categoria.' };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Lista os tipos de refeição disponíveis no tenant para configuração
 */
export async function listMealTypes(): Promise<{
  success: boolean;
  mealTypes: MealTypeOption[];
  error?: string;
}> {
  try {
    const supabase = createBrowserClient();
    const { data, error } = await supabase
      .from('meal_types')
      .select('id, code, name')
      .eq('status', 'active');

    if (error) {
      return { success: false, mealTypes: [], error: error.message };
    }

    const displayOrder = new Map([
      ['breakfast', 0],
      ['lunch', 1],
      ['dinner', 2],
    ]);
    const mealTypes = ((data || []) as MealTypeOption[]).sort((left, right) => {
      const leftOrder = displayOrder.get(left.code) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = displayOrder.get(right.code) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.name.localeCompare(right.name, 'pt-BR');
    });

    return { success: true, mealTypes };
  } catch (err) {
    return { success: false, mealTypes: [], error: (err as Error).message };
  }
}
