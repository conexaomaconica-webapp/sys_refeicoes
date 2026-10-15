import { createClient as createBrowserClient } from '@/lib/supabase/client';
import type { IdentityResolutionResult } from '@/types/card';

/**
 * ==============================================================================
 * Serviço de Resolução Rápida de Identidade (Terminal de Atendimento / Caixa)
 * Aciona a RPC resolve_student_identity validando operador, unidade e identificador.
 * ==============================================================================
 */

export async function resolveStudentIdentity(
  unitId: string,
  identifier: string
): Promise<IdentityResolutionResult> {
  const cleanId = identifier ? identifier.trim() : '';

  if (!unitId) {
    return {
      success: false,
      error_code: 'UNIT_REQUIRED',
      message: 'Unidade operacional de atendimento não selecionada.',
    };
  }

  if (!cleanId) {
    return {
      success: false,
      error_code: 'IDENTIFIER_REQUIRED',
      message: 'Matrícula, QR Code ou Cartão Físico não informado.',
    };
  }

  try {
    const supabase = createBrowserClient();
    const { data, error } = await (
      supabase as unknown as {
        rpc: (
          fn: string,
          args: { p_unit_id: string; p_identifier: string }
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      }
    ).rpc('resolve_student_identity', {
      p_unit_id: unitId,
      p_identifier: cleanId,
    });

    if (error) {
      return {
        success: false,
        error_code: 'RPC_ERROR',
        message: error.message,
      };
    }

    return data as unknown as IdentityResolutionResult;
  } catch (err) {
    return {
      success: false,
      error_code: 'CLIENT_ERROR',
      message: (err as Error).message,
    };
  }
}
