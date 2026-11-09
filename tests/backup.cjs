const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-backup-'));
const output = path.join(root, 'test-output'); fs.mkdirSync(output, { recursive: true });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const options = profile => (process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE)
  ? { executablePath: path.resolve((process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE)), args: [`--user-data-dir=${profile}`, '--skip-account-prompt'], env }
  : { args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env };
let app, page;
const errors = [];
async function launch(profile) {
  app = await electron.launch(options(profile));
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor();
}
async function preferences() {
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await page.getByRole('tab', { name: 'Backup', exact: true }).click();
}
async function dialogs(file) {
  // Only the OS file chooser is replaced. Buttons, renderer, preload, IPC and file IO are production code.
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, file);
}
async function restore(file) {
  await dialogs(file); await preferences();
  await page.getByRole('button', { name: 'Importar backup', exact: true }).click();
  await page.getByRole('dialog', { name: 'Restaurar este backup?', exact: true }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.getByText('Backup restaurado.', { exact: true }).waitFor();
}
async function saved(profile, expected) {
  const file = path.join(profile, 'compasso.json');
  await page.waitForTimeout(300);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), expected);
}
(async () => {
  const { seed, firstPlan, dayKey, play, pause, extendLesson, recordKey } = await import('../src/model.js');
  const { createKind } = await import('../src/block-kinds.js');
  const kind = createKind('Revisão de backup', 'brain');
  const date = dayKey(), now = Date.now();
  const source = path.join(directory, 'source'), target = path.join(directory, 'clean');
  fs.mkdirSync(source); fs.mkdirSync(target);
  fs.writeFileSync(path.join(source, 'compasso.json'), JSON.stringify({ ...seed(), onboardingCompleted: true }));
  await launch(source);
  const { image, sketch } = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 220; canvas.height = 90;
    const context = canvas.getContext('2d'); context.fillStyle = '#c9b5ff'; context.fillRect(0, 0, 220, 90);
    context.fillStyle = '#191524'; context.font = '20px sans-serif'; context.fillText('Print de teste', 15, 50);
    const image = canvas.toDataURL('image/png');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, 220, 90);
    context.strokeStyle = '#8040c0'; context.lineWidth = 5; context.beginPath(); context.moveTo(15, 60);
    context.bezierCurveTo(50, 0, 130, 100, 200, 20); context.stroke();
    return { image, sketch: canvas.toDataURL('image/png') };
  });
  await app.close(); app = null;
  const document = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Título restaurado' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Texto formatado', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'fontSize', attrs: { size: '24' } }] }, { type: 'hardBreak' }, { type: 'text', text: 'Outra linha' }] },
    { type: 'image', attrs: { src: image } },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }] }] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Numerado' }] }] }] },
    { type: 'image', attrs: { src: sketch } }, { type: 'paragraph' },
  ] };
  const plan = { ...firstPlan(), name: 'Plano auditado', description: 'Descrição preservada', icon: 'atom', color: '#abc123', days: [0, 1, 2, 3, 4, 5, 6], notes: [
    { id: 'legacy-note', date, text: 'Legado\nsegunda linha', images: [image], blockId: 'legacy-block', pinned: false },
    { id: 'rich-note', date, text: 'Texto formatado', images: [], document, pinned: true },
  ] };
  const completed = { ...firstPlan(), name: 'Curso concluído', completedAt: date };
  plan.blocks[2].kind = { ...kind };
  let fixture = { ...seed(), blockKinds: [kind], onboardingCompleted: true, plans: [plan, completed], settings: { sound: false, startWithWindows: false, creditManualTime: true, theme: 'custom', palette: 'green', density: 'comfortable', plansView: 'list' },
    notebooks: [{ id: 'book-image', name: 'Caderno com capa', icon: 'none', color: '#123abc', cover: image, pages: [
      { id: 'rich-page', title: 'Página auditada', date, text: 'Texto formatado', images: [], document },
      { id: 'legacy-page', title: '', date, text: 'Página antiga', images: [image] },
    ] }, { id: 'book-color', name: 'Caderno sem imagem', icon: 'diary', color: 'pink', cover: null, pages: [] }],
    reminders: [
      { id: 'daily', title: 'Nota diária', description: 'Descrição diária', schedule: 'daily', date, seenDates: ['2026-10-26', date], notifyOnStartup: true },
      { id: 'dated', title: 'Nota agendada', description: 'Descrição agendada', schedule: 'date', date, seenDates: [], notifyOnStartup: false },
    ], records: {
      [recordKey(date, plan.id, plan.blocks[2].id)]: { elapsedMs: 1500000, manualMs: 1300000, done: true, type: 'lesson', planName: plan.name, blockName: 'Aula 2' },
      [recordKey('2026-09-03', 'deleted-plan', 'deleted-block')]: { elapsedMs: 120000, done: true, type: 'lesson', planName: 'Plano excluído', blockName: 'Antiga' },
      [recordKey(date, plan.id, plan.blocks[1].id)]: { elapsedMs: 300000, done: true, type: 'break' },
    } };
  fixture = pause(extendLesson(play(fixture, plan, plan.blocks[0], date, now), 5, now + 12000), now + 12000);
  fs.writeFileSync(path.join(source, 'compasso.json'), JSON.stringify(fixture));
  await launch(source); await dialogs(path.join(directory, 'backup.json')); await preferences();
  await page.getByRole('tabpanel', { name: 'Backup', exact: true }).getByRole('button', { name: 'Exportar backup', exact: true }).click();
  await page.getByText('Backup exportado.', { exact: true }).waitFor();
  const exported = JSON.parse(fs.readFileSync(path.join(directory, 'backup.json'), 'utf8'));
  fixture.active.startedAt = exported.active.startedAt;
  assert.deepEqual(exported, fixture);
  await app.close(); app = null;
  // Start with no compasso.json at all; dismiss the clean-profile tutorial.
  app = await electron.launch(options(target)); page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Agora não', exact: true }).click();
  await restore(path.join(directory, 'backup.json'));
  const expected = { ...exported, active: { ...exported.active, running: false } };
  await saved(target, expected);
  await page.screenshot({ path: path.join(output, 'backup-restored.png') });
  await app.close(); app = null; await launch(target);
  const restarted = JSON.parse(fs.readFileSync(path.join(target, 'compasso.json'), 'utf8'));
  expected.active.startedAt = restarted.active.startedAt;
  await saved(target, expected);
  assert.equal(await page.getByRole('button', { name: 'Continuar aula', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Cadernos', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir caderno Caderno com capa', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Texto da anotação', exact: true });
  await editor.waitFor();
  assert.equal(await editor.locator('h2').innerText(), 'Título restaurado');
  assert.equal(await editor.locator('strong em, em strong').innerText(), 'Texto formatado');
  assert.equal(await editor.locator('img').count(), 2);
  await page.waitForFunction(() => [...document.querySelectorAll('.notebook-text img')].every(image => image.complete && image.naturalWidth > 0));
  assert.equal(await editor.locator('ol').getAttribute('start'), '3');
  await page.screenshot({ path: path.join(output, 'backup-page-restored.png') });
  await page.getByRole('button', { name: /^Meu dia/ }).click();
  // A valid export can exceed the former arbitrary 40 MiB import ceiling.
  const large = structuredClone(expected); large.notebooks[0].pages[1].text = 'x'.repeat(41 * 1024 * 1024);
  const largeFile = path.join(directory, 'large.json'); fs.writeFileSync(largeFile, JSON.stringify(large));
  await restore(largeFile); await saved(target, large);
  const largeExport = path.join(directory, 'large-export.json'); await dialogs(largeExport); await preferences();
  await page.getByRole('tabpanel', { name: 'Backup', exact: true }).getByRole('button', { name: 'Exportar backup', exact: true }).click();
  await page.getByText('Backup exportado.', { exact: true }).waitFor();
  assert.deepEqual(JSON.parse(fs.readFileSync(largeExport, 'utf8')), large);
  await app.close(); app = null;
  const legacy = { version: 1, plans: [{ ...plan, icon: undefined, completedAt: undefined }], records: {}, settings: { theme: 'light' } };
  const legacyFile = path.join(directory, 'legacy.json'); fs.writeFileSync(legacyFile, JSON.stringify(legacy));
  await launch(target); await restore(legacyFile);
  const { validateData } = await import('../src/model.js');
  const migrated = validateData(JSON.parse(JSON.stringify(legacy))); await saved(target, migrated);
  await preferences();
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  await page.getByRole('button', { name: 'Importar backup', exact: true }).click(); await saved(target, migrated);
  const invalidFile = path.join(directory, 'invalid.json'); fs.writeFileSync(invalidFile, '{broken'); await dialogs(invalidFile);
  await page.getByRole('button', { name: 'Importar backup', exact: true }).click();
  await page.getByText(/Não foi possível importar:/).waitFor(); await saved(target, migrated);
  await page.getByRole('button', { name: 'Concluir', exact: true }).click();
  // Reproduce a failed automatic save in the main process; export must still include the current renderer state.
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('data:save'); ipcMain.handle('data:save', () => { throw new Error('Simulated disk failure'); }); });
  await preferences(); await page.getByRole('tab', { name: 'Geral', exact: true }).click();
  await page.getByRole('switch', { name: 'Contabilizar tempo ao concluir manualmente', exact: true }).click();
  await page.getByRole('tab', { name: 'Backup', exact: true }).click();
  const recoveryFile = path.join(directory, 'recovery.json'); await dialogs(recoveryFile);
  await page.getByRole('tabpanel', { name: 'Backup', exact: true }).getByRole('button', { name: 'Exportar backup', exact: true }).click();
  await page.getByText('Backup exportado.', { exact: true }).waitFor();
  assert.equal(JSON.parse(fs.readFileSync(recoveryFile, 'utf8')).settings.creditManualTime, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'compasso.json'), 'utf8')).settings.creditManualTime, false);
  await dialogs(recoveryFile);
  await page.getByRole('button', { name: 'Importar backup', exact: true }).click();
  await page.getByRole('dialog', { name: 'Restaurar este backup?', exact: true }).getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.getByText('Backup carregado, mas não foi possível salvar no computador. Exporte uma cópia antes de fechar.', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'backup-audit.json'), JSON.stringify({ date: new Date().toISOString(), executable: (process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE) || 'development Electron', directory, bytes: fs.statSync(largeFile).size, checks: ['export equality', 'clean-profile import equality', 'restart equality except startedAt', 'restored rich page rendering', 'over 40 MiB import and export equality', 'legacy import migration', 'cancel and invalid JSON preserve data', 'export current data despite local save failure', 'import save failure never reports success'], result: 'PASS' }, null, 2));
  console.log('PASS: complete UI/IPC backup roundtrip, clean profile, restart and >40 MiB. Evidence:', directory);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (app) await app.close(); });
