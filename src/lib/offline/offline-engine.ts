/**
 * ==============================================================================
 * Motor de Contingência Offline (Offline Engine)
 * Sprint 10 — MA Refeições (Módulo 10.1)
 * Valida regras de negócio em cache criptografado, trava duplicidade local,
 * gerencia fila durável encadeada e previne estouro de risco financeiro.
 * ==============================================================================
 */

import {
  deriveTerminalCryptoKey,
  encryptData,
  decryptData,
  calculateEventChainHash,
  hashRegistrationNumber,
  hexToBytes,
} from './crypto';
import {
  openOfflineDatabase,
  getOrInitTerminalSalt,
  getOrInitDeviceMasterSecret,
  getNextSequenceNumber,
  getLastEventHash,
  saveEncryptedStudents,
  findEncryptedStudentByRegistration,
  findEncryptedStudentByHash,
  clearStudentsCache,
  enqueueOfflineEvent,
  getPendingOfflineEvents,
  markEventsSynced,
  markEventConflict,
  hasLocalPassageToday,
  recordLocalPassage,
  getQueueStats,
  getTerminalMeta,
  setTerminalMeta,
  StoredEncryptedStudent,
  StoredEncryptedEvent,
} from './db';
import type {
  CachedStudent,
  OfflineConsumptionEvent,
  TerminalOfflineConfig,
  OfflineValidationResult,
} from '@/types/offline';
import { generateIdempotencyKey } from '@/services/consumption.service';

export interface TerminalKeyParams {
  tenantId: string;
  unitId: string;
  terminalId: string;
}

/**
 * Cache em memória da CryptoKey da sessão ativa para evitar rederivações em todo bip
 */
let cachedTerminalKey: {
  key: CryptoKey;
  secretMaterial: string;
} | null = null;

/**
 * Obtém ou deriva a chave criptográfica do terminal a partir do segredo mestre de hardware (CSPRNG 256-bit)
 * e do contexto segregado de tenant/unidade/terminal.
 * Permite que diferentes operadores autorizados no mesmo terminal acessem a mesma fila de contingência
 * e que a fila seja recuperada mesmo após reinicialização do dispositivo sem internet.
 */
export async function getTerminalKey(params: TerminalKeyParams): Promise<CryptoKey> {
  const cacheKey = `TENANT:${params.tenantId}|UNIT:${params.unitId}|TERM:${params.terminalId}`;

  if (cachedTerminalKey && cachedTerminalKey.secretMaterial === cacheKey) {
    return cachedTerminalKey.key;
  }

  const masterSecretHex = await getOrInitDeviceMasterSecret(params.terminalId);
  const saltHex = await getOrInitTerminalSalt();
  const saltBytes = hexToBytes(saltHex);

  const key = await deriveTerminalCryptoKey(
    masterSecretHex,
    {
      tenantId: params.tenantId,
      unitId: params.unitId,
      terminalId: params.terminalId,
    },
    saltBytes
  );

  cachedTerminalKey = { key, secretMaterial: cacheKey };
  return key;
}

export interface SnapshotMeta {
  status: 'completed' | 'in_progress' | 'failed';
  version: string;
  generated_at: string;
  valid_until: string;
  tenant_id: string;
  unit_id: string;
  terminal_id: string;
  total_students: number;
}

/**
 * Carrega e criptografa o Snapshot de Alunos do Turno no IndexedDB
 */
