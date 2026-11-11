/**
 * ==============================================================================
 * Criptografia Autenticada para QR Code Estático de Estudante / Consumidor
 * MA Refeições — Utiliza AES-256-GCM com Web Crypto API nativa
 * ==============================================================================
 *
 * Características:
 * 1. Payload criptografado e assinado via tag de autenticação GCM (tamper-proof).
 * 2. Estático e perene: não expira a cada 90s, permitindo uso offline no PWA.
 * 3. Oculta a matrícula contra curiosos e fotos não autorizadas.
 * 4. Ao ser lido por scanner USB 2D no terminal, é decifrado instantaneamente em < 1ms.
 */

const STATIC_QR_SECRET_FALLBACK = 'MA_REFEICOES_STATIC_QR_SECURE_KEY_2026';

function getCryptoKeyMaterial(): string {
  return (
    process.env.CONSUMER_IDENTITY_HMAC_KEY ||
    process.env.NEXT_PUBLIC_STATIC_QR_SALT ||
    STATIC_QR_SECRET_FALLBACK
  );
}

async function getDerivedAesKey(): Promise<CryptoKey> {
  const secret = getCryptoKeyMaterial();
  const encoder = new TextEncoder();
  const keyHash = await crypto.subtle.digest('SHA-256', encoder.encode(secret));

  return crypto.subtle.importKey(
    'raw',
    keyHash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface StaticQrData {
  registrationNumber: string;
  tenantId: string;
  studentId: string;
}

/**
 * Criptografa os dados do aluno em um token estático seguro para o QR Code.
 * Retorna string no formato `MAR:S:<iv_hex>:<ciphertext_hex>`.
 */
export async function generateEncryptedStudentQr(data: StaticQrData): Promise<string> {
  const key = await getDerivedAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();

  const payload = JSON.stringify({
    reg: data.registrationNumber.trim(),
    tid: data.tenantId,
    sid: data.studentId,
    v: 1,
  });

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(payload)
  );

  const ivHex = Buffer.from(iv).toString('hex');
  const cipherHex = Buffer.from(encryptedBuffer).toString('hex');

  return `MAR:S:${ivHex}:${cipherHex}`;
}

/**
 * Decifra e valida a integridade de um token de QR Code estático.
 * Retorna os dados originais se autêntico, ou null se corrompido/adulterado.
 */
export async function decryptEncryptedStudentQr(token: string): Promise<StaticQrData | null> {
  const cleanToken = token.trim();
  if (!cleanToken.startsWith('MAR:S:')) return null;

  const parts = cleanToken.slice(6).split(':');
  if (parts.length !== 2) return null;

  try {
    const iv = Buffer.from(parts[0], 'hex');
    const ciphertext = Buffer.from(parts[1], 'hex');
    if (iv.length !== 12 || ciphertext.length < 16) return null;

    const key = await getDerivedAesKey();
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    const decoder = new TextDecoder();
    const parsed = JSON.parse(decoder.decode(decryptedBuffer)) as {
      reg?: string;
      tid?: string;
      sid?: string;
    };

    if (!parsed.reg) return null;

    return {
      registrationNumber: String(parsed.reg),
      tenantId: String(parsed.tid || ''),
      studentId: String(parsed.sid || ''),
    };
  } catch {
    return null;
  }
}
