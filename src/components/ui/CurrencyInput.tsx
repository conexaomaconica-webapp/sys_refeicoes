'use client';

import React from 'react';
import { applyBRLDigitMask, formatDecimalStringToBRLDisplay } from '@/lib/currency';

export interface CurrencyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> {
  /** Valor em string decimal ("12.50", "20", "") */
  value: string;
  /** Retorna string decimal normalizada ("12.50" ou "") */
  onValueChange: (decimalValue: string) => void;
  /** Permite string vazia quando zerado/apagado (padrão: true) */
  allowEmpty?: boolean;
}

/**
 * Campo monetário com máscara automática em Real (R$ 0,00).
 * Trabalha em centavos da direita para a esquerda e emite string decimal compatível com Number/parseFloat.
 */
export function CurrencyInput({
  value,
  onValueChange,
  allowEmpty = true,
  placeholder = 'R$ 0,00',
  onKeyDown,
  ...rest
}: CurrencyInputProps) {
  const displayValue = formatDecimalStringToBRLDisplay(value, allowEmpty);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const masked = applyBRLDigitMask(raw, allowEmpty);
    onValueChange(masked.decimalString);
  };

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      value={displayValue}
      placeholder={placeholder}
      onChange={handleChange}
      onKeyDown={onKeyDown}
    />
  );
}