export async function loadShiftSnapshot(
  students: CachedStudent[],
  context: TerminalKeyParams & { validUntil?: string }
): Promise<{ count: number }> {
  const validUntil = context.validUntil || new Date(Date.now() + 8 * 3600 * 1000).toISOString();

  await setTerminalMeta<SnapshotMeta>('snapshot_meta', {
    status: 'in_progress',
    version: '2026.1',
    generated_at: new Date().toISOString(),
    valid_until: validUntil,
    tenant_id: context.tenantId,
    unit_id: context.unitId,
    terminal_id: context.terminalId,
    total_students: students.length,
  });

  const key = await getTerminalKey(context);
  const storedItems: StoredEncryptedStudent[] = [];

  for (const student of students) {
    const encrypted = await encryptData(student, key);
    storedItems.push({
      id: student.id,
      registration_number: student.registration_number.trim().toUpperCase(),
      registration_hash: student.registration_hash,
      encrypted_student: encrypted,
      valid_until: student.valid_until,
    });
  }

  // Limpa apenas o cache de alunos, preservando 100% da fila pendente (pending_sync_queue)
  await clearStudentsCache();
  await saveEncryptedStudents(storedItems);

  await setTerminalMeta<SnapshotMeta>('snapshot_meta', {
    status: 'completed',
    version: '2026.1',
    generated_at: new Date().toISOString(),
    valid_until: validUntil,
    tenant_id: context.tenantId,
    unit_id: context.unitId,
    terminal_id: context.terminalId,
    total_students: storedItems.length,
  });

  return { count: storedItems.length };
}

/**
 * Parâmetros de entrada para liberação de refeição offline
 */
export interface ProcessOfflineMealInput {
  identifier: string;
  meal_type_id: string;
  meal_type_name?: string;
  student_price: number;
  unit_id: string;
  tenant_id: string;
  terminal_id: string;
  operator_id: string;
  config: TerminalOfflineConfig;
}

/**
 * Executa a validação e registro atômico de uma refeição em modo contingência offline
 */
