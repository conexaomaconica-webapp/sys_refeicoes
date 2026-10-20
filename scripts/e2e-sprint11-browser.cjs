const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(root, '.e2e-sprint11-manifest.json'), 'utf8'));
const serverLogPath = path.join(root, '.e2e-sprint11-server.log');
const edgeLogPath = path.join(root, '.e2e-sprint11-edge.log');
const profileDir = path.join(root, `.e2e-sprint11-edge-profile-${process.pid}`);
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const appUrl = 'http://127.0.0.1:3111';
const debugUrl = 'http://127.0.0.1:9223';

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}
async function waitHttp(url, timeout = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { await getJson(`${debugUrl}/json/version`); return; } catch {}
    try {
      await new Promise((resolve, reject) => http.get(url, (response) => { response.resume(); resolve(); }).on('error', reject));
      return;
    } catch {}
    await delay(500);
  }
  throw new Error(`Timeout aguardando ${url}`);
}

class Cdp {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.ws = new WebSocket(url);
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Falha JavaScript no navegador.');
    return result.result.value;
  }
  close() { this.ws.close(); }
}

async function waitFor(cdp, predicate, label, timeout = 90000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await cdp.evaluate(predicate);
      if (last) return last;
    } catch {}
    await delay(500);
  }
  const body = await cdp.evaluate('document.body?.innerText?.slice(0, 3000) || ""').catch(() => 'indisponível');
  throw new Error(`Timeout: ${label}. Estado da página: ${body}`);
}

