/**
 * ==============================================================================
 * Diagnóstico e Gerenciamento de Persistência de Armazenamento do Navegador
 * Sprint 10 — MA Refeições
 * Utiliza StorageManager API para prevenir limpeza automática de dados pelo SO/navegador.
 * ==============================================================================
 */

export interface StorageStatus {
  supported: boolean;
  persisted: boolean;
  quotaMb?: number;
  usageMb?: number;
  warning?: string;
}

/**
 * Solicita ao navegador a concessão de armazenamento persistente para o terminal
 */
export async function requestPersistentStorage(): Promise<StorageStatus> {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    !navigator.storage.persist
  ) {
    return {
      supported: false,
      persisted: false,
      warning: 'StorageManager API não suportada neste navegador.',
    };
  }

  try {
    const isPersisted = await navigator.storage.persist();
    let quotaMb: number | undefined;
    let usageMb: number | undefined;

    if (navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota) quotaMb = Math.round(estimate.quota / (1024 * 1024));
      if (estimate.usage) usageMb = Math.round(estimate.usage / (1024 * 1024));
    }

    return {
      supported: true,
      persisted: isPersisted,
      quotaMb,
      usageMb,
      warning: !isPersisted
        ? 'O navegador não concedeu persistência estrita. Os dados locais podem ser expurgados em caso de falta crítica de disco.'
        : undefined,
    };
  } catch (err) {
    return {
      supported: true,
      persisted: false,
      warning: `Falha ao solicitar persistência: ${(err as Error).message}`,
    };
  }
}

/**
 * Verifica o status atual de persistência sem exibir prompt ao usuário
 */
export async function getStorageDiagnostics(): Promise<StorageStatus> {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    !navigator.storage.persisted
  ) {
    return {
      supported: false,
      persisted: false,
      warning: 'StorageManager API não disponível.',
    };
  }

  try {
    const isPersisted = await navigator.storage.persisted();
    let quotaMb: number | undefined;
    let usageMb: number | undefined;

    if (navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota) quotaMb = Math.round(estimate.quota / (1024 * 1024));
      if (estimate.usage) usageMb = Math.round(estimate.usage / (1024 * 1024));
    }

    return {
      supported: true,
      persisted: isPersisted,
      quotaMb,
      usageMb,
    };
  } catch (err) {
    return {
      supported: true,
      persisted: false,
      warning: (err as Error).message,
    };
  }
}
