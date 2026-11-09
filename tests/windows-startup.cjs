const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-startup-')), file = path.join(profile, 'compasso.json'), output = path.join(root, 'test-output'); fs.mkdirSync(output, { recursive: true });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const options = (process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE) ? { executablePath: path.resolve((process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE)), args: [`--user-data-dir=${profile}`, '--autostart', '--skip-account-prompt'], env } : { args: [root, `--user-data-dir=${profile}`, '--autostart', '--skip-account-prompt'], env };
let app;
async function installAdapters() {
  await app.evaluate(({ app, ipcMain, BrowserWindow }) => {
    const require = process.getBuiltinModule('module').createRequire(process.getBuiltinModule('path').join(app.getAppPath(), 'package.json'));
    const path = require('node:path'), fs = require('node:fs'), { EventEmitter } = require('node:events');
    const { WindowsStartup } = require(path.join(app.getAppPath(), 'electron/startup.cjs'));
    const { ReminderNotifications, openRemindersWindow } = require(path.join(app.getAppPath(), 'electron/reminder-notifications.cjs'));
    const read = () => JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'compasso.json'), 'utf8'));
    globalThis.startupFeatureTest = { calls: [], notifications: [], fail: false };
    const state = globalThis.startupFeatureTest; let current = { openAtLogin: false, executableWillLaunchAtLogin: false };
    const adapter = { getLoginItemSettings: () => current, setLoginItemSettings: value => { if (state.fail) throw Error('Simulated failure'); state.calls.push(value); current = { openAtLogin: value.openAtLogin, executableWillLaunchAtLogin: value.enabled }; } };
    const startup = new WindowsStartup({ app: adapter, path: app.getPath('exe'), available: true }); startup.sync(read().settings);
    class Notification extends EventEmitter { static isSupported() { return true; } constructor(options) { super(); this.options = options; } show() { state.notifications.push(this); } }
    const reminders = new ReminderNotifications({ Notification, open: () => openRemindersWindow(BrowserWindow.getAllWindows()[0]) });
    for (const name of ['startup:status', 'startup:set', 'reminders:startup']) ipcMain.removeHandler(name);
    ipcMain.handle('startup:status', () => startup.status()); ipcMain.handle('startup:set', (_event, enabled) => startup.set(enabled)); ipcMain.handle('reminders:startup', () => reminders.startup(read().reminders));
  });
}
async function notificationReady() {
  await app.evaluate(() => new Promise((resolve, reject) => {
    const interval = setInterval(() => { if (globalThis.startupFeatureTest.notifications.length) { clearInterval(interval); clearTimeout(timeout); resolve(); } }, 30);
    const timeout = setTimeout(() => { clearInterval(interval); reject(Error('No startup notification')); }, 5000);
  }));
}
(async () => {
  const { dayKey, firstPlan, preferences, seed, validateData } = await import('../src/model.js');
  const { newReminder } = await import('../src/reminders.js');
  const today = dayKey(), tomorrowDate = new Date(); tomorrowDate.setDate(tomorrowDate.getDate() + 1); const tomorrow = dayKey(tomorrowDate);
  const note = (title, extra) => ({ ...newReminder(today), title, ...extra });
  fs.writeFileSync(file, JSON.stringify({ ...seed(), onboardingCompleted: true, settings: preferences(), plans: [{ ...firstPlan(), name: 'Estudar', days: [0, 1, 2, 3, 4, 5, 6] }], reminders: [note('Lembrar hoje', { notifyOnStartup: true }), note('Lembrar sempre', { schedule: 'daily', notifyOnStartup: true }), note('Amanhã', { date: tomorrow, notifyOnStartup: true }), note('Já vista', { notifyOnStartup: true, seenDates: [today] }), note('Sem aviso', {})] }));
  app = await electron.launch(options); let page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.desktop.startup.status())).available, false);
  await installAdapters(); await page.reload(); await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor(); await notificationReady();
  assert.match(await app.evaluate(() => globalThis.startupFeatureTest.notifications[0].options.body), /2 notas pendentes/);
  assert.equal((await page.evaluate(() => window.desktop.reminders.startup())).reason, 'already-checked');
  await page.getByRole('button', { name: 'Preferências', exact: true }).click(); await page.getByRole('tab', { name: 'Geral', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Iniciar com o Windows', exact: true }); assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  await toggle.click(); assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  await toggle.click(); assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  await app.evaluate(() => { globalThis.startupFeatureTest.fail = true; });
  await toggle.click(); await page.getByRole('alert').filter({ hasText: 'Não foi possível alterar' }).waitFor(); assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  await app.evaluate(() => { globalThis.startupFeatureTest.fail = false; }); await toggle.click(); assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  await page.waitForTimeout(180); await page.screenshot({ path: path.join(output, '24-iniciar-windows.png') });
  await page.getByRole('button', { name: 'Concluir', exact: true }).click();
  await page.getByRole('button', { name: 'Notas', exact: true }).click(); await page.getByRole('button', { name: 'Nova nota', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Nova nota', exact: true });
  assert.equal(await modal.getByRole('switch', { name: 'Lembrar-me', exact: true }).getAttribute('aria-checked'), 'false');
  await modal.getByLabel('Título da nota', { exact: true }).fill('Mais um lembrete'); await modal.getByRole('switch', { name: 'Lembrar-me', exact: true }).click();
  await page.waitForTimeout(180); await page.screenshot({ path: path.join(output, '25-lembrar-nota.png') });
  await modal.getByRole('button', { name: 'Salvar nota', exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.startupFeatureTest.notifications.length), 1);
  await page.getByRole('button', { name: /^Meu dia/ }).click();
  await page.getByRole('button', { name: 'Iniciar Aula 1', exact: true }).click(); await page.getByRole('button', { name: 'Modo compacto', exact: true }).click();
  await page.locator('.compact-window').waitFor();
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].minimize(); });
  await app.evaluate(() => globalThis.startupFeatureTest.notifications[0].emit('click'));
  await page.getByRole('heading', { name: 'Notas', exact: true }).waitFor();
  assert.equal(await page.locator('.compact-window').count(), 0);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), false);
  assert.equal(await page.getByRole('button', { name: 'Hoje', exact: true }).getAttribute('class'), 'selected');
  assert.equal(await page.locator('.reminder-card').count(), 4);
  // Opening the notification never marks notes seen.
  assert.equal(await page.getByRole('checkbox', { name: 'Marcar como vista Lembrar hoje', exact: true }).count(), 1);
  await new Promise(resolve => setTimeout(resolve, 1000));
  const saved = validateData(JSON.parse(fs.readFileSync(file, 'utf8'))); assert.equal(saved.settings.startWithWindows, false); assert.equal(saved.reminders.find(value => value.title === 'Mais um lembrete').notifyOnStartup, true);
  assert.deepEqual(errors, []);
  await app.close(); app = await electron.launch(options); page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor(); await installAdapters(); await page.reload(); await notificationReady();
  assert.match(await app.evaluate(() => globalThis.startupFeatureTest.notifications[0].options.body), /3 notas pendentes/);
  await page.getByRole('button', { name: 'Preferências', exact: true }).click(); await page.getByRole('tab', { name: 'Geral', exact: true }).click(); assert.equal(await page.getByRole('switch', { name: 'Iniciar com o Windows', exact: true }).getAttribute('aria-checked'), 'false');
  console.log('PASS: startup defaults/toggle/error/persistence, opt-in note flag, aggregated notification, no duplicates, click from compact/minimized, pending filter and restart; OS adapters simulated.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (app) await app.close(); });