async function main() {
  if (!fs.existsSync(edgePath)) throw new Error('Microsoft Edge não encontrado.');
  fs.mkdirSync(profileDir, { recursive: true });
  const serverLog = fs.openSync(serverLogPath, 'w');
  const edgeLog = fs.openSync(edgeLogPath, 'w');
  const server = spawn(process.execPath, ['-r', './scripts/patch-fs.cjs', './node_modules/next/dist/bin/next', 'start', '-p', '3111'], {
    cwd: root, env: { ...process.env, NODE_ENV: 'production' }, stdio: ['ignore', serverLog, serverLog], windowsHide: true,
  });
  let edge;
  let cdp;
  try {
    await waitHttp(appUrl, 60000);
    edge = spawn(edgePath, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-mode', '--no-service-autorun',
      '--disable-features=msEdgeFirstRunExperience,msEdgeStartupBoost', '--remote-debugging-port=9223',
      `--user-data-dir=${profileDir}`, `${appUrl}/login`,
    ], { stdio: ['ignore', edgeLog, edgeLog], windowsHide: true });
    await waitHttp(`${debugUrl}/json/version`, 30000);
    const pages = await getJson(`${debugUrl}/json/list`);
    const page = pages.find((item) => item.type === 'page');
    if (!page) throw new Error('Página do Edge não localizada.');
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('DOM.enable')]);
    await waitFor(cdp, `document.querySelector('#email') && document.querySelector('#password')`, 'formulário de login');
    await waitFor(cdp, `Object.keys(document.querySelector('button[type=submit]')).some((key) => key.startsWith('__reactProps$'))`, 'hidratação React do login');

    await cdp.evaluate(`document.querySelector('#email').focus(); true`);
    await cdp.send('Input.insertText', { text: fixture.email });
    await cdp.evaluate(`document.querySelector('#password').focus(); true`);
    await cdp.send('Input.insertText', { text: fixture.password });
    await delay(500);
    const loginReady = await cdp.evaluate(`({
      email: document.querySelector('#email').value.length > 0,
      password: document.querySelector('#password').value.length > 0,
      disabled: document.querySelector('button[type=submit]').disabled
    })`);
    if (!loginReady.email || !loginReady.password || loginReady.disabled) throw new Error('Campos de login não foram preenchidos pelo navegador.');
    await cdp.evaluate(`document.querySelector('button[type=submit]').click(); true`);
    await waitFor(cdp, `location.pathname === '/admin'`, 'redirecionamento administrativo');
    console.log('PASS login real com usuário administrativo sintético');

    await cdp.send('Page.navigate', { url: `${appUrl}/admin/importacoes` });
    await waitFor(cdp, `document.body.innerText.includes('Importação parcial') && document.querySelector('input[type=file]')`, 'página de importações');
    await waitFor(cdp, `Object.keys(document.querySelector('form button')).some((key) => key.startsWith('__reactProps$'))`, 'hidratação React da importação');
    console.log('PASS rota /admin/importacoes autorizada');

    const documentNode = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const fileNode = await cdp.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: 'input[type=file]' });
    if (!fileNode.nodeId) throw new Error('Input de arquivo não localizado.');
    await cdp.send('DOM.setFileInputFiles', { nodeId: fileNode.nodeId, files: [fixture.csvPath] });
    await cdp.evaluate(`(() => {
      const institution = document.querySelector('select[name=institutionId]');
      const option = [...institution.options].find((item) => item.value === ${JSON.stringify(fixture.institutionId)});
      if (!option) throw new Error('Instituição sintética não disponível na interface.');
      institution.value = option.value;
      institution.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await delay(500);
    await cdp.evaluate(`document.querySelector('form').requestSubmit(); true`);
    await waitFor(cdp, `document.body.innerText.includes('Preview — .e2e-sprint11-input.csv')`, 'preview da planilha', 120000);
    const previewCounts = await cdp.evaluate(`(() => {
      const normalize = (value) => value.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
      return [...document.querySelectorAll('section button')].reduce((result, button) => {
        const parts = [...button.querySelectorAll('p')].map((item) => item.innerText.trim());
        if (parts.length === 2) result[normalize(parts[0])] = Number(parts[1]);
        return result;
      }, {});
    })()`);
    if (previewCounts.validas !== 8 || previewCounts.invalidas !== 2) {
      throw new Error(`Contagens do preview não correspondem a 8 válidas/2 inválidas: ${JSON.stringify(previewCounts)}.`);
    }
    console.log('PASS upload e preview exibem 8 válidas e 2 rejeições');

    const downloads = await cdp.evaluate(`(async () => {
      const links = [...document.querySelectorAll('a')].filter((item) => item.href.includes('/rejeicoes?format='));
      const result = {};
      for (const link of links) {
        const format = new URL(link.href).searchParams.get('format');
        const response = await fetch(link.href, { credentials: 'include' });
        const bytes = (await response.arrayBuffer()).byteLength;
        result[format] = { status: response.status, type: response.headers.get('content-type'), bytes };
      }
      return result;
    })()`);
    if (downloads.xlsx?.status !== 200 || downloads.xlsx.bytes < 100 || downloads.csv?.status !== 200 || downloads.csv.bytes < 20) {
      throw new Error(`Downloads de rejeição inválidos: ${JSON.stringify(downloads)}`);
    }
    console.log('PASS downloads autenticados XLSX e CSV de rejeições');

    await cdp.evaluate(`(() => {
      const checkbox = [...document.querySelectorAll('input[type=checkbox]')].find((item) => item.parentElement?.innerText.includes('Confirmo o processamento'));
      if (!checkbox) throw new Error('Confirmação explícita não localizada.');
      checkbox.click();
      const button = [...document.querySelectorAll('button')].find((item) => item.innerText.includes('Confirmar linhas válidas'));
      if (!button) throw new Error('Botão de confirmação não localizado.');
      button.click();
      return true;
    })()`);
    await waitFor(cdp, `document.body.innerText.includes('Importação concluída: 8 processadas, 0 falhas e 2 rejeitadas/ignoradas.')`, 'resultado da confirmação', 120000);
    console.log('PASS confirmação via interface processa 8 e isola 2');
    console.log('RESULTADO NAVEGADOR: 5/5 PASS');
  } finally {
    if (cdp) {
      await cdp.send('Browser.close').catch(() => {});
      cdp.close();
      await delay(1500);
    }
    if (edge?.pid) spawnSync('taskkill.exe', ['/PID', String(edge.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    if (server?.pid) spawnSync('taskkill.exe', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    fs.closeSync(serverLog);
    fs.closeSync(edgeLog);
    await delay(2000);
    const resolvedProfile = path.resolve(profileDir);
    if (resolvedProfile.startsWith(`${root}${path.sep}`) && path.basename(resolvedProfile) === `.e2e-sprint11-edge-profile-${process.pid}`) {
      let cleanupError;
      for (let attempt = 0; attempt < 40; attempt++) {
        try { fs.rmSync(resolvedProfile, { recursive: true, force: true }); cleanupError = undefined; break; }
        catch (error) { cleanupError = error; await delay(500); }
      }
      if (cleanupError) console.warn(`Aviso: perfil local do Edge será removido posteriormente: ${cleanupError.message}`);
    }
  }
}

main().catch((error) => {
  const serverLog = fs.existsSync(serverLogPath) ? fs.readFileSync(serverLogPath, 'utf8').slice(-4000) : '';
  console.error(`E2E SPRINT 11 REPROVADO: ${error.message}`);
  if (serverLog) console.error(`LOG DO SERVIDOR:\n${serverLog}`);
  process.exit(1);
});
