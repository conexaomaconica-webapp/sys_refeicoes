/**
 * ==============================================================================
 * Mutex Atômico de Sincronização (Sync Mutex)
 * Sprint 10 — MA Refeições (Módulo 10.3)
 * Garante que apenas UM processo de transmissão e reconciliação execute por vez,
 * prevenindo condições de corrida na reconexão e reenvio de lotes em duplicidade.
 * ==============================================================================
 */

let inMemorySyncLock = false;
let lockAcquiredTimestamp = 0;
const LOCK_TIMEOUT_MS = 60_000; // 60 segundos de tempo máximo de vida para evitar travamentos permanentes

/**
 * Tenta adquirir o lock de sincronização exclusivo
 * @returns true se o lock foi adquirido, false se já existe sincronização ativa
 */
export async function acquireSyncLock(): Promise<boolean> {
  const now = Date.now();

  // 1. Verificar se o lock expirou por timeout (autodefesa contra travamentos de worker)
  if (inMemorySyncLock && now - lockAcquiredTimestamp > LOCK_TIMEOUT_MS) {
    inMemorySyncLock = false;
  }

  if (inMemorySyncLock) {
    return false;
  }

  // 2. Se o ambiente suportar Web Locks API, utilizar lock do sistema
  if (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'locks' in navigator &&
    navigator.locks?.request
  ) {
    try {
      let acquired = false;
      await navigator.locks.request(
        'ma_refeicoes_sync_lock',
        { ifAvailable: true },
        async (lock) => {
          if (lock) {
            inMemorySyncLock = true;
            lockAcquiredTimestamp = now;
            acquired = true;
          }
        }
      );
      return acquired;
    } catch {
      // Fallback para memória em caso de falha da API
    }
  }

  inMemorySyncLock = true;
  lockAcquiredTimestamp = now;
  return true;
}

/**
 * Libera o lock de sincronização
 */
export function releaseSyncLock(): void {
  inMemorySyncLock = false;
  lockAcquiredTimestamp = 0;
}

/**
 * Verifica se a sincronização está em andamento
 */
export function isSyncLockActive(): boolean {
  if (inMemorySyncLock && Date.now() - lockAcquiredTimestamp > LOCK_TIMEOUT_MS) {
    inMemorySyncLock = false;
  }
  return inMemorySyncLock;
}
