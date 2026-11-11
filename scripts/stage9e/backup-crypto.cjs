const crypto = require('node:crypto');
const fs = require('node:fs');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const MAGIC = Buffer.from('MAREFB01', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES;

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(file);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function encryptReadable(readable, outputPath, key) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plainHash = crypto.createHash('sha256');
  let plainBytes = 0;
  const tap = new Transform({
    transform(chunk, _encoding, callback) {
      plainHash.update(chunk);
      plainBytes += chunk.length;
      callback(null, chunk);
    },
  });
  const output = fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
  output.write(Buffer.concat([MAGIC, iv]));
  await pipeline(readable, tap, cipher, output, { end: false });
  const tag = cipher.getAuthTag();
  await new Promise((resolve, reject) => {
    output.once('error', reject);
    output.end(tag, resolve);
  });
  return {
    plainBytes,
    plainSha256: plainHash.digest('hex'),
    encryptedBytes: fs.statSync(outputPath).size,
    encryptedSha256: await sha256File(outputPath),
  };
}

function decryptReadable(inputPath, key) {
  const stats = fs.statSync(inputPath);
  if (stats.size <= HEADER_BYTES + TAG_BYTES) throw new Error('Arquivo cifrado muito pequeno.');
  const descriptor = fs.openSync(inputPath, 'r');
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    fs.readSync(descriptor, header, 0, header.length, 0);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Magic do backup invalido.');
    const tag = Buffer.alloc(TAG_BYTES);
    fs.readSync(descriptor, tag, 0, tag.length, stats.size - TAG_BYTES);
    const iv = header.subarray(MAGIC.length);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const source = fs.createReadStream(inputPath, {
      start: HEADER_BYTES,
      end: stats.size - TAG_BYTES - 1,
    });
    source.on('error', (error) => decipher.destroy(error));
    source.pipe(decipher);
    return decipher;
  } finally {
    fs.closeSync(descriptor);
  }
}

async function verifyEncrypted(inputPath, key, expected) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of decryptReadable(inputPath, key)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  const digest = hash.digest('hex');
  if (bytes !== expected.plainBytes || digest !== expected.plainSha256) {
    throw new Error('Verificacao de conteudo cifrado divergente.');
  }
  return { plainBytes: bytes, plainSha256: digest };
}

module.exports = { encryptReadable, decryptReadable, sha256File, verifyEncrypted };

