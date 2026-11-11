const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const baseUrl = process.env.STAGE5C_URL || 'http://127.0.0.1:3105/demonstracao/central-inteligencia';
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const evidenceDir = path.resolve(process.env.STAGE5C_EVIDENCE_DIR || 'docs/evidence/stage5c');
const debuggingPort = 9335;
const results = [];

console.log('Iniciando homologação automatizada da Etapa 5C...');

function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function waitForChrome() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await fetchJson(`http://127.0.0.1:${debuggingPort}/json/version`);
    } catch {
      await wait(200);
    }
  }
  throw new Error('Chrome DevTools não respondeu.');
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.openPromise = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
  }

  async connect() {
    await Promise.race([
      this.openPromise,
      wait(5000).then(() => { throw new Error('Timeout ao conectar ao Chrome DevTools.'); }),
    ]);
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

async function clickButton(client, label) {
  return evaluate(client, `(() => {
    const element = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(label)});
    if (!element) return false;
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);
}

async function selectValue(client, index, value) {
  return evaluate(client, `(() => {
    const element = document.querySelectorAll('select')[${index}];
    if (!element) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return element.value;
  })()`);
}

async function setViewport(client, width, height) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
  await wait(150);
}

async function screenshot(client, filename) {
  const metrics = await client.send('Page.getLayoutMetrics');
  const content = metrics.cssContentSize;
  const capture = await client.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 78,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: content.width, height: content.height, scale: 1 },
  });
  fs.writeFileSync(path.join(evidenceDir, filename), Buffer.from(capture.data, 'base64'));
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage5c-chrome-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let client;
  try {
    await waitForChrome();
    const page = await fetchJson(`http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(baseUrl)}`, { method: 'PUT' });
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await setViewport(client, 1440, 1000);
    await client.send('Page.navigate', { url: baseUrl });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const hydrated = await evaluate(client, `(() => {
        const button = document.querySelector('nav button');
        return Boolean(button && Object.keys(button).some((key) => key.startsWith('__reactProps')));
      })()`);
      if (hydrated) break;
      await wait(200);
    }
    await wait(300);

    const title = await evaluate(client, 'document.title');
    check('Rota local carregada', title.includes('Central de Inteligência'), title);
    check('Sem conexão Supabase no recurso carregado', !(await evaluate(client, "performance.getEntriesByType('resource').some((entry) => /supabase/i.test(entry.name))")));

    const views = [
      ['Mês', 'Como está o mês?', '01-mes-desktop.jpg'],
      ['Atendimento', 'Estamos atendendo bem?', '02-atendimento-desktop.jpg'],
      ['Resultado', 'Onde está o resultado?', '03-resultado-desktop.jpg'],
      ['Unidades', 'Qual unidade precisa de atenção?', '04-unidades-desktop.jpg'],
      ['Público', 'Quem está utilizando o serviço?', '05-publico-desktop.jpg'],
      ['Desperdício', 'Onde estamos desperdiçando?', '06-desperdicio-desktop.jpg'],
      ['Previsão', 'Como vamos fechar o mês?', '07-previsao-desktop.jpg'],
      ['Ações', 'O que exige ação agora?', '08-acoes-desktop.jpg'],
    ];

    for (const [button, heading, file] of views) {
      const clicked = await clickButton(client, button);
      await wait(400);
      const activeHeading = await evaluate(client, "document.querySelector('main h2')?.textContent");
      check(`Navegação: ${button}`, clicked && activeHeading === heading, activeHeading || 'sem título');
      await screenshot(client, file);
    }

    await clickButton(client, 'Mês');
    await selectValue(client, 0, 'september');
    await selectValue(client, 1, 'south');
    await selectValue(client, 2, 'partial');
    await wait(400);
    const selectedFilters = await evaluate(client, "[...document.querySelectorAll('select')].map((item) => item.value)");
    check('Filtros combinados', JSON.stringify(selectedFilters) === JSON.stringify(['september', 'south', 'partial']), selectedFilters.join(', '));

    await clickButton(client, 'Público');
    await wait(400);
    const audience = await evaluate(client, `(() => {
      const section = [...document.querySelectorAll('section')].find((item) => item.textContent.includes('Consumo por categoria'));
      return section ? { text: section.textContent, label: section.querySelector('[role="img"]')?.getAttribute('aria-label') } : null;
    })()`);
    check('Filtro de categoria refletido na composição', audience?.text.includes('Comensal parcial') && !audience?.text.includes('Bolsista integral') && audience?.label?.startsWith('100 por cento'), audience?.label || 'sem composição');

    await clickButton(client, 'Limpar');
    await clickButton(client, 'Mês');
    await clickButton(client, 'Ver unidade crítica');
    await wait(400);
    const criticalAction = await evaluate(client, "({ heading: document.querySelector('main h2')?.textContent, unit: document.querySelectorAll('select')[1]?.value })");
    check('Ação Ver unidade crítica', criticalAction.heading === 'Qual unidade precisa de atenção?' && criticalAction.unit === 'north', JSON.stringify(criticalAction));

    for (const [button, expected] of [['Carregando', 'Carregando demonstração...'], ['Vazio', 'Nenhum dado para esta combinação'], ['Indisponível', 'Indicadores temporariamente indisponíveis'], ['Dados', 'Qual unidade precisa de atenção?']]) {
      await clickButton(client, button);
      await wait(300);
      const visible = await evaluate(client, `document.body.innerText.includes(${JSON.stringify(expected)})`);
      check(`Estado: ${button}`, visible, expected);
    }

    const keyboard = await evaluate(client, `(() => {
      const interactive = [...document.querySelectorAll('button:not([disabled]), select, summary')];
      const inaccessible = interactive.filter((item) => item.tabIndex < 0).length;
      const target = document.querySelector('nav button');
      target.focus();
      const style = getComputedStyle(target);
      return { count: interactive.length, inaccessible, focused: document.activeElement === target, outline: style.outlineStyle };
    })()`);
    check('Navegação por teclado e foco visível', keyboard.count > 0 && keyboard.inaccessible === 0 && keyboard.focused && keyboard.outline !== 'none', JSON.stringify(keyboard));

    for (const [width, height, label, file] of [[1440, 1000, 'desktop', '09-responsivo-desktop.jpg'], [768, 1024, 'tablet', '10-responsivo-tablet.jpg'], [390, 844, 'celular', '11-responsivo-celular.jpg']]) {
      await setViewport(client, width, height);
      await clickButton(client, 'Mês');
      await wait(300);
      const overflow = await evaluate(client, 'document.documentElement.scrollWidth > document.documentElement.clientWidth');
      check(`Responsividade ${label}`, !overflow, `${width}x${height}`);
      await screenshot(client, file);
    }
  } finally {
    if (client) client.close();
    chrome.kill();
  }

  const failed = results.filter((item) => !item.passed);
  console.log(`\nResumo: ${results.length - failed.length}/${results.length} verificações aprovadas.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
