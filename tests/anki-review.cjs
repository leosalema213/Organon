// Focused review/audio regression. --screenshots-only produces the user's requested preview images.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { packageFixture } = require('./anki-fixtures.cjs');
const root = path.resolve(__dirname, '..'), screenshotsOnly = process.argv.includes('--screenshots-only');
let app, directory;
(async () => {
  if (!screenshotsOnly) cp.execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root, stdio: 'inherit' });
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-anki-review-'));
  const profile = path.join(directory, 'profile'), output = path.join(root, 'test-output'); fs.mkdirSync(profile); fs.mkdirSync(output, { recursive: true });
  const { seed } = await import('../src/model.js'), { basicModel, newCard } = await import('../src/anki.js'), { AnkiMedia } = require('../electron/anki-media.cjs');
  const bytes = Buffer.alloc(44 + 8000 * 2 * 8); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  const data = seed(); data.onboardingCompleted = true; data.settings.theme = 'dark';
  data.anki.decks = [{ id: 'deck', name: 'Inglês · revisão', presetId: 'default' }]; data.anki.models = [basicModel];
  data.anki.media = { 'sample.wav': new AnkiMedia(profile).put(bytes, 'sample.wav') };
  data.anki.notes = [{ id: 'note', modelId: basicModel.id, fields: ['Como se diz “aprender” em inglês? [sound:sample.wav]', 'To learn'], tags: [] }];
  data.anki.cards = [newCard('note', 'deck', 0, 1)];
  fs.writeFileSync(path.join(profile, 'compasso.json'), JSON.stringify(data));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env }); const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Anki', exact: true }).click();
  const fixtures = path.join(directory, 'fixture'); fs.mkdirSync(fixtures); const file = packageFixture(fixtures, true);
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); dialog.showMessageBox = async () => ({ response: 0 }); }, file);
  await page.getByRole('button', { name: 'Importar arquivo', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Importar coleção Anki', exact: true }); await modal.waitFor();
  await modal.screenshot({ path: path.join(output, 'anki-import-preview3.png') });
  await modal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Criar baralho', exact: true }).click();
  await page.getByRole('dialog').screenshot({ path: path.join(output, 'anki-deck-preview3.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Inglês · revisão', exact: true }).click();
  await page.getByRole('button', { name: 'Estudar agora', exact: true }).click();
  const front = page.frameLocator('iframe[title="Frente da carta"]'); await front.getByRole('button', { name: 'Reproduzir áudio', exact: true }).waitFor();
  if (!screenshotsOnly) {
    await page.waitForFunction(() => document.querySelector('iframe[title="Frente da carta"]')?.contentDocument?.querySelector('audio')?.paused === false);
    assert.equal(await front.locator('audio[controls]').count(), 0);
    assert.equal(await page.getByRole('button', { name: /Repetir áudio|Enterrar até amanhã/ }).count(), 0);
  }
  await page.getByRole('button', { name: /Mostrar resposta/ }).click();
  const back = page.frameLocator('iframe[title="Verso da carta"]'); await back.getByRole('button', { name: 'Reproduzir áudio', exact: true }).waitFor();
  // A screenshot waits for the flip to finish; no profile outside this fixture is opened.
  await page.waitForTimeout(550);
  await page.locator('.anki-section').screenshot({ path: path.join(output, 'anki-review-preview3.png') });
  if (!screenshotsOnly) {
    assert(await back.locator('audio').evaluate(audio => audio.paused));
    assert(await front.locator('audio').evaluate(audio => audio.paused));
    assert.equal(await back.locator('audio[controls]').count(), 0);
    await back.getByRole('button', { name: 'Reproduzir áudio', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('iframe[title="Verso da carta"]')?.contentDocument?.querySelector('audio')?.paused === false);
    await back.locator('audio').evaluate(audio => { audio.dataset.replays = '0'; audio.addEventListener('play', () => { audio.dataset.replays = String(Number(audio.dataset.replays) + 1); }); });
    await page.keyboard.press('r');
    await page.waitForFunction(() => document.querySelector('iframe[title="Verso da carta"]')?.contentDocument?.querySelector('audio')?.dataset.replays === '1');
    assert.equal(await page.getByRole('button', { name: /Difícil|Fácil/ }).count(), 0);
    await page.getByRole('button', { name: /Acertei/ }).click();
    await page.getByRole('heading', { name: 'Revisões em dia por enquanto.', exact: true }).waitFor();
    await page.waitForFunction(async () => (await window.desktop.load()).anki.reviews.length === 1);
    const saved = await page.evaluate(() => window.desktop.load()); assert.equal(saved.anki.reviews[0].rating, 3); assert.equal(saved.anki.cards[0].state, 1); assert.equal(saved.anki.cards[0].step, 1);
    await page.getByRole('button', { name: 'Desfazer última resposta', exact: true }).click();
    await front.getByText(/Como se diz/).waitFor();
    await page.getByRole('button', { name: /Mostrar resposta/ }).click();
    await page.getByRole('button', { name: /Errei/ }).click();
    await page.getByRole('heading', { name: 'Revisões em dia por enquanto.', exact: true }).waitFor();
    await page.waitForFunction(async () => (await window.desktop.load()).anki.reviews[0]?.rating === 1);
    const failed = await page.evaluate(() => window.desktop.load()); assert.equal(failed.anki.cards[0].step, 0);
    console.log('Revisão: autoplay apenas na entrada, play/R, ausência de barra nativa, Errei/Acertei e Acertei=Bom verificados.');
  }
  console.log('Prints em:', output);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close();
  if (directory) { const target = path.resolve(directory); if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('organon-anki-review-')) fs.rmSync(target, { recursive: true, force: true }); }
});
