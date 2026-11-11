/**
 * ==============================================================================
 * Serviço Legado de Snapshot de Turno do Terminal (Desativado — Política Online-First)
 * Sprint 10 -> Saneado na Sprint 20 (Etapa 20.7)
 *
 * A RPC get_terminal_shift_snapshot foi revogada pela Migration 72 para impedir
 * cache local permissivo e garantir validação estrita online no servidor.
 * Este módulo falha fechado (fail-closed) sem acionar chamadas remotas revogadas.
 * ==============================================================================
 */

export interface ShiftSnapshotOptions {
  unitId: string;
  terminalId: string;
  operatorId: string;
  ttlHours?: number;
}

export const TERMINAL_SNAPSHOT_BLOCK_CODE = 'ONLINE_FIRST_POLICY_ACTIVE';

export async function downloadShiftSnapshot(
  _options: ShiftSnapshotOptions
): Promise<{ success: boolean; count: number; error?: string }> {
  void _options;
  return {
    success: false,
    count: 0,
    error: `${TERMINAL_SNAPSHOT_BLOCK_CODE}: O download de snapshot offline foi desativado após a Migration 72. O terminal opera exclusivamente em modo online-first.`,
  };
}
