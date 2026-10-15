'use client';

import React, { useState } from 'react';
import { User, QrCode, CreditCard, Shield, Sparkles, Building2, BookOpen } from 'lucide-react';
import { DynamicQRCode } from './DynamicQRCode';
import type { Card } from '@/types/card';

interface StudentCardProps {
  student: {
    id: string;
    full_name: string;
    registration_number: string;
    course?: string | null;
    photo_path?: string | null;
    institution_name?: string;
    category: {
      name: string;
      code: string;
      is_integral: boolean;
    };
  };
  card?: Card | null;
  initialQRToken?: {
    payload: string;
    expires_at: string;
    ttl_seconds: number;
  };
}

export const StudentCard: React.FC<StudentCardProps> = ({
  student,
  card,
  initialQRToken,
}) => {
  const [showQR, setShowQR] = useState<boolean>(true);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('');
  };

  return (
    <div className="w-full max-w-sm mx-auto select-none">
      {/* Cartão Estilizado */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 p-6 text-white shadow-2xl border border-slate-700/60 backdrop-blur-xl">
        {/* Glow de Fundo */}
        <div className="absolute -top-16 -right-16 w-44 h-44 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-44 h-44 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />

        {/* Cabeçalho Institucional */}
        <div className="flex items-start justify-between border-b border-slate-700/50 pb-4 mb-4">
          <div>
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold tracking-wider uppercase text-slate-300">
                MA Refeições
              </span>
            </div>
            <h2 className="text-sm font-semibold text-white tracking-wide">Carteirinha Digital</h2>
          </div>
          <div className="flex items-center gap-1 bg-slate-800/80 px-2.5 py-1 rounded-full border border-slate-700 text-[11px] font-medium text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>{card?.status === 'active' ? 'Ativa' : 'Cadastrada'}</span>
          </div>
        </div>

        {/* Bloco Central: Foto, Nome e Matrícula em Destaque */}
        <div className="flex items-center gap-4 mb-4">
          {/* Foto com Fallback de Iniciais */}
          <div className="relative w-16 h-16 rounded-2xl overflow-hidden bg-slate-800 border-2 border-slate-600 flex items-center justify-center shrink-0 shadow-md">
            {student.photo_path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={student.photo_path}
                alt={student.full_name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-slate-300">
                {student.full_name ? (
                  <span className="text-base font-bold tracking-wider">{getInitials(student.full_name)}</span>
                ) : (
                  <User className="w-8 h-8 text-slate-400" />
                )}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-white truncate leading-tight">
              {student.full_name}
            </h3>
            {student.institution_name && (
              <div className="flex items-center gap-1 text-xs text-slate-400 truncate mt-0.5">
                <Building2 className="w-3 h-3 shrink-0" />
                <span className="truncate">{student.institution_name}</span>
              </div>
            )}
            {student.course && (
              <div className="flex items-center gap-1 text-xs text-slate-400 truncate mt-0.5">
                <BookOpen className="w-3 h-3 shrink-0" />
                <span className="truncate">{student.course}</span>
              </div>
            )}
          </div>
        </div>

        {/* MATRÍCULA OPERACIONAL EM DESTAQUE (Identificador Principal) */}
        <div className="bg-slate-950/70 rounded-2xl p-3.5 border border-slate-800 mb-4 shadow-inner">
          <div className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
            Matrícula Principal
          </div>
          <div className="text-xl font-mono font-extrabold text-emerald-400 tracking-widest mt-0.5">
            {student.registration_number}
          </div>
        </div>

        {/* Tag da Categoria */}
        <div className="flex items-center justify-between mb-4">
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
              student.category.is_integral
                ? 'bg-purple-900/40 text-purple-300 border border-purple-700/50'
                : 'bg-cyan-900/40 text-cyan-300 border border-cyan-700/50'
            }`}
          >
            <Shield className="w-3 h-3" />
            <span>{student.category.name || (student.category.is_integral ? 'Integral / Bolsista' : 'Parcial')}</span>
          </div>

          {/* Botão de Alternância QR / Dados */}
          <button
            type="button"
            onClick={() => setShowQR((prev) => !prev)}
            className="flex items-center gap-1 text-xs text-slate-300 hover:text-white bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700 transition"
          >
            {showQR ? (
              <>
                <CreditCard className="w-3.5 h-3.5 text-cyan-400" />
                <span>Ocultar QR</span>
              </>
            ) : (
              <>
                <QrCode className="w-3.5 h-3.5 text-emerald-400" />
                <span>Exibir QR</span>
              </>
            )}
          </button>
        </div>

        {/* QR Code Dinâmico Embutido */}
        {showQR && (
          <div className="pt-2">
            <DynamicQRCode
              cardId={card?.id}
              initialPayload={initialQRToken?.payload}
              initialExpiresAt={initialQRToken?.expires_at}
              initialTtlSeconds={initialQRToken?.ttl_seconds}
            />
          </div>
        )}

        {/* Rodapé do Cartão */}
        <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-400 font-mono">
          <span>{card?.card_number || 'CARTEIRINHA DIGITAL'}</span>
          <span>USO PESSOAL</span>
        </div>
      </div>
    </div>
  );
};
