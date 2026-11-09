// Focused UI contract; IPC is simulated and no installer is downloaded or executed.
const { _electron: electron } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-update-scheduling-ui-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
(async () => {
  const { seed } = await import('../src/model.js');
  fs.writeFileSync(path.join(profile, 'compasso.json'), JSON.stringify({ ...seed(), onboardingCompleted: true }));
  app = await electron.launch({ args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env });
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor();
  await app.evaluate(({ app, ipcMain, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const probe = global.updateSchedulingProbe = { scheduled: 0, cancelled: 0, installed: 0, state: { status: 'ready', currentVersion: app.getVersion(), version: '99.0.0', percent: 100 } };
    const status = value => { probe.state = { ...probe.state, ...value }; win.webContents.send('updates:status', probe.state); return probe.state; };
    for (const name of ['status', 'check', 'schedule', 'cancel-schedule', 'install']) ipcMain.removeHandler('updates:' + name);
    ipcMain.handle('updates:status', () => probe.state);
    ipcMain.handle('updates:check', () => probe.state);
    ipcMain.handle('updates:schedule', () => { probe.scheduled++; return status({ status: 'scheduled' }); });
    ipcMain.handle('updates:cancel-schedule', () => { probe.cancelled++; return status({ status: 'ready' }); });
    ipcMain.handle('updates:install', () => { probe.installed++; return status({ status: 'installing' }); });
    status({ status: 'ready' });
  });
  const ready = page.getByRole('dialog', { name: 'Pronto para atualizar', exact: true });
  await ready.getByRole('button', { name: 'Instalar na próxima abertura', exact: true }).click();
  await ready.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor();
  assert.deepEqual(await app.evaluate(() => ({ scheduled: global.updateSchedulingProbe.scheduled, installed: global.updateSchedulingProbe.installed })), { scheduled: 1, installed: 0 });
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await page.getByRole('tab', { name: 'Atualizações', exact: true }).click();
  await page.getByText('Atualização agendada para a próxima abertura.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Ver atualização', exact: true }).click();
  const scheduled = page.getByRole('dialog', { name: 'Atualização agendada', exact: true });
  await scheduled.getByRole('button', { name: 'Cancelar agendamento', exact: true }).click();
  await ready.getByRole('button', { name: 'Instalar na próxima abertura', exact: true }).waitFor();
  assert.equal(await app.evaluate(() => global.updateSchedulingProbe.cancelled), 1);
  await ready.getByRole('button', { name: 'Atualizar e reiniciar', exact: true }).click();
  await page.getByRole('dialog', { name: 'Atualizando o Organon', exact: true }).waitFor();
  assert.equal(await app.evaluate(() => global.updateSchedulingProbe.installed), 1);
  assert.deepEqual(errors, []);
  console.log('PASS: schedule keeps app open, preferences show authorization, cancellation restores ready state and install-now remains available. IPC simulated; installer not executed.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close();
  const target = path.resolve(profile);
  if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('organon-update-scheduling-ui-')) fs.rmSync(target, { recursive: true, force: true });
});
