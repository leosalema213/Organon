// Focused renderer checks with simulated IPC. No personal profiles or remote writes.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-sync-onboarding-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
(async () => {
  const { seed, firstPlan } = await import('../src/model.js');
  const data = { ...seed(), onboardingCompleted: true, plans: [{ ...firstPlan(), name: 'Plano da nuvem' }] };
  fs.writeFileSync(path.join(profile, 'compasso.json'), JSON.stringify({ ...data, plans: [] }));
  app = await electron.launch({ args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env });
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor();
  await app.evaluate(({ ipcMain, BrowserWindow }, data) => {
    const win = BrowserWindow.getAllWindows()[0];
    const state = globalThis.syncOnboarding = { user: null, promptSeen: true, enabled: true, busy: false, conflict: null, downloads: 0, updates: 0, version: '1.0.0', available: false };
    const emit = () => { const value = { ...state }; win.webContents.send('cloud:status', value); return value; };
    const pluginStatus = () => ({ configured: true, busy: false, plugins: [{ id: 'financeiro', name: 'Financeiro', installed: true, version: state.version, availableVersion: '1.1.0', updateAvailable: state.available }] });
    const handlers = {
      'cloud:status': () => ({ ...state }),
      'cloud:authenticate': () => { state.user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'synthetic@example.invalid' }; return emit(); },
      'cloud:sync': () => { state.conflict = { updatedAt: '2026-11-09T10:00:00Z' }; return emit(); },
      'cloud:download': async () => {
        state.downloads++; state.busy = true; state.progress = { stage: 'downloading', completed: 0, total: 3 }; emit();
        await new Promise(resolve => { globalThis.releaseSyncDownload = resolve; });
        state.progress.completed = 2; emit();
        await new Promise(resolve => { globalThis.finishSyncDownload = resolve; });
        state.busy = false; state.progress = null; emit(); return data;
      },
      'cloud:accept': () => {
        state.conflict = null; state.lastSync = new Date().toISOString();
        state.available = true; win.webContents.send('plugins:changed', pluginStatus()); return emit();
      },
      'plugins:list': pluginStatus,
      'plugins:check': () => { win.webContents.send('plugins:changed', pluginStatus()); return {}; },
      'plugins:install': id => {
        assertId(id); state.updates++; state.version = '1.1.0'; state.available = false;
        win.webContents.send('plugins:changed', pluginStatus()); return {};
      },
    };
    function assertId(id) { if (id !== 'financeiro') throw new Error('Unexpected plugin'); }
    for (const [channel, action] of Object.entries(handlers)) { ipcMain.removeHandler(channel); ipcMain.handle(channel, (_event, ...args) => action(...args)); }
  }, data);
  await page.reload();
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await page.getByRole('tab', { name: 'Conta', exact: true }).click();
  await page.getByRole('button', { name: 'Entrar ou criar conta', exact: true }).click();
  await page.getByLabel('E-mail', { exact: true }).fill('synthetic@example.invalid');
  await page.getByLabel('Senha', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Entrar na minha conta', exact: true }).click();
  const conflict = page.getByRole('dialog', { name: 'Seus dados estão na nuvem', exact: true });
  await conflict.waitFor();
  assert.equal(await app.evaluate(() => globalThis.syncOnboarding.downloads), 0);
  await conflict.getByRole('button', { name: 'Trazer dados da nuvem', exact: true }).click();
  await conflict.getByRole('button', { name: 'Confirmar escolha', exact: true }).click();
  await conflict.getByRole('progressbar').waitFor();
  await page.locator('.account-badge progress[value="0"][max="3"]').waitFor();
  await app.evaluate(() => globalThis.releaseSyncDownload());
  await page.locator('.account-badge progress[value="2"][max="3"]').waitFor();
  await app.evaluate(() => globalThis.finishSyncDownload());
  await conflict.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Concluir', exact: true }).click();
  const updates = page.getByRole('dialog', { name: 'Atualizações de plugins', exact: true });
  await updates.waitFor();
  assert.equal(await app.evaluate(() => globalThis.syncOnboarding.updates), 0, 'An update requires consent');
  await updates.getByRole('button', { name: 'Atualizar agora', exact: true }).click();
  await updates.waitFor({ state: 'hidden' });
  assert.equal(await app.evaluate(() => globalThis.syncOnboarding.updates), 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'compasso.json'))).plans[0].name, 'Plano da nuvem');
  console.log('Login → escolha automática → progresso na lateral → restauração → confirmação de atualização: aprovados. IPC simulado.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close();
  const target = path.resolve(profile);
  if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('organon-sync-onboarding-')) fs.rmSync(target, { recursive: true, force: true });
});
