const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
let app, profile;

(async () => {
  const { seed, firstPlan } = await import('../src/model.js');
  const { basicModel, newCard, reversedModel } = await import('../src/anki.js');
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-anki-navigation-'));
  const data = seed();
  data.onboardingCompleted = true;
  const plan = { ...firstPlan(), days: [0, 1, 2, 3, 4, 5, 6] };
  data.plans = [plan];
  data.anki.settings.learnAhead = 0;
  data.anki.decks = [
    { id: 'other', name: 'Outro baralho', presetId: 'default' },
    { id: 'linked', name: 'Baralho vinculado', presetId: 'default', planIds: [plan.id] },
  ];
  data.anki.models = [basicModel, reversedModel];
  data.anki.notes = ['Primeira pergunta', 'Segunda pergunta'].map((question, index) => ({
    id: `note-${index}`, modelId: basicModel.id, fields: [question, 'Resposta'], tags: [],
  }));
  data.anki.cards = data.anki.notes.map((note, index) => newCard(note.id, 'linked', 0, index + 1));
  data.anki.notes.push(
    { id: 'duplicate', modelId: reversedModel.id, fields: ['Pergunta duplicada', 'Resposta duplicada'], tags: [] },
    { id: 'next', modelId: basicModel.id, fields: ['Próxima pergunta', 'Resposta'], tags: [] },
  );
  // Keep the sibling out of the earlier undo scenario.
  data.anki.cards.push(
    newCard('duplicate', 'other', 0, 1),
    { ...newCard('duplicate', 'linked', 1, 2), suspended: true },
    newCard('next', 'other', 0, 3),
  );
  fs.writeFileSync(path.join(profile, 'compasso.json'), JSON.stringify(data));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.getByRole('button', { name: 'Anki do plano (1)', exact: true }).click();
  await page.locator('.anki-breadcrumb [aria-current="page"]').filter({ hasText: 'Baralho vinculado' }).waitFor();
  assert.equal(await page.locator('.anki-decks').count(), 0);
  const start = page.getByRole('button', { name: 'Estudar agora', exact: true });
  const undo = page.getByRole('button', { name: 'Desfazer última resposta', exact: true });
  const front = page.frameLocator('iframe[title="Frente da carta"]');
  async function answer(question) {
    await front.getByText(question, { exact: true }).waitFor();
    await page.getByRole('button', { name: /Mostrar resposta/ }).click();
    await page.getByRole('button', { name: /Acertei/ }).click();
  }
  await start.click();
  await answer('Primeira pergunta');
  await front.getByText('Segunda pergunta', { exact: true }).waitFor();
  await undo.click();
  await front.getByText('Primeira pergunta', { exact: true }).waitFor();
  await page.waitForFunction(async () => (await window.desktop.load()).anki.reviews.length === 0);
  await answer('Primeira pergunta');
  await answer('Segunda pergunta');
  await page.getByRole('heading', { name: 'Revisões em dia por enquanto.', exact: true }).waitFor();
  await undo.click();
  await front.getByText('Segunda pergunta', { exact: true }).waitFor();
  assert.equal(await start.count(), 0);
  await page.waitForFunction(async () => (await window.desktop.load()).anki.reviews.length === 1);

  await page.getByRole('navigation', { name: 'Caminho do baralho' }).getByRole('button', { name: 'Baralhos', exact: true }).click();
  await page.getByRole('combobox', { name: 'Baralhos por plano' }).selectOption('');
  await page.getByRole('button', { name: 'Outro baralho', exact: true }).click();
  await start.click();
  await front.getByText('Pergunta duplicada', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Mostrar resposta/ }).click();

  const editor = page.getByRole('dialog', { name: 'Editar nota', exact: true });
  const confirmation = page.getByRole('dialog', { name: 'Excluir nota?', exact: true });
  const openConfirmation = editor.getByRole('button', { name: 'Excluir nota e suas cartas', exact: true });
  const tags = editor.getByRole('textbox', { name: 'Marcadores', exact: true });
  await page.getByRole('button', { name: 'Editar nota', exact: true }).click();
  await tags.fill('rascunho');
  await openConfirmation.click();
  await confirmation.waitFor();
  await page.keyboard.press('Escape');
  await confirmation.waitFor({ state: 'hidden' });
  assert.equal(await tags.inputValue(), 'rascunho');
  await openConfirmation.click();
  await confirmation.getByRole('button', { name: 'Excluir nota', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  await front.getByText('Próxima pergunta', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Mostrar resposta/ }).waitFor();
  assert.equal(await start.count(), 0);
  await page.waitForFunction(async () => {
    const { anki } = await window.desktop.load();
    return !anki.notes.some(note => note.id === 'duplicate') && !anki.cards.some(card => card.noteId === 'duplicate') && anki.reviews.length === 1;
  });

  await page.getByRole('button', { name: 'Editar nota', exact: true }).click();
  await openConfirmation.click();
  await confirmation.getByRole('button', { name: 'Excluir nota', exact: true }).click();
  await page.getByRole('heading', { name: 'Revisões em dia por enquanto.', exact: true }).waitFor();
  console.log('Atalho de Meu dia, desfazer e exclusão de notas durante a revisão aprovados. Perfil temporário.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close();
  if (profile) {
    const target = path.resolve(profile);
    if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('organon-anki-navigation-')) fs.rmSync(target, { recursive: true, force: true });
  }
});
