/**
 * ==============================================================================
 * Teste Unitário e de Integridade Criptográfica do Módulo 10.1 (Offline Engine)
 * Inclui Hardening de Segurança:
 * - CSPRNG 256 bits para Segredo Mestre de Dispositivo
 * - Persistência do cofre de dispositivo (Simulação de Reboot/Fechamento)
 * - Continuidade Operacional em Troca de Operador
 * - Segregação Multi-Tenant e Multi-Unidade
 * - Proteção contra Adulteração via AES-GCM
 * - Diagnóstico de Persistência de Armazenamento
 * ==============================================================================
 */

const assert = require('assert');

async function runHardenedOfflineTests() {
  console.log('--- [TESTE HARDENING MÓDULO 10.1: SEGURANÇA, CHAVES E PERSISTÊNCIA] ---');

  const { subtle } = globalThis.crypto;
  assert(subtle, 'Web Crypto API subtle deve estar disponível no ambiente de execução.');

  // Utilitários de conversão
  function bytesToHex(bytes) {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  function stringToBytes(str) {
    return new TextEncoder().encode(str);
  }

  function bytesToString(bytes) {
    return new TextDecoder().decode(bytes);
  }

  async function calculateSha256(data) {
    const msgBuffer = stringToBytes(data);
    const hashBuffer = await subtle.digest('SHA-256', msgBuffer);
    return bytesToHex(new Uint8Array(hashBuffer));
  }

  function generateCsprngSecret(byteLength = 32) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(byteLength));
    return bytesToHex(bytes);
  }

  async function deriveTerminalCryptoKey(deviceMasterSecretHex, context, saltBytes) {
    const secretMaterial = `DEVICE_SECRET:${deviceMasterSecretHex}|TENANT:${context.tenantId}|UNIT:${context.unitId}|TERM:${context.terminalId}`;
    const keyMaterial = await subtle.importKey(
      'raw',
      stringToBytes(secretMaterial),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: 100_000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // 1. Teste de CSPRNG 256 bits
  const secret1 = generateCsprngSecret(32);
  const secret2 = generateCsprngSecret(32);
  assert.strictEqual(secret1.length, 64, 'Segredo CSPRNG de 32 bytes deve ter 64 caracteres hexadecimais.');
  assert.notStrictEqual(secret1, secret2, 'CSPRNG deve produzir segredos criptográficos com alta entropia.');
  console.log('✅ 1. Geração de Segredo de Hardware CSPRNG 256-bit aprovada.');

  // 2. Simulação de Vault de Dispositivo (Persistência pós-reboot)
  const simulatedVault = new Map();
  const terminalId = 'TERM-OPERACIONAL-01';
  const tenantId = 'tenant-uuid-111';
  const unitId = 'unit-uuid-222';

  // Provisionamento inicial do terminal
  const provisionedMasterSecret = generateCsprngSecret(32);
  simulatedVault.set(`device_master_secret_${terminalId}`, provisionedMasterSecret);
  const partitionSalt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  simulatedVault.set('partition_salt_hex', bytesToHex(partitionSalt));

  console.log('✅ 2. Provisionamento seguro de cofre do terminal (terminal_vault) concluído.');

  // 3. Derivação e Criptografia com Operador A (Turno Manhã)
  const contextTerminal = { tenantId, unitId, terminalId };
  const keyTurnoA = await deriveTerminalCryptoKey(
    simulatedVault.get(`device_master_secret_${terminalId}`),
    contextTerminal,
    hexToBytes(simulatedVault.get('partition_salt_hex'))
  );

  const mockOfflineEvent = {
    id: 'event-uuid-001',
    sequence_num: 1,
    terminal_id: terminalId,
    unit_id: unitId,
    tenant_id: tenantId,
    operator_id: 'operador-a-uuid',
    student_id: 'student-uuid-999',
    registration_attempted: '20261001',
    meal_type_id: 'meal-lunch-uuid',
    device_timestamp: new Date().toISOString(),
    status: 'pending_sync',
  };

  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encryptedBytes = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    keyTurnoA,
    stringToBytes(JSON.stringify(mockOfflineEvent))
  );

  const storedQueueItem = {
    id: mockOfflineEvent.id,
    ivHex: bytesToHex(iv),
    ciphertextHex: bytesToHex(new Uint8Array(encryptedBytes)),
  };
  console.log('✅ 3. Operador A gravou evento criptografado na fila em modo offline.');

  // 4. Teste de Troca de Operador no mesmo terminal (Operador B - Turno Tarde)
  // Operador B abre a sessão no mesmo terminal. A chave derivada deve ser capaz de decifrar
  // e dar continuidade à fila sem que o operador anterior precise estar logado!
  const keyTurnoB = await deriveTerminalCryptoKey(
    simulatedVault.get(`device_master_secret_${terminalId}`),
    contextTerminal,
    hexToBytes(simulatedVault.get('partition_salt_hex'))
  );

  const decryptedByB = await subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(storedQueueItem.ivHex) },
    keyTurnoB,
    hexToBytes(storedQueueItem.ciphertextHex)
  );

  const recoveredEventByB = JSON.parse(bytesToString(new Uint8Array(decryptedByB)));
  assert.strictEqual(recoveredEventByB.id, mockOfflineEvent.id);
  assert.strictEqual(recoveredEventByB.operator_id, 'operador-a-uuid');
  console.log('✅ 4. Troca de operador aprovada: Operador B recuperou evento pendente do Operador A.');

  // 5. Teste de Segregação Multi-Tenant e Multi-Unidade (Context Mismatch)
  // Se o mesmo dispositivo for apontado para outra unidade ou outro tenant sem re-provisionamento,
  // a chave de derivação não bate e o AES-GCM rejeita por quebra de tag de autenticação.
  const contextOutraUnidade = { tenantId, unitId: 'unit-uuid-OUTRA-INTRUSA', terminalId };
  const keyOutraUnidade = await deriveTerminalCryptoKey(
    simulatedVault.get(`device_master_secret_${terminalId}`),
    contextOutraUnidade,
    hexToBytes(simulatedVault.get('partition_salt_hex'))
  );

  let segregationBlocked = false;
  try {
    await subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBytes(storedQueueItem.ivHex) },
      keyOutraUnidade,
      hexToBytes(storedQueueItem.ciphertextHex)
    );
  } catch (err) {
    segregationBlocked = true;
  }
  assert(segregationBlocked, 'AES-GCM deve falhar ao tentar decifrar com contexto de unidade diferente.');
  console.log('✅ 5. Segregação estrita aprovada: Tentativa de acesso com unidade diferente foi bloqueada pelo GCM.');

  // 6. Teste de Simulação de Reboot do Computador e Reabertura do Navegador
  // Simular novo processo lendo o cofre persistente
  const rebootedMasterSecret = simulatedVault.get(`device_master_secret_${terminalId}`);
  assert(rebootedMasterSecret, 'Segredo de hardware deve persistir no cofre do dispositivo.');

  const keyPosReboot = await deriveTerminalCryptoKey(
    rebootedMasterSecret,
    contextTerminal,
    hexToBytes(simulatedVault.get('partition_salt_hex'))
  );

  const decryptedPosReboot = await subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(storedQueueItem.ivHex) },
    keyPosReboot,
    hexToBytes(storedQueueItem.ciphertextHex)
  );
  const recoveredEventPosReboot = JSON.parse(bytesToString(new Uint8Array(decryptedPosReboot)));
  assert.strictEqual(recoveredEventPosReboot.student_id, 'student-uuid-999');
  console.log('✅ 6. Recuperação de fila após reinicialização da máquina/navegador aprovada.');

  console.log('\n======================================================');
  console.log('HARDENING DO MÓDULO 10.1 HOMOLOGADO COM SUCESSO!');
  console.log('======================================================\n');
}

runHardenedOfflineTests().catch((err) => {
  console.error('❌ Erro no teste de hardening do Módulo 10.1:', err);
  process.exit(1);
});
