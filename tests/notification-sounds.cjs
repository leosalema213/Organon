// Focused interface test: temporary profile, synthesized audio and simulated OS delivery.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-sounds-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
(async () => {
  const { seed, firstPlan, preferences } = await import('../src/model.js');
  const plan = firstPlan(); plan.days = [0, 1, 2, 3, 4, 5, 6]; plan.blocks = plan.blocks.map(block => ({ ...block, minutes: 1 }));
  fs.writeFileSync(path.join(profile, 'compasso.json'), JSON.stringify({ ...seed(), onboardingCompleted: true, plans: [plan], settings: preferences({ sound: false }) }));
  const launch = () => electron.launch({ args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env });
  app = await launch(); let page = await app.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor();
  await app.evaluate(({ ipcMain, BrowserWindow, app }) => {
    const require = process.getBuiltinModule('module').createRequire(process.getBuiltinModule('path').join(app.getAppPath(), 'package.json'));
    const { EventEmitter } = require('node:events');
    const { showCompletionNotification } = require(require('node:path').join(app.getAppPath(), 'electron/reminder-notifications.cjs'));
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => callback({ cancel: true }));
    const state = globalThis.notificationFeatureTest = { notifications: [] };
    class Notification extends EventEmitter { static isSupported() { return true; } constructor(options) { super(); this.options = options; } show() { state.notifications.push(this); } }
    ipcMain.removeAllListeners('timer:notify');
    ipcMain.on('timer:notify', (_event, body) => showCompletionNotification({ Notification, win, body }));
  });
  await page.evaluate(() => {
    window.__soundNotes = [];
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = create.call(this), start = oscillator.start;
      oscillator.start = function (...args) { window.__soundNotes.push(this.frequency.value); return start.apply(this, args); };
      return oscillator;
    };
  });
  await page.clock.install({ time: new Date() });
  async function preferencesPanel() {
    await page.getByRole('button', { name: 'Abrir preferências', exact: true }).click();
    await page.getByRole('tab', { name: 'Geral', exact: true }).click();
    return page.getByRole('dialog', { name: 'Preferências', exact: true });
  }
  let panel = await preferencesPanel();
  const completion = panel.getByRole('combobox', { name: 'Som de conclusão', exact: true });
  assert.equal(await completion.inputValue(), 'completion');
  const catalog = await completion.locator('option').evaluateAll(options => options.map(option => option.value));
  assert(catalog.includes('alarm-long') && catalog.includes('silent'));
  assert.equal(catalog.length, 11);
  await completion.selectOption('alert-short');
  await panel.getByRole('button', { name: 'Testar som', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__soundNotes), [880, 1047, 880, 1047]);
  const toggle = panel.getByRole('switch', { name: 'Som de conclusão', exact: true });
  assert.equal(await toggle.getAttribute('aria-checked'), 'false'); await toggle.click();
  await panel.getByRole('button', { name: 'Concluir', exact: true }).click();
  await page.getByRole('button', { name: 'Notas', exact: true }).click();
  await page.getByRole('button', { name: 'Nova nota', exact: true }).click();
  let note = page.getByRole('dialog', { name: 'Nova nota', exact: true });
  const reminder = note.getByLabel('Som do lembrete', { exact: true });
  assert.deepEqual(await reminder.locator('option').evaluateAll(options => options.map(option => option.value)), catalog);
  assert.equal(await reminder.inputValue(), 'chime');
  await note.getByLabel('Título da nota', { exact: true }).fill('Som compartilhado');
  await reminder.selectOption('alarm-long');
  await note.getByRole('button', { name: 'Salvar nota', exact: true }).click();
  await page.getByRole('button', { name: 'Nova nota', exact: true }).click();
  note = page.getByRole('dialog', { name: 'Nova nota', exact: true });
  assert.equal(await note.getByLabel('Som do lembrete', { exact: true }).inputValue(), 'alarm-long');
  await note.getByRole('button', { name: 'Cancelar', exact: true }).click();
  panel = await preferencesPanel(); assert.equal(await panel.getByRole('combobox', { name: 'Som de conclusão', exact: true }).inputValue(), 'alert-short');
  await panel.getByRole('button', { name: 'Concluir', exact: true }).click();
  await page.getByRole('button', { name: /^Meu dia/ }).click();
  await page.getByRole('button', { name: 'Iniciar Aula 1', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await page.clock.fastForward(60000);
  await page.waitForFunction(() => window.__soundNotes.length >= 8);
  assert.deepEqual((await page.evaluate(() => window.__soundNotes)).slice(-4), [880, 1047, 880, 1047]);
  const restored = await app.evaluate(({ BrowserWindow }) => {
    const state = globalThis.notificationFeatureTest;
    if (state.notifications.length !== 1) throw new Error('Expected one completion notification');
    if (!state.notifications[0].options.silent) throw new Error('Unexpected native sound');
    state.notifications[0].emit('click');
    const win = BrowserWindow.getAllWindows()[0]; return { minimized: win.isMinimized(), visible: win.isVisible() };
  });
  assert.deepEqual(restored, { minimized: false, visible: true });
  await page.waitForFunction(async () => {
    const saved = await window.desktop.load();
    return saved.settings.completionSound === 'alert-short' && saved.settings.reminderSound === 'alarm-long' && saved.reminders[0]?.sound === 'alarm-long' && saved.active?.running === false;
  });
  assert.deepEqual(errors, []);
  await app.close(); app = await launch(); page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor();
  panel = await preferencesPanel(); assert.equal(await panel.getByRole('combobox', { name: 'Som de conclusão', exact: true }).inputValue(), 'alert-short');
  console.log('PASS: shared catalog, independent choices, audio preview, timer completion with selected sound, notification click restores window and settings survive restart. OS delivery is simulated; audible quality requires manual preview validation.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (app) await app.close(); });
