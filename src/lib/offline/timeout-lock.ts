/**
 * ==============================================================================
 * Gerenciador de Operações com Resultado Desconhecido (Timeout Lock Manager)
 * Sprint 10 — MA Refeições (Módulo 10.3)
 * Bloqueia novas autorizações conflitantes para a mesma matrícula, refeição e dia
 * enquanto existir uma transação cujo resultado remoto foi indeterminado por timeout.
 * ==============================================================================
 */

import type { UnknownTimeoutRecord } from '@/types/connectivity';

/**
 * Armazenamento em memória das travas ativas de timeout (com espelhamento em localStorage/IndexedDB)
 */
const pendingTimeoutLocks = new Map<string, UnknownTimeoutRecord>();

function getTimeoutKey(identifier: string, mealTypeId: string, date: string): string {
  return `${identifier.trim().toUpperCase()}:${mealTypeId}:${date}`;
}

/**
 * Registra uma operação como pendente de resolução por timeout
 */
export function recordUnknownTimeout(
  params: Omit<UnknownTimeoutRecord, 'id' | 'status' | 'attempts'>
): UnknownTimeoutRecord {
  const key = getTimeoutKey(params.identifier, params.mealTypeId, params.consumptionDate);
  const record: UnknownTimeoutRecord = {
    ...params,
    id: key,
    status: 'pending_resolution',
    attempts: 1,
  };

  pendingTimeoutLocks.set(key, record);

  // Espelhar em localStorage para sobreviver a recarregamentos acidentais da página
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const serializable = Array.from(pendingTimeoutLocks.entries());
      window.localStorage.setItem('ma_pending_timeout_locks', JSON.stringify(serializable));
    } catch {
      // Ignora falhas de cota
    }
  }

  return record;
}

/**
 * Verifica se uma matrícula já possui operação em análise por timeout para a mesma refeição e dia
 */
export function hasPendingUnknownTimeout(
  identifier: string,
  mealTypeId: string,
  consumptionDate: string
): boolean {
  initFromStorage();
  const key = getTimeoutKey(identifier, mealTypeId, consumptionDate);
  const record = pendingTimeoutLocks.get(key);
  return !!record && record.status === 'pending_resolution';
}

/**
 * Obtém o registro de timeout pendente, se houver
 */
export function getPendingTimeout(
  identifier: string,
  mealTypeId: string,
  consumptionDate: string
): UnknownTimeoutRecord | null {
  initFromStorage();
  const key = getTimeoutKey(identifier, mealTypeId, consumptionDate);
  return pendingTimeoutLocks.get(key) || null;
}

/**
 * Resolve o estado da operação após verificação com o backend
 */
export function resolveUnknownTimeout(
  idempotencyKey: string,
  status: 'resolved_confirmed' | 'resolved_not_applied'
): void {
  initFromStorage();
  for (const [key, record] of pendingTimeoutLocks.entries()) {
    if (record.idempotencyKey === idempotencyKey) {
      if (status === 'resolved_not_applied') {
        pendingTimeoutLocks.delete(key);
      } else {
        record.status = 'resolved_confirmed';
        pendingTimeoutLocks.set(key, record);
      }
      break;
    }
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const serializable = Array.from(pendingTimeoutLocks.entries());
      window.localStorage.setItem('ma_pending_timeout_locks', JSON.stringify(serializable));
    } catch {
      // Ignora falhas de cota
    }
  }
}

/**
 * Retorna todos os registros pendentes de resolução
 */
export function getAllPendingTimeouts(): UnknownTimeoutRecord[] {
  initFromStorage();
  return Array.from(pendingTimeoutLocks.values()).filter(
    (item) => item.status === 'pending_resolution'
  );
}

/**
 * Inicializa os bloqueios a partir do armazenamento local caso o navegador tenha recarregado
 */
let isInitialized = false;
function initFromStorage(): void {
  if (isInitialized) return;
  isInitialized = true;

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem('ma_pending_timeout_locks');
      if (stored) {
        const parsed = JSON.parse(stored) as [string, UnknownTimeoutRecord][];
        for (const [k, v] of parsed) {
          if (v && v.status === 'pending_resolution') {
            pendingTimeoutLocks.set(k, v);
          }
        }
      }
    } catch {
      // Ignora erro de parsing
    }
  }
}
