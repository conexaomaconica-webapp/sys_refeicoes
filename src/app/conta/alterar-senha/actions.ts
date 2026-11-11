'use server';

import { createClient } from '@/lib/supabase/server';

export async function changeOwnPasswordAction(
  currentPassword: string,
  newPassword: string,
  confirmation: string
) {
  if (!currentPassword) {
    return { success: false as const, error: 'Informe a senha atual.' };
  }
  if (newPassword.length < 6) {
    return { success: false as const, error: 'A nova senha deve ter pelo menos 6 caracteres.' };
  }
  if (newPassword !== confirmation) {
    return { success: false as const, error: 'A confirmação da nova senha não confere.' };
  }
  if (newPassword === currentPassword) {
    return { success: false as const, error: 'A nova senha deve ser diferente da senha atual.' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) {
    return { success: false as const, error: 'Sessão inválida ou sem e-mail associado.' };
  }

  const { data: authentication, error: authenticationError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (authenticationError || authentication.user.id !== user.id) {
    return { success: false as const, error: 'A senha atual está incorreta.' };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    return {
      success: false as const,
      error: updateError.message || 'Não foi possível alterar a senha.',
    };
  }

  return { success: true as const, message: 'Senha alterada com sucesso.' };
}

