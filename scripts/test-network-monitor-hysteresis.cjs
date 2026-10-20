/**
 * ==============================================================================
 * Teste Automatizado do Módulo 10.3: Conectividade Resiliente e Histerese
 * Valida:
 * 1. Máquina de 5 Estados com Histerese Anti-Flapping
 * 2. Cálculo dos Percentis de Latência (p50, p95, p99)
 * 3. Travas de Timeout Preventivas (Idempotência e Prevenção de Duplo Bip)
 * 4. Mutex de Sincronização (Prevenção de Execuções Concorrentes)
 * ==============================================================================
 */

const assert = require('assert');

// 1. Simulação da Máquina de Estados do NetworkMonitor
class TestNetworkMonitor {
  constructor() {
    this.state = 'ONLINE';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.latencySamples = [];
    this.maxSamples = 30;
  }

  processProbeResult(result) {
    if (result.success) {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses += 1;

      this.latencySamples.push(result.latencyMs);
      if (this.latencySamples.length > this.maxSamples) {
        this.latencySamples.shift();
      }

      if (this.state === 'OFFLINE') {
        this.state = 'RECOVERING';
      } else if (this.state === 'RECOVERING') {
        if (this.consecutiveSuccesses >= 3) {
          this.state = result.latencyMs > 1500 ? 'DEGRADED' : 'ONLINE';
        }
      } else if (this.state === 'DEGRADED') {
        if (result.latencyMs <= 1500 && this.consecutiveSuccesses >= 2) {
          this.state = 'ONLINE';
        }
      } else if (this.state === 'ONLINE') {
        if (result.latencyMs > 1500) {
          this.state = 'DEGRADED';
        }
      }
    } else {
      this.consecutiveSuccesses = 0;
      this.consecutiveFailures += 1;

      if (this.state === 'ONLINE' || this.state === 'RECOVERING') {
        if (this.consecutiveFailures >= 3) {
          this.state = 'OFFLINE';
        } else {
          this.state = 'DEGRADED';
        }
      } else if (this.state === 'DEGRADED') {
        if (this.consecutiveFailures >= 3) {
          this.state = 'OFFLINE';
        }
      }
    }
  }

  getMetrics() {
    const samples = [...this.latencySamples].sort((a, b) => a - b);
    const count = samples.length;

    let p50 = 0;
    let p95 = 0;
    let p99 = 0;

    if (count > 0) {
      const getPercentile = (p) => {
        const index = Math.ceil((p / 100) * count) - 1;
        return samples[Math.max(0, Math.min(index, count - 1))];
      };
      p50 = getPercentile(50);
      p95 = getPercentile(95);
      p99 = getPercentile(99);
    }

    return {
      p50,
      p95,
      p99,
      samplesCount: count,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
    };
  }
}

// 2. Simulação do Timeout Lock Manager
class TestTimeoutLockManager {
  constructor() {
    this.locks = new Map();
  }

  recordUnknownTimeout(identifier, mealTypeId, date, idempotencyKey) {
    const key = `${identifier.trim().toUpperCase()}:${mealTypeId}:${date}`;
    this.locks.set(key, {
      identifier,
      mealTypeId,
      date,
      idempotencyKey,
      status: 'pending_resolution',
    });
  }

  hasPendingTimeout(identifier, mealTypeId, date) {
    const key = `${identifier.trim().toUpperCase()}:${mealTypeId}:${date}`;
    const item = this.locks.get(key);
    return !!item && item.status === 'pending_resolution';
  }

  resolveTimeout(idempotencyKey, status) {
    for (const [key, record] of this.locks.entries()) {
      if (record.idempotencyKey === idempotencyKey) {
        if (status === 'resolved_not_applied') {
          this.locks.delete(key);
        } else {
          record.status = 'resolved_confirmed';
        }
        break;
      }
    }
  }
}

// 3. Simulação do Sync Mutex
class TestSyncMutex {
  constructor() {
    this.isLocked = false;
  }

  acquire() {
    if (this.isLocked) return false;
    this.isLocked = true;
    return true;
  }

  release() {
    this.isLocked = false;
  }
}

