'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface PrintDocumentMetadata {
  label: string;
  value: React.ReactNode;
}

interface PrintDocumentProps {
  title: string;
  companyName: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  metadata?: PrintDocumentMetadata[];
  issuedAt: Date;
  footerText?: string;
  variant?: 'report' | 'receipt';
  children: React.ReactNode;
}

const formatDateTime = (value: Date) =>
  value.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium',
  });

export function PrintDocument({
  title,
  companyName,
  logoUrl,
  primaryColor = '#C5161D',
  metadata = [],
  issuedAt,
  footerText,
  variant = 'report',
  children,
}: PrintDocumentProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const initials = companyName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');

  return createPortal(
    <article
      className={`print-document-root print-document-root--${variant}`}
      style={{ '--print-primary': primaryColor || '#C5161D' } as React.CSSProperties}
      aria-hidden="true"
    >
      <header className="print-document-header">
        <div className="print-document-brand">
          {logoUrl ? (
            // A URL pertence ao branding do tenant e pode apontar para o Storage.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={`Logo ${companyName}`} />
          ) : (
            <div className="print-document-brand-fallback">{initials || 'MA'}</div>
          )}
          <div>
            <strong>{companyName}</strong>
            <span>Documento emitido pelo sistema de gestão de refeições</span>
          </div>
        </div>
        <div className="print-document-title">
          <span>{variant === 'receipt' ? 'Comprovante' : 'Relatório'}</span>
          <h1>{title}</h1>
        </div>
      </header>

      {metadata.length > 0 && (
        <dl className="print-document-metadata">
          {metadata.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value || 'Não informado'}</dd>
            </div>
          ))}
        </dl>
      )}

      <main className="print-document-content">{children}</main>

      <footer className="print-document-footer">
        <span>{footerText || `${companyName} • Documento para conferência e auditoria`}</span>
        <span>Emitido em {formatDateTime(issuedAt)}</span>
      </footer>
    </article>,
    document.body
  );
}
