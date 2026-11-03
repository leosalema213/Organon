// Focused account/profile UI checks. Network is simulated; the profile is temporary.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-account-profile-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
(async () => {
  const { seed, firstPlan } = await import('../src/model.js');
  const fixture = { ...seed(), onboardingCompleted: true, plans: [{ ...firstPlan(), name: 'Conteúdo preservado', notes: [{ id: 'n', date: '2026-11-03', text: 'Nota', images: ['data:image/png;base64,aGVsbG8='] }] }] };
  fs.writeFileSync(path.join(profile, 'compasso.json'), JSON.stringify(fixture));
  app = await electron.launch({ args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env });
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor();
  await app.evaluate(async ({ app, ipcMain, safeStorage, BrowserWindow }) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const fs = require('node:fs'), path = require('node:path');
    const { CloudSync } = require('./electron/cloud.cjs');
    const window = BrowserWindow.getAllWindows()[0];
    const server = globalThis.profileTest = { row: null, profile: null, assets: new Map(), resume: null };
    const gate = new Promise(resolve => { server.resume = resolve; });
    const cloud = new CloudSync({ directory: app.getPath('userData'), safeStorage,
      readData: () => JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'compasso.json'))),
      emit: status => window.webContents.send('cloud:status', status),
      fetchImpl: async (url, options) => {
        const endpoint = new URL(url).pathname, body = Buffer.isBuffer(options.body) ? options.body : options.body ? JSON.parse(options.body) : null;
        const response = value => new Response(JSON.stringify(value));
        if (endpoint === '/auth/v1/signup' || endpoint === '/auth/v1/token') return response({ access_token: 'synthetic-token', refresh_token: 'synthetic-refresh', expires_in: 3600, user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: body.email } });
        if (endpoint === '/auth/v1/logout') return response(null);
        if (endpoint === '/rest/v1/organon_profiles') { if (body) server.profile = { ...server.profile, ...body }; return response(server.profile ? [server.profile] : []); }
        if (endpoint === '/rest/v1/organon_sync_state') return response(server.row ? [server.row] : []);
        if (endpoint.includes('/object/list/')) return response([...server.assets.keys()].map(name => ({ name })));
        if (endpoint.includes('/object/authenticated/')) return new Response(server.assets.get(endpoint.split('/').at(-1)));
        if (endpoint.includes('/object/organon-assets/')) { await gate; server.assets.set(endpoint.split('/').at(-1), body); return response({}); }
        if (endpoint === '/rest/v1/rpc/organon_commit_snapshot') { server.row = { revision: 1, checksum: body.p_checksum, payload: body.p_payload, updated_at: new Date().toISOString() }; return response({ ok: true, current: server.row }); }
        throw new Error('Unexpected endpoint: ' + endpoint);
      } });
    await cloud.ready;
    const actions = { status: () => cloud.status(), authenticate: (...args) => cloud.authenticate(...args), sync: () => cloud.sync(), skip: () => cloud.skip(), signout: () => cloud.signOut(), profile: value => cloud.updateProfile(value) };
    for (const [name, action] of Object.entries(actions)) { ipcMain.removeHandler('cloud:' + name); ipcMain.handle('cloud:' + name, (_event, ...args) => action(...args)); }
  });
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await page.getByRole('tab', { name: 'Conta', exact: true }).click();
  await page.getByRole('button', { name: 'Entrar ou criar conta', exact: true }).click();
  await page.getByRole('tab', { name: 'Criar conta', exact: true }).click();
  await page.getByLabel('E-mail', { exact: true }).fill('profile@example.invalid');
  await page.getByLabel('Senha', { exact: true }).fill('synthetic-password-123');
  await page.getByRole('button', { name: 'Criar minha conta', exact: true }).click();
  await page.getByRole('dialog', { name: 'Sua conta', exact: true }).waitFor({ state: 'hidden' });
  await page.getByText('Enviando arquivos: 0 de 1', { exact: true }).first().waitFor();
  assert.equal(await app.evaluate(() => globalThis.profileTest.row), null, 'Account dialog must close before the slow upload completes');
  await page.getByRole('button', { name: 'Concluir', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir meu perfil', exact: true }).waitFor();
  assert.equal(await page.locator('.local-pill').innerText(), 'SINCRONIZANDO');
  await app.evaluate(() => globalThis.profileTest.resume());
  await page.locator('.account-badge').getByText('Dados sincronizados', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Abrir meu perfil', exact: true }).click();
  await page.getByRole('button', { name: 'Editar perfil', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Meu perfil', exact: true });
  await dialog.getByLabel('Nome', { exact: true }).fill('Pessoa de teste');
  await dialog.getByLabel('Apelido', { exact: true }).fill('Meu apelido');
  const photo = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16; canvas.getContext('2d').fillRect(0, 0, 16, 16); return canvas.toDataURL('image/png').split(',')[1]; });
  await dialog.locator('input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') });
  await dialog.locator('.account-avatar img').waitFor();
  await dialog.getByRole('button', { name: 'Salvar perfil', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.account-badge strong').innerText(), 'Meu apelido');
  assert.equal(await page.locator('.account-badge img').count(), 1);
  assert.equal(await app.evaluate(() => globalThis.profileTest.profile.name), 'Pessoa de teste');
  await page.getByRole('button', { name: 'Editar perfil', exact: true }).click();
  await dialog.getByRole('button', { name: 'Remover foto', exact: true }).click();
  await dialog.getByRole('button', { name: 'Salvar perfil', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.account-badge img').count(), 0);
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await page.locator('.local-badge').waitFor();
  assert((await page.locator('.local-badge').innerText()).includes('Dados locais'));
  assert.equal(await page.getByRole('button', { name: 'Abrir meu perfil', exact: true }).count(), 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'compasso.json'))).plans[0].name, fixture.plans[0].name);
  console.log('Conta/perfil: cadastro separado do upload lento, progresso, nome/apelido, foto/remover foto e saída da conta aprovados em perfil temporário. Rede simulada.');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close();
  const target = path.resolve(profile);
  if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('organon-account-profile-')) fs.rmSync(target, { recursive: true, force: true });
});
