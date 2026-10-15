import 'server-only';

import { getAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { Card, IssueCardInput, UpdateCardStatusInput } from '@/types/card';

/**
 * ==============================================================================
 * Serviço Administrativo de Carteirinhas (Server-Side Exclusivo)
 * Centraliza emissão e bloqueio através das RPCs auditáveis admin_issue_card
 * e admin_update_card_status com validação do operador autenticado.
 * ==============================================================================
 */

export async function adminIssueCard(
  input: IssueCardInput
): Promise<{ success: boolean; cardId?: string; cardNumber?: string; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Usuário não autenticado.' };
    }

    const adminClient = getAdminClient();
    const { data, error } = await (
      adminClient as unknown as {
        rpc: (
          fn: string,
          args: {
            p_student_id: string;
            p_card_type: 'digital' | 'physical';
            p_physical_code: string | null;
          }
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      }
    ).rpc('admin_issue_card', {
      p_student_id: input.student_id,
      p_card_type: input.card_type || 'digital',
      p_physical_code: input.physical_code || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const res = data as {
      success: boolean;
      card_id: string;
      card_number: string;
    };

    return {
      success: true,
      cardId: res.card_id,
      cardNumber: res.card_number,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function adminUpdateCardStatus(
  input: UpdateCardStatusInput
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Usuário não autenticado.' };
    }

    const adminClient = getAdminClient();
    const { data, error } = await (
      adminClient as unknown as {
        rpc: (
          fn: string,
          args: {
            p_card_id: string;
            p_new_status: 'active' | 'blocked' | 'cancelled' | 'replaced';
            p_reason: string | null;
          }
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      }
    ).rpc('admin_update_card_status', {
      p_card_id: input.card_id,
      p_new_status: input.new_status,
      p_reason: input.reason || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const res = data as { success: boolean };
    return { success: res.success };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function adminListStudentCards(
  studentId: string
): Promise<{ cards: Card[]; error?: string }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('cards')
      .select('*')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });

    if (error) {
      return { cards: [], error: error.message };
    }

    return { cards: (data || []) as Card[] };
  } catch (err) {
    return { cards: [], error: (err as Error).message };
  }
}
