const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const brlNumberFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formata um valor numérico em moeda Real brasileira (ex.: R$ 1.234,56).
 */
export function formatBRL(value: number | null | undefined): string {
  const num = Number(value ?? 0);
  return brlFormatter.format(Number.isFinite(num) ? num : 0);
}

/**
 * Converte string numérica ("12.50", "12,50", "R$ 1.234,56") em número decimal seguro.
 */
export function parseCurrencyString(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;

  if (trimmed.includes(',')) {
    const cleaned = trimmed.replace(/[R$\s.]/g, '').replace(',', '.');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const cleaned = trimmed.replace(/[R$\s]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Formata uma string decimal ("50.00" ou "50") para exibição com máscara "R$ 50,00".
 * Mantém vazio se allowEmpty e entrada vazia.
 */
export function formatDecimalStringToBRLDisplay(value: string, allowEmpty = true): string {
  const trimmed = value.trim();
  if (!trimmed && allowEmpty) return '';
  const num = parseCurrencyString(trimmed);
  return `R$ ${brlNumberFormatter.format(Math.max(0, num))}`;
}

/**
 * Aplica máscara de centavos digitados (da direita para a esquerda):
 * Digitar "1250" gera display "R$ 12,50" e decimalString "12.50".
 */
export function applyBRLDigitMask(rawInput: string, allowEmpty = true): {
  display: string;
  decimalString: string;
  numeric: number;
} {
  const digits = rawInput.replace(/\D/g, '');
  if (!digits) {
    return allowEmpty
      ? { display: '', decimalString: '', numeric: 0 }
      : { display: 'R$ 0,00', decimalString: '0.00', numeric: 0 };
  }

  const cents = Number(digits);
  if (!Number.isSafeInteger(cents)) {
    return { display: 'R$ 0,00', decimalString: '0.00', numeric: 0 };
  }

  const numeric = cents / 100;
  return {
    display: `R$ ${brlNumberFormatter.format(numeric)}`,
    decimalString: numeric.toFixed(2),
    numeric,
  };
}

