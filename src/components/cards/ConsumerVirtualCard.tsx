'use client';

import { ShieldCheck, User, WalletCards } from 'lucide-react';
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
  };
  card?: Card | null;
  balance?: number | null;
  requiresWallet: boolean;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const getInitials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');

export function ConsumerVirtualCard({ student, card, balance, requiresWallet }: ConsumerVirtualCardProps) {
  const { branding } = useBrand();
  const isActive = student.status === 'active' && card?.status === 'active';
  const backgroundUrl = branding.consumer_card_background_url?.replace(/["'\\\r\n]/g, '');
  const backgroundImageStyle =
    branding.consumer_card_background_mode === 'image' && backgroundUrl
      ? getConsumerCardBackgroundImageStyle(
          backgroundUrl,
          branding.consumer_card_background_transform
        )
      : null;

  return (
    <article className="mx-auto w-full max-w-[410px] select-none">
      <div className="relative aspect-[9/16] min-h-[650px] overflow-hidden rounded-[2.25rem] border border-white/20 text-white shadow-2xl" style={{ backgroundColor: branding.consumer_card_background_color }}>
        {backgroundImageStyle && (
          <div className="pointer-events-none absolute inset-0" style={backgroundImageStyle} />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/30" />
        {branding.consumer_card_elements.logo.visible && <div className="absolute z-10 w-[40%] text-center" style={getConsumerCardElementStyle(branding.consumer_card_layout.logo, branding.consumer_card_elements.logo.zoom)}>
          {branding.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logo_url} alt={branding.app_name} className="mx-auto max-h-16 max-w-full object-contain" />
          ) : (
            <p className="truncate text-xs font-black uppercase tracking-[0.2em] text-white/90">{branding.app_name}</p>
          )}
        </div>}

        {branding.consumer_card_elements.title.visible && <h2 className="absolute z-10 w-[44%] text-center text-xl font-light uppercase leading-tight tracking-wide" style={getConsumerCardElementStyle(branding.consumer_card_layout.title, branding.consumer_card_elements.title.zoom)}>
          Cartão virtual<br /><strong className="font-black">de consumo</strong>
        </h2>}

        {branding.consumer_card_elements.qr.visible && <div className="absolute z-10 w-[74%] max-w-[290px]" style={getConsumerCardElementStyle(branding.consumer_card_layout.qr, branding.consumer_card_elements.qr.zoom)}>
          <DynamicQRCode compact cardId={card?.id} />
        </div>}

        {branding.consumer_card_elements.photo.visible && <div className="absolute z-10 grid h-20 w-20 place-items-center overflow-hidden rounded-full border-4 bg-white text-slate-600 shadow-lg" style={{ ...getConsumerCardElementStyle(branding.consumer_card_layout.photo, branding.consumer_card_elements.photo.zoom), borderColor: branding.consumer_card_accent_color }}>
          {student.photoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={student.photoPath} alt={student.fullName} className="h-full w-full object-cover" />
          ) : student.fullName ? (
            <span className="text-xl font-black">{getInitials(student.fullName)}</span>
          ) : (
            <User className="h-9 w-9" />
          )}
        </div>}

        {branding.consumer_card_elements.name.visible && <div className="absolute z-10 w-[58%] rounded-2xl bg-black/20 p-3 text-center backdrop-blur-md" style={getConsumerCardElementStyle(branding.consumer_card_layout.name, branding.consumer_card_elements.name.zoom)}>
          <h3 className="truncate text-lg font-black">{student.fullName}</h3>
          <p className="mt-0.5 truncate font-mono text-xs text-white/80">{student.registrationNumber}</p>
          {(student.course || student.institutionName) && (
            <p className="mt-2 line-clamp-2 text-[10px] text-white/75">
              {[student.course, student.institutionName].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>}

        {branding.consumer_card_elements.status.visible && <div className="absolute z-10 flex max-w-[58%] flex-wrap items-center justify-center gap-1.5" style={getConsumerCardElementStyle(branding.consumer_card_layout.status, branding.consumer_card_elements.status.zoom)}>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-black ${isActive ? 'bg-emerald-500 text-emerald-950' : 'bg-slate-900/80 text-white'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-950' : 'bg-slate-400'}`} />
            {isActive ? 'ATIVO' : 'INATIVO'}
          </span>
          <span className="max-w-full truncate rounded-full bg-white/15 px-2 py-1 text-[9px] font-bold">{student.categoryName}</span>
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
}
