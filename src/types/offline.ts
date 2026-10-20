/**
 * ==============================================================================
 * Tipos e Contratos do Motor de Contingência Offline e Terminal Operacional
 * Sprint 10 — MA Refeições
 * ==============================================================================
 */

/**
 * Estados operacionais explícitos definidos pela arquitetura da Sprint 10
 */
export type OperationalState =
  | 'ONLINE_CONFIRMED'            // 🟢 Consumo atômico validado no servidor
  | 'OFFLINE_CONTINGENCY_LOGGED'   // 🟡 Liberação provisória registrada localmente
  | 'REMOTE_UNKNOWN_TIMEOUT'       // 🟠 Timeout de rede com resultado desconhecido (trava de segurança)
  | 'PENDING_SYNC'                 // ⏳ Evento na fila durável aguardando transmissão
  | 'SYNCED_CONFIRMED'             // ✅ Evento reconciliado e confirmado pelo servidor
  | 'CONFLICT_PENDING_REVIEW'      // ⚠️ Conflito de duplicidade offline retido para auditoria
  | 'BLOCKED';                     // 🔴 Bloqueado por regra de negócio (saldo, status, horário, cota)

/**
 * Snapshot de Aluno em Cache Local (Minimizado conforme LGPD)
 * Armazena apenas o necessário para validação do turno ativo.
 */
export interface CachedStudent {
  id: string;                      // student_id (UUID)
  registration_number: string;     // Matrícula do aluno
  registration_hash: string;       // Hash da matrícula para indexação rápida
  name_display: string;            // Nome social ou primeiro e último nome
  category_code: string;           // Código da categoria (ex: BOLSISTA_INTEGRAL, PARCIAL)
  is_integral: boolean;            // True se subsídio 100% (cota 1/dia por tipo)
  is_active: boolean;              // True se matrícula ativa no período
  estimated_balance: number;       // Saldo estimado no momento do snapshot
  photo_path?: string | null;      // Caminho relativo da foto ou thumbnail em cache
  last_cached_at: string;          // ISO UTC da carga
  valid_until: string;             // ISO UTC de expiração do snapshot
}

/**
 * Evento persistido na fila durável criptografada (IndexedDB)
 */
export interface OfflineConsumptionEvent {
  id: string;                      // UUID v4 único do evento
  sequence_num: number;            // Contador monotônico sequencial por terminal (1, 2, 3...)
  terminal_id: string;             // Identificador físico/lógico do terminal
  unit_id: string;                 // UUID da unidade de alimentação
  tenant_id: string;               // UUID do tenant
  operator_id: string;             // UUID do operador autenticado no início do turno
  student_id: string;              // UUID do aluno identificado
  registration_attempted: string;  // Matrícula ou código bipado
  meal_type_id: string;            // Tipo de refeição (Almoço, Jantar, etc.)
  meal_type_name?: string;         // Nome para exibição amigável
  student_price: number;           // Preço teórico aplicado
  device_timestamp: string;        // ISO UTC registrado no instante do bip pelo hardware local
  verification_method: 'offline_contingency';
  idempotency_key: string;         // Chave de alta entropia para prevenir reprocessamento duplo
  previous_event_hash: string;     // Hash do evento anterior para encadeamento criptográfico
  integrity_hash: string;          // HMAC/SHA-256 do payload do evento atual
  status: 'pending_sync' | 'synced' | 'conflict_pending_review';
  sync_attempts: number;           // Quantidade de tentativas de envio
  last_sync_error?: string | null; // Mensagem de erro caso a última tentativa tenha falhado
  created_at: string;              // ISO UTC local
}

/**
 * Histórico de Passagens Locais no Terminal (Trava de Duplicidade no Mesmo Dispositivo)
 */
export interface TerminalLocalPassage {
  id: string;                      // chave composta: student_id:meal_type_id:consumption_date
  student_id: string;
  meal_type_id: string;
  consumption_date: string;        // YYYY-MM-DD
  consumed_at: string;             // ISO UTC
  terminal_id: string;
  operational_state: OperationalState;
}

/**
 * Parâmetros de Configuração e Tolerância de Risco Offline
 */
export interface TerminalOfflineConfig {
  unit_id: string;
  terminal_id: string;
  tenant_id: string;
  max_contingency_meals: number;   // Teto máximo de refeições offline acumuladas (ex: 50 a 100)
  allow_partial_offline: boolean;  // Se permite liberação de alunos parciais em contingência
  max_partial_risk_amount: number; // Valor máximo de risco financeiro tolerado por refeição
  snapshot_ttl_hours: number;      // TTL do cache de estudantes (padrão: 6 horas)
}

/**
 * Resultado da Validação pelo Motor Offline Local
 */
export interface OfflineValidationResult {
  allowed: boolean;
  operational_state: OperationalState;
  reason_code?: string;
  reason_message?: string;
  student?: {
    id: string;
    name_display: string;
    registration_number: string;
    category_code: string;
    is_integral: boolean;
    estimated_balance: number;
    photo_path?: string | null;
  };
  event?: OfflineConsumptionEvent;
}

/**
 * Estatísticas da Fila Local e da Contingência
 */
export interface OfflineQueueStats {
  pending_count: number;
  synced_count: number;
  conflict_count: number;
  last_sync_at?: string | null;
  oldest_pending_timestamp?: string | null;
  current_sequence_num: number;
  is_limit_reached: boolean;
}
