/**
 * ==============================================================================
 * Monitor de Conectividade Resiliente e Prevenção de Flapping
 * Sprint 10 — MA Refeições (Módulo 10.3)
 * Controla máquina de estados com histerese (ONLINE, DEGRADED, OFFLINE, RECOVERING, SYNCING)
 * e instrumenta latências com percentis p50, p95 e p99.
 * ==============================================================================
 */

import type {
  ConnectivityState,
  NetworkProbeResult,
  ConnectivityMetrics,
} from '@/types/connectivity';
import { createBrowserClient } from '@/lib/supabase/client';

export type ProbeFunction = () => Promise<NetworkProbeResult>;

export class NetworkMonitor {
  private state: ConnectivityState = 'ONLINE';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private latencySamples: number[] = [];
  private readonly maxSamples = 30;

  private pollIntervalMs = 5000;
  private timer: NodeJS.Timeout | null = null;
  private customProbe: ProbeFunction | null = null;
  private isChecking = false;

  private lastSuccessfulProbe: string | null = null;
  private lastFailedProbe: string | null = null;

  private listeners: Set<(state: ConnectivityState, metrics: ConnectivityMetrics) => void> =
    new Set();

  constructor(customProbe?: ProbeFunction) {
    if (customProbe) {
      this.customProbe = customProbe;
    }
  }

  /**
   * Inscreve um callback para ser notificado em mudanças de estado ou métricas
   */
  public subscribe(
    callback: (state: ConnectivityState, metrics: ConnectivityMetrics) => void
  ): () => void {
    this.listeners.add(callback);
    callback(this.state, this.getMetrics());
    return () => this.listeners.delete(callback);
  }

  /**
   * Notifica todos os observadores
   */
  private notifyListeners(): void {
    const metrics = this.getMetrics();
    for (const listener of this.listeners) {
      try {
        listener(this.state, metrics);
      } catch {
        // Ignora erros em listeners externos
      }
    }
  }

  /**
   * Obtém o estado atual de conectividade
   */
  public getState(): ConnectivityState {
    return this.state;
  }

  /**
   * Define forçadamente o estado de SYNCING durante a transmissão de fila
   */
  public setSyncing(isSyncing: boolean): void {
    if (isSyncing) {
      this.state = 'SYNCING';
    } else {
      // Retorna ao estado correspondente aos sucessos acumulados
      this.state = this.consecutiveFailures > 0 ? 'DEGRADED' : 'ONLINE';
    }
    this.notifyListeners();
  }

  /**
   * Executa um probe padrão contra o backend Supabase com timeout de 2000ms
   */
  public async executeProbe(): Promise<NetworkProbeResult> {
    if (this.customProbe) {
      return this.customProbe();
    }

    const start = performance.now();
    const timeoutMs = 2000;

    try {
      const supabase = createBrowserClient();
      const probePromise = supabase
        .from('units')
        .select('id')
        .limit(1)
        .maybeSingle();

      const timeoutPromise = new Promise<{ isTimeout: true }>((resolve) =>
        setTimeout(() => resolve({ isTimeout: true }), timeoutMs)
      );

      const result = await Promise.race([probePromise, timeoutPromise]);
      const latencyMs = Math.round(performance.now() - start);

      if ('isTimeout' in result) {
        return {
          success: false,
          latencyMs: timeoutMs,
          timestamp: new Date().toISOString(),
          error: 'TIMEOUT_EXCEEDED',
        };
      }

      const { error } = result;
      if (error) {
        return {
          success: false,
          latencyMs,
          timestamp: new Date().toISOString(),
          error: error.message,
        };
      }

      return {
        success: true,
        latencyMs,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      return {
        success: false,
        latencyMs,
        timestamp: new Date().toISOString(),
        error: (err as Error).message,
      };
    }
  }

  /**
   * Processa o resultado do probe e aplica a máquina de estados com histerese
   */
  public processProbeResult(result: NetworkProbeResult): void {
    const previousState = this.state;

    if (result.success) {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses += 1;
      this.lastSuccessfulProbe = result.timestamp;

      // Adiciona amostra de latência
      this.latencySamples.push(result.latencyMs);
      if (this.latencySamples.length > this.maxSamples) {
        this.latencySamples.shift();
      }

      // Máquina de estados com Histerese de Retorno:
      if (this.state === 'OFFLINE') {
        // Primeiro sucesso: entra em período probatório de estabilização
        this.state = 'RECOVERING';
      } else if (this.state === 'RECOVERING') {
        // Exige 3 sucessos consecutivos para confirmar reestabilização
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
      // Falha no probe
      this.consecutiveSuccesses = 0;
      this.consecutiveFailures += 1;
      this.lastFailedProbe = result.timestamp;

      // Histerese de Queda: Exige 3 falhas consecutivas para declarar OFFLINE
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

    if (previousState !== this.state || result.success) {
      this.notifyListeners();
    }
  }

  /**
   * Calcula percentis de latência (p50, p95, p99)
   */
  public getMetrics(): ConnectivityMetrics {
    const samples = [...this.latencySamples].sort((a, b) => a - b);
    const count = samples.length;

    let p50 = 0;
    let p95 = 0;
    let p99 = 0;

    if (count > 0) {
      const getPercentile = (p: number) => {
        const index = Math.ceil((p / 100) * count) - 1;
        return samples[Math.max(0, Math.min(index, count - 1))];
      };

      p50 = getPercentile(50);
      p95 = getPercentile(95);
      p99 = getPercentile(99);
    }

    const currentLatency = count > 0 ? this.latencySamples[this.latencySamples.length - 1] : 0;

    return {
      currentLatencyMs: currentLatency,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      samplesCount: count,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastSuccessfulProbe: this.lastSuccessfulProbe,
      lastFailedProbe: this.lastFailedProbe,
    };
  }

  /**
   * Inicia o ciclo periódico de verificação de heartbeat
   */
  public start(intervalMs = 5000): void {
    this.pollIntervalMs = intervalMs;
    this.stop();

    const tick = async () => {
      if (this.isChecking) return;
      this.isChecking = true;
      try {
        const res = await this.executeProbe();
        this.processProbeResult(res);
      } finally {
        this.isChecking = false;
        // Ajusta intervalo: mais rápido em recuperação/degradação (2500ms)
        const nextInterval =
          this.state === 'DEGRADED' || this.state === 'RECOVERING' ? 2500 : this.pollIntervalMs;
        this.timer = setTimeout(tick, nextInterval);
      }
    };

    tick();
  }

  /**
   * Interrompe o ciclo de verificação
   */
  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

// Instância singleton para uso em toda a aplicação cliente
export const globalNetworkMonitor = new NetworkMonitor();
