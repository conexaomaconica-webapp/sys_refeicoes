/**
 * ==============================================================================
 * Serviço de Carregamento e Gestão do Snapshot de Turno do Terminal
 * Sprint 10 — MA Refeições
 * Obtém os dados minimizados dos estudantes para cache seguro do operador.
 * ==============================================================================
 */

import { createBrowserClient } from '@/lib/supabase/client';
import { hashRegistrationNumber } from '@/lib/offline/crypto';
import type { CachedStudent } from '@/types/offline';
import { loadShiftSnapshot } from '@/lib/offline/offline-engine';

export interface ShiftSnapshotOptions {
  unitId: string;
  terminalId: string;
  operatorId: string;
  ttlHours?: number;
}

interface RawSnapshotStudent {
  id: string;
  registration_number: string;
  full_name: string;
  photo_path?: string | null;
  status: string;
  category_code: string;
  is_integral: boolean;
  estimated_balance: number;
}

interface RawUnitRow {
  id: string;
  institution_id: string;
  tenant_id: string;
}

/**
 * Baixa os estudantes ativos vinculados à unidade/instituição para alimentar o cache do turno
 */
export async function downloadShiftSnapshot(
  options: ShiftSnapshotOptions
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const supabase = createBrowserClient();
    const ttlHours = options.ttlHours || 8;
    const now = new Date();
    const validUntil = new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();

    // 1. Buscar a instituição e tenant da unidade operacional
    const unitQuery = await (supabase
      .from('units')
      .select('id, institution_id, tenant_id')
      .eq('id', options.unitId)
      .single() as unknown as Promise<{ data: RawUnitRow | null; error: { message: string } | null }>);

    if (unitQuery.error || !unitQuery.data) {
      return {
        success: false,
        count: 0,
        error: unitQuery.error?.message || 'Unidade não encontrada.',
      };
    }

    const unitData = unitQuery.data;

    // 2. Buscar snapshot minimizado via RPC segura get_terminal_shift_snapshot
    const { data: snapshotData, error: snapErr } = await (
      supabase as unknown as {
        rpc: (
          fn: string,
          args: { p_unit_id: string }
        ) => Promise<{ data: RawSnapshotStudent[] | null; error: { message: string } | null }>;
      }
    ).rpc('get_terminal_shift_snapshot', {
      p_unit_id: options.unitId,
    });

    if (snapErr) {
      return {
        success: false,
        count: 0,
        error: snapErr.message,
      };
    }

    const students = snapshotData || [];
    if (students.length === 0) {
      return { success: true, count: 0 };
    }

    // 3. Transformar e minimizar dados conforme LGPD
    const cachedStudents: CachedStudent[] = [];

    for (const s of students) {
      const regNumber = s.registration_number.trim().toUpperCase();
      const regHash = await hashRegistrationNumber(regNumber);

      cachedStudents.push({
        id: s.id,
        registration_number: regNumber,
        registration_hash: regHash,
        name_display: s.full_name,
        category_code: s.category_code,
        is_integral: s.is_integral,
        is_active: s.status === 'active',
        estimated_balance: Number(s.estimated_balance) || 0,
        photo_path: s.photo_path || null,
        last_cached_at: now.toISOString(),
        valid_until: validUntil,
      });
    }

    // 4. Criptografar e armazenar localmente no IndexedDB
    const result = await loadShiftSnapshot(cachedStudents, {
      tenantId: unitData.tenant_id,
      unitId: options.unitId,
      terminalId: options.terminalId,
      validUntil,
    });

    return {
      success: true,
      count: result.count,
    };
  } catch (err) {
    return {
      success: false,
      count: 0,
      error: (err as Error).message,
    };
  }
}
