/**
 * ==============================================================================
 * Serviço Legado de Sincronização Offline (Desativado — Política Online-First)
 * Sprint 10 -> Saneado na Sprint 20 (Etapa 20.7)
 *
 * Após a revogação da RPC reconcile_offline_consumptions na Migration 72,
 * o cliente não executa mais reconciliação automática cliente->servidor.
 * Qualquer tentativa de disparo falha de modo seguro (fail-closed) com
 * ONLINE_FIRST_POLICY_ACTIVE, orientando o operador para /admin/contingencia.
 * ==============================================================================
 */

import { getDecryptedPendingEvents } from '@/lib/offline/offline-engine';
import { acquireSyncLock, releaseSyncLock } from '@/lib/offline/sync-mutex';
import { globalNetworkMonitor } from '@/lib/offline/network-monitor';

export interface SyncOptions {
  tenantId: string;
  unitId: string;
  terminalId: string;
  operatorId: string;
  batchSize?: number;
}

export interface SyncResult {
  success: boolean;
  totalPending: number;
  syncedCount: number;
  conflictCount: number;
  failedCount: number;
  message?: string;
}

export const OFFLINE_SYNC_BLOCK_CODE = 'ONLINE_FIRST_POLICY_ACTIVE';

/**
 * Barreira fail-closed contra execução de sincronização offline cliente->servidor.
 * Mantém o Mutex exclusivo para inspeção segura da fila local sem chamadas a RPCs revogadas.
 */
export async function executeOfflineSync(options: SyncOptions): Promise<SyncResult> {
  const lockAcquired = await acquireSyncLock();
  if (!lockAcquired) {
    return {
      success: false,
      totalPending: 0,
      syncedCount: 0,
      conflictCount: 0,
      failedCount: 0,
      message: 'Sincronização já em execução por outro processo ativo.',
    };
  }

  globalNetworkMonitor.setSyncing(true);

  try {
    const pendingEvents = await getDecryptedPendingEvents({
      tenantId: options.tenantId,
      unitId: options.unitId,
      terminalId: options.terminalId,
    });

    return {
      success: false,
      totalPending: pendingEvents.length,
      syncedCount: 0,
      conflictCount: 0,
      failedCount: pendingEvents.length,
      message: `${OFFLINE_SYNC_BLOCK_CODE}: A sincronização direta cliente→servidor foi desativada após a Migration 72. Registros contingenciais devem ser lançados em /admin/contingencia.`,
    };
  } catch (err) {
    return {
      success: false,
      totalPending: 0,
      syncedCount: 0,
      conflictCount: 0,
      failedCount: 0,
      message: `${OFFLINE_SYNC_BLOCK_CODE}: ${(err as Error).message}`,
    };
  } finally {
    releaseSyncLock();
    globalNetworkMonitor.setSyncing(false);
  }
}
