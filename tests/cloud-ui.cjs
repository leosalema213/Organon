const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-account-'));
const output = path.join(root, 'test-output'); fs.mkdirSync(output, { recursive: true });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const options = (process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE)
  ? { executablePath: path.resolve((process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE)), args: [`--user-data-dir=${profile}`, '--enable-cloud-test'], env }
  : { args: [root, `--user-data-dir=${profile}`, '--enable-cloud-test'], env };
let app;
(async () => {
  const { seed, firstPlan } = await import('../src/model.js');
  const fixture = { ...seed(), plans: [{ ...firstPlan(), name: 'Meu conteúdo existente' }], onboardingCompleted: true };
  fs.writeFileSync(path.join(profile, 'compasso.json'), JSON.stringify(fixture));
  app = await electron.launch(options); let page = await app.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('dialog', { name: 'Sua conta', exact: true }).waitFor();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(output, 'account-welcome.png') });
  await page.getByRole('button', { name: 'Continuar offline', exact: true }).click();
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await page.getByRole('tab', { name: 'Conta', exact: true }).click();
  await page.getByRole('button', { name: 'Entrar ou criar conta', exact: true }).waitFor();
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'compasso.json'))).plans[0].name, fixture.plans[0].name);
  await app.close(); app = null;
  app = await electron.launch(options); page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: 'Sua conta', exact: true }).count(), 0);
  // The network is simulated; real controller, filesystem and Windows encryption are exercised.
  await app.evaluate(async ({ app, ipcMain, safeStorage, BrowserWindow }) => {
    const require = process.getBuiltinModule('module').createRequire(process.getBuiltinModule('path').join(app.getAppPath(), 'package.json'));
    const { CloudSync } = require('./electron/cloud.cjs');
    const fs = require('node:fs'), path = require('node:path');
    const win = BrowserWindow.getAllWindows()[0];
    globalThis.accountTest = { row: null, requests: 0, uploads: 0, assets: new Map() };
    const server = globalThis.accountTest;
    const cloud = new CloudSync({ directory: app.getPath('userData'), safeStorage,
      readData: () => JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'compasso.json'))),
      emit: status => win.webContents.send('cloud:status', status),
      fetchImpl: async (url, options) => {
        server.requests++; const endpoint = new URL(url).pathname;
        const body = Buffer.isBuffer(options.body) ? options.body : options.body ? JSON.parse(options.body) : null;
        const respond = value => new Response(JSON.stringify(value));
        if (endpoint.startsWith('/auth/v1/') && endpoint !== '/auth/v1/logout') return respond({ access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token', expires_in: 3600, user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: body.email } });
        if (endpoint === '/auth/v1/logout') return respond(null);
        if (endpoint === '/rest/v1/organon_sync_state') return respond(server.row ? [server.row] : []);
        if (endpoint === '/rest/v1/organon_profiles') { if (body) server.profile = body; return respond(server.profile ? [server.profile] : []); }
        if (endpoint.includes('/object/list/')) return respond([...server.assets.keys()].map(name => ({ name })));
        if (endpoint.includes('/object/organon-assets/')) { server.uploads++; server.assets.set(endpoint.split('/').at(-1), body); return respond({}); }
        if (endpoint === '/rest/v1/rpc/organon_commit_snapshot') { server.row = { payload: body.p_payload, checksum: body.p_checksum, revision: 1, updated_at: new Date().toISOString() }; return respond({ ok: true, current: server.row }); }
        throw new Error('Unexpected endpoint');
      } });
    await cloud.ready;
    const handlers = { status: () => cloud.status(), authenticate: (...args) => cloud.authenticate(...args), skip: () => cloud.skip(), signout: () => cloud.signOut(), sync: () => cloud.sync() };
    for (const [name, action] of Object.entries(handlers)) { ipcMain.removeHandler('cloud:' + name); ipcMain.handle('cloud:' + name, (_event, ...args) => action(...args)); }
  });
  await page.getByRole('button', { name: 'Preferências', exact: true }).click(); await page.getByRole('tab', { name: 'Conta', exact: true }).click();
  await page.getByRole('button', { name: 'Entrar ou criar conta', exact: true }).click();
  await page.getByRole('tab', { name: 'Criar conta', exact: true }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Pessoa sintética');
  await page.getByLabel('Apelido', { exact: true }).fill('Teste');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('E-mail', { exact: true }).fill('test@example.invalid');
  await page.getByLabel('Senha', { exact: true }).fill('synthetic-password-123');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Pular foto e criar conta', exact: true }).click();
  await page.getByText('test@example.invalid', { exact: true }).waitFor({ timeout: 10000 }).catch(async error => { await page.screenshot({ path: path.join(output, 'account-error.png') }); throw new Error(error.message + '\n' + (await page.locator('.form-error').allTextContents()).join('\n')); });
  await page.getByText('Dados sincronizados', { exact: true }).first().waitFor();
  assert.equal(await app.evaluate(() => globalThis.accountTest.row.payload.plans[0].name), fixture.plans[0].name);
  const sessionFile = path.join(profile, 'cloud-session.enc');
  assert(fs.existsSync(sessionFile)); assert(!fs.readFileSync(sessionFile, 'utf8').includes('synthetic-refresh-token'));
  assert.equal(await app.evaluate(async ({ safeStorage, app }) => {
    const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path');
    const decrypted = await safeStorage.decryptStringAsync(fs.readFileSync(path.join(app.getPath('userData'), 'cloud-session.enc')));
    return JSON.parse(decrypted.result).user.email;
  }), 'test@example.invalid');
  assert.equal(await app.evaluate(async ({ safeStorage, app }) => {
    const require = process.getBuiltinModule('module').createRequire(process.getBuiltinModule('path').join(app.getAppPath(), 'package.json'));
    const { CloudSync } = require('./electron/cloud.cjs');
    const restored = new CloudSync({ directory: app.getPath('userData'), safeStorage, readData: () => null });
    await restored.ready; return restored.status().user.email;
  }), 'test@example.invalid');
  await page.screenshot({ path: path.join(output, 'account-connected.png') });
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await page.getByRole('button', { name: 'Entrar ou criar conta', exact: true }).waitFor();
  assert(!fs.existsSync(sessionFile));
  await page.getByRole('button', { name: 'Concluir', exact: true }).click();
  // Exercise a large screenshot-like PNG through the actual editor entry point and worker.
  const payload = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1400;
    const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(canvas.width, canvas.height);
    let seed = 42;
    for (let i = 0; i < pixels.data.length; i += 4) { seed = (seed * 1664525 + 1013904223) >>> 0; pixels.data[i] = seed & 255; pixels.data[i + 1] = seed >>> 8 & 255; pixels.data[i + 2] = seed >>> 16 & 255; pixels.data[i + 3] = 255; }
    ctx.putImageData(pixels, 0, 0); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 650, 140); ctx.fillStyle = 'black'; ctx.font = '40px sans-serif'; ctx.fillText('Texto legível de teste', 20, 80);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'Cadernos', exact: true }).click(); await page.getByRole('button', { name: 'Novo caderno', exact: true }).click();
  await page.getByLabel('Nome do caderno', { exact: true }).fill('Imagens otimizadas'); await page.getByRole('button', { name: 'Salvar caderno', exact: true }).click();
  await page.getByRole('textbox', { name: 'Texto da anotação', exact: true }).waitFor();
  // The picker captures the insertion bookmark before the asynchronous worker starts.
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Imagem', exact: true }).click();
  await (await chooser).setFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.from(payload, 'base64') });
  await page.locator('.notebook-text img').waitFor({ timeout: 30000 });
  const src = await page.locator('.notebook-text img').getAttribute('src');
  const bytes = Buffer.from(src.split(',')[1], 'base64').length;
  assert(bytes <= 1024 * 1024); assert(bytes < Buffer.from(payload, 'base64').length);
  await page.waitForFunction(() => document.querySelector('.notebook-text img')?.naturalWidth > 0);
  await page.screenshot({ path: path.join(output, 'image-compressed.png') });
  assert.deepEqual(errors, []);
  const secondChooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Imagem', exact: true }).click();
  await (await secondChooser).setFiles({ name: 'second-large.png', mimeType: 'image/png', buffer: Buffer.from(payload, 'base64') });
  await page.getByText('Preparando imagem…', { exact: true }).waitFor();
  const closed = app.waitForEvent('close'); await page.evaluate(() => window.desktop.close()); await closed; app = null;
  const saved = JSON.parse(fs.readFileSync(path.join(profile, 'compasso.json'), 'utf8'));
  assert.equal(saved.notebooks[0].pages[0].document.content.filter(node => node.type === 'image').length, 2);
  fs.writeFileSync(path.join(output, 'cloud-ui-audit.json'), JSON.stringify({ result: 'PASS', network: 'simulated', encryption: 'real Windows safeStorage', originalBytes: Buffer.from(payload, 'base64').length, optimizedBytes: bytes }, null, 2));
  console.log('PASS: one-time account prompt, offline/restart, signup UI, local linking, real Windows session encryption, signout, large image worker compression and safe close during processing.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (app) await app.close(); });
