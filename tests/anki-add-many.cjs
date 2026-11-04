// Focused UI check; uses the already compiled build without rebuilding during packaging.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..'); let app, folder;
(async () => {
  const { seed } = await import('../src/model.js'), { basicModel, reversedModel } = await import('../src/anki.js');
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-add-many-'));
  const data = seed(); data.onboardingCompleted = true;
  data.anki.decks = [{ id: 'first', name: 'Vocabulário', presetId: 'default' }, { id: 'selected', name: 'Conversação', presetId: 'default' }]; data.anki.models = [basicModel, reversedModel];
  fs.writeFileSync(path.join(folder, 'compasso.json'), JSON.stringify(data)); const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [root, `--user-data-dir=${folder}`, '--skip-account-prompt'], env }); const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await page.getByRole('button', { name: 'Anki', exact: true }).click(); await page.getByRole('button', { name: 'Adicionar', exact: true }).click(); await page.getByRole('menuitem', { name: 'Criar carta', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Criar carta', exact: true }); await dialog.locator('.anki-form-grid select').nth(0).selectOption('selected'); await dialog.locator('.anki-form-grid select').nth(1).selectOption(reversedModel.id);
  for (const [index, front, back] of [[0,'Bom dia','Good morning'], [1,'Boa noite','Good evening']]) {
    await dialog.getByRole('textbox', { name: 'Frente', exact: true }).fill(front); await dialog.getByRole('textbox', { name: 'Verso', exact: true }).fill(back); await dialog.getByLabel('Marcadores', { exact: true }).fill('rotina');
    await dialog.getByRole('button', { name: 'Criar carta', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Frente' && !document.activeElement.textContent.trim());
    assert.equal((await dialog.getByRole('textbox', { name: 'Verso', exact: true }).innerText()).trim(), ''); assert.equal(await dialog.getByLabel('Marcadores', { exact: true }).inputValue(), '');
    assert.equal(await dialog.locator('.anki-form-grid select').nth(0).inputValue(), 'selected'); assert.equal(await dialog.locator('.anki-form-grid select').nth(1).inputValue(), reversedModel.id);
    await page.waitForFunction(async expected => (await window.desktop.load()).anki.notes.length === expected, index + 1);
  }
  await dialog.getByRole('button', { name: 'Criar carta', exact: true }).click(); assert.equal((await page.evaluate(() => window.desktop.load())).anki.notes.length, 2);
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click(); await page.getByRole('button', { name: 'Explorar', exact: true }).click(); await page.locator('.anki-browser article').filter({ hasText: 'Bom dia' }).first().getByRole('button', { name: 'Editar nota' }).click();
  const edit = page.getByRole('dialog', { name: 'Editar nota', exact: true }); await edit.getByRole('textbox', { name: 'Verso', exact: true }).fill('Good morning!'); await edit.getByRole('button', { name: 'Salvar nota', exact: true }).click(); await edit.waitFor({ state: 'detached' });
  await page.waitForFunction(async () => (await window.desktop.load()).anki.notes.some(note => note.fields[1].includes('Good morning!')));
  const saved = (await page.evaluate(() => window.desktop.load())).anki;
  assert.equal(saved.notes.length, 2); assert.equal(saved.cards.length, 4); assert.equal(new Set(saved.notes.map(note => note.id)).size, 2); assert(saved.cards.every(card => card.deckId === 'selected'));
  assert(saved.notes.some(note => note.fields[0].includes('Bom dia'))); assert(saved.notes.some(note => note.fields[0].includes('Boa noite')));
  console.log('Cadastro contínuo: duas notas distintas, quatro cartas invertidas, campos limpos, foco na Frente, baralho/tipo preservados, envio vazio bloqueado e edição existente encerrada corretamente.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close();
  if (folder) { const target = path.resolve(folder); if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('organon-add-many-')) fs.rmSync(target, { recursive: true, force: true }); }
});
