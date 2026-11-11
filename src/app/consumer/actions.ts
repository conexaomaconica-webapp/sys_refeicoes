'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { initiateRechargeServer } from '@/services/recharge.service';
import type { PaymentMethod } from '@/types/payment';

export interface ConsumerActionResult {
  success: boolean;
  message?: string;
  error?: string;
  pixQrCode?: string;
  pixCopyPaste?: string;
  status?: string;
}

async function requireConsumer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Sessão expirada. Entre novamente.');

  const { data } = await supabase
    .from('profiles')
    .select('role,status')
    .eq('id', user.id)
    .maybeSingle();
  const profile = data as { role: string; status: string } | null;

  if (!profile || profile.status !== 'active' || profile.role !== 'student') {
    throw new Error('Perfil sem acesso ao portal do consumidor.');
  }

  return { supabase, user };
}

export async function createConsumerRecharge(input: {
  studentId: string;
  method: PaymentMethod;
  amount: number;
}): Promise<ConsumerActionResult> {
  try {
    await requireConsumer();
    const amount = Number(input.amount);

    if (!Number.isFinite(amount) || amount < 5 || amount > 500) {
      return { success: false, error: 'Informe uma recarga entre R$ 5,00 e R$ 500,00.' };
    }
    if (!['pix', 'credit_card'].includes(input.method)) {
      return { success: false, error: 'Forma de pagamento inválida.' };
    }

    const result = await initiateRechargeServer({
      studentId: input.studentId,
      method: input.method,
      amount,
    });

    if (!result.success) return { success: false, error: result.error };

    revalidatePath('/consumer');
    return {
      success: true,
      message:
        result.status === 'confirmed'
          ? 'Recarga confirmada e creditada no saldo.'
          : 'Cobrança criada. O saldo será atualizado após a confirmação.',
      pixQrCode: result.pixQrCode,
      pixCopyPaste: result.pixCopyPaste,
      status: result.status,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao criar recarga.',
    };
  }
}

export async function saveConsumerPreferences(input: {
  lowBalanceEnabled: boolean;
  lowBalanceThreshold: number;
  pushEnabled: boolean;
}): Promise<ConsumerActionResult> {
  try {
    const { supabase } = await requireConsumer();
    const threshold = Number(input.lowBalanceThreshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1000) {
      return { success: false, error: 'Informe um limite entre R$ 0,00 e R$ 1.000,00.' };
    }

    const rpcClient = supabase as unknown as {
      rpc: (
        name: string,
        args: Record<string, unknown>
      ) => Promise<{ error: { message: string } | null }>;
    };
    const { error } = await rpcClient.rpc('upsert_my_consumer_preferences', {
      p_low_balance_enabled: Boolean(input.lowBalanceEnabled),
      p_low_balance_threshold: threshold,
      p_push_enabled: Boolean(input.pushEnabled),
    });
    if (error) return { success: false, error: error.message };

    revalidatePath('/consumer');
    return { success: true, message: 'Preferências atualizadas.' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao salvar preferências.',
    };
  }
}

export async function updateConsumerContact(input: {
  email: string;
  phone: string;
}): Promise<ConsumerActionResult> {
  try {
    const { supabase, user } = await requireConsumer();
    const email = input.email.trim();
    const phone = input.phone.trim();

    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      return { success: false, error: 'Informe um e-mail válido.' };
    }
    if (phone.length > 30) {
      return { success: false, error: 'O telefone informado é muito longo.' };
    }

    const updateClient = supabase as unknown as {
      from: (table: string) => {
        update: (values: Record<string, unknown>) => {
          eq: (
            column: string,
            value: string
          ) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
    const { error } = await updateClient
      .from('students')
      .update({ email: email || null, phone: phone || null })
      .eq('user_id', user.id);
    if (error) return { success: false, error: error.message };

    revalidatePath('/consumer');
    return { success: true, message: 'Dados de contato atualizados.' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao atualizar seus dados.',
    };
  }
}

export async function updateConsumerPhotoAction(formData: FormData): Promise<{
  success: boolean;
  photoUrl?: string;
  error?: string;
}> {
  try {
    const { supabase, user } = await requireConsumer();
    const file = formData.get('file') as File | null;
    if (!file) {
      return { success: false, error: 'Nenhum arquivo enviado.' };
    }

    if (file.size > 5 * 1024 * 1024) {
      return { success: false, error: 'A foto deve ter no máximo 5MB.' };
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return { success: false, error: 'Formato inválido. Use JPG, PNG ou WEBP.' };
    }

    const { data: student, error: studentError } = await (supabase
      .from('students')
      .select('id, tenant_id, institution_id')
      .eq('user_id', user.id)
      .maybeSingle() as unknown as Promise<{
        data: { id: string; tenant_id: string; institution_id: string } | null;
        error: { message: string } | null;
      }>);

    if (studentError || !student) {
      return { success: false, error: 'Cadastro do estudante não encontrado.' };
    }

    const studentRecord = student;
    const adminClient = getAdminClient();
    const ext = file.name.split('.').pop() || 'jpg';
    const filePath = `${studentRecord.tenant_id}/${studentRecord.institution_id}/${studentRecord.id}/profile_${Date.now()}.${ext}`;

    const { error: uploadError } = await adminClient.storage
      .from('student-photos')
      .upload(filePath, file, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      return { success: false, error: `Falha no envio da foto: ${uploadError.message}` };
    }

    const { error: dbError } = await adminClient
      .from('students')
      .update({ photo_path: filePath })
      .eq('id', studentRecord.id);

    if (dbError) {
      return { success: false, error: `Falha ao salvar foto no cadastro: ${dbError.message}` };
    }

    const { data: signedData } = await adminClient.storage
      .from('student-photos')
      .createSignedUrl(filePath, 86400 * 7);

    revalidatePath('/consumer');
    return {
      success: true,
      photoUrl: signedData?.signedUrl || filePath,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao atualizar foto.',
    };
  }
}

