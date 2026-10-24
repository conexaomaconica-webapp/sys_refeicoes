'use server';

import { createClient } from '@/lib/supabase/server';
import { getPostLoginDestination } from '@/lib/auth/post-login-destination';

export async function redefinePasswordAction(password: string, confirmation: string) {
  if (password.length < 8) return { success: false as const, error: 'A senha deve ter pelo menos 8 caracteres.' };
  if (password !== confirmation) return { success: false as const, error: 'A confirmação da senha não confere.' };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false as const, error: 'Link inválido ou expirado.' };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { success: false as const, error: error.message };

  const { data: profileData } = await supabase
    .from('profiles')
    .select('role,status')
    .eq('id', user.id)
    .maybeSingle();
  const profile = profileData as { role: string; status: string } | null;
  if (!profile || profile.status !== 'active') {
    await supabase.auth.signOut();
    return { success: false as const, error: 'Senha alterada, mas o perfil está inativo ou inválido.' };
  }

  return { success: true as const, redirectTo: getPostLoginDestination(profile.role) };
}
