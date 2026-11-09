const { _electron: electron } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-ebooks-'));
const output = path.join(root, 'test-output'); fs.mkdirSync(output, { recursive: true });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const errors = [];
async function launch(profile) {
  app = await electron.launch((process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE)
    ? { executablePath: path.resolve((process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE)), args: [`--user-data-dir=${profile}`, '--skip-account-prompt'], env }
    : { args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env });
  page = await app.firstWindow(); page.on('pageerror', err => errors.push(err.message));
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Livros', exact: true }).click();
}
async function choose(files, save) {
  await app.evaluate(({ dialog }, { files, save }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: save });
  }, { files, save });
}
async function saved(predicate) {
  for (let i = 0; i < 100; i++) {
    const data = await page.evaluate(() => window.desktop.load());
    if (predicate(data)) return data;
    await page.waitForTimeout(100);
  }
  throw new Error('Expected reading state was not saved.');
}
async function reader(title) {
  await page.getByRole('button', { name: `Ler ${title}`, exact: true }).click();
  await page.getByRole('button', { name: 'Próxima página', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.ebook-message'));
}
(async () => {
  const { seed } = await import('../src/model.js');
  const profile = path.join(temp, 'source'), clean = path.join(temp, 'clean'); fs.mkdirSync(profile); fs.mkdirSync(clean);
  for (const directory of [profile, clean]) fs.writeFileSync(path.join(directory, 'compasso.json'), JSON.stringify({ ...seed(), onboardingCompleted: true }));
  const mobi = path.join(temp, 'MOBI test.mobi'), epub = path.join(temp, 'EPUB test.epub');
  fs.copyFileSync(path.join(root, 'tests/fixtures/reading.mobi'), mobi); fs.copyFileSync(path.join(root, 'tests/fixtures/reading.epub'), epub);
  const azw = path.join(temp, 'Kindle test.azw'); fs.writeFileSync(azw, Buffer.concat([fs.readFileSync(mobi), Buffer.from('\n')]));
  await launch(profile); await choose([epub, mobi, azw]);
  await page.getByRole('button', { name: 'Importar livros', exact: true }).click();
  await saved(data => data.books.length === 3);
  assert.equal(await page.locator('.books-format-help').count(), 0);
  await reader('EPUB test');
  let data = await saved(data => !!data.books[0].location);
  const first = data.books[0].location;
  const content = page.frames().find(frame => frame.url().startsWith('blob:')); assert(content);
  assert.match(await content.locator('body').innerText(), /Chapter 1/);
  assert.equal(await content.locator('script,[onerror],iframe,object,form').count(), 0);
  assert.match(await content.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'), /script-src 'none'/);
  assert.equal(await content.evaluate(() => window.frameElement.getAttribute('sandbox')), 'allow-same-origin');
  assert.equal(await page.evaluate(() => !!window.__ebookExecuted), false);
  await page.getByRole('button', { name: 'Próxima página', exact: true }).click();
  data = await saved(data => data.books[0].location !== first);
  const anchor = data.books[0].location, high = data.books[0].furthestFraction;
  await page.mouse.move(300, 400); await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control');
  await saved(data => data.books[0].view.fontSize === 22);
  assert.equal(await page.evaluate(() => window.innerWidth), 1260);
  await page.getByLabel('Tamanho da fonte').selectOption('28');
  await content.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '28px');
  await page.getByLabel('Páginas por tela').selectOption('2');
  await page.getByLabel('Contraste de leitura').selectOption('night');
  await saved(data => data.books[0].view.spread === 2 && data.books[0].view.contrast === 'night');
  await page.waitForTimeout(350);
  const columnWidth = await content.evaluate(() => parseFloat(getComputedStyle(document.documentElement).columnWidth));
  assert(columnWidth > 0 && columnWidth < 700, 'two-page mode must actually render two columns');
  data = await page.evaluate(() => window.desktop.load()); assert.equal(data.books[0].location, anchor); assert(data.books[0].furthestFraction >= high);
  await page.screenshot({ path: path.join(output, 'ebooks-epub-spread.png') });
  await app.close(); app = null; await launch(profile); await reader('EPUB test');
  data = await saved(data => !!data.books[0].location); assert.equal(data.books[0].location, anchor);
  assert.equal(await page.getByLabel('Tamanho da fonte').inputValue(), '28');
  await page.getByRole('button', { name: 'Fechar leitor', exact: true }).click();
  for (const title of ['MOBI test', 'Kindle test']) {
    await reader(title);
    data = await saved(data => !!data.books.find(book => book.title === title)?.location);
    const before = data.books.find(book => book.title === title).location;
    await page.getByRole('button', { name: 'Próxima página', exact: true }).click();
    await saved(data => data.books.find(book => book.title === title).location !== before);
    await page.getByRole('button', { name: 'Fechar leitor', exact: true }).click();
  }
  if (process.env.ORGANON_AZW3_REFERENCE) {
    await choose([process.env.ORGANON_AZW3_REFERENCE]); await page.getByRole('button', { name: 'Importar livros', exact: true }).click();
    data = await saved(data => data.books.length === 4);
    await reader(data.books[3].title);
    await saved(data => !!data.books[3].location);
    await page.screenshot({ path: path.join(output, 'ebooks-azw3.png') });
    await page.getByRole('button', { name: 'Fechar leitor', exact: true }).click();
  }
  const backup = path.join(temp, 'ebooks.json'); await choose([], backup);
  assert.equal(await page.evaluate(async () => window.desktop.exportData(await window.desktop.load())), true);
  const portable = JSON.parse(fs.readFileSync(backup, 'utf8'));
  await app.close(); app = null; await launch(clean); await choose([backup]);
  await page.getByRole('button', { name: 'Preferências', exact: true }).click(); await page.getByRole('tab', { name: 'Backup', exact: true }).click();
  await page.getByRole('button', { name: 'Importar backup', exact: true }).click();
  await page.getByRole('dialog', { name: 'Restaurar este backup?', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.getByText('Backup restaurado.', { exact: true }).waitFor();
  data = await page.evaluate(() => window.desktop.load()); assert.deepEqual(data.books, portable.books);
  for (const book of data.books) {
    const bytes = await page.evaluate(({ hash, format }) => window.desktop.books.read(hash, format), book);
    assert.equal(Buffer.from(bytes).toString('base64'), portable.bookFiles[book.hash]);
  }
  await reader('EPUB test'); assert.equal((await saved(data => !!data.books[0].location)).books[0].location, anchor);
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'ebooks-audit.json'), JSON.stringify({ passed: true, azw3Tested: !!process.env.ORGANON_AZW3_REFERENCE, errors, isolatedProfiles: true }, null, 2));
  console.log('PASS: EPUB/MOBI/AZW native offline reading, stable CFI across fonts/spread/restart, sanitization and sandbox, complete binary backup/clean-profile restore.');
})().catch(async error => {
  console.error(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, 'ebooks-failure.png') });
    console.error(await page.locator('.book-reader').innerText().catch(() => 'No reader'), errors);
    console.error(await page.locator('.ebook-host').innerHTML().catch(() => ''));
  }
  process.exitCode = 1;
}).finally(async () => { if (app) await app.close(); });
