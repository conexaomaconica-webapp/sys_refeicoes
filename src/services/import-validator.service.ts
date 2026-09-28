import 'server-only';
import { ImportMode, ImportPreviewRow, ImportRowAction, NormalizedImportData } from '@/types/import';

export interface CategoryLookup {
  id: string;
  code: string;
  name: string;
}

export interface ExistingStudentLookup {
  id: string;
  registration_number: string;
  full_name: string;
  category_id: string;
  category_code: string;
  course?: string;
  email?: string;
  phone?: string;
  status: string;
  updated_at: string;
}

export interface ValidationContext {
  tenant_id: string;
  institution_id: string;
  import_mode: ImportMode;
  is_official_snapshot: boolean;
  categories: CategoryLookup[];
  existingStudents: ExistingStudentLookup[];
  allTenantEmails: Set<string>;
}

/**
 * Validador e Classificador do Preview de Importação
 */
export function validateAndClassifyRows(
  parsedRows: {
    row_number: number;
    raw_data: Record<string, unknown>;
    normalized: NormalizedImportData;
  }[],
  context: ValidationContext
): ImportPreviewRow[] {
  const previewRows: ImportPreviewRow[] = [];
  const seenRegistrations = new Map<string, number>(); // registration_number -> row_number
  const fileRegistrations = new Set<string>();

  // Mapear categorias ativas por slug/código e por nome (case-insensitive)
  const categoryMapByCode = new Map<string, CategoryLookup>();
  const categoryMapByName = new Map<string, CategoryLookup>();
  let defaultPartialCategory: CategoryLookup | undefined;
  let integralCategory: CategoryLookup | undefined;

  context.categories.forEach(cat => {
    categoryMapByCode.set(cat.code.toLowerCase(), cat);
    categoryMapByName.set(cat.name.toLowerCase(), cat);
    if (cat.code.toLowerCase() === 'partial') defaultPartialCategory = cat;
    if (cat.code.toLowerCase() === 'integral') integralCategory = cat;
  });

  // Mapear alunos existentes por matrícula para busca O(1)
  const studentMapByReg = new Map<string, ExistingStudentLookup>();
  context.existingStudents.forEach(st => {
    studentMapByReg.set(st.registration_number, st);
  });

  // 1. Processar linhas enviadas no arquivo
  parsedRows.forEach(item => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const norm = item.normalized;
    let action: ImportRowAction = 'error';

    // A. Validação de Matrícula
    if (!norm.registration_number) {
      errors.push('Matrícula é obrigatória e não pode estar em branco.');
    } else {
      fileRegistrations.add(norm.registration_number);
      if (seenRegistrations.has(norm.registration_number)) {
        errors.push(`Matrícula duplicada dentro do próprio arquivo (já vista na linha ${seenRegistrations.get(norm.registration_number)}).`);
      } else {
        seenRegistrations.set(norm.registration_number, item.row_number);
      }
    }

    // B. Validação de Nome
    if (!norm.full_name) {
      errors.push('Nome completo do aluno é obrigatório.');
    } else if (norm.full_name.length < 3) {
      errors.push('Nome completo deve possuir no mínimo 3 caracteres.');
    }

    // C. Validação de Categoria
    let resolvedCategory: CategoryLookup | undefined;
    if (norm.category_code) {
      resolvedCategory = categoryMapByCode.get(norm.category_code) || categoryMapByName.get(norm.category_code);
      if (!resolvedCategory) {
        errors.push(`Categoria '${norm.category_code}' não encontrada no cadastro do Tenant.`);
      } else {
        norm.category_id = resolvedCategory.id;
      }
    } else {
      // Se a categoria estiver em branco no Modo Geral, erro. No Modo Integrais, assume 'integral'.
      if (context.import_mode === 'integral_snapshot') {
        resolvedCategory = integralCategory;
        if (resolvedCategory) {
          norm.category_id = resolvedCategory.id;
          norm.category_code = resolvedCategory.code;
        } else {
          errors.push("Categoria 'integral' não está configurada no Tenant.");
        }
      } else {
        errors.push('Categoria do aluno é obrigatória na importação geral.');
      }
    }

    // D. Validação de E-mail (Aviso, NÃO impede a importação)
    if (norm.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(norm.email)) {
        errors.push(`Formato de e-mail inválido ('${norm.email}').`);
      } else if (context.allTenantEmails.has(norm.email)) {
        warnings.push(`O e-mail '${norm.email}' já consta cadastrado no sistema.`);
      }
    }

    // E. Validação de Status Acadêmico
    if (norm.academic_status) {
      const validStatuses = ['active', 'inactive', 'suspended', 'cancelled', 'graduated'];
      if (!validStatuses.includes(norm.academic_status)) {
        errors.push(`Status acadêmico inválido ('${norm.academic_status}').`);
      }
    }

    // Classificação da Linha se não houver erros impeditivos
    let existingStudent: ExistingStudentLookup | undefined;
    let beforeSnapshot: Record<string, unknown> | undefined;

    if (errors.length === 0) {
      existingStudent = studentMapByReg.get(norm.registration_number);

      if (!existingStudent) {
        // Aluno Novo -> INSERT
        action = 'insert';
        if (!norm.academic_status) {
          norm.academic_status = 'active';
        }
      } else {
        // Aluno Existente -> UPDATE ou IGNORE
        beforeSnapshot = {
          id: existingStudent.id,
          registration_number: existingStudent.registration_number,
          full_name: existingStudent.full_name,
          category_id: existingStudent.category_id,
          category_code: existingStudent.category_code,
          course: existingStudent.course || '',
          email: existingStudent.email || '',
          phone: existingStudent.phone || '',
          status: existingStudent.status,
          updated_at: existingStudent.updated_at
        };

        const targetCatId = norm.category_id || existingStudent.category_id;
        const targetStatus = norm.academic_status || existingStudent.status;

        const hasDiff = 
          norm.full_name !== existingStudent.full_name ||
          targetCatId !== existingStudent.category_id ||
          (norm.course !== undefined && norm.course !== (existingStudent.course || '')) ||
          (norm.email !== undefined && norm.email !== (existingStudent.email || '')) ||
          (norm.phone !== undefined && norm.phone !== (existingStudent.phone || '')) ||
          targetStatus !== existingStudent.status;

        if (hasDiff) {
          action = 'update';
        } else {
          action = 'ignore';
        }
      }
    }

    previewRows.push({
      row_number: item.row_number,
      registration_number: norm.registration_number || '',
      full_name: norm.full_name || '',
      action,
      status: 'pending',
      raw_data: item.raw_data,
      normalized_data: norm,
      errors,
      warnings,
      student_id: existingStudent?.id,
      before_snapshot: beforeSnapshot
    });
  });

  // 2. Tratar Modo Oficial Snapshot de Integrais (Reclassificação de Ausentes)
  if (context.import_mode === 'integral_snapshot' && context.is_official_snapshot && defaultPartialCategory && integralCategory) {
    let nextRowNumber = parsedRows.length > 0 ? Math.max(...parsedRows.map(r => r.row_number)) + 1 : 1;

    context.existingStudents.forEach(st => {
      // Se o aluno era 'integral' e NÃO constou no arquivo enviado
      if (st.category_id === integralCategory?.id && !fileRegistrations.has(st.registration_number)) {
        const norm: NormalizedImportData = {
          registration_number: st.registration_number,
          full_name: st.full_name,
          category_code: defaultPartialCategory?.code,
          category_id: defaultPartialCategory?.id,
          academic_status: st.status as NormalizedImportData['academic_status']
        };

        previewRows.push({
          row_number: nextRowNumber++,
          registration_number: st.registration_number,
          full_name: st.full_name,
          action: 'reclassify_partial',
          status: 'pending',
          raw_data: {
            origem: 'SISTEMA_RECLASSIFICACAO_AUTOMATICA',
            motivo: 'Aluno ausente da relação oficial de integrais submetida'
          },
          normalized_data: norm,
          errors: [],
          warnings: ['Aluno reclassificado para PARCIAL por não constar na lista oficial enviada.'],
          student_id: st.id,
          before_snapshot: {
            id: st.id,
            registration_number: st.registration_number,
            full_name: st.full_name,
            category_id: st.category_id,
            category_code: st.category_code,
            status: st.status,
            updated_at: st.updated_at
          }
        });
      }
    });
  }

  return previewRows;
}
