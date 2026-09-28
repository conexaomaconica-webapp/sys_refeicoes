/**
 * Sanitizador de Segurança contra CSV/Excel Formula Injection
 * 
 * Regra Arquitetural da Sprint 4:
 * 1. Durante a IMPORTAÇÃO: O dado é lido literalmente e mantido em sua forma canônica.
 *    NUNCA insere prefixo `'` permanentemente no banco de dados.
 * 2. Durante a EXPORTAÇÃO (geração de CSV/Excel): Qualquer campo cujo texto inicie
 *    por '=', '+', '-', '@', '\t' (Tab) ou '\r' (Carriage Return) deve ser neutralizado
 *    adicionando uma aspa simples (') no início da célula do arquivo exportado.
 */

const FORMULA_START_CHARS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Sanitiza um valor individual para exportação segura em CSV ou Excel.
 */
export function sanitizeCellForExport(val: unknown): string {
  if (val === null || val === undefined) {
    return '';
  }

  const str = String(val);
  
  if (str.length === 0) {
    return '';
  }

  const firstChar = str.charAt(0);
  if (FORMULA_START_CHARS.includes(firstChar)) {
    return `'${str}`;
  }

  return str;
}

/**
 * Sanitiza uma linha inteira de dados para exportação em CSV.
 */
export function sanitizeRowForExport(row: Record<string, unknown>): Record<string, string> {
  const sanitizedRow: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    sanitizedRow[key] = sanitizeCellForExport(value);
  }
  return sanitizedRow;
}
