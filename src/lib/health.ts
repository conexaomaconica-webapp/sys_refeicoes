import 'server-only';

const REQUIRED_VALUES = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CONSUMER_IDENTITY_HMAC_KEY',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_DEFAULT_TENANT_SLUG',
] as const;

function isHttpUrl(value: string | undefined, allowLocalhost: boolean): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return allowLocalhost && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isRuntimeReady(): boolean {
  if (REQUIRED_VALUES.some((name) => !process.env[name]?.trim())) return false;

  // `next start` usa NODE_ENV=production também no smoke local. Na Vercel,
  // VERCEL_ENV distingue inequivocamente a implantação operacional.
  const allowLocalhost = process.env.VERCEL_ENV !== 'production';
  if (!isHttpUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, false)) return false;
  if (!isHttpUrl(process.env.NEXT_PUBLIC_APP_URL, allowLocalhost)) return false;
  if ((process.env.CONSUMER_IDENTITY_HMAC_KEY?.length ?? 0) < 32) return false;

  return true;
}

export const HEALTH_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'Content-Type': 'application/json; charset=utf-8',
} as const;
