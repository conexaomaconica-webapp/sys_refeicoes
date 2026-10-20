/**
 * ==============================================================================
 * Camada de Persistência Durável Transacional com IndexedDB
 * Sprint 10 — MA Refeições
 * Gerencia stores: students_cache, pending_sync_queue, terminal_local_history, terminal_meta
 * ==============================================================================
 */

import { EncryptedPayload, generateCsprngSecret } from './crypto';
import type {
  TerminalLocalPassage,
  OfflineQueueStats,
} from '@/types/offline';

const DB_NAME = 'ma_refeicoes_offline_v1';
const DB_VERSION = 2;

export interface StoredEncryptedStudent {
  id: string; // student_id
  registration_number: string;
  registration_hash: string;
  encrypted_student: EncryptedPayload;
  valid_until: string;
}

export interface StoredEncryptedEvent {
  id: string; // event_id (UUID)
  sequence_num: number;
  status: 'pending_sync' | 'synced' | 'conflict_pending_review';
  device_timestamp: string;
  encrypted_event: EncryptedPayload;
  integrity_hash: string;
  previous_event_hash: string;
  sync_attempts: number;
  last_sync_error?: string | null;
}

export interface TerminalMetaRecord {
  key: string;
  value: unknown;
}

/**
 * Abre ou inicializa o banco de dados IndexedDB
 */
