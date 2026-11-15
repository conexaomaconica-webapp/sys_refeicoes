'use client';

import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, ShieldCheck, User, WalletCards, X } from 'lucide-react';
import { useBrand } from '@/components/branding/brand-context';
import {
  getConsumerCardBackgroundImageStyle,
  getConsumerCardElementStyle,
} from '@/lib/consumer-card-layout';
import { DynamicQRCode } from './DynamicQRCode';
import type { Card } from '@/types/card';

interface ConsumerVirtualCardProps {
  student: {
    fullName: string;
    registrationNumber: string;
    course?: string | null;
    photoPath?: string | null;
    institutionName?: string;
    status: string;
    categoryName: string;
    qrPayload?: string;
  };
  card?: Card | null;
  balance?: number | null;
  requiresWallet: boolean;
  allowFullscreen?: boolean;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const getInitials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');

export function ConsumerVirtualCard({
  student,
  card,
  balance,
  requiresWallet,
  allowFullscreen = false,
}: ConsumerVirtualCardProps) {
  const { branding } = useBrand();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenContainerRef = useRef<HTMLDivElement | null>(null);
  const isActive = student.status === 'active' && card?.status === 'active';
  const backgroundUrl = branding.consumer_card_background_url?.replace(/["'\\\r\n]/g, '');
  const backgroundImageStyle =
    branding.consumer_card_background_mode === 'image' && backgroundUrl
      ? getConsumerCardBackgroundImageStyle(
          backgroundUrl,
          branding.consumer_card_background_transform
        )
      : null;

  useEffect(() => {
    if (!isFullscreen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFullscreen(false);
      }
    };

    const handleNativeFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('fullscreenchange', handleNativeFullscreenChange);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('fullscreenchange', handleNativeFullscreenChange);
    };
  }, [isFullscreen]);

  const openFullscreen = () => {
    setIsFullscreen(true);
    requestAnimationFrame(() => {
      const el = fullscreenContainerRef.current;
      if (el && typeof el.requestFullscreen === 'function' && !document.fullscreenElement) {
        void el.requestFullscreen().catch(() => {
          // Fallback silencioso para navegadores mobile (ex.: iOS Safari) usando o overlay fixo
        });
      }
    });
  };

  const closeFullscreen = () => {
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      void document.exitFullscreen().catch(() => {});
    }
    setIsFullscreen(false);
  };

  const renderCardBody = (fullMode: boolean) => (
    <article
      className={
        fullMode
          ? 'mx-auto w-full max-w-[430px] select-none'
          : 'mx-auto w-full max-w-[410px] select-none'
      }
    >
      <div
        className={`relative aspect-[9/16] overflow-hidden rounded-[2.25rem] border border-white/20 text-white shadow-2xl ${
          fullMode ? 'max-h-[calc(100dvh-5rem)] w-full' : 'min-h-[650px]'
        }`}
        style={{ backgroundColor: branding.consumer_card_background_color }}
      >
        {allowFullscreen && !fullMode && (
          <button
            type="button"
            onClick={openFullscreen}
            aria-label="Ver cartão em tela cheia"
            className="absolute right-3.5 top-3.5 z-20 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-black/45 px-3 py-1.5 text-[11px] font-bold text-white backdrop-blur-md transition hover:bg-black/65 active:scale-95"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            <span>Tela cheia</span>
          </button>
        )}
        {backgroundImageStyle && (
          <div className="pointer-events-none absolute inset-0" style={backgroundImageStyle} />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/30" />
        {branding.consumer_card_elements.logo.visible && <div className="absolute z-10 w-[65%] max-w-[240px] text-center" style={getConsumerCardElementStyle(branding.consumer_card_layout.logo, branding.consumer_card_elements.logo.zoom)}>
          {branding.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logo_url} alt={branding.app_name} className="mx-auto max-h-16 w-auto object-contain drop-shadow-md" />
          ) : (
            <p className="truncate text-base font-black uppercase tracking-[0.2em] text-white/90">{branding.app_name}</p>
          )}
        </div>}

        {branding.consumer_card_elements.title.visible && <h2 className="absolute z-10 w-[44%] text-center text-xl font-light uppercase leading-tight tracking-wide" style={getConsumerCardElementStyle(branding.consumer_card_layout.title, branding.consumer_card_elements.title.zoom)}>
          Cartão virtual<br /><strong className="font-black">de consumo</strong>
        </h2>}

        {branding.consumer_card_elements.qr.visible && <div className="absolute z-10 w-[58%] max-w-[210px]" style={getConsumerCardElementStyle(branding.consumer_card_layout.qr, branding.consumer_card_elements.qr.zoom)}>
          <DynamicQRCode
            compact
            hideLabel
            cardId={card?.id}
            initialPayload={student.qrPayload}
            registrationNumber={student.registrationNumber}
          />
        </div>}

        {branding.consumer_card_elements.photo.visible && <div className="absolute z-10 grid h-16 w-16 place-items-center overflow-hidden rounded-full border-2 bg-slate-800 text-white shadow-xl ring-2 ring-black/20" style={{ ...getConsumerCardElementStyle(branding.consumer_card_layout.photo, branding.consumer_card_elements.photo.zoom), borderColor: branding.consumer_card_accent_color }}>
          {student.photoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={student.photoPath}
              alt={student.fullName}
              className="h-full w-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : student.fullName ? (
            <span className="text-base font-black">{getInitials(student.fullName)}</span>
          ) : (
            <User className="h-8 w-8" />
          )}
        </div>}

