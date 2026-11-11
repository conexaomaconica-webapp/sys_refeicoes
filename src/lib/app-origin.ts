/**
 * Utilitário de resolução da URL de origem da aplicação
 * Prioriza origens remotas/hosts reais enviados pelos cabeçalhos da requisição
 * antes de fazer fallback para variáveis locais.
 */
export function resolveAppOrigin(
  requestHeaders: { get(name: string): string | null },
  configuredAppUrl?: string
): string {
  const originHeader = requestHeaders.get('origin');
  const forwardedHost = requestHeaders.get('x-forwarded-host');
  const host = forwardedHost || requestHeaders.get('host');
  const proto = requestHeaders.get('x-forwarded-proto') || (host?.includes('localhost') ? 'http' : 'https');

  // 1. Se veio origin explícito não-localhost do navegador, tem prioridade máxima
  if (originHeader && !originHeader.includes('localhost') && !originHeader.includes('127.0.0.1')) {
    try {
      return new URL(originHeader).origin;
    } catch {
      // continua para os próximos
    }
  }

  // 2. Se o host da requisição for um domínio ou IP real (não-localhost)
  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    return `${proto}://${host}`;
  }

  // 3. Se NEXT_PUBLIC_APP_URL foi configurado e não for localhost
  if (configuredAppUrl && !configuredAppUrl.includes('localhost') && !configuredAppUrl.includes('127.0.0.1')) {
    try {
      return new URL(configuredAppUrl).origin;
    } catch {
      // continua
    }
  }

  // 4. Se tiver origin (mesmo que localhost)
  if (originHeader) {
    try {
      return new URL(originHeader).origin;
    } catch {
      // continua
    }
  }

  // 5. Se tiver host
  if (host) {
    return `${proto}://${host}`;
  }

  // 6. Configuração fallback
  if (configuredAppUrl) {
    try {
      return new URL(configuredAppUrl).origin;
    } catch {
      // continua
    }
  }

  return 'http://localhost:3000';
}
