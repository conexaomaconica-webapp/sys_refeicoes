'use server';

import { decryptEncryptedStudentQr } from '@/lib/security/static-qr-crypto';

/**
 * Resolve o identificador recebido pelo terminal (digitado ou lido por scanner USB).
 * Se for um QR Code estático criptografado ('MAR:S:...'), decifra com segurança para obter a matrícula.
 * Caso contrário, retorna o identificador original limpo.
 */
export async function resolveTerminalIdentifierAction(
  rawIdentifier: string,
  expectedTenantId?: string
): Promise<string> {
  const trimmed = rawIdentifier.trim();
  if (!trimmed.startsWith('MAR:S:')) return trimmed;

  const decrypted = await decryptEncryptedStudentQr(trimmed);
  if (!decrypted) {
    throw new Error('QR_INVALID: QR Code estático inválido ou corrompido.');
  }

  if (expectedTenantId && decrypted.tenantId && decrypted.tenantId !== expectedTenantId) {
    throw new Error('QR_TENANT_MISMATCH: QR Code pertence a outra organização/tenant.');
  }

  return decrypted.registrationNumber;
}