export function openOfflineDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB não suportado neste ambiente'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. Store: students_cache (Snapshot do Turno)
      if (!db.objectStoreNames.contains('students_cache')) {
        const studentStore = db.createObjectStore('students_cache', { keyPath: 'id' });
        studentStore.createIndex('idx_reg_number', 'registration_number', { unique: false });
        studentStore.createIndex('idx_reg_hash', 'registration_hash', { unique: false });
        studentStore.createIndex('idx_valid_until', 'valid_until', { unique: false });
      }

      // 2. Store: pending_sync_queue (Fila Durável Criptografada)
      if (!db.objectStoreNames.contains('pending_sync_queue')) {
        const queueStore = db.createObjectStore('pending_sync_queue', { keyPath: 'id' });
        queueStore.createIndex('idx_sequence_num', 'sequence_num', { unique: true });
        queueStore.createIndex('idx_status', 'status', { unique: false });
        queueStore.createIndex('idx_device_ts', 'device_timestamp', { unique: false });
      }

      // 3. Store: terminal_local_history (Prevenção de Duplo Bip no Mesmo Terminal)
      if (!db.objectStoreNames.contains('terminal_local_history')) {
        const historyStore = db.createObjectStore('terminal_local_history', { keyPath: 'id' });
        historyStore.createIndex('idx_student', 'student_id', { unique: false });
        historyStore.createIndex('idx_date', 'consumption_date', { unique: false });
      }

      // 4. Store: terminal_meta (Metadados de sessão, salt, saltos de sequência)
      if (!db.objectStoreNames.contains('terminal_meta')) {
        db.createObjectStore('terminal_meta', { keyPath: 'key' });
      }

      // 5. Store: terminal_vault (Cofre de segredos criptográficos de dispositivo gerados com CSPRNG)
      if (!db.objectStoreNames.contains('terminal_vault')) {
        db.createObjectStore('terminal_vault', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Utilitário genérico para executar operações em uma transação do IndexedDB
 */
export async function executeTx<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  callback: (stores: Record<string, IDBObjectStore>) => Promise<T> | T
): Promise<T> {
  const db = await openOfflineDatabase();
  const tx = db.transaction(storeNames, mode);
  const stores: Record<string, IDBObjectStore> = {};

  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  for (const name of names) {
    stores[name] = tx.objectStore(name);
  }

  return new Promise<T>((resolve, reject) => {
    let result: T;
    let callbackPromise: Promise<T> | null = null;

    tx.oncomplete = () => {
      resolve(result);
    };

    tx.onerror = () => {
      reject(tx.error);
    };

    tx.onabort = () => {
      reject(new Error('Transação abortada no IndexedDB'));
    };

    try {
      const cbRes = callback(stores);
      if (cbRes instanceof Promise) {
        callbackPromise = cbRes;
        callbackPromise
          .then((res) => {
            result = res;
          })
          .catch((err) => {
            tx.abort();
            reject(err);
          });
      } else {
        result = cbRes;
      }
    } catch (err) {
      tx.abort();
      reject(err);
    }
  });
}

/**
 * Gerenciador de Metadados do Terminal
 */
export async function getTerminalMeta<T>(key: string): Promise<T | null> {
  return executeTx('terminal_meta', 'readonly', (stores) => {
    return new Promise<T | null>((resolve, reject) => {
      const req = stores.terminal_meta.get(key);
      req.onsuccess = () => {
        resolve(req.result ? (req.result.value as T) : null);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export async function setTerminalMeta<T>(key: string, value: T): Promise<void> {
  return executeTx('terminal_meta', 'readwrite', (stores) => {
    stores.terminal_meta.put({ key, value });
  });
}

/**
 * Obtém ou inicializa o Salt criptográfico da partição do terminal
 */
export async function getOrInitTerminalSalt(): Promise<string> {
  const existing = await getTerminalMeta<string>('partition_salt_hex');
  if (existing) {
    return existing;
  }
  const newSalt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(newSalt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  await setTerminalMeta('partition_salt_hex', hex);
  return hex;
}

/**
 * Obtém ou gera via CSPRNG (256 bits) o segredo de hardware mestre deste terminal.
 * Persiste no terminal_vault para permitir continuidade offline após reinicialização do dispositivo
 * e troca de operadores autorizados no mesmo terminal.
 */
export async function getOrInitDeviceMasterSecret(terminalId: string): Promise<string> {
  const vaultKey = `device_master_secret_${terminalId}`;
  return executeTx('terminal_vault', 'readwrite', (stores) => {
    return new Promise<string>((resolve, reject) => {
      const req = stores.terminal_vault.get(vaultKey);
      req.onsuccess = () => {
        if (req.result && (req.result as { value?: string }).value) {
          resolve((req.result as { value: string }).value);
        } else {
          const newSecret = generateCsprngSecret(32);
          stores.terminal_vault.put({ key: vaultKey, value: newSecret });
          resolve(newSecret);
        }
      };
      req.onerror = () => reject(req.error);
    });
  });
}

/**
 * Obtém e incrementa de forma atômica o número de sequência do terminal
 */
export async function getNextSequenceNumber(): Promise<number> {
  return executeTx('terminal_meta', 'readwrite', (stores) => {
    return new Promise<number>((resolve, reject) => {
      const req = stores.terminal_meta.get('last_sequence_num');
      req.onsuccess = () => {
        const current = (req.result?.value as number) || 0;
        const next = current + 1;
        stores.terminal_meta.put({ key: 'last_sequence_num', value: next });
        resolve(next);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

/**
 * Obtém o hash do último evento registrado na fila para encadeamento
 */
export async function getLastEventHash(): Promise<string> {
  const hash = await getTerminalMeta<string>('last_event_hash');
  return hash || 'GENESIS_TERMINAL_V1';
}

/**
 * Armazena um lote de estudantes criptografados no cache
 */
export async function saveEncryptedStudents(students: StoredEncryptedStudent[]): Promise<void> {
  return executeTx('students_cache', 'readwrite', (stores) => {
    const store = stores.students_cache;
    for (const item of students) {
      store.put(item);
    }
  });
}

/**
 * Busca estudante cifrado por matrícula
 */
export async function findEncryptedStudentByRegistration(
  reg: string
): Promise<StoredEncryptedStudent | null> {
  const normalized = reg.trim().toUpperCase();
  return executeTx('students_cache', 'readonly', (stores) => {
    return new Promise<StoredEncryptedStudent | null>((resolve, reject) => {
      const index = stores.students_cache.index('idx_reg_number');
      const req = index.get(normalized);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  });
}

/**
 * Busca estudante cifrado por hash da matrícula
 */
export async function findEncryptedStudentByHash(
  hash: string
): Promise<StoredEncryptedStudent | null> {
  return executeTx('students_cache', 'readonly', (stores) => {
    return new Promise<StoredEncryptedStudent | null>((resolve, reject) => {
      const index = stores.students_cache.index('idx_reg_hash');
      const req = index.get(hash);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  });
}

/**
 * Limpa o cache de estudantes (sem tocar na fila durável)
 */
export async function clearStudentsCache(): Promise<void> {
  return executeTx('students_cache', 'readwrite', (stores) => {
    stores.students_cache.clear();
  });
}

/**
 * Grava um evento offline na fila durável e atualiza metadados encadeados
 */
export async function enqueueOfflineEvent(eventRecord: StoredEncryptedEvent): Promise<void> {
  return executeTx(['pending_sync_queue', 'terminal_meta'], 'readwrite', (stores) => {
    stores.pending_sync_queue.put(eventRecord);
    stores.terminal_meta.put({ key: 'last_event_hash', value: eventRecord.integrity_hash });
  });
}

/**
 * Obtém todos os eventos pendentes de sincronização ordenados por sequence_num
 */
export async function getPendingOfflineEvents(): Promise<StoredEncryptedEvent[]> {
  return executeTx('pending_sync_queue', 'readonly', (stores) => {
    return new Promise<StoredEncryptedEvent[]>((resolve, reject) => {
      const index = stores.pending_sync_queue.index('idx_status');
      const req = index.getAll('pending_sync');
      req.onsuccess = () => {
        const events = (req.result as StoredEncryptedEvent[]) || [];
        events.sort((a, b) => a.sequence_num - b.sequence_num);
        resolve(events);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

/**
 * Marca eventos confirmados como sincronizados ou remove da fila durável
 */
export async function markEventsSynced(eventIds: string[]): Promise<void> {
  return executeTx('pending_sync_queue', 'readwrite', (stores) => {
    for (const id of eventIds) {
      stores.pending_sync_queue.delete(id);
    }
  });
}

/**
 * Marca um evento como conflito sob revisão
 */
export async function markEventConflict(eventId: string, errorReason: string): Promise<void> {
  return executeTx('pending_sync_queue', 'readwrite', (stores) => {
    const req = stores.pending_sync_queue.get(eventId);
    req.onsuccess = () => {
      const event = req.result as StoredEncryptedEvent | undefined;
      if (event) {
        event.status = 'conflict_pending_review';
        event.last_sync_error = errorReason;
        stores.pending_sync_queue.put(event);
      }
    };
  });
}

/**
 * Registra e verifica histórico local de passagens (trava de duplicidade no mesmo terminal)
 */
export async function hasLocalPassageToday(
  studentId: string,
  mealTypeId: string,
  consumptionDate: string
): Promise<boolean> {
  const passageKey = `${studentId}:${mealTypeId}:${consumptionDate}`;
  return executeTx('terminal_local_history', 'readonly', (stores) => {
    return new Promise<boolean>((resolve, reject) => {
      const req = stores.terminal_local_history.get(passageKey);
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

export async function recordLocalPassage(passage: TerminalLocalPassage): Promise<void> {
  const passageKey = `${passage.student_id}:${passage.meal_type_id}:${passage.consumption_date}`;
  return executeTx('terminal_local_history', 'readwrite', (stores) => {
    stores.terminal_local_history.put({
      ...passage,
      id: passageKey,
    });
  });
}

/**
 * Estatísticas da fila local e conferência de teto de risco
 */
export async function getQueueStats(maxMealsLimit: number): Promise<OfflineQueueStats> {
  return executeTx(['pending_sync_queue', 'terminal_meta'], 'readonly', (stores) => {
    return new Promise<OfflineQueueStats>((resolve, reject) => {
      const pendingReq = stores.pending_sync_queue.index('idx_status').count('pending_sync');
      const conflictReq = stores.pending_sync_queue.index('idx_status').count('conflict_pending_review');
      const lastSeqReq = stores.terminal_meta.get('last_sequence_num');
      const lastSyncReq = stores.terminal_meta.get('last_sync_at');

      let pending = 0;
      let conflict = 0;
      let lastSeq = 0;
      let lastSync: string | null = null;

      pendingReq.onsuccess = () => {
        pending = pendingReq.result;
        conflictReq.onsuccess = () => {
          conflict = conflictReq.result;
          lastSeqReq.onsuccess = () => {
            lastSeq = (lastSeqReq.result?.value as number) || 0;
            lastSyncReq.onsuccess = () => {
              lastSync = (lastSyncReq.result?.value as string) || null;
              resolve({
                pending_count: pending,
                synced_count: 0,
                conflict_count: conflict,
                last_sync_at: lastSync,
                current_sequence_num: lastSeq,
                is_limit_reached: pending >= maxMealsLimit,
              });
            };
          };
        };
      };

      pendingReq.onerror = () => reject(pendingReq.error);
    });
  });
}
