import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { ImportMode, ImportPreviewResult, ImportRecord, ImportRowRecord } from '@/types/import';
import { parseImportBuffer } from './import-parser.service';
import { validateAndClassifyRows, CategoryLookup, ExistingStudentLookup } from './import-validator.service';
import { sanitizeCellForExport } from '@/lib/security/formula-sanitizer';

export interface StageImportParams {
  institutionId: string;
  importMode: ImportMode;
  isOfficialSnapshot: boolean;
  forceReimport?: boolean;
  fileBuffer: Buffer;
  originalFilename: string;
}

/**
 * Serviço Server-Only de Administração de Importações por Planilha
 */
export class AdminImportService {

  /**
   * Executa parsing, validação contra o banco, staging e gera o Preview completo.
   */
  static async createImportPreview(params: StageImportParams): Promise<ImportPreviewResult> {
    const supabase = await createClient();

    // 1. Verificar autenticação e permissões server-side
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('Usuário não autenticado.');
    }

    const { data: rawProfile } = await supabase
      .from('profiles')
      .select('id, tenant_id, role, status')
      .eq('id', user.id)
      .single();

    const profile = rawProfile as unknown as { id: string; tenant_id: string; role: string; status: string } | null;

    if (!profile || profile.status !== 'active') {
      throw new Error('Perfil de usuário inativo ou não encontrado.');
    }

    if (!['admin_general', 'operations_director'].includes(profile.role)) {
      throw new Error('Acesso negado: Apenas diretores e administradores podem importar planilhas.');
    }

    const tenantId = profile.tenant_id;

    // 2. Parsing Seguro da Planilha em Memória
    const parsedData = await parseImportBuffer(params.fileBuffer);

    // 3. Buscar Categorias do Tenant no Banco
    const { data: categoriesData, error: catError } = await supabase
      .from('student_categories')
      .select('id, code, name')
      .eq('tenant_id', tenantId);

    if (catError || !categoriesData) {
      throw new Error(`Erro ao carregar categorias do tenant: ${catError?.message || 'Dados ausentes'}`);
    }

    const categories: CategoryLookup[] = (categoriesData as unknown as { id: string; code: string; name: string }[]).map(c => ({
      id: c.id,
      code: c.code,
      name: c.name
    }));

    // 4. Buscar Alunos Existentes da Instituição no Banco
    const { data: studentsData, error: stError } = await supabase
      .from('students')
      .select(`
        id,
        registration_number,
        full_name,
        category_id,
        course,
        email,
        phone,
        status,
        updated_at,
        student_categories ( code )
      `)
      .eq('tenant_id', tenantId)
      .eq('institution_id', params.institutionId);

    if (stError) {
      throw new Error(`Erro ao consultar alunos existentes: ${stError.message}`);
    }

    const existingStudents: ExistingStudentLookup[] = (studentsData || []).map((s: Record<string, unknown>) => {
      const catObj = s.student_categories as { code: string } | null;
      return {
        id: s.id as string,
        registration_number: s.registration_number as string,
        full_name: s.full_name as string,
        category_id: s.category_id as string,
        category_code: catObj?.code || '',
        course: (s.course as string) || '',
        email: (s.email as string) || '',
        phone: (s.phone as string) || '',
        status: s.status as string,
        updated_at: s.updated_at as string
      };
    });

    // 5. Buscar todos os e-mails de alunos do tenant para validação de unicidade
    const { data: emailsData } = await supabase
      .from('students')
      .select('email')
      .eq('tenant_id', tenantId)
      .not('email', 'is', null);

    const allTenantEmails = new Set<string>(
      (emailsData || []).map((e: Record<string, unknown>) => (e.email as string | null)?.toLowerCase() || '').filter(Boolean)
    );

    // 6. Validar e Classificar Linhas do Preview
    const previewRows = validateAndClassifyRows(parsedData.rows, {
      tenant_id: tenantId,
      institution_id: params.institutionId,
      import_mode: params.importMode,
      is_official_snapshot: params.isOfficialSnapshot,
      categories,
      existingStudents,
      allTenantEmails
    });

