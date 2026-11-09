const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-reader-'));
const output = path.join(root, 'test-output'); fs.mkdirSync(output, { recursive: true });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const errors = [];
async function launch(profile) {
  const options = (process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE)
    ? { executablePath: path.resolve((process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE)), args: [`--user-data-dir=${profile}`, '--skip-account-prompt'], env }
    : { args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env };
  app = await electron.launch(options); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor();
}
async function choose(files, save) {
  await app.evaluate(({ dialog }, { files, save }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: save });
  }, { files, save });
}
async function state() { return page.evaluate(() => window.desktop.load()); }
async function waitSaved(predicate, message) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const data = await state(); if (predicate(data)) return data;
    await page.waitForTimeout(100);
  }
  throw new Error(message);
}
async function openBooks() { await page.getByRole('button', { name: 'Livros', exact: true }).click(); }
async function preferences() { await page.getByRole('button', { name: 'Preferências', exact: true }).click(); await page.getByRole('tab', { name: 'Backup', exact: true }).click(); }
async function rendered(number) {
  await page.getByRole('document', { name: `Página ${number}`, exact: true }).locator('.textLayer span').first().waitFor();
}
(async () => {
  const { seed, firstPlan, dayKey } = await import('../src/model.js');
  const source = path.join(directory, 'source'), target = path.join(directory, 'clean'); fs.mkdirSync(source); fs.mkdirSync(target);
  const plan = { ...firstPlan(), name: 'Redes', days: [0, 1, 2, 3, 4, 5, 6] }, other = { ...firstPlan(), name: 'Linux' };
  const fixture = { ...seed(), onboardingCompleted: true, plans: [plan, other] };
  fs.writeFileSync(path.join(source, 'compasso.json'), JSON.stringify(fixture));
  const original = path.join(directory, 'Reading test.pdf'), second = path.join(directory, 'Independent book.pdf');
  fs.copyFileSync(path.join(root, 'tests/fixtures/reading.pdf'), original); fs.writeFileSync(second, Buffer.concat([fs.readFileSync(original), Buffer.from('\n')]));
  await launch(source); await openBooks(); await choose([original, second, original]);
  await page.getByRole('button', { name: 'Importar livros', exact: true }).click();
  await page.locator('.reading-card').nth(1).waitFor(); assert.equal(await page.locator('.reading-card').count(), 2);
  await waitSaved(data => data.books.length === 2, 'Books not saved');
  assert.equal(fs.readdirSync(path.join(source, 'books')).filter(name => name.endsWith('.pdf')).length, 2);
  fs.renameSync(original, original + '.moved');
  await page.getByRole('button', { name: 'Ler Reading test', exact: true }).click(); await rendered(1);
  await page.getByRole('button', { name: 'Próxima página', exact: true }).click(); await rendered(2);
  await page.keyboard.press('ArrowRight'); await rendered(3);
  let saved = await waitSaved(data => data.books[0].page === 3 && data.books[0].pageCount === 6, 'Page 3 not saved');
  assert.equal(saved.books[0].completedAt, null);
  assert.deepEqual(await page.getByLabel('Páginas por tela').locator('option').allTextContents(), ['1', '2']);
  await page.locator('.reader-pages').hover(); await page.keyboard.down('Control'); await page.mouse.wheel(0, -120); await page.keyboard.up('Control');
  await waitSaved(data => data.books[0].view.zoom === 1.25, 'Ctrl + scroll did not zoom');
  assert.equal(await page.evaluate(() => window.innerWidth), 1260);
  await page.mouse.wheel(0, 120); await page.waitForTimeout(100);
  assert.equal((await state()).books[0].view.zoom, 1.25, 'plain scroll must not change zoom');
  await page.getByRole('button', { name: 'Aumentar zoom', exact: true }).click();
  await waitSaved(data => data.books[0].view.zoom === 1.5, 'Zoom button failed');
  await page.getByRole('button', { name: 'Diminuir zoom', exact: true }).click();
  await page.getByLabel('Zoom do PDF').selectOption('1'); await rendered(3);
  await page.getByRole('button', { name: 'Maximizar ou restaurar janela', exact: true }).click();
  for (let i = 0; i < 30 && !await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()); i++) await page.waitForTimeout(100);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()), true);
  await page.getByRole('button', { name: 'Maximizar ou restaurar janela', exact: true }).click();
  for (let i = 0; i < 30 && await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()); i++) await page.waitForTimeout(100);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()), false);
  await rendered(3);
  const selected = await page.locator('.textLayer').evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString();
  });
  assert.match(selected, /Page 3/);
  await page.screenshot({ path: path.join(output, 'books-reader-single.png') });
  await page.getByLabel('Páginas por tela').selectOption('2'); await rendered(4);
  assert.equal(await page.locator('.pdf-sheet').count(), 2);
  await waitSaved(data => data.books[0].furthestPage === 4 && data.books[0].view.spread === 2, 'Spread not saved');
  await page.screenshot({ path: path.join(output, 'books-reader-spread.png') });
  await page.getByLabel('Zoom do PDF').selectOption('1.5'); await rendered(3);
  await page.getByLabel('Contraste de leitura').selectOption('night');
  await page.getByLabel('Ir para página').fill('1'); await page.getByRole('button', { name: 'Ir', exact: true }).click(); await rendered(1);
  saved = await waitSaved(data => data.books[0].page === 1 && data.books[0].view.contrast === 'night', 'Return position not saved');
  assert.equal(saved.books[0].furthestPage, 4); assert.equal(saved.books[0].completedAt, null);
  // Close the actual window, exercising the final position flush, then restart.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await app.close(); app = null; await launch(source); await openBooks();
  await page.getByRole('button', { name: 'Ler Reading test', exact: true }).click(); await rendered(1);
  assert.equal(await page.getByLabel('Páginas por tela').inputValue(), '2'); assert.equal(await page.getByLabel('Zoom do PDF').inputValue(), '1.5');
  assert.equal(await page.getByLabel('Contraste de leitura').inputValue(), 'night');
  await page.getByRole('button', { name: 'Fechar leitor', exact: true }).click();
  await page.getByRole('button', { name: 'Opções de Reading test', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Editar livro', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill('   ');
  assert.equal(await page.getByRole('button', { name: 'Salvar alterações', exact: true }).isDisabled(), true);
  await page.getByLabel('Título', { exact: true }).fill('  Leitura de teste  ');
  await page.getByRole('checkbox', { name: 'Redes', exact: true }).check(); await page.getByRole('checkbox', { name: 'Linux', exact: true }).check();
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await page.getByRole('heading', { name: 'Leitura de teste', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Opções de Independent book', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Editar livro', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Redes', exact: true }).check(); await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await page.getByRole('button', { name: 'Planos de estudo', exact: true }).click();
  await page.getByRole('button', { name: 'Livros do plano Redes', exact: true }).click();
  assert.equal(await page.locator('.reading-card').count(), 2); assert.equal(await page.getByLabel('Livros por plano').inputValue(), plan.id);
  await page.getByRole('button', { name: 'Concluir livro Leitura de teste', exact: true }).click();
  saved = await waitSaved(data => data.books[0].completedAt === dayKey(), 'Completion not saved');
  assert.equal(saved.books[0].page, 1); assert.equal(saved.books[0].furthestPage, 4);
  await page.getByRole('button', { name: 'Meu progresso', exact: true }).click();
  await page.getByRole('heading', { name: 'Livros lidos neste período · 1', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Período anterior', exact: true }).click();
  await page.getByRole('heading', { name: 'Livros lidos neste período · 0', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Mensal', exact: true }).click();
  await page.getByRole('heading', { name: 'Livros lidos neste período · 1', exact: true }).waitFor();
  await openBooks(); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(840, 620));
  assert.equal(await page.locator('.books-filters').evaluate(el => el.scrollWidth > el.clientWidth), false);
  const controlSizes = await page.locator('.books-heading button, .books-filters > input, .books-filters > select').evaluateAll(
    controls => controls.map(control => [control.offsetHeight, getComputedStyle(control).fontSize])
  );
  assert.deepEqual(controlSizes, Array.from({ length: 4 }, () => [32, '12px']));
  const actionsFit = await page.locator('.reading-actions').evaluateAll(rows => rows.every(row => {
    const bounds = row.getBoundingClientRect();
    return row.children.length === 3 && [...row.children].every(button => {
      const rect = button.getBoundingClientRect();
      return rect.top === bounds.top && rect.bottom === bounds.bottom && rect.right <= bounds.right;
    });
  }));
  assert.equal(actionsFit, true, 'Book actions should fit in one row');
  await page.screenshot({ path: path.join(output, 'books-library-small.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1260, 850));
  const backup = path.join(directory, 'complete.json'); await choose([], backup); await preferences();
  await page.getByRole('tabpanel', { name: 'Backup', exact: true }).getByRole('button', { name: 'Exportar backup', exact: true }).click();
  await page.getByText('Backup exportado.', { exact: true }).waitFor();
  const portable = JSON.parse(fs.readFileSync(backup, 'utf8')); assert.equal(Object.keys(portable.bookFiles).length, 2);
  assert.equal('bookFiles' in JSON.parse(fs.readFileSync(path.join(source, 'compasso.json'), 'utf8')), false);
  await app.close(); app = null;
  fs.writeFileSync(path.join(target, 'compasso.json'), JSON.stringify({ ...seed(), onboardingCompleted: true }));
  await launch(target); await choose([backup]); await preferences();
  await page.getByRole('button', { name: 'Importar backup', exact: true }).click();
  await page.getByRole('dialog', { name: 'Restaurar este backup?', exact: true }).waitFor();
  assert.equal(fs.existsSync(path.join(target, 'books')), false);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal((await state()).books.length, 0); assert.equal(fs.existsSync(path.join(target, 'books')), false);
  const canceled = await page.evaluate(async () => {
    const preview = await window.desktop.importData();
    await window.desktop.books.cancelRestore(preview._booksRestoreToken);
    try { await window.desktop.books.restore(preview._booksRestoreToken); return false; } catch { return true; }
  });
  assert.equal(canceled, true, 'canceled restore token cannot retain/reinstall staged files');
  await page.getByRole('button', { name: 'Importar backup', exact: true }).click();
  await page.getByRole('dialog', { name: 'Restaurar este backup?', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click(); await page.getByText('Backup restaurado.', { exact: true }).waitFor();
  saved = await state(); assert.deepEqual(saved.books, portable.books);
  for (const book of saved.books) assert.equal(fs.readFileSync(path.join(target, 'books', book.hash + '.pdf')).toString('base64'), portable.bookFiles[book.hash]);
  await app.close(); app = null; await launch(target); await openBooks();
  await page.getByRole('button', { name: 'Ler Leitura de teste', exact: true }).click(); await rendered(1);
  await page.getByRole('button', { name: 'Fechar leitor', exact: true }).click();
  // A user-supplied PDF is optional and never bundled with the repository or synthetic fixtures.
  if (process.env.ORGANON_REFERENCE_PDF) {
    await choose([process.env.ORGANON_REFERENCE_PDF]); await page.getByRole('button', { name: 'Importar livros', exact: true }).click();
    const real = await waitSaved(data => data.books.length === 3, 'Reference not imported');
    const book = real.books[2]; await page.getByRole('button', { name: `Ler ${book.title}`, exact: true }).click(); await rendered(1);
    await page.getByLabel('Ir para página').fill('3'); await page.getByRole('button', { name: 'Ir', exact: true }).click(); await rendered(3);
    assert.equal((await waitSaved(data => data.books[2].page === 3, 'Reference page not saved')).books[2].pageCount, 85);
    await page.getByLabel('Páginas por tela').selectOption('2'); await rendered(4);
    await page.screenshot({ path: path.join(output, 'books-reference-spread.png') });
    await app.close(); app = null; await launch(target); await openBooks();
    await page.getByRole('button', { name: `Ler ${book.title}`, exact: true }).click(); await rendered(3);
    assert.equal(await page.getByLabel('Ir para página').inputValue(), '3');
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'books-audit.json'), JSON.stringify({ passed: true, referenceTested: !!process.env.ORGANON_REFERENCE_PDF, isolatedProfiles: true, profile: directory, errors }, null, 2));
  console.log('PASS: real PDF rendering and selectable text, bulk import/deduplication, moved original, page persistence/restart, spread, zoom, contrast, multiple books/plans, explicit completion/periods, portable backup/clean-profile restart.');
})().catch(async error => {
  console.error(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, 'books-failure.png') });
    console.error(await page.locator('.book-reader').innerText().catch(() => 'Reader closed'), errors);
    console.error(await page.locator('.pdf-sheet').evaluateAll(items => items.map(item => ({ label: item.getAttribute('aria-label'), rect: item.getBoundingClientRect().toJSON(), text: item.innerText.slice(0, 80), spans: item.querySelectorAll('span').length }))));
  }
  process.exitCode = 1;
}).finally(async () => { if (app) await app.close(); });
