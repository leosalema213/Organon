// Focused shell/protocol integration. Actual signed plugin bundles; synthetic domain IPC.
// No personal profile or remote database is used. Run after npm run build.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { verifyCatalog, validatePackage } = require('../electron/plugins.cjs');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-modules-ui-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
(async () => {
  const output = path.join(root, 'plugins', 'out');
  const envelope = JSON.parse(fs.readFileSync(path.join(output, 'organon-plugins-catalog.json'), 'utf8'));
  const catalog = verifyCatalog(envelope, require('../electron/plugin-public-key.cjs'));
  assert.deepEqual(catalog.plugins.map(p => p.id).sort(), ['financeiro', 'mei']);
  for (const item of catalog.plugins) validatePackage(fs.readFileSync(path.join(output, path.basename(new URL(item.url).pathname))), item, require('../package.json').version);
  assert.ok(fs.existsSync(path.join(root, 'dist', 'build-manifest.json')), 'Execute npm run build antes deste teste.');
  const { seed, newNotebook } = await import('../src/model.js');
  const notebook = { ...newNotebook(), name: 'Original pessoal preservado' };
  notebook.pages[0].title = 'Página pessoal'; notebook.pages[0].text = 'Conteúdo pessoal';
  const fixture = { ...seed(), onboardingCompleted: true, notebooks: [notebook] };
  fs.writeFileSync(path.join(profile, 'compasso.json'), JSON.stringify(fixture));
  app = await electron.launch({ ...(packaged ? { executablePath: path.join(root, 'release', require('../package.json').version, 'win-unpacked', 'Organon.exe') } : {}), args: [...(packaged ? [] : [root]), `--user-data-dir=${profile}`, '--skip-account-prompt'], env });
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), packaged);
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor();
  await app.evaluate(async ({ app, ipcMain, BrowserWindow }, fixtureDirectory) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const fs = require('node:fs'), path = require('node:path');
    const { createPluginManager, registerPluginIpc, CATALOG_URL } = require('./electron/plugins.cjs');
    const { report } = require('./electron/modules/mei.cjs');
    const window = BrowserWindow.getAllWindows()[0], output = fixtureDirectory;
    const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'modules-ui@example.invalid', name: 'Pessoa sintética', nickname: 'Teste' };
    const workspace = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', owner_id: user.id, name: 'Espaço sintético' };
    const board = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', org_id: workspace.id, name: 'Quadro de teste', bg_type: 'none', revision: 1 };
    const list = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', board_id: board.id, org_id: workspace.id, name: 'A fazer', position: 0, color: '#777777', revision: 1 };
    const card = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', board_id: board.id, org_id: workspace.id, list_id: list.id, title: 'Cartão preservado', description: '<p>Descrição sintética</p>', position: 0, revision: 1 };
    const now = new Date(), year = now.getFullYear(), date = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const type = { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'Casa', revision: 1 };
    const entries = [{ id: '11111111-1111-4111-8111-111111111111', description: 'Entrada sintética', value: '100.25', typeId: type.id, entryType: 'entrada', entryDate: date, countForMei: true, createdAt: `${date}T12:00:00Z`, revision: 1 }];
    const settings = [{ id: '22222222-2222-4222-8222-222222222222', orgId: workspace.id, ownerId: user.id, year, meiLimit: '1000.00', revision: 1 }];
    const personal = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'compasso.json'), 'utf8')).notebooks[0];
    let shared = { org_id: workspace.id, module: 'notebooks', resource_id: personal.id, content: { ...structuredClone(personal), name: 'Caderno compartilhado sintético' }, revision: 1, canWrite: true };
    const state = globalThis.modulesUiTest = { entries, served: [], downloads: [], calls: [], sharedSaves: 0, manager: null };
    // Keep accidental renderer/updater HTTP requests inside this isolated test.
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const manager = state.manager = createPluginManager({ directory: path.join(app.getPath('userData'), 'plugins'), hostVersion: app.getVersion(), publicKey: require('./electron/plugin-public-key.cjs'),
      emit: status => window.webContents.send('plugins:changed', status),
      fetchImpl: async url => {
        state.downloads.push(url);
        const filename = url === CATALOG_URL ? 'organon-plugins-catalog.json' : path.basename(new URL(url).pathname);
        if (!/^organon-(plugins-catalog\.json|plugin-(financeiro|mei)-\d+\.\d+\.\d+\.organon-plugin)$/.test(filename)) throw new Error('Download inesperado no teste.');
        const bytes = fs.readFileSync(path.join(output, filename));
        return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
      } });
    for (const name of ['list', 'check', 'install', 'remove', 'rollback', 'entry']) ipcMain.removeHandler(`plugins:${name}`);
    registerPluginIpc({ ipcMain, manager, isTrustedSender: event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame });
    await window.webContents.session.protocol.unhandle('organon-plugin');
    window.webContents.session.protocol.handle('organon-plugin', async request => {
      const response = await manager.handleRequest(request);
      state.served.push({ url: request.url, status: response.status }); return response;
    });
    const status = { enabled: true, promptSeen: true, user, pending: false, busy: false, lastSync: new Date().toISOString(), error: '', conflict: null };
    for (const name of ['status', 'sync', 'skip']) { ipcMain.removeHandler(`cloud:${name}`); ipcMain.handle(`cloud:${name}`, () => status); }
    ipcMain.removeHandler('modules:watch'); ipcMain.handle('modules:watch', (_event, orgId) => { if (orgId && orgId !== workspace.id) throw new Error('Espaço inesperado.'); return { connected: true, realtime: false }; });
    ipcMain.removeHandler('modules:call');
    ipcMain.handle('modules:call', async (_event, module, action, payload = {}) => {
      state.calls.push({ module, action });
      if (['financeiro', 'mei'].includes(module) && !(await manager.list()).plugins.some(p => p.id === module && p.installed)) throw new Error('Plugin não instalado.');
      if (payload.orgId && payload.orgId !== workspace.id) throw new Error('Espaço inesperado.');
      if (module === 'teams') {
        if (action === 'list') return [workspace];
        if (action === 'notifications' || action === 'members') return [];
        if (action === 'inbox') return { notifications: [], invitations: [], unreadCount: 0 };
        if (action === 'roster') return [{ id: workspace.id, user_id: user.id, name: 'Pessoa sintética', nickname: 'Teste', status: 'accepted', role: 'owner' }];
        if (action === 'catalog') return { notebooks: [{ id: personal.id, name: personal.name }], books: [], kanban: [{ id: board.id, name: board.name }] };
        if (action === 'resources') return [structuredClone(shared)];
        if (action === 'openResource' && payload.resourceId === personal.id) return structuredClone(shared);
        if (action === 'editResource' && payload.resourceId === personal.id) {
          assertRevision(payload.revision, shared.revision);
          shared = { ...shared, content: structuredClone(payload.content), revision: shared.revision + 1 }; state.sharedSaves++;
          return { ok: true };
        }
      }
      if (module === 'kanban') {
        if (action === 'getBoards') return [board];
        if (action === 'getTags') return { tags: [], canManageTags: true, canCreateBoard: true };
        if (action === 'getBoard') return { board, lists: [list], cards: [card], tags: [], cardTags: [], canWrite: true, canManageTags: true };
      }
      if (module === 'financeiro' && action === 'snapshot') return { entries: structuredClone(entries), types: [type], canWrite: true };
      if (module === 'mei' && action === 'load') return { ...report(entries, settings, payload.year, payload.month), allSettings: settings, types: [type] };
      throw new Error(`Comando inesperado: ${module}/${action}`);
    });
    function assertRevision(received, expected) { if (received !== expected) throw new Error('Revisão incorreta.'); }
    window.webContents.send('cloud:status', status);
  }, output);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.reload();
  await page.getByRole('button', { name: 'Abrir meu perfil', exact: true }).waitFor();
  const nav = page.locator('.sidebar nav');
  assert.equal(await nav.getByRole('button', { name: 'Financeiro', exact: true }).count(), 0);
  assert.equal(await nav.getByRole('button', { name: 'MEI', exact: true }).count(), 0);
  if (!packaged) {
  await nav.getByRole('button', { name: 'Quadros', exact: true }).click();
  await page.getByRole('button', { name: 'Cartão preservado', exact: true }).waitFor();
  await nav.getByRole('button', { name: 'Equipes', exact: true }).click();
  await page.getByRole('button', { name: 'Membros', exact: true }).waitFor();
  await page.locator('.teams-row').getByText('Pessoa sintética', { exact: true }).waitFor();
  await nav.getByRole('button', { name: 'Cadernos', exact: true }).click();
  await page.getByRole('button', { name: 'Cadernos compartilhados', exact: true }).click();
  await page.getByRole('button', { name: 'Caderno compartilhado sintético', exact: true }).click();
  await page.locator('.shared-notebook [role="textbox"][contenteditable="false"]').waitFor();
  await page.getByRole('button', { name: 'Editar caderno', exact: true }).click();
  await page.locator('.shared-notebook [role="textbox"][contenteditable="true"]').waitFor();
  await page.getByLabel('Título da página compartilhada', { exact: true }).fill('Título colaborativo');
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await page.locator('.shared-notebook').waitFor({ state: 'hidden' });
  assert.equal(await app.evaluate(() => globalThis.modulesUiTest.sharedSaves), 1);
  }
  async function preferences() {
    await page.getByRole('button', { name: 'Preferências', exact: true }).click();
    await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
    return page.getByRole('dialog', { name: 'Preferências', exact: true });
  }
  const dialog = await preferences();
  await dialog.locator('.preference-section').filter({ has: page.getByRole('heading', { name: 'Financeiro', exact: true }) }).getByRole('button', { name: 'Baixar e instalar', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.organon-plugin-settings .secondary')?.disabled);
  assert.ok((await app.evaluate(() => globalThis.modulesUiTest.downloads)).includes(require('../electron/plugins.cjs').CATALOG_URL), 'Abrir Plugins consulta automaticamente o catálogo.');
  const pluginRow = id => dialog.locator('.preference-section').filter({ has: page.getByRole('heading', { name: id, exact: true }) });
  for (const name of ['Financeiro', 'MEI']) {
    await pluginRow(name).getByRole('button', { name: 'Baixar e instalar', exact: true }).click();
    const id = name === 'Financeiro' ? 'financeiro' : 'mei';
    // The same <small> also shows "· Disponível: ..." after the installed version.
    try {
      await pluginRow(name).getByText(`Instalado · ${catalog.plugins.find(item => item.id === id).version}`, { exact: false }).waitFor({ timeout: 10000 });
    } catch (error) {
      const alerts = page.isClosed() ? [] : await dialog.getByRole('alert').allTextContents().catch(() => []);
      throw new Error(`Instalação de ${name}: ${alerts.join('; ') || error.message}`);
    }
  }
  await dialog.getByRole('button', { name: 'Concluir', exact: true }).click();
  await nav.getByRole('button', { name: 'Financeiro', exact: true }).click();
  await page.locator('.financeiro-page').getByRole('button', { name: 'Entrada sintética', exact: true }).waitFor();
  assert.equal(await page.getByText(/Projetados não compõem o saldo/).count(), 0);
  const financeLayout = await page.locator('.financeiro-page').evaluate(element => ({ padding: getComputedStyle(element).paddingLeft, title: getComputedStyle(element.querySelector('h1')).fontSize, expectedTitle: getComputedStyle(document.documentElement).getPropertyValue('--heading-size').trim() }));
  assert.equal(financeLayout.padding, '0px', 'Financeiro usa somente o padding do conteúdo compartilhado.');
  assert.equal(financeLayout.title, financeLayout.expectedTitle, 'Título financeiro segue a densidade do aplicativo.');
  await page.getByRole('button', { name: 'Novo lançamento', exact: true }).click();
  await page.getByRole('dialog', { name: 'Novo lançamento', exact: true }).waitFor();
  await page.getByRole('dialog', { name: 'Novo lançamento', exact: true }).getByRole('button', { name: 'Cancelar', exact: true }).click();
  await nav.getByRole('button', { name: 'MEI', exact: true }).click();
  await page.getByRole('region', { name: 'Totais anuais', exact: true }).waitFor();
  await page.locator('.mei-page .page-heading').getByLabel('Ano', { exact: true }).waitFor();
  assert.equal(await page.getByText('Controle salarial + teto MEI', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Resumo mensal', exact: true }).click();
  await page.getByRole('heading', { name: 'Resumo mensal', exact: true }).waitFor();
  const served = await app.evaluate(() => globalThis.modulesUiTest.served);
  for (const id of ['financeiro', 'mei']) for (const file of ['index.js', 'style.css']) assert.ok(served.some(r => r.status === 200 && r.url.includes(`/${id}/`) && r.url.endsWith('/' + file)), `${id}/${file} precisa carregar pelo protocolo real.`);
  assert.equal(await page.evaluate(() => globalThis[Symbol.for('organon.plugins.host.v1')]?.abi), 1);
  const removal = await preferences();
  await removal.locator('.preference-section').filter({ has: page.getByRole('heading', { name: 'Financeiro', exact: true }) }).getByRole('button', { name: 'Remover', exact: true }).click();
  await page.getByRole('dialog', { name: 'Remover Financeiro?', exact: true }).getByRole('button', { name: 'Remover plugin', exact: true }).click();
  await removal.getByText('Plugin removido. Seus dados foram preservados.', { exact: true }).waitFor();
  await removal.getByRole('button', { name: 'Concluir', exact: true }).click();
  assert.equal(await nav.getByRole('button', { name: 'Financeiro', exact: true }).count(), 0);
  assert.equal(await nav.getByRole('button', { name: 'MEI', exact: true }).count(), 1);
  assert.equal(await app.evaluate(() => globalThis.modulesUiTest.entries.length), 1);
  const saved = JSON.parse(fs.readFileSync(path.join(profile, 'compasso.json'), 'utf8'));
  assert.deepEqual(saved.notebooks, fixture.notebooks, 'Edição compartilhada e remoção de plugin não alteram os originais pessoais.');
  assert.deepEqual(errors, [], 'Não deve haver falhas de renderização dos módulos.');
  console.log(packaged ? 'Preview empacotado: instalação/abertura/remoção dos plugins assinados, JavaScript/CSS pelo protocolo real e preservação dos dados aprovados. Perfil temporário e rede simulada; não valida download público do GitHub.' : 'Módulos UI: quadro/equipes, caderno compartilhado com leitura/edição, instalação e remoção dos pacotes assinados Financeiro/MEI pelo protocolo real aprovados. Perfil temporário e rede simulada; não valida Supabase/GitHub reais.');
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close();
  const target = path.resolve(profile);
  if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('organon-modules-ui-')) fs.rmSync(target, { recursive: true, force: true });
});
