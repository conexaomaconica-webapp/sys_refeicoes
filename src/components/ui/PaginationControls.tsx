'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PaginationControlsProps {
  totalItems: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
  itemLabel?: string;
  compact?: boolean;
  className?: string;
}

export function PaginationControls({
  totalItems,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  itemLabel = 'resultado(s)',
  compact = false,
  className = '',
}: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const startItem = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endItem = Math.min(totalItems, safePage * pageSize);

  return (
    <div
      className={`flex flex-col items-center justify-between gap-3 border-t border-slate-100 ${
        compact ? 'pt-3 text-xs' : 'pt-4 text-sm'
      } sm:flex-row ${className}`}
    >
      <div className="flex flex-wrap items-center gap-3 text-slate-600">
        <span>
          Exibindo <strong>{startItem}</strong>–<strong>{endItem}</strong> de{' '}
          <strong>{totalItems}</strong> {itemLabel}
        </span>

        <label className="inline-flex items-center gap-1.5 text-slate-600">
          <span>Mostrar</span>
          <select
            value={pageSize}
            onChange={(event) => {
              const nextSize = Number(event.target.value);
              onPageSizeChange(nextSize);
              onPageChange(1);
            }}
            aria-label="Quantidade de registros por página"
            className={`rounded-lg border border-slate-300 bg-white font-bold text-slate-800 outline-none focus:border-slate-500 ${
              compact ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-sm'
            }`}
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <span>por página</span>
        </label>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-slate-500">
          Página <strong>{safePage}</strong> de <strong>{totalPages}</strong>
        </span>
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          className={`inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 ${
            compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
          }`}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Anterior
        </button>
        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
          className={`inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 ${
            compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
          }`}
        >
          Próxima
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

