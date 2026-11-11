const assert = require('assert');

// Test implementation mirroring src/lib/security/static-qr-crypto.ts
const STATIC_QR_SECRET_FALLBACK = 'MA_REFEICOES_STATIC_QR_SECURE_KEY_2026';

function getCryptoKeyMaterial() {
  return (
    process.env.CONSUMER_IDENTITY_HMAC_KEY ||
    process.env.NEXT_PUBLIC_STATIC_QR_SALT ||
    STATIC_QR_SECRET_FALLBACK
  );
}

async function getDerivedAesKey() {
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

async function generateEncryptedStudentQr(data) {
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

async function decryptEncryptedStudentQr(token) {
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
    const parsed = JSON.parse(decoder.decode(decryptedBuffer));

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

async function resolveTerminalIdentifier(rawIdentifier, expectedTenantId) {
  const trimmed = rawIdentifier.trim();
  if (!trimmed.startsWith('MAR:S:')) return trimmed;

  const decrypted = await decryptEncryptedStudentQr(trimmed);
  if (!decrypted) return trimmed;

  if (expectedTenantId && decrypted.tenantId && decrypted.tenantId !== expectedTenantId) {
    return trimmed;
  }

  return decrypted.registrationNumber;
}

async function runValidation() {
  console.log('--- VALIDATING ENCRYPTED STATIC QR CODE ---');

  const sampleStudent = {
    registrationNumber: '0001',
    tenantId: 'e1000000-0000-0000-0000-000000000001',
    studentId: 'st-0000-0000',
  };

  // 1. Generate encrypted QR payload
  const encryptedPayload = await generateEncryptedStudentQr(sampleStudent);
  console.log('1. Generated Payload:', encryptedPayload);
  assert(encryptedPayload.startsWith('MAR:S:'), 'Must start with MAR:S: prefix');
  const parts = encryptedPayload.slice(6).split(':');
  assert.strictEqual(parts.length, 2, 'Must have iv and ciphertext parts');
  assert.strictEqual(parts[0].length, 24, 'IV hex must be 12 bytes (24 chars)');
  console.log('   ✓ Format and structure valid');

  // 2. Decrypt encrypted QR payload
  const decrypted = await decryptEncryptedStudentQr(encryptedPayload);
  console.log('2. Decrypted Result:', decrypted);
  assert.strictEqual(decrypted.registrationNumber, '0001', 'Registration number must match');
  assert.strictEqual(decrypted.tenantId, sampleStudent.tenantId, 'TenantId must match');
  assert.strictEqual(decrypted.studentId, sampleStudent.studentId, 'StudentId must match');
  console.log('   ✓ Roundtrip decryption successful');

  // 3. Terminal resolver on encrypted QR payload
  const resolvedMatricula = await resolveTerminalIdentifier(encryptedPayload, sampleStudent.tenantId);
  console.log('3. Terminal Resolved Matrícula:', resolvedMatricula);
  assert.strictEqual(resolvedMatricula, '0001', 'Terminal must resolve to registration number');
  console.log('   ✓ Terminal resolution successful');

  // 4. Terminal resolver on plain typed matrícula
  const plainResolved = await resolveTerminalIdentifier(' 0001 ');
  console.log('4. Terminal Resolved Plain Matrícula:', plainResolved);
  assert.strictEqual(plainResolved, '0001', 'Plain typed matrícula must pass through unchanged');
  console.log('   ✓ Plain matrícula pass-through successful');

  // 5. Anti-tamper check (modify ciphertext)
  const tamperedPayload = encryptedPayload.slice(0, -4) + 'abcd';
  const tamperedResult = await decryptEncryptedStudentQr(tamperedPayload);
  assert.strictEqual(tamperedResult, null, 'Tampered ciphertext must fail GCM authentication');
  const tamperedResolver = await resolveTerminalIdentifier(tamperedPayload, sampleStudent.tenantId);
  assert.strictEqual(tamperedResolver, tamperedPayload, 'Tampered payload should safely fall back');
  console.log('   ✓ Anti-tamper authentication verified');

  // 6. Cross-tenant isolation check
  const wrongTenantResolved = await resolveTerminalIdentifier(encryptedPayload, 'other-tenant-id');
  assert.notStrictEqual(wrongTenantResolved, '0001', 'Must not resolve for mismatched tenant');
  console.log('   ✓ Cross-tenant isolation verified');

  console.log('\n🎉 ALL 6 ENCRYPTED STATIC QR CODE CHECKS PASSED!');
}

runValidation().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