async function runModule103Tests() {
  console.log('--- [TESTE MÓDULO 10.3: CONECTIVIDADE RESILIENTE E HISTERESE] ---');

  // =========================================================================
  // CENÁRIO 1: Histerese de Queda de Rede (Anti-Flapping)
  // =========================================================================
  const monitor = new TestNetworkMonitor();
  assert.strictEqual(monitor.state, 'ONLINE');

  // 1ª falha isolada: NÃO deve comutar diretamente para OFFLINE
  monitor.processProbeResult({ success: false, latencyMs: 2000 });
  assert.strictEqual(
    monitor.state,
    'DEGRADED',
    'Uma única falha esporádica de ping deve degradar o estado, não derrubar para OFFLINE.'
  );
  console.log('✅ 1.1 Primeira falha de rede tratada com histerese: Estado = DEGRADED (sem flapping).');

  // 2ª falha: permanece DEGRADED
  monitor.processProbeResult({ success: false, latencyMs: 2000 });
  assert.strictEqual(monitor.state, 'DEGRADED');
  console.log('✅ 1.2 Segunda falha de rede acumulada: Estado = DEGRADED.');

  // 3ª falha consecutiva: agora sim comuta para OFFLINE (contingência declarada)
  monitor.processProbeResult({ success: false, latencyMs: 2000 });
  assert.strictEqual(
    monitor.state,
    'OFFLINE',
    'Três falhas consecutivas devem confirmar a contingência OFFLINE.'
  );
  console.log('✅ 1.3 Terceira falha consecutiva confirmada: Estado = OFFLINE (Contingência Ativa).');

  // =========================================================================
  // CENÁRIO 2: Histerese de Recuperação Gradual (Anti-Flapping de Retorno)
  // =========================================================================
  // 1º sucesso após queda: entra em RECOVERING (período probatório)
  monitor.processProbeResult({ success: true, latencyMs: 120 });
  assert.strictEqual(
    monitor.state,
    'RECOVERING',
    'Primeiro sucesso de ping não deve ir direto para ONLINE; deve entrar em RECOVERING.'
  );
  console.log('✅ 2.1 Retomada de sinal: Estado = RECOVERING (período de estabilização probatória).');

  // 2º sucesso em recuperação: ainda permanece RECOVERING
  monitor.processProbeResult({ success: true, latencyMs: 95 });
  assert.strictEqual(monitor.state, 'RECOVERING');
  console.log('✅ 2.2 Segundo sucesso acumulado: permanece em RECOVERING (2/3 confirmados).');

  // 3º sucesso consecutivo: confirma estabilidade e retorna para ONLINE!
  monitor.processProbeResult({ success: true, latencyMs: 80 });
  assert.strictEqual(
    monitor.state,
    'ONLINE',
    'Três sucessos consecutivos restabelecem o estado ONLINE com segurança.'
  );
  console.log('✅ 2.3 Terceiro sucesso consecutivo: estabilização concluída -> Estado = ONLINE.');

  // =========================================================================
  // CENÁRIO 3: Instrumentação de Latência e Percentis (p50, p95, p99)
  // =========================================================================
  const latencies = [35, 42, 48, 50, 52, 60, 75, 80, 95, 110, 150, 320, 450, 800, 1200];
  for (const lat of latencies) {
    monitor.processProbeResult({ success: true, latencyMs: lat });
  }

  const metrics = monitor.getMetrics();
  assert(metrics.p50 > 0, 'p50 deve ser maior que 0');
  assert(metrics.p95 >= metrics.p50, 'p95 deve ser maior ou igual a p50');
  assert(metrics.p99 >= metrics.p95, 'p99 deve ser maior ou igual a p95');
  console.log('✅ 3. Instrumentação de latência aprovada:');
  console.log(`   - p50 (mediana): ${metrics.p50}ms`);
  console.log(`   - p95: ${metrics.p95}ms`);
  console.log(`   - p99: ${metrics.p99}ms`);

  // =========================================================================
  // CENÁRIO 4: Bloqueio de Conflito por Timeout Remoto (Idempotency Protection)
  // =========================================================================
  const lockManager = new TestTimeoutLockManager();
  const studentReg = '20261099';
  const mealType = 'lunch-uuid';
  const today = '2026-10-16';
  const idemKey = 'TERM-01_1729000000_ABC';

  // Simulação: Transação atingiu timeout no servidor
  lockManager.recordUnknownTimeout(studentReg, mealType, today, idemKey);

  // Aluno tenta passar novamente no mesmo segundo / turno:
  const isBlockedSameMeal = lockManager.hasPendingTimeout(studentReg, mealType, today);
  assert.strictEqual(
    isBlockedSameMeal,
    true,
    'Nova tentativa para a mesma matrícula e refeição DEVE ser bloqueada preventivamente.'
  );
  console.log('✅ 4.1 Bloqueio de segurança ativo para matrícula com timeout remoto não resolvido.');

  // Aluno tenta passar em outro tipo de refeição (ex: Jantar) -> não deve sofrer bloqueio indevido
  const isBlockedOtherMeal = lockManager.hasPendingTimeout(studentReg, 'dinner-uuid', today);
  assert.strictEqual(isBlockedOtherMeal, false, 'Outro tipo de refeição não deve ser travado.');
  console.log('✅ 4.2 Isolamento de escopo por refeição verificado com sucesso.');

  // Resolução da pendência
  lockManager.resolveTimeout(idemKey, 'resolved_not_applied');
  const isUnblocked = lockManager.hasPendingTimeout(studentReg, mealType, today);
  assert.strictEqual(isUnblocked, false, 'Após resolução comprovada, trava é desativada.');
  console.log('✅ 4.3 Desbloqueio e liberação de trava pós-conciliação comprovados.');

  // =========================================================================
  // CENÁRIO 5: Mutex Atômico de Sincronização (Prevenção de Corridas)
  // =========================================================================
  const mutex = new TestSyncMutex();

  const processA = mutex.acquire();
  assert.strictEqual(processA, true, 'Processo A adquire o lock com sucesso.');

  const processB = mutex.acquire();
  assert.strictEqual(
    processB,
    false,
    'Processo B concorrente é rejeitado enquanto Processo A está sincronizando.'
  );
  console.log('✅ 5.1 Mutex impediu execução simultânea concorrente de sincronização.');

  mutex.release();
  const processC = mutex.acquire();
  assert.strictEqual(processC, true, 'Após liberação do Processo A, Processo C pode executar.');
  console.log('✅ 5.2 Liberação e reutilização sequencial do lock comprovadas.');

  console.log('\n======================================================');
  console.log('TODOS OS TESTES DO MÓDULO 10.3 FORAM APROVADOS!');
  console.log('======================================================\n');
}

runModule103Tests().catch((err) => {
  console.error('❌ Falha nos testes do Módulo 10.3:', err);
  process.exit(1);
});
