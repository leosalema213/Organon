// Focused offline integration, only synthetic data in a temporary profile.
const { _electron: electron } = require('playwright');
const { drawRectangle, clickCanvas, chooseBoardImage } = require('./board-gestures.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-board-ui-'));
const file = path.join(profile, 'compasso.json'), errors = [], external = [];
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
(async () => {
  const { seed, newNotebook, validateData } = await import('../src/model.js');
  const book = newNotebook(); book.name = 'Projeto do jogo'; book.pages[0].text = 'Regras preservadas';
  fs.writeFileSync(file, JSON.stringify({ ...seed(), onboardingCompleted: true, notebooks: [book] }));
  app = await electron.launch({ args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env });
  const crashFile = path.join(root, 'test-output', 'notebook-board-ui-crash.json');
  fs.mkdirSync(path.dirname(crashFile), { recursive: true });
  fs.writeFileSync(crashFile, JSON.stringify({ events: [] }));
  await app.evaluate(({ app }, file) => {
    // App-level events can be registered before the first BrowserWindow exists.
    app.on('render-process-gone', (_event, _webContents, details) => {
      const fs = process.getBuiltinModule('fs');
      const report = JSON.parse(fs.readFileSync(file, 'utf8'));
      report.events.push({ ...details, at: new Date().toISOString(), electron: process.versions.electron, chrome: process.versions.chrome });
      fs.writeFileSync(file, JSON.stringify(report, null, 2));
    });
  }, crashFile);
  const page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true })));
  await page.getByRole('button', { name: 'Cadernos', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir caderno Projeto do jogo', exact: true }).click();
  await page.getByRole('button', { name: 'Nova', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Tela de desenho', exact: true }).click();
  await page.locator('.notebook-board .excalidraw__canvas.interactive').waitFor();
  await page.getByRole('textbox', { name: 'Título da página', exact: true }).fill('Mapa inicial');
  const read = () => validateData(JSON.parse(fs.readFileSync(file, 'utf8')));
  const board = () => read().notebooks[0].pages.find(page => page.kind === 'board')?.board;
  async function waitData(predicate, description) {
    const end = Date.now() + 20000;
    while (Date.now() < end) { try { if (predicate()) return; } catch { /* Local atomic save may be in progress. */ } await new Promise(resolve => setTimeout(resolve, 100)); }
    const alerts = await page.locator('.notebook-board [role="alert"]').allTextContents();
    throw new Error('Tempo esgotado: ' + description + (alerts.length ? '. ' + alerts.join(' ') : ''));
  }
  await drawRectangle(page, 100, 170, 120, 60);
  await waitData(() => board()?.elements.some(e => e.type === 'rectangle' && !e.isDeleted), 'salvar retângulo');
  await page.keyboard.press('Control+z');
  await waitData(() => board()?.elements.some(e => e.type === 'rectangle' && e.isDeleted), 'desfazer desenho');
  await page.keyboard.press('Control+Shift+z');
  await waitData(() => board()?.elements.some(e => e.type === 'rectangle' && !e.isDeleted), 'refazer desenho');
  const png = path.join(profile, 'reference.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
  await chooseBoardImage(page, png);
  await clickCanvas(page, 300, 200);
  await waitData(() => board()?.elements.some(e => e.type === 'image' && !e.isDeleted) && Object.keys(board().files).length === 1, 'persistir imagem editável');
  // Text editing exercises the bundled drawing font while all external requests are blocked.
  await page.locator('[data-testid="toolbar-text"]').check({ force: true });
  await clickCanvas(page, 120, 280); await page.keyboard.type('Missao da floresta'); await page.keyboard.press('Escape');
  await waitData(() => read().notebooks[0].pages.some(p => p.text.includes('Missao da floresta')), 'texto pesquisável');
  await page.evaluate(() => document.fonts.ready);
  assert.equal(external.filter(url => /esm\.sh|excalidraw|\.woff/.test(url)).length, 0, 'Fontes do quadro não devem depender de CDN');
  const localFontLoaded = await page.evaluate(async () => {
    const faces = await document.fonts.load('20px Excalifont', 'Missao da floresta');
    return faces.length > 0 && faces.every(face => face.status === 'loaded');
  });
  assert.equal(localFontLoaded, true, 'A fonte de desenho deve carregar com a rede externa bloqueada');
  await page.getByRole('button', { name: 'Tela cheia', exact: true }).click();
  await page.waitForFunction(() => document.fullscreenElement?.classList.contains('notebook-board'));
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.fullscreenElement);
  await clickCanvas(page, 350, 300);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -200); await page.keyboard.up('Control');
  await page.waitForFunction(() => Object.keys(sessionStorage).some(key => key.startsWith('organon:board-camera:') && JSON.parse(sessionStorage.getItem(key)).zoom?.value !== 1));
  const saved = structuredClone(board());
  await page.reload();
  await page.getByRole('button', { name: 'Cadernos', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir caderno Projeto do jogo', exact: true }).click();
  await page.locator('.journal-page-row').filter({ hasText: 'Mapa inicial' }).getByRole('button').first().click();
  await page.locator('.notebook-board .excalidraw__canvas.interactive').waitFor();
  assert.deepEqual(board().files, saved.files); assert.equal(read().notebooks[0].pages[0].text, 'Regras preservadas');
  const search = page.getByRole('textbox', { name: 'Buscar páginas', exact: true });
  await search.fill('floresta'); assert.equal(await page.locator('.journal-page-row').count(), 1); await search.fill('');
  await page.getByRole('button', { name: 'Excluir página Mapa inicial', exact: true }).click();
  await page.getByRole('dialog', { name: 'Excluir página?', exact: true }).getByRole('button', { name: 'Excluir página', exact: true }).click();
  await waitData(() => read().notebooks[0].pages.length === 1, 'excluir somente a página de quadro');
  assert.equal(read().notebooks[0].pages[0].text, 'Regras preservadas'); assert.deepEqual(errors, []);
  console.log('Quadro offline: criação, desenho, desfazer/refazer, imagem editável, texto/busca, fontes locais, câmera, tela cheia, reabertura e exclusão com preservação de texto aprovados.');
})().catch(error => {
  console.error(error.stack || error);
  const crashFile = path.join(root, 'test-output', 'notebook-board-ui-crash.json');
  if (fs.existsSync(crashFile)) { const report = JSON.parse(fs.readFileSync(crashFile, 'utf8')); if (report.events.length) console.error('Encerramento do renderer:', JSON.stringify(report)); }
  process.exitCode = 1;
}).finally(async () => {
  if (app) await app.close();
  const target = fs.realpathSync(profile), temporary = fs.realpathSync(os.tmpdir());
  if (path.dirname(target) === temporary && path.basename(target).startsWith('organon-board-ui-')) fs.rmSync(target, { recursive: true, force: true });
});
