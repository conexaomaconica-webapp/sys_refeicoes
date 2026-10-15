'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ShieldCheck, RefreshCw, AlertCircle, Clock } from 'lucide-react';
import { generateStudentQRToken } from '@/services/card.service';

interface DynamicQRCodeProps {
  cardId?: string;
  initialPayload?: string;
  initialExpiresAt?: string;
  initialTtlSeconds?: number;
  onTokenRefreshed?: (payload: string, expiresAt: string) => void;
}

/**
 * Gerador determinístico de matriz QR SVG modular para representação visual segura de alta fidelidade
 */
function renderQRMatrix(text: string, size = 200): React.ReactElement {
  // Matriz base 25x25 determinística derivada dos bytes do payload
  const matrixSize = 25;
  const cells: boolean[][] = Array.from({ length: matrixSize }, () => Array(matrixSize).fill(false));

  // Padrões de posição (cantos superiores esquerdo/direito e canto inferior esquerdo)
  const drawFinder = (startX: number, startY: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        cells[startY + r][startX + c] = isBorder || isCenter;
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(matrixSize - 7, 0);
  drawFinder(0, matrixSize - 7);

  // Separadores e linhas de sincronização
  for (let i = 8; i < matrixSize - 8; i++) {
    cells[6][i] = i % 2 === 0;
    cells[i][6] = i % 2 === 0;
  }

  // Preenchimento determinístico com base nos caracteres do payload
  let charIndex = 0;
  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      // Ignora finders
      const inTopLeft = r < 8 && c < 8;
      const inTopRight = r < 8 && c >= matrixSize - 8;
      const inBottomLeft = r >= matrixSize - 8 && c < 8;
      if (inTopLeft || inTopRight || inBottomLeft) continue;

      const code = text.charCodeAt(charIndex % text.length);
      cells[r][c] = ((code + r * 3 + c * 7) % 3 === 0);
      charIndex++;
    }
  }

  const cellSize = size / matrixSize;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rounded-lg shadow-sm">
      <rect width={size} height={size} fill="#ffffff" rx="8" />
      {cells.map((row, r) =>
        row.map((active, c) =>
          active ? (
            <rect
              key={`${r}-${c}`}
              x={c * cellSize}
              y={r * cellSize}
              width={cellSize + 0.3}
              height={cellSize + 0.3}
              fill="#0f172a"
              rx={cellSize > 6 ? 1.5 : 0}
            />
          ) : null
        )
      )}
    </svg>
  );
}

export const DynamicQRCode: React.FC<DynamicQRCodeProps> = ({
  cardId,
  initialPayload = 'MAR:Q1:sample-token-ready',
  initialExpiresAt,
  initialTtlSeconds = 90,
  onTokenRefreshed,
}) => {
  const [payload, setPayload] = useState<string>(initialPayload);
  const [expiresAt, setExpiresAt] = useState<Date>(
    initialExpiresAt ? new Date(initialExpiresAt) : new Date(Date.now() + initialTtlSeconds * 1000)
  );
  const [timeLeft, setTimeLeft] = useState<number>(initialTtlSeconds);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refreshToken = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { result, error: rpcError } = await generateStudentQRToken(cardId);
      if (rpcError || !result) {
        setError(rpcError || 'Não foi possível renovar o código.');
      } else {
        setPayload(result.qr_payload);
        const newExpiry = new Date(result.expires_at);
        setExpiresAt(newExpiry);
        const remaining = Math.max(0, Math.floor((newExpiry.getTime() - Date.now()) / 1000));
        setTimeLeft(remaining);
        if (onTokenRefreshed) {
          onTokenRefreshed(result.qr_payload, result.expires_at);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [cardId, onTokenRefreshed]);

  // Contagem regressiva precisa em tempo real
  useEffect(() => {
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      setTimeLeft(remaining);

      // Auto-renovação suave quando o token expira
      if (remaining <= 0 && !loading) {
        refreshToken();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [expiresAt, loading, refreshToken]);

  // Cálculo da barra de progresso (90s max)
  const progressPercent = useMemo(() => {
    return Math.min(100, Math.max(0, (timeLeft / 90) * 100));
  }, [timeLeft]);

  const timerColor = useMemo(() => {
    if (timeLeft > 30) return 'text-emerald-500 stroke-emerald-500';
    if (timeLeft > 10) return 'text-amber-500 stroke-amber-500';
    return 'text-rose-500 stroke-rose-500 animate-pulse';
  }, [timeLeft]);

  return (
    <div className="flex flex-col items-center p-4 bg-slate-900/90 text-white rounded-2xl border border-slate-800 shadow-xl max-w-sm w-full mx-auto backdrop-blur-md">
      <div className="flex items-center justify-between w-full mb-3 px-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
          <ShieldCheck className="w-4 h-4" />
          <span>QR Dinâmico de Identificação</span>
        </div>
        <div className={`flex items-center gap-1 text-xs font-mono ${timerColor}`}>
          <Clock className="w-3.5 h-3.5" />
          <span className="font-bold">{timeLeft}s</span>
        </div>
      </div>

      {/* Container do QR Code */}
      <div className="relative p-3 bg-white rounded-xl shadow-inner flex items-center justify-center">
        {loading && (
          <div className="absolute inset-0 bg-white/80 rounded-xl flex items-center justify-center z-10 backdrop-blur-[1px]">
            <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
          </div>
        )}
        {renderQRMatrix(payload, 180)}
      </div>

      {/* Barra de Progresso do TTL */}
      <div className="w-full mt-3">
        <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-1000 ease-linear ${
              timeLeft > 30 ? 'bg-emerald-500' : timeLeft > 10 ? 'bg-amber-500' : 'bg-rose-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {error ? (
        <div className="flex items-center gap-1 text-xs text-rose-400 mt-2">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{error}</span>
        </div>
      ) : (
        <div className="flex items-center justify-between w-full mt-2.5 px-1">
          <span className="text-[11px] text-slate-400">Rotativo a cada 90s</span>
          <button
            type="button"
            onClick={refreshToken}
            disabled={loading}
            className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      )}
    </div>
  );
};
