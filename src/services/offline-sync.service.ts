/**
 * ==============================================================================
 * Serviço de Sincronização e Reconciliação Resiliente (Client-Side Pipeline)
 * Sprint 10 — MA Refeições (Módulo 10.4)
 * Transmite lotes criptografados da fila durável para a RPC reconcile_offline_consumptions,
 * com controle de concorrência via Mutex, retries com backoff e expurgo seguro condicionado.
 * ==============================================================================
 */

import { createBrowserClient } from '@/lib/supabase/client';
import {
  getDecryptedPendingEvents,
  markEventsSynced,
  markEventConflict,
} from '@/lib/offline/offline-engine';
import { setTerminalMeta } from '@/lib/offline/db';
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

interface ServerReconcileResult {
  event_id: string;
  idempotency_key: string;
  status: 'confirmed_regular' | 'conflict_duplicate' | 'pending_administrative_review' | 'failed_irrecoverable';
  already_processed?: boolean;
  linked_consumption_id?: string;
  financial_debit_applied?: boolean;
  wallet_transaction_id?: string;
  error_code?: string;
  message?: string;
}

/**
 * Executa a sincronização da fila durável do terminal com o backend
 */
export async function executeOfflineSync(options: SyncOptions): Promise<SyncResult> {
  const batchSize = options.batchSize || 25;

  // 1. Tentar adquirir lock exclusivo de sincronização (Prevenção de concorrência)
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

  let syncedCount = 0;
  let conflictCount = 0;
  let failedCount = 0;

  try {
    // 2. Recuperar eventos pendentes do IndexedDB
    const pendingEvents = await getDecryptedPendingEvents({
      tenantId: options.tenantId,
      unitId: options.unitId,
      terminalId: options.terminalId,
    });

    if (pendingEvents.length === 0) {
      return {
        success: true,
        totalPending: 0,
        syncedCount: 0,
        conflictCount: 0,
        failedCount: 0,
        message: 'Nenhum evento pendente na fila durável.',
      };
    }

    const supabase = createBrowserClient();

    // 3. Processar em lotes limitados (Bounded Batch Processing)
    for (let i = 0; i < pendingEvents.length; i += batchSize) {
      const batch = pendingEvents.slice(i, i + batchSize);

      // Payload canônico para a RPC
      const rpcPayload = batch.map((ev) => ({
        id: ev.id,
        terminal_id: ev.terminal_id,
        unit_id: ev.unit_id,
        operator_id: ev.operator_id,
        student_id: ev.student_id,
        registration_attempted: ev.registration_attempted,
        meal_type_id: ev.meal_type_id,
        device_timestamp: ev.device_timestamp,
        sequence_num: ev.sequence_num,
        idempotency_key: ev.idempotency_key,
        previous_event_hash: ev.previous_event_hash,
        integrity_hash: ev.integrity_hash,
      }));

      // Chamar RPC reconcile_offline_consumptions no Supabase
      const { data, error } = await (
        supabase as unknown as {
          rpc: (
            fn: string,
            args: { p_batch: unknown }
          ) => Promise<{ data: ServerReconcileResult[] | null; error: { message: string } | null }>;
        }
      ).rpc('reconcile_offline_consumptions', {
        p_batch: rpcPayload,
      });

      if (error || !data) {
        // Falha no lote: interrompe o loop para retentativa posterior sem corromper a fila
        failedCount += batch.length;
        console.error('[OfflineSync] Erro na reconciliação do lote:', error?.message);
        break;
      }

      // 4. Tratamento Individual de Confirmação (Salvaguarda Estrita)
      // REGRA: Apenas expurgar do IndexedDB eventos confirmados pelo servidor!
      const successfullyConfirmedEventIds: string[] = [];

      for (const item of data) {
        if (item.status === 'confirmed_regular' || item.already_processed) {
          syncedCount++;
          successfullyConfirmedEventIds.push(item.event_id);
        } else if (item.status === 'conflict_duplicate') {
          // Conflito preservado no servidor: expurgar da fila local após confirmação do registro de conflito
          conflictCount++;
          successfullyConfirmedEventIds.push(item.event_id);
        } else if (item.status === 'pending_administrative_review') {
          // Requer intervenção: marcar na store local
          conflictCount++;
          await markEventConflict(item.event_id, item.message || 'Retido para revisão administrativa.');
        } else {
          failedCount++;
          await markEventConflict(item.event_id, item.message || 'Falha na validação do servidor.');
        }
      }

      // Expurgar com segurança os confirmados
      if (successfullyConfirmedEventIds.length > 0) {
        await markEventsSynced(successfullyConfirmedEventIds);
      }
    }

    // Atualizar timestamp da última sincronização bem-sucedida
    await setTerminalMeta('last_sync_at', new Date().toISOString());

    return {
      success: failedCount === 0,
      totalPending: pendingEvents.length,
      syncedCount,
      conflictCount,
      failedCount,
      message: `Sincronização concluída: ${syncedCount} confirmados, ${conflictCount} conflitos, ${failedCount} pendências.`,
    };
  } catch (err) {
    return {
      success: false,
      totalPending: 0,
      syncedCount,
      conflictCount,
      failedCount,
      message: `Erro inesperado na sincronização: ${(err as Error).message}`,
    };
  } finally {
    releaseSyncLock();
    globalNetworkMonitor.setSyncing(false);
  }
}
