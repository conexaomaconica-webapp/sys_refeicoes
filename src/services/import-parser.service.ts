import 'server-only';
import * as XLSX from 'xlsx';
import crypto from 'crypto';
import { NormalizedImportData } from '@/types/import';

// Limites de Segurança (Decompression Bomb & Limits)
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ROWS_LIMIT = 10000;
export const MAX_SHEETS_LIMIT = 5;
export const MAX_CELLS_LIMIT = 100000;

// Mapa estático de Aliases de Cabeçalho (Sem heurísticas cegas)
const HEADER_ALIASES: Partial<Record<keyof NormalizedImportData, string[]>> = {
  registration_number: ['matricula', 'matrícula', 'registration_number', 'cod_aluno', 'codigo_aluno', 'ra', 'registro'],
  full_name: ['nome', 'nome_completo', 'full_name', 'aluno', 'estudante'],
  category_code: ['categoria', 'category', 'tipo_bolsa', 'tipo_aluno', 'modalidade'],
  course: ['curso', 'course', 'graduacao', 'programa'],
  email: ['email', 'e-mail', 'mail'],
  phone: ['telefone', 'celular', 'phone', 'contato', 'whatsapp'],
  academic_status: ['status', 'situacao', 'situaçao', 'situacao_academica', 'academic_status']
};

export interface ParsedSheetData {
  file_hash: string;
  file_size_bytes: number;
  total_rows: number;
  rows: {
    row_number: number;
    raw_data: Record<string, unknown>;
    normalized: NormalizedImportData;
  }[];
}

/**
 * Normaliza o cabeçalho de uma coluna para a chave canônica correspondente.
 */
function normalizeHeaderName(header: string): keyof NormalizedImportData | null {
  const cleanHeader = header.trim().toLowerCase().replace(/\s+/g, '_');
  
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases && aliases.includes(cleanHeader)) {
      return key as keyof NormalizedImportData;
    }
  }
  return null;
}

/**
 * Sanitiza e normaliza o valor da matrícula preservando ZEROS À ESQUERDA.
 * NUNCA converte para Number.
 */
function normalizeRegistrationNumber(rawVal: unknown): string {
  if (rawVal === null || rawVal === undefined) {
    return '';
  }
  
  // Garantir tipo String pura
  let strVal = String(rawVal);
  
  // Remover apenas espaços nas extremidades (trim)
  strVal = strVal.trim();
  
  return strVal;
}

/**
 * Parser Server-Side Seguro para planilhas .xlsx e .csv
 */
export async function parseImportBuffer(
  buffer: Buffer
): Promise<ParsedSheetData> {
  const fileSize = buffer.length;

  if (fileSize > MAX_FILE_SIZE_BYTES) {
    throw new Error(`Arquivo excede o limite máximo permitido de 10 MB (Tamanho: ${(fileSize / (1024 * 1024)).toFixed(2)} MB).`);
  }

  // Calcular Hash SHA-256 do arquivo original
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

  // Ler o workbook via XLSX com parsing seguro em memória
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    raw: true, // Preserva valores literais sem avaliar fórmulas
    cellText: true,
    cellDates: false
  });

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('O arquivo submetido não contém planilhas válidas.');
  }

  if (workbook.SheetNames.length > MAX_SHEETS_LIMIT) {
    throw new Error(`O arquivo excede o limite de ${MAX_SHEETS_LIMIT} abas (sheets).`);
  }

  // Utilizar a primeira aba do arquivo
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    throw new Error('Não foi possível acessar os dados da primeira aba da planilha.');
  }

  // Converter para matriz de células brutas
  const matrix: unknown[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: true,
    defval: ''
  });

  if (matrix.length === 0) {
    throw new Error('A planilha está vazia.');
  }

  // Linha 0 = Cabeçalho
  const headerRow = matrix[0].map(cell => String(cell || '').trim());
  if (headerRow.length === 0 || headerRow.every(h => h === '')) {
    throw new Error('A planilha não possui um cabeçalho válido na primeira linha.');
  }

  // Mapear colunas do cabeçalho
  const colMap: Map<number, keyof NormalizedImportData> = new Map();
  headerRow.forEach((colName, index) => {
    const canonicalKey = normalizeHeaderName(colName);
    if (canonicalKey) {
      colMap.set(index, canonicalKey);
    }
  });

  if (!Array.from(colMap.values()).includes('registration_number')) {
    throw new Error('Coluna obrigatória de matrícula (registration_number / matricula) não encontrada no cabeçalho da planilha.');
  }

  if (!Array.from(colMap.values()).includes('full_name')) {
    throw new Error('Coluna obrigatória de nome (full_name / nome) não encontrada no cabeçalho da planilha.');
  }

  const dataRows = matrix.slice(1);
  if (dataRows.length > MAX_ROWS_LIMIT) {
    throw new Error(`A planilha excede o limite máximo de ${MAX_ROWS_LIMIT} linhas (Total: ${dataRows.length} linhas).`);
  }

  const totalCells = dataRows.length * headerRow.length;
  if (totalCells > MAX_CELLS_LIMIT) {
    throw new Error(`A planilha excede o limite total de ${MAX_CELLS_LIMIT} células.`);
  }

  const parsedRows: ParsedSheetData['rows'] = [];

  dataRows.forEach((row, rowIndex) => {
    // Ignorar linhas completamente vazias
    if (row.every(cell => cell === null || cell === undefined || String(cell).trim() === '')) {
      return;
    }

    const rowNumber = rowIndex + 2; // 1-indexed, considerando cabeçalho na linha 1
    const rawData: Record<string, unknown> = {};
    const normalized: NormalizedImportData = {
      registration_number: '',
      full_name: ''
    };

    headerRow.forEach((hName, cIdx) => {
      if (hName) {
        rawData[hName] = row[cIdx] !== undefined ? row[cIdx] : '';
      }
    });

    colMap.forEach((canonicalKey, colIdx) => {
      const rawVal = row[colIdx];
      if (canonicalKey === 'registration_number') {
        normalized.registration_number = normalizeRegistrationNumber(rawVal);
      } else if (canonicalKey === 'full_name') {
        normalized.full_name = String(rawVal || '').trim();
      } else if (canonicalKey === 'category_code') {
        normalized.category_code = String(rawVal || '').trim().toLowerCase();
      } else if (canonicalKey === 'course') {
        normalized.course = String(rawVal || '').trim();
      } else if (canonicalKey === 'email') {
        normalized.email = String(rawVal || '').trim().toLowerCase();
      } else if (canonicalKey === 'phone') {
        normalized.phone = String(rawVal || '').trim();
      } else if (canonicalKey === 'academic_status') {
        const rawStatus = String(rawVal || '').trim().toLowerCase();
        if (['active', 'ativo'].includes(rawStatus)) normalized.academic_status = 'active';
        else if (['inactive', 'inativo'].includes(rawStatus)) normalized.academic_status = 'inactive';
        else if (['suspended', 'suspenso'].includes(rawStatus)) normalized.academic_status = 'suspended';
        else if (['cancelled', 'cancelado'].includes(rawStatus)) normalized.academic_status = 'cancelled';
        else if (['graduated', 'formado', 'graduado'].includes(rawStatus)) normalized.academic_status = 'graduated';
        else if (rawStatus) normalized.academic_status = rawStatus as NormalizedImportData['academic_status'];
      }
    });

    parsedRows.push({
      row_number: rowNumber,
      raw_data: rawData,
      normalized
    });
  });

  return {
    file_hash: fileHash,
    file_size_bytes: fileSize,
    total_rows: parsedRows.length,
    rows: parsedRows
  };
}
