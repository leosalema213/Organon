const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output'); fs.mkdirSync(output, { recursive: true });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const executable = process.argv.includes('--packaged') ? path.join(root, 'release', require('../package.json').version, 'win-unpacked/Organon.exe') : (process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE);
let app, page;
const errors = [];
async function launch(profile) {
  app = await electron.launch(executable
    ? { executablePath: path.resolve(executable), args: [`--user-data-dir=${profile}`, '--skip-account-prompt'], env }
    : { args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor();
}
async function cover() {
  await page.getByRole('button', { name: 'Livros', exact: true }).click();
  const image = page.locator('.reading-card').filter({ hasText: 'PDF thumbnail fixture' }).locator('.reading-cover img');
  await image.waitFor();
  await image.evaluate(image => image.decode());
  const size = await image.evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight }));
  assert(size.width > 0 && size.width <= 240 && size.height > 0 && size.height <= 320);
  return image.getAttribute('src');
}
(async () => {
  cp.execFileSync(process.execPath, ['--test', path.join(__dirname, 'book-thumbnails.test.js')], { cwd: root, stdio: 'inherit' });
  const { seed } = await import('../src/model.js'), { BookFiles } = require('../electron/books.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-thumbnail-ui-')), profile = path.join(directory, 'source'), clean = path.join(directory, 'clean');
  const store = new BookFiles(profile);
  const book = { ...store.import(path.join(root, 'tests/fixtures/reading.pdf')), title: 'PDF thumbnail fixture', page: 4, pageCount: 6, furthestPage: 5 };
  const epub = { ...store.import(path.join(root, 'tests/fixtures/reading.epub')), title: 'EPUB fallback fixture' };
  const state = { ...seed(), onboardingCompleted: true, books: [book, epub] };
  fs.writeFileSync(path.join(profile, 'compasso.json'), JSON.stringify(state));
  await launch(profile);
  await page.getByRole('button', { name: 'Notas', exact: true }).click();
  await page.getByRole('heading', { name: 'Notas', exact: true }).waitFor();
  assert.equal(await page.locator('.reminders-hint').count(), 0);
  const first = await cover(); assert(first.startsWith('data:image/webp;base64,'));
  assert.equal(await page.locator('.reading-card').filter({ hasText: 'EPUB fallback fixture' }).locator('img').count(), 0);
  assert.deepEqual((await page.evaluate(() => window.desktop.load())).books, state.books);
  const before = fs.readFileSync(store.file(book.hash));
  assert.deepEqual(before, fs.readFileSync(path.join(root, 'tests/fixtures/reading.pdf')));
  assert.equal(store.thumbnail(book.hash), first);
  await page.screenshot({ path: path.join(output, 'book-thumbnails.png') });
  await app.close(); app = null; await launch(profile);
  // A cached cover must not need another PDF read or another render.
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('books:read'); ipcMain.handle('books:read', () => { throw new Error('Cached cover must not reread PDF'); }); });
  assert.equal(await cover(), first);
  const backup = path.join(directory, 'backup.json');
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, backup);
  assert.equal(await page.evaluate(async () => window.desktop.exportData(await window.desktop.load())), true);
  const portable = JSON.parse(fs.readFileSync(backup, 'utf8')), target = new BookFiles(clean);
  const restored = target.restore(target.verifyBackup(portable)); assert.equal(target.thumbnail(book.hash), null);
  fs.writeFileSync(path.join(clean, 'compasso.json'), JSON.stringify(restored));
  await app.close(); app = null; await launch(clean); await cover();
  assert.deepEqual((await page.evaluate(() => window.desktop.load())).books, state.books);
  assert.deepEqual(errors, []);
  console.log('PASS: PDF first-page cover, cached restart, unchanged reading progress/original, restored-cover regeneration, EPUB fallback and removed Notes hint.');
})().catch(async error => {
  console.error(error); if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'book-thumbnails-failure.png') }).catch(() => {});
  process.exitCode = 1;
}).finally(async () => { if (app) await app.close(); });