export async function processOfflineMealConsumption(
  input: ProcessOfflineMealInput
): Promise<OfflineValidationResult> {
  const cleanId = input.identifier ? input.identifier.trim().toUpperCase() : '';

  if (!cleanId) {
    return {
      allowed: false,
      operational_state: 'BLOCKED',
      reason_code: 'INVALID_IDENTIFIER',
      reason_message: 'Identificador (matrícula ou cartão) não informado.',
    };
  }

  // 1. Validar integridade e expiração do snapshot deste terminal
  const snapshotMeta = await getTerminalMeta<SnapshotMeta>('snapshot_meta');
  if (!snapshotMeta || snapshotMeta.status !== 'completed') {
    return {
      allowed: false,
      operational_state: 'BLOCKED',
      reason_code: 'SNAPSHOT_UNAVAILABLE',
      reason_message: 'Base de dados local indisponível ou incompleta neste terminal.',
    };
  }

  if (new Date(snapshotMeta.valid_until).getTime() < Date.now()) {
    return {
      allowed: false,
      operational_state: 'BLOCKED',
      reason_code: 'SNAPSHOT_EXPIRED',
      reason_message: 'Os dados locais deste terminal expiraram. Conecte à rede para atualizar.',
    };
  }

  if (snapshotMeta.unit_id !== input.unit_id || snapshotMeta.tenant_id !== input.tenant_id) {
    return {
      allowed: false,
      operational_state: 'BLOCKED',
      reason_code: 'SNAPSHOT_SCOPE_MISMATCH',
      reason_message: 'Dados locais incompatíveis com a unidade ou instituição atual.',
    };
  }

  // 2. Verificar teto de contingência offline acumulado (Prevenção de fraude em massa)
  const stats = await getQueueStats(input.config.max_contingency_meals);
  if (stats.is_limit_reached) {
    return {
      allowed: false,
      operational_state: 'BLOCKED',
      reason_code: 'OFFLINE_LIMIT_EXCEEDED',
      reason_message: `Limite de contingência atingido (${stats.pending_count}/${input.config.max_contingency_meals} refeições). Conecte à rede para sincronizar.`,
    };
  }

  // 3. Chave de criptografia da partição do terminal
  const key = await getTerminalKey({
    tenantId: input.tenant_id,
    unitId: input.unit_id,
    terminalId: input.terminal_id,
  });

  // 4. Localizar estudante no cache (por matrícula ou por hash)
  let storedStudent = await findEncryptedStudentByRegistration(cleanId);
  if (!storedStudent) {
    const regHash = await hashRegistrationNumber(cleanId);
    storedStudent = await findEncryptedStudentByHash(regHash);
  }

  if (!storedStudent) {
    return {
      allowed: false,
      operational_state: 'BLOCKED',
      reason_code: 'STUDENT_NOT_FOUND',
      reason_message: 'Identificação/matrícula não encontrada no cadastro local deste turno.',
    };
  }

  // 5. Validar expiração individual do usuário no cache
  if (storedStudent.valid_until && new Date(storedStudent.valid_until).getTime() < Date.now()) {
    return {
      allowed: false,
      operational_state: 'BLOCKED',
      reason_code: 'SNAPSHOT_EXPIRED',
      reason_message: 'Autorização de acesso expirada no cadastro local deste turno.',
    };
  }

  // 4. Descriptografar e validar integridade do cadastro
  let student: CachedStudent;
  try {
    student = await decryptData<CachedStudent>(storedStudent.encrypted_student, key);
  } catch {
    return {
      allowed: false,
      operational_state: 'BLOCKED',
      reason_code: 'INTEGRITY_CHECK_FAILED',
      reason_message: 'Falha na verificação de integridade do cadastro local.',
    };
  }

  // 5. Verificar status cadastral
  if (!student.is_active) {
    return {
      allowed: false,
      operational_state: 'BLOCKED',
      reason_code: 'STUDENT_INACTIVE',
      reason_message: 'Cadastro inativo, trancado ou desligado da instituição.',
      student: {
        id: student.id,
        name_display: student.name_display,
        registration_number: student.registration_number,
        category_code: student.category_code,
        is_integral: student.is_integral,
        estimated_balance: student.estimated_balance,
        photo_path: student.photo_path,
      },
    };
  }

  // 6. Trava de Duplicidade no Mesmo Terminal (Prevenção de Bip Duplo na Catraca/Caixa)
  // Comensais da categoria 'visitante' são isentos da restrição de cota única (podem consumir mais de uma refeição com pagamento integral)
  const isVisitor = student.category_code?.toLowerCase() === 'visitante';
  const now = new Date();
  const consumptionDate = now.toISOString().split('T')[0];

  if (!isVisitor) {
    const alreadyConsumedHere = await hasLocalPassageToday(
      student.id,
      input.meal_type_id,
      consumptionDate
    );

    if (alreadyConsumedHere) {
      return {
        allowed: false,
        operational_state: 'BLOCKED',
        reason_code: 'ALREADY_CONSUMED_TODAY',
        reason_message: 'Refeição já liberada para este usuário neste terminal durante o turno atual.',
        student: {
          id: student.id,
          name_display: student.name_display,
          registration_number: student.registration_number,
          category_code: student.category_code,
          is_integral: student.is_integral,
          estimated_balance: student.estimated_balance,
          photo_path: student.photo_path,
        },
      };
    }
  }

  // 7. Política de Risco para Beneficiários Integrais vs Parciais
  if (!student.is_integral) {
    if (!input.config.allow_partial_offline) {
      return {
        allowed: false,
        operational_state: 'BLOCKED',
        reason_code: 'OFFLINE_PARTIAL_NOT_ALLOWED',
        reason_message: 'Contingência offline permitida apenas para refeições com subsídio integral nesta unidade.',
        student: {
          id: student.id,
          name_display: student.name_display,
          registration_number: student.registration_number,
          category_code: student.category_code,
          is_integral: student.is_integral,
          estimated_balance: student.estimated_balance,
          photo_path: student.photo_path,
        },
      };
    }

    if (student.estimated_balance < input.student_price) {
      return {
        allowed: false,
        operational_state: 'BLOCKED',
        reason_code: 'INSUFFICIENT_FUNDS',
        reason_message: `Saldo insuficiente no cadastro local (R$ ${student.estimated_balance.toFixed(2)}). Exigido: R$ ${input.student_price.toFixed(2)}.`,
        student: {
          id: student.id,
          name_display: student.name_display,
          registration_number: student.registration_number,
          category_code: student.category_code,
          is_integral: student.is_integral,
          estimated_balance: student.estimated_balance,
          photo_path: student.photo_path,
        },
      };
    }
  }

  // 8. Construção Atômica do Evento da Fila Durável
  const sequenceNum = await getNextSequenceNumber();
  const previousEventHash = await getLastEventHash();
  const deviceTimestamp = now.toISOString();
  const eventId = globalThis.crypto.randomUUID();
  const idempotencyKey = generateIdempotencyKey(input.unit_id, input.terminal_id);

  const integrityHash = await calculateEventChainHash(
    sequenceNum,
    input.terminal_id,
    student.id,
    input.meal_type_id,
    deviceTimestamp,
    idempotencyKey,
    previousEventHash
  );

  const event: OfflineConsumptionEvent = {
    id: eventId,
    sequence_num: sequenceNum,
    terminal_id: input.terminal_id,
    unit_id: input.unit_id,
    tenant_id: input.tenant_id,
    operator_id: input.operator_id,
    student_id: student.id,
    registration_attempted: cleanId,
    meal_type_id: input.meal_type_id,
    meal_type_name: input.meal_type_name,
    student_price: student.is_integral ? 0 : input.student_price,
    device_timestamp: deviceTimestamp,
    verification_method: 'offline_contingency',
    idempotency_key: idempotencyKey,
    previous_event_hash: previousEventHash,
    integrity_hash: integrityHash,
    status: 'pending_sync',
    sync_attempts: 0,
    created_at: deviceTimestamp,
  };

  // Criptografar evento para persistência durável no IndexedDB
  const encryptedEventPayload = await encryptData(event, key);

  const storedEvent: StoredEncryptedEvent = {
    id: eventId,
    sequence_num: sequenceNum,
    status: 'pending_sync',
    device_timestamp: deviceTimestamp,
    encrypted_event: encryptedEventPayload,
    integrity_hash: integrityHash,
    previous_event_hash: previousEventHash,
    sync_attempts: 0,
  };

  // Gravação na fila durável
  await enqueueOfflineEvent(storedEvent);

  // Registro no histórico local de passagens para trava imediata
  await recordLocalPassage({
    id: `${student.id}:${input.meal_type_id}:${consumptionDate}`,
    student_id: student.id,
    meal_type_id: input.meal_type_id,
    consumption_date: consumptionDate,
    consumed_at: deviceTimestamp,
    terminal_id: input.terminal_id,
    operational_state: 'OFFLINE_CONTINGENCY_LOGGED',
  });

  return {
    allowed: true,
    operational_state: 'OFFLINE_CONTINGENCY_LOGGED',
    student: {
      id: student.id,
      name_display: student.name_display,
      registration_number: student.registration_number,
      category_code: student.category_code,
      is_integral: student.is_integral,
      estimated_balance: student.estimated_balance,
      photo_path: student.photo_path,
    },
    event,
  };
}

/**
 * Recupera e descriptografa todos os eventos da fila pendente para sincronização
 */
export async function getDecryptedPendingEvents(
  params: TerminalKeyParams
): Promise<OfflineConsumptionEvent[]> {
  const key = await getTerminalKey(params);
  const rawEvents = await getPendingOfflineEvents();
  const decryptedEvents: OfflineConsumptionEvent[] = [];

  for (const raw of rawEvents) {
    try {
      const event = await decryptData<OfflineConsumptionEvent>(raw.encrypted_event, key);
      decryptedEvents.push(event);
    } catch (err) {
      console.error(`[OfflineEngine] Erro ao descriptografar evento ${raw.id}:`, err);
    }
  }

  return decryptedEvents;
}

export { markEventsSynced, markEventConflict, getQueueStats, openOfflineDatabase };
