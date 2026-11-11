'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  submitContingencyBatchServer,
  reviewContingencyBatchServer,
  getContingencyBatchDetails,
} from '@/server/contingency/contingency.service';
import type {
  SubmitContingencyBatchInput,
  ReviewContingencyBatchInput,
  ContingencyBatchItem,
} from '@/types/contingency';

export type ContingencyActionResult =
  | { success: true; message: string; batch_id?: string }
  | { success: false; error: string };

export async function submitContingencyBatchAction(
  input: SubmitContingencyBatchInput
): Promise<ContingencyActionResult> {
  try {
    if (!input.unit_id) return { success: false, error: 'Selecione a unidade.' };
    if (!input.meal_type_id) return { success: false, error: 'Selecione o turno/refeição.' };
    if (!input.service_date) return { success: false, error: 'Informe a data do serviço.' };
    if (!input.justification || input.justification.trim().length < 10) {
      return { success: false, error: 'Justificativa detalhada obrigatória (mínimo 10 caracteres).' };
    }
    if (input.total_meals_served <= 0) {
      return { success: false, error: 'O número de refeições deve ser maior que zero.' };
    }

    const res = await submitContingencyBatchServer(input);
    if (!res.success) {
      return { success: false, error: res.message };
    }

    revalidatePath('/admin/contingencia');
    return { success: true, message: res.message, batch_id: res.batch_id };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function reviewContingencyBatchAction(
  input: ReviewContingencyBatchInput
): Promise<ContingencyActionResult> {
  try {
    if (!input.batch_id) return { success: false, error: 'Identificador do lote não informado.' };
    if (!['approve', 'reject'].includes(input.action)) {
      return { success: false, error: 'Ação inválida.' };
    }
    if (input.action === 'reject' && (!input.reason || input.reason.trim().length < 5)) {
      return { success: false, error: 'Informe o motivo da rejeição (mínimo 5 caracteres).' };
    }

    const res = await reviewContingencyBatchServer(input);
    if (!res.success) {
      return { success: false, error: res.message };
    }

    revalidatePath('/admin/contingencia');
    return { success: true, message: res.message };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function loadBatchItemsAction(batchId: string): Promise<{
  success: boolean;
  items?: ContingencyBatchItem[];
  error?: string;
}> {
  try {
    const { items } = await getContingencyBatchDetails(batchId);
    return { success: true, items };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function searchStudentsForContingencyAction(
  query: string,
  categoryId?: string
): Promise<
  Array<{ id: string; fullName: string; registrationNumber: string; categoryId: string; categoryName: string }>
> {
  const clean = query.trim();
  if (clean.length < 2) return [];

  const supabase = await createClient();
  let req = supabase
    .from('students')
    .select(`
      id,
      full_name,
      registration_number,
      category_id,
      student_categories(name)
    `)
    .or(`full_name.ilike.%${clean}%,registration_number.ilike.%${clean}%`)
    .eq('status', 'active')
    .limit(10);

  if (categoryId) {
    req = req.eq('category_id', categoryId);
  }

  const { data, error } = await req;

  if (error || !data) return [];

  return data.map((s: {
    id: string;
    full_name: string;
    registration_number: string;
    category_id: string;
    student_categories?: { name?: string } | null;
  }) => ({
    id: s.id,
    fullName: s.full_name,
    registrationNumber: s.registration_number,
    categoryId: s.category_id,
    categoryName: s.student_categories?.name || 'Geral',
  }));
}

export async function uploadContingencyEvidenceAction(formData: FormData): Promise<{
  success: boolean;
  url?: string;
  error?: string;
}> {
  try {
    const file = formData.get('file') as File | null;
    if (!file) {
      return { success: false, error: 'Nenhum arquivo enviado.' };
    }

    if (file.size > 15 * 1024 * 1024) {
      return { success: false, error: 'O arquivo excede o limite de 15MB.' };
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      return { success: false, error: 'Formato não permitido. Envie JPG, PNG, WEBP ou PDF.' };
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: 'Sessão expirada. Autentique-se novamente.' };
    }

    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('tenant_id, role, status')
      .eq('id', user.id)
      .maybeSingle();
    const profile = profileData as { tenant_id: string; role: string; status: string } | null;

    if (
      profileError ||
      !profile ||
      profile.status !== 'active' ||
      !['admin_general', 'operations_director', 'supervisor', 'unit_manager'].includes(profile.role)
    ) {
      return {
        success: false,
        error: 'Perfil sem permissão para anexar evidências de contingência.',
      };
    }

    const ext = file.name.split('.').pop() || 'bin';
    const filename = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const filePath = `${profile.tenant_id}/batches/${filename}`;

    const { error: uploadError } = await supabase.storage
      .from('contingency-evidence')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      return { success: false, error: `Falha no upload: ${uploadError.message}` };
    }

    // Criar signed URL com validade estendida (7 dias) para visualização administrativa
    const { data: signedData, error: signedError } = await supabase.storage
      .from('contingency-evidence')
      .createSignedUrl(filePath, 60 * 60 * 24 * 7);

    if (signedError || !signedData?.signedUrl) {
      return { success: true, url: filePath };
    }

    return { success: true, url: signedData.signedUrl };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
