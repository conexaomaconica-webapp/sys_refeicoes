import 'server-only';

import crypto from 'node:crypto';

function identityKey(): string {
  const key = process.env.CONSUMER_IDENTITY_HMAC_KEY;
  if (!key || key.length < 32) {
    throw new Error('CONSUMER_IDENTITY_HMAC_KEY deve possuir pelo menos 32 caracteres.');
  }
  return key;
}

export function normalizeCpf(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function isValidCpf(value: unknown): boolean {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const calculateDigit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cpf[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calculateDigit(9) === Number(cpf[9]) && calculateDigit(10) === Number(cpf[10]);
}

export function hashCpf(value: unknown): string {
  const cpf = normalizeCpf(value);
  return crypto.createHmac('sha256', identityKey()).update(`cpf:v1:${cpf}`).digest('hex');
}

export function cpfLast4(value: unknown): string {
  return normalizeCpf(value).slice(-4);
}

export function normalizeIdentityName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('pt-BR');
}

export function hashRequestFingerprint(ip: string, userAgent: string): string {
  return crypto
    .createHmac('sha256', identityKey())
    .update(`first-access:v1:${ip}:${userAgent}`)
    .digest('hex');
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return 'e-mail cadastrado';
  return `${local.slice(0, 2)}***@${domain}`;
}
