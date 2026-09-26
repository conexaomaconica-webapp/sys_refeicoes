/**
 * Patch de compatibilidade de sistema de arquivos FAT32/Windows para Node.js e Webpack/Next.js.
 * 
 * MOTIVAÇÕES TÉCNICAS (FAT32 no Windows):
 * 1. `fs.readlink`: Em sistemas FAT32, chamadas a `readlink` em arquivos regulares retornam `EISDIR`
 *    em vez de `EINVAL`. O Webpack espera `EINVAL` para reconhecer arquivos regulares.
 * 2. `fs.mkdir`: Em sistemas FAT32 no Windows, `mkdir` com `{ recursive: true }` em diretórios
 *    já existentes sob alta concorrência de I/O por vezes retorna `EPERM` (-4048) em vez de ignorar
 *    silenciosamente. Caso o diretório já exista, essa exceção deve ser suprimida com segurança.
 */
const fs = require('fs');

const origReadlink = fs.readlink;
const origReadlinkSync = fs.readlinkSync;
const origPromisesReadlink = fs.promises.readlink;

const origMkdir = fs.mkdir;
const origMkdirSync = fs.mkdirSync;
const origPromisesMkdir = fs.promises.mkdir;

function convertReadlinkError(err) {
  if (err && (err.code === 'EISDIR' || err.code === 'UNKNOWN')) {
    const newErr = new Error(err.message);
    newErr.code = 'EINVAL';
    newErr.errno = -4071; // EINVAL
    newErr.syscall = err.syscall;
    newErr.path = err.path;
    return newErr;
  }
  return err;
}

function shouldSuppressMkdirError(err, dirPath) {
  if (!err) return false;
  if (err.code === 'EEXIST' || err.code === 'EPERM') {
    try {
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        return true;
      }
    } catch {
      // Ignora erro de checagem
    }
  }
  return false;
}

// Patch readlink
if (origReadlink) {
  fs.readlink = function (...args) {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') {
      args[args.length - 1] = function (err, result) {
        return cb(convertReadlinkError(err), result);
      };
    }
    return origReadlink.apply(this, args);
  };
}

if (origReadlinkSync) {
  fs.readlinkSync = function (...args) {
    try {
      return origReadlinkSync.apply(this, args);
    } catch (err) {
      throw convertReadlinkError(err);
    }
  };
}

if (origPromisesReadlink) {
  fs.promises.readlink = async function (...args) {
    try {
      return await origPromisesReadlink.apply(this, args);
    } catch (err) {
      throw convertReadlinkError(err);
    }
  };
}

// Patch mkdir
if (origMkdir) {
  fs.mkdir = function (...args) {
    const dirPath = args[0];
    const cb = args[args.length - 1];
    if (typeof cb === 'function') {
      args[args.length - 1] = function (err, result) {
        if (shouldSuppressMkdirError(err, dirPath)) {
          return cb(null, dirPath);
        }
        return cb(err, result);
      };
    }
    return origMkdir.apply(this, args);
  };
}

if (origMkdirSync) {
  fs.mkdirSync = function (...args) {
    const dirPath = args[0];
    try {
      return origMkdirSync.apply(this, args);
    } catch (err) {
      if (shouldSuppressMkdirError(err, dirPath)) {
        return dirPath;
      }
      throw err;
    }
  };
}

if (origPromisesMkdir) {
  fs.promises.mkdir = async function (...args) {
    const dirPath = args[0];
    try {
      return await origPromisesMkdir.apply(this, args);
    } catch (err) {
      if (shouldSuppressMkdirError(err, dirPath)) {
        return dirPath;
      }
      throw err;
    }
  };
}
