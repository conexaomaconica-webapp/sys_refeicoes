/**
 * ==============================================================================
 * Camada de Criptografia Autenticada e Integridade para Cache e Fila Local
 * Sprint 10 — MA Refeições
 * Utiliza Web Crypto API nativa (AES-GCM 256 bits, PBKDF2 e SHA-256)
 * ==============================================================================
 * 
 * NOTA ARQUITETURAL SOBRE SEGURANÇA NO NAVEGADOR:
 * Ambientes de navegadores não constituem Módulos de Segurança de Hardware (HSM) ou
 * Enclaves Seguros isolados. A criptografia local no cliente (AES-GCM via Web Crypto API)
 * tem como objetivo:
 * 1. Proteger dados em repouso contra inspeção direta não autorizada no armazenamento local;
 * 2. Prevenir adulterações manuais da fila pendente via DevTools através de tags GCM autenticadas;
 * 3. Garantir integridade da cadeia de eventos locais via hashes SHA-256 encadeados.
 * 
 * A autenticidade contábil, fiscal e financeira é SEMPRE validada centralmente no backend (Supabase),
 * que não confia cegamente no cliente e aplica verificação de sessão, permissões RLS,
 * unicidade de cota diária e idempotência canônica.
 */

/**
 * Converte Uint8Array para string hexadecimal
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Converte string hexadecimal para Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Converte string para Uint8Array usando TextEncoder
 */
export function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Converte Uint8Array para string usando TextDecoder
 */
export function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Gera um segredo criptográfico aleatório de alta entropia usando CSPRNG nativo
 * @param byteLength Quantidade de bytes de entropia (padrão: 32 bytes / 256 bits)
 */
export function generateCsprngSecret(byteLength = 32): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToHex(bytes);
}

/**
 * Calcula o hash SHA-256 de uma string retornando formato hex
 */
export async function calculateSha256(data: string): Promise<string> {
  const msgBuffer = stringToBytes(data);
  const hashBuffer = await globalThis.crypto.subtle.digest(
    'SHA-256',
    msgBuffer as unknown as BufferSource
  );
  return bytesToHex(new Uint8Array(hashBuffer));
}

/**
 * Normaliza e gera hash de uma matrícula de aluno para busca determinística
 */
export async function hashRegistrationNumber(reg: string): Promise<string> {
  const normalized = reg.trim().toUpperCase();
  return calculateSha256(`REG_SALT:${normalized}`);
}

/**
 * Contexto de segregação multi-tenant do terminal
 */
export interface TerminalSecurityContext {
  tenantId: string;
  unitId: string;
  terminalId: string;
}

/**
 * Deriva uma CryptoKey AES-GCM (256 bits) usando PBKDF2 a partir de:
 * 1. Segredo de Dispositivo provisionado (CSPRNG de 256 bits, persistido em vault seguro)
 * 2. Contexto segregado de tenant/unidade/terminal
 * 3. Salt aleatório de 16 bytes único por partição
 * 
 * Permite que o terminal decifre sua fila mesmo após reinicialização do equipamento
 * e troca de operadores no mesmo dispositivo, sem depender de conexão com o servidor.
 */
export async function deriveTerminalCryptoKey(
  deviceMasterSecretHex: string,
  context: TerminalSecurityContext,
  saltBytes: Uint8Array
): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;

  // Composição canônica: Segredo CSPRNG + Isolamento Contextual
  const secretMaterial = `DEVICE_SECRET:${deviceMasterSecretHex}|TENANT:${context.tenantId}|UNIT:${context.unitId}|TERM:${context.terminalId}`;

  const keyMaterial = await subtle.importKey(
    'raw',
    stringToBytes(secretMaterial) as unknown as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes as unknown as BufferSource,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Estrutura serializável do payload cifrado
 */
export interface EncryptedPayload {
  ivHex: string;
  ciphertextHex: string;
}

/**
 * Criptografa um objeto genérico com AES-GCM (autenticado)
 */
export async function encryptData<T>(data: T, key: CryptoKey): Promise<EncryptedPayload> {
  const subtle = globalThis.crypto.subtle;
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV para GCM
  const jsonStr = JSON.stringify(data);
  const encoded = stringToBytes(jsonStr);

  const encryptedBuffer = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
    },
    key,
    encoded as unknown as BufferSource
  );

  return {
    ivHex: bytesToHex(iv),
    ciphertextHex: bytesToHex(new Uint8Array(encryptedBuffer)),
  };
}

/**
 * Descriptografa um payload cifrado AES-GCM validando a integridade autenticada
 */
export async function decryptData<T>(encrypted: EncryptedPayload, key: CryptoKey): Promise<T> {
  const subtle = globalThis.crypto.subtle;
  const iv = hexToBytes(encrypted.ivHex);
  const ciphertext = hexToBytes(encrypted.ciphertextHex);

  const decryptedBuffer = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
    },
    key,
    ciphertext as unknown as BufferSource
  );

  const jsonStr = bytesToString(new Uint8Array(decryptedBuffer));
  return JSON.parse(jsonStr) as T;
}

/**
 * Calcula o hash de integridade de um evento offline encadeado
 * Permite detecção de quebra ou exclusão na cadeia local do terminal
 */
export async function calculateEventChainHash(
  sequenceNum: number,
  terminalId: string,
  studentId: string,
  mealTypeId: string,
  deviceTimestamp: string,
  idempotencyKey: string,
  previousEventHash: string
): Promise<string> {
  const canonicalPayload = [
    sequenceNum,
    terminalId,
    studentId,
    mealTypeId,
    deviceTimestamp,
    idempotencyKey,
    previousEventHash,
  ].join('|');

  return calculateSha256(`EVENT_CHAIN_V1:${canonicalPayload}`);
}
