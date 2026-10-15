import { createClient as createBrowserClient } from '@/lib/supabase/client';
import type { Card, QRTokenGenerationResult } from '@/types/card';

/**
 * ==============================================================================
 * Serviço de Carteirinha Digital do Estudante (PWA / Client-Side)
 * Permite que o aluno autenticado consulte sua carteirinha e emita seu QR Token.
 * ==============================================================================
 */

export async function getMyActiveDigitalCard(): Promise<{ card: Card | null; error?: string }> {
  try {
    const supabase = createBrowserClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return { card: null, error: 'Usuário não autenticado.' };
    }

    // Busca a carteirinha digital ativa através da política RLS sel_cards_student
    const { data, error } = await supabase
      .from('cards')
      .select('*')
      .eq('card_type', 'digital')
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      return { card: null, error: `Erro ao buscar carteirinha: ${error.message}` };
    }

    return { card: data as Card | null };
  } catch (err) {
    return { card: null, error: (err as Error).message };
  }
}

export async function generateStudentQRToken(cardId?: string): Promise<{ result: QRTokenGenerationResult | null; error?: string }> {
  try {
    const supabase = createBrowserClient();
    const { data, error } = await (
      supabase as unknown as {
        rpc: (
          fn: string,
          args: { p_card_id: string | null }
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      }
    ).rpc('generate_student_qr_token', {
      p_card_id: cardId || null,
    });

    if (error) {
      return { result: null, error: `Falha ao gerar QR Code: ${error.message}` };
    }

    const payload = data as {
      success: boolean;
      token_id: string;
      qr_payload: string;
      expires_at: string;
      ttl_seconds: number;
    };

    if (!payload || !payload.qr_payload) {
      return { result: null, error: 'Resposta de geração de token inválida.' };
    }

    return {
      result: {
        success: true,
        token_id: payload.token_id,
        qr_payload: payload.qr_payload,
        expires_at: payload.expires_at,
        ttl_seconds: payload.ttl_seconds,
      },
    };
  } catch (err) {
    return { result: null, error: (err as Error).message };
  }
}