    // 7. Salvar arquivo original no Bucket Privado 'import-files' com Path Canônico
    // Path Canônico: {tenant_id}/{institution_id}/{temp_hash}/original.{xlsx|csv}
    const extension = params.originalFilename.endsWith('.csv') ? 'csv' : 'xlsx';
    const storagePath = `${tenantId}/${params.institutionId}/${parsedData.file_hash.substring(0, 16)}_${Date.now()}/original.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from('import-files')
      .upload(storagePath, params.fileBuffer, {
        contentType: extension === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: true
      });

    if (uploadError) {
      throw new Error(`Erro ao armazenar arquivo no bucket privado: ${uploadError.message}`);
    }

    // 8. Chamar RPC Server-Side stage_import_batch para salvar o manifesto
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: importId, error: rpcError } = await (supabase.rpc as any)('stage_import_batch', {
      p_institution_id: params.institutionId,
      p_import_mode: params.importMode,
      p_original_filename: params.originalFilename,
      p_storage_path: storagePath,
      p_file_hash: parsedData.file_hash,
      p_file_size_bytes: parsedData.file_size_bytes,
      p_is_official_snapshot: params.isOfficialSnapshot,
      p_force_reimport: !!params.forceReimport,
      p_rows: previewRows
    });

    if (rpcError) {
      throw new Error(`Erro no staging da importação: ${rpcError.message}`);
    }

    // Calcular resumo das métricas
    const summary = {
      total_rows: previewRows.length,
      valid_rows: previewRows.filter(r => ['insert', 'update', 'reclassify_partial'].includes(r.action)).length,
      insert_rows: previewRows.filter(r => r.action === 'insert').length,
      update_rows: previewRows.filter(r => r.action === 'update').length,
      reclassify_rows: previewRows.filter(r => r.action === 'reclassify_partial').length,
      ignored_rows: previewRows.filter(r => r.action === 'ignore').length,
      error_rows: previewRows.filter(r => r.action === 'error').length
    };

    return {
      import_id: importId as string,
      tenant_id: tenantId,
      institution_id: params.institutionId,
      import_mode: params.importMode,
      original_filename: params.originalFilename,
      file_hash: parsedData.file_hash,
      file_size_bytes: parsedData.file_size_bytes,
      is_official_snapshot: params.isOfficialSnapshot,
      summary,
      rows: previewRows
    };
  }

  /**
   * Confirma e executa o processamento do lote com base estrita no manifesto persistido.
   */
  static async confirmImport(importId: string): Promise<{
    import_id: string;
    status: string;
    processed: number;
    failed: number;
    skipped: number;
  }> {
    const supabase = await createClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: result, error } = await (supabase.rpc as any)('confirm_and_process_import', {
      p_import_id: importId
    });

    if (error) {
      throw new Error(`Erro na execução da importação: ${error.message}`);
    }

    return result as {
      import_id: string;
      status: string;
      processed: number;
      failed: number;
      skipped: number;
    };
  }

  /**
   * Cancela uma importação em preview.
   */
  static async cancelImport(importId: string): Promise<boolean> {
    const supabase = await createClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: success, error } = await (supabase.rpc as any)('cancel_import', {
      p_import_id: importId
    });

    if (error) {
      throw new Error(`Erro ao cancelar importação: ${error.message}`);
    }

    return !!success;
  }

  /**
   * Busca os detalhes de uma importação por ID.
   */
  static async getImportById(importId: string): Promise<{ import: ImportRecord; rows: ImportRowRecord[] }> {
    const supabase = await createClient();

    const { data: importData, error: impError } = await supabase
      .from('imports')
      .select('*')
      .eq('id', importId)
      .single();

    if (impError || !importData) {
      throw new Error(`Importação não encontrada: ${impError?.message || 'Registro ausente'}`);
    }

    const { data: rowsData, error: rowsError } = await supabase
      .from('import_rows')
      .select('*')
      .eq('import_id', importId)
      .order('row_number', { ascending: true });

    if (rowsError) {
      throw new Error(`Erro ao buscar linhas da importação: ${rowsError.message}`);
    }

    return {
      import: importData as unknown as ImportRecord,
      rows: (rowsData || []) as unknown as ImportRowRecord[]
    };
  }

  /**
   * Gera o relatório CSV de erros neutralizado contra Formula Injection.
   */
  static async generateErrorCsvReport(importId: string): Promise<string> {
    const { rows } = await this.getImportById(importId);
    
    const errorRows = rows.filter(r => r.status === 'failed' || r.action === 'error');
    
    if (errorRows.length === 0) {
      return 'LINHA,MATRICULA,ERROS\n';
    }

    const csvLines: string[] = ['LINHA,MATRICULA,ERROS'];

    errorRows.forEach(r => {
      const lineNum = sanitizeCellForExport(r.row_number);
      const reg = sanitizeCellForExport(r.registration_number || '');
      const errList = sanitizeCellForExport((r.errors || []).join(' | '));

      csvLines.push(`"${lineNum}","${reg}","${errList}"`);
    });

    return csvLines.join('\n');
  }
}
