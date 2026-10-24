'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { saveUnitServer, type SaveUnitInput } from '@/services/admin-unit.service';

type ActionResult = { success: true; message: string } | { success: false; error: string };

export async function saveUnitAction(input: SaveUnitInput): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Sessão expirada. Entre novamente.' };

    const result = await saveUnitServer(user.id, input);
    if (!result.success) return { success: false, error: result.error || 'Não foi possível salvar a unidade.' };
    revalidatePath('/admin/unidades');
    revalidatePath('/admin');
    return {
      success: true,
      message: input.id ? 'Unidade atualizada com sucesso.' : 'Unidade criada com sucesso.',
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Erro inesperado ao salvar unidade.' };
  }
}
