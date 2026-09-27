import { createBrowserClient } from '@/lib/supabase/client';
import type { AuthUserSession, Profile, UserInstitutionAccess, UserUnitAccess } from '@/types/auth';

/**
 * Servicio de Leitura e Gestão de Perfis de Usuário.
 */

export async function getCurrentUserProfile(): Promise<Profile | null> {
  try {
    const supabase = createBrowserClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();

    if (error || !data) return null;

    return data as Profile;
  } catch (err) {
    console.error('[ProfileService] Erro ao obter perfil atual:', err);
    return null;
  }
}

export async function getUserUnitAccesses(userId: string): Promise<UserUnitAccess[]> {
  try {
    const supabase = createBrowserClient();
    const { data, error } = await supabase
      .from('user_unit_access')
      .select('*')
      .eq('user_id', userId);

    if (error || !data) return [];
    return data as UserUnitAccess[];
  } catch (err) {
    console.error('[ProfileService] Erro ao obter acessos a unidades:', err);
    return [];
  }
}

export async function getUserInstitutionAccesses(userId: string): Promise<UserInstitutionAccess[]> {
  try {
    const supabase = createBrowserClient();
    const { data, error } = await supabase
      .from('user_institution_access')
      .select('*')
      .eq('user_id', userId);

    if (error || !data) return [];
    return data as UserInstitutionAccess[];
  } catch (err) {
    console.error('[ProfileService] Erro ao obter acessos a instituições:', err);
    return [];
  }
}

export async function getFullAuthSession(): Promise<AuthUserSession | null> {
  const profile = await getCurrentUserProfile();
  if (!profile) return null;

  const [unitAccesses, institutionAccesses] = await Promise.all([
    getUserUnitAccesses(profile.id),
    getUserInstitutionAccesses(profile.id),
  ]);

  return {
    user: {
      id: profile.id,
      email: profile.email || undefined,
    },
    profile,
    unitAccesses,
    institutionAccesses,
  };
}
