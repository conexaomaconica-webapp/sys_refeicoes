/**
 * ==============================================================================
 * Tipos e Contratos do Monitor de Conectividade e Prevenção de Flapping
 * Sprint 10 — MA Refeições (Módulo 10.3)
 * ==============================================================================
 */

/**
 * 5 Estados de conectividade da máquina de estados com histerese
 */
export type ConnectivityState =
  | 'ONLINE'      // 🟢 Conexão estável com backend Supabase (latência aceitável)
  | 'DEGRADED'    // 🟡 Conexão ativa porém instável ou com latência elevada (> 1500ms)
  | 'OFFLINE'     // 🔴 Backend inacessível confirmado após 3 falhas consecutivas (contingência ativa)
  | 'RECOVERING'  // 🔵 Conexão reestabelecida em período probatório de estabilização (histerese)
  | 'SYNCING';    // 🟣 Sincronização e conciliação atômica de fila pendente em andamento

/**
 * Resultado individual de um probe de rede (heartbeat)
 */
export interface NetworkProbeResult {
  success: boolean;
  latencyMs: number;
  timestamp: string;
  error?: string;
  statusCode?: number;
}

/**
 * Métricas e percentis de desempenho de rede
 */
export interface ConnectivityMetrics {
  currentLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  samplesCount: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastSuccessfulProbe?: string | null;
  lastFailedProbe?: string | null;
}

/**
 * Registro de Operação com Resultado Desconhecido (Timeout Remoto)
 * Previne duplicidade de liberação enquanto a resposta do servidor não é confirmada.
 */
export interface UnknownTimeoutRecord {
  id: string; // Chave composta: identifier:meal_type_id:date
  identifier: string;
  studentId?: string;
  mealTypeId: string;
  consumptionDate: string; // YYYY-MM-DD
  idempotencyKey: string;
  terminalId: string;
  unitId: string;
  timeoutAt: string; // ISO UTC
  status: 'pending_resolution' | 'resolved_confirmed' | 'resolved_not_applied';
  attempts: number;
}
