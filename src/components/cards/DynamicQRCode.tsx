'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ShieldCheck, RefreshCw, AlertCircle, Clock } from 'lucide-react';
import QRCode from 'qrcode';
import { generateStudentQRToken } from '@/services/card.service';

interface DynamicQRCodeProps {
  cardId?: string;
  initialPayload?: string;
  initialExpiresAt?: string;
  initialTtlSeconds?: number;
  onTokenRefreshed?: (payload: string, expiresAt: string) => void;
  compact?: boolean;
}

export const DynamicQRCode: React.FC<DynamicQRCodeProps> = ({
  cardId,
  initialPayload = '',
  initialExpiresAt,
  initialTtlSeconds = 90,
  onTokenRefreshed,
  compact = false,
}) => {
  const [payload, setPayload] = useState<string>(initialPayload);
  const [expiresAt, setExpiresAt] = useState<Date>(
    initialExpiresAt ? new Date(initialExpiresAt) : new Date(Date.now() + initialTtlSeconds * 1000)
  );
  const [timeLeft, setTimeLeft] = useState<number>(initialTtlSeconds);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState<boolean>(Boolean(initialPayload));
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  const refreshToken = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { result, error: rpcError } = await generateStudentQRToken(cardId);
      if (rpcError || !result) {
        setError(rpcError || 'Não foi possível renovar o código.');
      } else {
        setPayload(result.qr_payload);
        setInitialized(true);
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

  useEffect(() => {
    if (cardId && !initialPayload) void refreshToken();
  }, [cardId, initialPayload, refreshToken]);

  useEffect(() => {
    if (!initialized || !payload) {
      setQrDataUrl('');
      return;
    }

    let cancelled = false;
    void QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 360,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível montar o QR Code.');
      });

    return () => {
      cancelled = true;
    };
  }, [initialized, payload]);

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

  if (compact) {
    return (
      <div className="w-full">
        <div className="relative mx-auto grid aspect-square w-full max-w-[210px] place-items-center rounded-3xl bg-white p-3 shadow-xl">
          {(loading || !initialized) && (
            <div className="absolute inset-0 z-10 grid place-items-center rounded-3xl bg-white/85">
              <RefreshCw className="h-8 w-8 animate-spin text-red-700" />
            </div>
          )}
          {initialized && qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt="QR Code dinÃ¢mico de identificaÃ§Ã£o" className="h-full w-full rounded-xl [image-rendering:pixelated]" />
          ) : (
            <div className="h-full w-full" />
          )}
        </div>
        <div className="mt-2 flex items-center justify-center gap-2 text-[11px] font-bold text-white/90">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>QR seguro Â· {timeLeft}s</span>
          <button type="button" onClick={refreshToken} disabled={loading} className="rounded-full bg-white/15 p-1 hover:bg-white/25" aria-label="Atualizar QR Code">
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {error && <p className="mt-1 text-center text-[10px] font-bold text-amber-200">{error}</p>}
      </div>
    );
  }

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
        {(loading || !initialized) && (
          <div className="absolute inset-0 bg-white/80 rounded-xl flex items-center justify-center z-10 backdrop-blur-[1px]">
            <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
          </div>
        )}
        {initialized && qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDataUrl}
            alt="QR Code dinâmico de identificação"
            className="h-[180px] w-[180px] rounded-lg [image-rendering:pixelated]"
          />
        ) : (
          <div className="h-[180px] w-[180px]" />
        )}
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
