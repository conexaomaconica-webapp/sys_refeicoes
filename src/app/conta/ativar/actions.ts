'use server';

import { createClient } from '@/lib/supabase/server';
import { getAdminClient } from '@/lib/supabase/admin';

type ActivationResult = { success: true; destination: '/consumer' | '/admin' } | { success: false; error: string };

export async function completeConsumerActivationAction(formData: FormData): Promise<ActivationResult> {
  const password = String(formData.get('password') || '');
  const passwordConfirmation = String(formData.get('passwordConfirmation') || '');
  const phone = String(formData.get('phone') || '').trim();
  const photo = formData.get('photo');

  if (password.length < 8) return { success: false, error: 'A senha deve ter pelo menos 8 caracteres.' };
  if (password !== passwordConfirmation) return { success: false, error: 'A confirmação da senha não confere.' };
  if (phone && phone.replace(/\D/g, '').length < 10) return { success: false, error: 'Informe um telefone válido.' };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'O link de ativação expirou. Solicite o primeiro acesso novamente.' };

  const adminClient = getAdminClient();
  const { data: profile } = await adminClient
    .from('profiles')
    .select('tenant_id,role,status,must_change_password')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || profile.status !== 'active' || !profile.must_change_password) {
    return { success: false, error: 'Conta inválida, inativa ou já ativada.' };
  }

  const isConsumer = profile.role === 'student';

  if (!isConsumer) {
    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) return { success: false, error: `Não foi possível definir a senha: ${passwordError.message}` };

    const { error: profileError } = await adminClient
      .from('profiles')
      .update({ must_change_password: false, phone: phone || null })
      .eq('id', user.id)
      .eq('tenant_id', profile.tenant_id)
      .neq('role', 'student');
    if (profileError) return { success: false, error: 'A senha foi definida, mas a ativação do perfil falhou.' };
    return { success: true, destination: '/admin' };
  }

  const { data: student } = await adminClient
    .from('students')
    .select('id,tenant_id,institution_id')
    .eq('user_id', user.id)
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle();
  if (!student) return { success: false, error: 'Conta sem comensal vinculado.' };

  let photoPath: string | undefined;
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > 5 * 1024 * 1024) return { success: false, error: 'A foto deve ter no máximo 5 MB.' };
    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const extension = extensions[photo.type];
    if (!extension) return { success: false, error: 'Use uma foto JPEG, PNG ou WebP.' };
    photoPath = `${profile.tenant_id}/${student.institution_id}/${student.id}/profile.${extension}`;
    const { error: uploadError } = await adminClient.storage
      .from('student-photos')
      .upload(photoPath, Buffer.from(await photo.arrayBuffer()), {
        contentType: photo.type,
        upsert: true,
      });
    if (uploadError) return { success: false, error: `Não foi possível salvar a foto: ${uploadError.message}` };
  }

  const { error: passwordError } = await supabase.auth.updateUser({ password });
  if (passwordError) return { success: false, error: `Não foi possível definir a senha: ${passwordError.message}` };

  const { error: profileError } = await adminClient
    .from('profiles')
    .update({ must_change_password: false })
    .eq('id', user.id)
    .eq('tenant_id', profile.tenant_id)
    .eq('role', 'student');
  if (profileError) return { success: false, error: 'A senha foi definida, mas a ativação do perfil falhou.' };

  const studentUpdate: {
    phone: string | null;
    first_access_status: 'active';
    consumer_activated_at: string;
    photo_path?: string;
  } = {
    phone: phone || null,
    first_access_status: 'active',
    consumer_activated_at: new Date().toISOString(),
  };
  if (photoPath) studentUpdate.photo_path = photoPath;

  const { error: studentError } = await adminClient
    .from('students')
    .update(studentUpdate)
    .eq('id', student.id)
    .eq('tenant_id', profile.tenant_id)
    .eq('user_id', user.id);
  if (studentError) return { success: false, error: 'A senha foi definida, mas o cadastro complementar falhou.' };

  return { success: true, destination: '/consumer' };
}