        {branding.consumer_card_elements.name.visible && <div className="absolute z-10 w-[58%] max-w-[220px] text-left drop-shadow-md" style={getConsumerCardElementStyle(branding.consumer_card_layout.name, branding.consumer_card_elements.name.zoom)}>
          <h3 className="truncate text-base font-black text-white leading-tight drop-shadow-sm">{student.fullName}</h3>
          <p className="mt-0.5 truncate font-mono text-[11px] font-bold text-white/95 drop-shadow-sm">Matrícula: {student.registrationNumber}</p>
          {(student.course || student.institutionName) && (
            <p className="mt-0.5 truncate text-[10px] font-medium text-white/80 drop-shadow-sm">
              {[student.course, student.institutionName].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>}

        {branding.consumer_card_elements.status.visible && <div className="absolute z-10 flex max-w-[54%] flex-wrap items-center justify-start gap-1.5" style={getConsumerCardElementStyle(branding.consumer_card_layout.status, branding.consumer_card_elements.status.zoom)}>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black ${isActive ? 'bg-emerald-500 text-emerald-950 shadow-sm' : 'bg-slate-900/80 text-white'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-950' : 'bg-slate-400'}`} />
            {isActive ? 'ATIVO' : 'INATIVO'}
          </span>
          <span className="max-w-full truncate rounded-full bg-white/20 backdrop-blur-sm px-2 py-0.5 text-[9px] font-bold text-white shadow-sm">{student.categoryName}</span>
        </div>}

        {branding.consumer_card_elements.balance.visible && <div className="absolute z-10 flex min-h-20 w-[86%] items-center justify-center gap-3 rounded-3xl px-5 py-4 text-center text-slate-950 shadow-lg" style={{ ...getConsumerCardElementStyle(branding.consumer_card_layout.balance, branding.consumer_card_elements.balance.zoom), backgroundColor: branding.consumer_card_accent_color }}>
            {requiresWallet ? <WalletCards className="h-7 w-7 shrink-0" /> : <ShieldCheck className="h-7 w-7 shrink-0" />}
            <div>
              <p className="text-[11px] font-black uppercase tracking-wider">{requiresWallet ? 'Saldo disponível' : 'Benefício integral'}</p>
              <p className="mt-0.5 text-xl font-black">{requiresWallet ? formatCurrency(Number(balance || 0)) : 'Sem cobrança'}</p>
            </div>
        </div>}
        <footer className="absolute inset-x-6 bottom-4 z-10 flex items-center justify-between font-mono text-[9px] font-bold text-white/70">
          <span>{card?.card_number || 'CARTEIRINHA DIGITAL'}</span><span>USO PESSOAL</span>
        </footer>
      </div>
    </article>
  );

  return (
    <>
      {renderCardBody(false)}

      {allowFullscreen && isFullscreen && (
        <div
          ref={fullscreenContainerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Cartão virtual em tela cheia"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/95 p-3 backdrop-blur-md"
        >
          <div className="mb-3 flex w-full max-w-[430px] items-center justify-end">
            <button
              type="button"
              onClick={closeFullscreen}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-white/20 active:scale-95"
            >
              <Minimize2 className="h-3.5 w-3.5" />
              <span>Sair da tela cheia</span>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {renderCardBody(true)}
        </div>
      )}
    </>
  );
}
