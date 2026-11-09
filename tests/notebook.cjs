const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-document-'));
const file = path.join(profile, 'compasso.json');
const output = path.join(root, 'test-output');
fs.mkdirSync(output, { recursive: true });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const options = (process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE) ? { executablePath: path.resolve((process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE)), args: [`--user-data-dir=${profile}`, '--skip-account-prompt'], env } : { args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env };
let app;
async function paste(page, { delay = false } = {}) {
  await page.evaluate(async delay => {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 48;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#cca4db'; ctx.fillRect(0, 0, 96, 48);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const clipboard = new DataTransfer(); clipboard.items.add(new File([blob], 'print.png', { type: 'image/png' }));
    if (delay) {
      const Original = window.FileReader;
      window.FileReader = class extends Original { readAsDataURL(file) { setTimeout(() => super.readAsDataURL(file), 250); } };
      setTimeout(() => { window.FileReader = Original; }, 500);
    }
    document.querySelector('.notebook-text').dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  }, delay);
}
async function cursor(page, paragraph, offset) {
  await page.locator('.notebook-text').evaluate((el, { paragraph, offset }) => {
    const p = el.querySelectorAll(':scope>p')[paragraph];
    el.editor.commands.setTextSelection(el.editor.view.posAtDOM(p.firstChild || p, offset));
    el.editor.view.focus();
  }, { paragraph, offset });
}
async function blocks(page) {
  return page.locator('.notebook-text').evaluate(el => [...el.children].map(node => node.tagName === 'FIGURE' ? 'IMAGE' : node.textContent));
}
(async () => {
  const { seed, newPlan, validateData } = await import('../src/model.js');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const old = { id: 'legacy-note', title: 'Nota anterior', text: 'Texto antigo\nOutro parágrafo', images: [png], date: '2026-10-26', pinned: true };
  const plan = { ...newPlan(), name: 'Caderno de teste', notes: [old] };
  fs.writeFileSync(file, JSON.stringify({ ...seed(), plans: [plan, ...Array.from({ length: 8 }, (_, i) => ({ ...newPlan(), name: `Plano extra ${i + 1}` }))], onboardingCompleted: true }));
  app = await electron.launch(options);
  let page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: 'Planos de estudo', exact: true }).click();
  await page.getByRole('button', { name: /^Anotações/ }).first().click();
  await page.getByRole('button', { name: /^Nota anterior/ }).click();
  await page.getByRole('textbox', { name: 'Texto da anotação', exact: true }).waitFor();
  assert.deepEqual(await blocks(page), ['Texto antigo', 'Outro parágrafo', 'IMAGE', '']);
  // Migration is nondestructive and the old image stays where it used to be.
  await cursor(page, 0, 0); await page.keyboard.insertText('Antes: ');
  await page.getByRole('button', { name: 'Nova anotação', exact: true }).click();
  await page.getByRole('textbox', { name: 'Título da anotação', exact: true }).fill('Documento contínuo');
  const editor = page.getByRole('textbox', { name: 'Texto da anotação', exact: true });
  await editor.fill('Olha este print'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await paste(page); await page.locator('.note-document-image img').waitFor();
  await page.keyboard.insertText('Olha o print 2'); await page.keyboard.press('Enter');
  await paste(page); await page.waitForFunction(() => document.querySelectorAll('.note-document-image').length === 2);
  await page.keyboard.insertText('Conclusão');
  assert.deepEqual(await blocks(page), ['Olha este print', 'IMAGE', 'Olha o print 2', 'IMAGE', 'Conclusão']);
  await page.screenshot({ path: path.join(output, '14-documento-continuo.png') });
  // Insert before existing text, not below all attachments.
  await editor.locator('p').first().click({ position: { x: 1, y: 12 } });
  await paste(page);
  await page.waitForFunction(() => document.querySelectorAll('.note-document-image').length === 3);
  assert.deepEqual(await blocks(page), ['IMAGE', 'Olha este print', 'IMAGE', 'Olha o print 2', 'IMAGE', 'Conclusão']);
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('.note-document-image').count(), 2);
  await page.keyboard.press('Control+y');
  assert.equal(await page.locator('.note-document-image').count(), 3);
  await page.getByRole('button', { name: 'Remover imagem', exact: true }).first().click();
  assert.equal(await page.locator('.note-document-image').count(), 2);
  // Insert into the middle of a paragraph and preserve both halves.
  await cursor(page, 2, 4); await paste(page);
  await page.waitForFunction(() => document.querySelectorAll('.note-document-image').length === 3);
  assert.deepEqual(await blocks(page), ['Olha este print', 'IMAGE', 'Olha o print 2', 'IMAGE', 'Conc', 'IMAGE', 'lusão']);
  await page.keyboard.insertText('Depois: ');
  assert.equal((await blocks(page)).at(-1), 'Depois: lusão');
  // Sketch uses the same insertion point as an image, even though its modal takes focus.
  await cursor(page, 0, 0);
  await page.getByRole('button', { name: 'Rabiscar', exact: true }).click();
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x + 15, box.y + 15); await page.mouse.down(); await page.mouse.move(box.x + 100, box.y + 60); await page.mouse.up();
  await page.getByRole('button', { name: 'Guardar no caderno', exact: true }).click();
  assert.equal((await blocks(page))[0], 'IMAGE');
  assert.equal((await blocks(page))[1], 'Olha este print');
  // Small attachments keep their close button within their own edge.
  const geometry = await page.locator('.note-document-image').nth(1).evaluate(el => {
    const frame = el.getBoundingClientRect(), image = el.querySelector('img').getBoundingClientRect(), button = el.querySelector('button').getBoundingClientRect();
    const previous = el.previousElementSibling.getBoundingClientRect();
    return { width: frame.width, image: image.width, inside: button.right <= image.right && button.left >= image.left, gap: frame.top - previous.bottom };
  });
  assert(Math.abs(geometry.width - geometry.image) < 2, JSON.stringify(geometry)); assert(geometry.inside); assert(geometry.gap >= 8 && geometry.gap <= 20, JSON.stringify(geometry));
  await page.screenshot({ path: path.join(output, '15-rabisco-no-documento.png') });
  // Async file reads map their insertion bookmark through typing and survive note switching.
  await cursor(page, 0, 0); await paste(page, { delay: true });
  await page.keyboard.insertText('Texto durante upload: ');
  await page.locator('.notebook-list').getByRole('button', { name: /^Nota anterior/ }).click();
  await new Promise(resolve => setTimeout(resolve, 600));
  await page.locator('.notebook-list').getByRole('button', { name: /^Documento contínuo/ }).click();
  assert.equal(await page.locator('.note-document-image').count(), 5);
  assert((await editor.innerText()).includes('Texto durante upload: '));
  assert((await editor.innerText()).includes('Olha este print'));
  // The file picker also retains the selection when its toolbar button takes focus.
  await page.getByRole('button', { name: 'Nova anotação', exact: true }).click();
  await page.getByRole('textbox', { name: 'Título da anotação', exact: true }).fill('Arquivo no cursor');
  await editor.fill('AntesDepois'); await cursor(page, 0, 5);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Imagem', exact: true }).click();
  await (await chooser).setFiles({ name: 'arquivo.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
  await page.locator('.note-document-image img').waitFor();
  assert.deepEqual(await blocks(page), ['Antes', 'IMAGE', 'Depois']);
  await page.locator('.notebook-list').getByRole('button', { name: /^Documento contínuo/ }).click();
  const expected = await blocks(page);
  await page.getByRole('button', { name: 'Filtrar notas por data', exact: true }).click();
  const dateFilter = page.getByLabel('Filtrar anotações pela data', { exact: true });
  await dateFilter.fill('2026-10-26');
  assert.equal(await page.locator('.notebook-list-row').count(), 1);
  assert.equal(await page.locator('.notebook-list-row strong').innerText(), 'Nota anterior');
  await page.getByRole('textbox', { name: 'Buscar anotações', exact: true }).fill('inexistente');
  assert.equal(await page.locator('.notebook-list-row').count(), 0);
  await page.getByRole('textbox', { name: 'Buscar anotações', exact: true }).fill('');
  await dateFilter.fill('1999-01-01');
  assert.equal(await page.locator('.notebook-list-row').count(), 0);
  await page.getByRole('button', { name: 'Limpar filtro de data', exact: true }).click();
  assert.equal(await page.locator('.notebook-list-row').count(), 3);
  await page.getByRole('button', { name: 'Filtrar notas por data', exact: true }).click();
  const background = page.locator('.main-scroll');
  assert(await background.evaluate(el => el.scrollHeight > el.clientHeight));
  assert.equal(await background.evaluate(el => getComputedStyle(el).overflowY), 'hidden');
  const backgroundTop = await background.evaluate(el => el.scrollTop);
  const sheet = page.locator('.notebook-page');
  await sheet.evaluate(el => { el.scrollTop = 0; });
  await sheet.hover(); await page.mouse.wheel(0, 700);
  await page.waitForFunction(() => document.querySelector('.notebook-page').scrollTop > 0);
  assert.equal(await background.evaluate(el => el.scrollTop), backgroundTop);
  await sheet.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.mouse.wheel(0, 700);
  await page.locator('.notebook-tools').hover(); await page.mouse.wheel(0, 700);
  await page.waitForTimeout(150);
  assert.equal(await background.evaluate(el => el.scrollTop), backgroundTop);
  await new Promise(resolve => setTimeout(resolve, 900));
  const saved = validateData(JSON.parse(fs.readFileSync(file, 'utf8')));
  const notes = saved.plans[0].notes;
  assert.equal(notes.find(n => n.id === old.id).pinned, true);
  assert.equal(notes.find(n => n.id === old.id).document.content.filter(n => n.type === 'image').length, 1);
  assert.equal(notes.find(n => n.title === 'Documento contínuo').images.length, 0);
  assert.equal(notes.find(n => n.title === 'Documento contínuo').document.content.filter(n => n.type === 'image').length, 5);
  assert.deepEqual(errors, []);
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  assert.equal(await background.evaluate(el => getComputedStyle(el).overflowY), 'auto');
  await app.close(); app = await electron.launch(options); page = await app.firstWindow();
  await page.getByRole('button', { name: 'Planos de estudo', exact: true }).click();
  await page.getByRole('button', { name: /^Anotações/ }).first().click();
  await page.getByRole('button', { name: /^Documento contínuo/ }).click();
  await page.getByRole('textbox', { name: 'Texto da anotação', exact: true }).waitFor();
  assert.deepEqual(await blocks(page), expected);
  console.log('PASS: legacy migration, interleaved text/images/sketch, cursor insertion, undo/redo, async paste, date filters, modal scrolling, geometry, backup and restart.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (app) await app.close(); });
