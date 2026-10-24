export const ADMINISTRATIVE_ROLES = [
  'admin_general',
  'operations_director',
  'finance',
  'supervisor',
  'unit_manager',
] as const;

export function getPostLoginDestination(role: string): '/admin' | '/consumer' | '/terminal' {
  if (role === 'student') return '/consumer';
  if ((ADMINISTRATIVE_ROLES as readonly string[]).includes(role)) return '/admin';
  return '/terminal';
}
