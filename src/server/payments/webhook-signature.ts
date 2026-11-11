import crypto from 'node:crypto';

function timingSafeTextEqual(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  return (
    receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

export function verifyAsaasWebhookToken(
  receivedToken: string | null,
  configuredSecret?: string
): boolean {
  if (!receivedToken || !configuredSecret) return false;
  return timingSafeTextEqual(receivedToken, configuredSecret);
}

function readMercadoPagoDataId(rawBody: string): string | null {
  try {
    const payload = JSON.parse(rawBody) as { data?: { id?: string | number } };
    const dataId = payload.data?.id;
    return dataId === undefined || dataId === null ? null : String(dataId);
  } catch {
    return null;
  }
}

export function verifyMercadoPagoWebhookSignature(params: {
  headers: Headers;
  rawBody: string;
  configuredSecret?: string;
  dataId?: string;
}): boolean {
  const { headers, rawBody, configuredSecret } = params;
  const signature = headers.get('x-signature');
  const requestId = headers.get('x-request-id');
  const dataId = (params.dataId || readMercadoPagoDataId(rawBody))?.toLowerCase();

  if (!configuredSecret || !signature || !requestId || !dataId) return false;

  let timestamp = '';
  let receivedHash = '';
  for (const part of signature.split(',')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 'ts') timestamp = value;
    if (key === 'v1') receivedHash = value;
  }

  if (!timestamp || !/^[a-f\d]{64}$/i.test(receivedHash)) return false;

  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  const expectedHash = crypto
    .createHmac('sha256', configuredSecret)
    .update(manifest)
    .digest('hex');

  return timingSafeTextEqual(receivedHash.toLowerCase(), expectedHash);
}
