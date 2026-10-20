'use server';

import { AdminImportService } from '@/services/admin-import.service';
import type { ImportMode, ImportPreviewResult } from '@/types/import';

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'Erro inesperado durante a importação.';
}

export async function createImportPreviewAction(formData: FormData): Promise<ActionResult<ImportPreviewResult>> {
  try {
    const file = formData.get('file');
    const institutionId = String(formData.get('institutionId') || '');
    const unitId = String(formData.get('unitId') || '');
    const importMode = String(formData.get('importMode') || 'general') as ImportMode;
    const effectiveDate = String(formData.get('effectiveDate') || '');
    const officialListConfirmed = formData.get('isOfficialSnapshot') === 'true';

    if (!(file instanceof File) || file.size === 0) throw new Error('Selecione um arquivo XLSX ou CSV.');
    if (!institutionId) throw new Error('Selecione a instituição.');
    if (!unitId) throw new Error('Selecione a unidade de origem da listagem.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error('Informe uma data de vigência válida.');
    if (!['general', 'integral_snapshot'].includes(importMode)) throw new Error('Modo de importação inválido.');
    if (importMode === 'integral_snapshot' && !officialListConfirmed) {
      throw new Error('A relação de integrais precisa ser confirmada como lista oficial.');
    }

    const data = await AdminImportService.createImportPreview({
      institutionId,
      unitId,
      importMode,
      effectiveDate,
      isOfficialSnapshot: importMode === 'integral_snapshot',
      fileBuffer: Buffer.from(await file.arrayBuffer()),
      originalFilename: file.name,
    });
    return { success: true, data };
  } catch (error) {
    return { success: false, error: messageFrom(error) };
  }
}

export async function confirmImportAction(importId: string) {
  try {
    return { success: true as const, data: await AdminImportService.confirmImport(importId) };
  } catch (error) {
    return { success: false as const, error: messageFrom(error) };
  }
}

export async function cancelImportAction(importId: string) {
  try {
    await AdminImportService.cancelImport(importId);
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: messageFrom(error) };
  }
}
