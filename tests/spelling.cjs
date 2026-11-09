// Uses the real Portuguese spelling provider and Chromium editing commands in an isolated profile.
// The popup is intercepted so this test does not require automating a native Windows menu.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-spelling-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
const runtime = [];
const capture = message => { runtime.push(String(message).trim()); if (runtime.length > 12) runtime.shift(); };
(async () => {
  const { seed, firstPlan, dayKey, validateData } = await import('../src/model.js');
  const { documentText, documentImages } = await import('../src/note-document.js');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'corassão', marks: [{ type: 'bold' }] }, { type: 'text', text: ' teste' }] }, { type: 'image', attrs: { src: png } }, { type: 'paragraph' }] };
  const plan = { ...firstPlan(), notes: [{ id: 'spelling-note', title: 'Ortografia', date: dayKey(), text: documentText(document), images: [], document }] };
  const initial = { ...seed(), plans: [plan], onboardingCompleted: true };
  fs.writeFileSync(path.join(profile, 'compasso.json'), JSON.stringify(validateData(initial)));
  const executablePath = process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE;
  app = await electron.launch({ executablePath: executablePath || require('electron'), args: [...(executablePath ? [] : [root]), `--user-data-dir=${profile}`, '--skip-account-prompt'], env });
  const page = await app.firstWindow(), errors = [];
  // Native spelling relies on Chromium's real focus, which Playwright otherwise emulates.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); win.webContents.focus(); });
  page.on('pageerror', error => errors.push(error.message));
  app.process().stdout.on('data', capture);
  app.process().stderr.on('data', capture);
  app.process().once('exit', (code, signal) => capture(`Electron exit: code=${code}, signal=${signal}`));
  page.on('crash', () => capture('Renderer crashed'));
  {
    await app.evaluate(({ BrowserWindow, ipcMain }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.on('close', () => console.log('SPELLING: window close requested'));
      win.webContents.on('render-process-gone', (_event, details) => console.log('SPELLING: renderer gone', JSON.stringify(details)));
      ipcMain.on('window:close', () => console.log('SPELLING: renderer requested close'));
    });
  }
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor();
  await app.evaluate(({ Menu, BrowserWindow }) => {
    global.__spellingProbe = { template: [], menus: 0, events: 0, params: null };
    const original = Menu.buildFromTemplate;
    Menu.buildFromTemplate = template => {
      if (!template.some(item => item.role === 'undo')) return original(template);
      global.__spellingProbe.template = template; global.__spellingProbe.menus++;
      return { popup() {}, closePopup() {} };
    };
    BrowserWindow.getAllWindows()[0].webContents.on('context-menu', (_event, params) => {
      global.__spellingProbe.events++;
      global.__spellingProbe.params = { word: params.misspelledWord, suggestions: params.dictionarySuggestions, editable: params.isEditable, type: params.formControlType, spellcheckEnabled: params.spellcheckEnabled };
    });
  });
  async function clickWord(locator, word) {
    await locator.waitFor({ state: 'visible', timeout: 5000 });
    await locator.scrollIntoViewIfNeeded();
    const point = await locator.evaluate((element, word) => {
      const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const start = node.textContent.indexOf(word); if (start < 0) continue;
        const range = element.ownerDocument.createRange(); range.setStart(node, start); range.setEnd(node, start + word.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
      throw new Error(`Palavra ausente: ${word}`);
    }, word);
    const before = await app.evaluate(() => global.__spellingProbe.menus);
    if (process.argv.includes('--diagnose')) console.log('Before context:', await page.evaluate(point => ({ point, target: document.elementFromPoint(point.x, point.y)?.outerHTML.slice(0, 250), dialogs: [...document.querySelectorAll('[role="dialog"]')].map(element => element.getAttribute('aria-label')) }), point));
    await page.mouse.click(point.x, point.y, { button: 'right' });
    if (process.argv.includes('--diagnose')) console.log('After context:', await page.evaluate(() => ({ dialogs: [...document.querySelectorAll('[role="dialog"]')].map(element => element.getAttribute('aria-label')) })));
    await app.evaluate((_electron, before) => new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (global.__spellingProbe.menus > before) { clearInterval(timer); resolve(); }
        else if (Date.now() - start > 15000) { clearInterval(timer); reject(new Error('O menu de contexto não retornou em 15 segundos.')); }
      }, 25);
    }), before);
  }
  async function correct(locator, word, suggestion) {
    let id;
    for (let attempt = 0; attempt < 40; attempt++) {
      await clickWord(locator, word);
      id = await app.evaluate((_electron, suggestion) => global.__spellingProbe.template.find(item => item.id?.startsWith('spelling-replace-') && item.label === suggestion)?.id, suggestion);
      if (id) break;
      await page.waitForTimeout(500);
    }
    if (!id) {
      const info = await app.evaluate(() => ({ ...global.__spellingProbe.params, items: global.__spellingProbe.template.map(item => item.label) }));
      throw new Error(`Dicionário pt-BR não ofereceu “${suggestion}”. ${JSON.stringify(info)}`);
    }
    await app.evaluate((_electron, id) => global.__spellingProbe.template.find(item => item.id === id).click(), id);
    await page.waitForFunction(({ label, suggestion }) => document.querySelector(`[aria-label="${label}"]`)?.textContent.includes(suggestion), { label: await locator.getAttribute('aria-label'), suggestion });
  }
  if (!process.argv.includes('--compact-only')) {
  await page.getByRole('button', { name: 'Planos de estudo', exact: true }).click();
  await page.getByRole('button', { name: /^Anotações/ }).first().click();
  await page.locator('.preview-note').filter({ hasText: 'Ortografia' }).click();
  const editor = page.getByRole('textbox', { name: 'Texto da anotação', exact: true });
  await editor.waitFor();
  if (process.argv.includes('--open-only')) {
    assert.equal(await editor.locator('strong').innerText(), 'corassão');
    assert.equal(await editor.locator('img').count(), 1);
    console.log('PASS: notebook preview opens its rich editor in an isolated profile. Spelling flow not executed.');
    return;
  }
  await editor.click();
  await editor.evaluate(element => { element.editor.commands.setTextSelection({ from: 1, to: 9 }); element.editor.view.focus(); });
  await page.keyboard.insertText('corassão');
  await page.keyboard.press('Space');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(1000);
  await correct(editor, 'corassão', 'coração');
  if (process.argv.includes('--first-correction-only')) { console.log('PASS: first native correction completed in an isolated profile.'); return; }
  assert.equal(await editor.locator('strong').innerText(), 'coração');
  assert.equal(await editor.locator('img').count(), 1);
  const notebook = page.getByRole('dialog', { name: /^Anotações ·/ });
  await notebook.getByRole('button', { name: 'Desfazer', exact: true }).click();
  assert((await editor.innerText()).includes('corassão'));
  await notebook.getByRole('button', { name: 'Refazer', exact: true }).click();
  assert((await editor.innerText()).includes('coração'));
  await notebook.getByRole('button', { name: 'Fechar', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Notas', exact: true }).click();
  await page.getByRole('button', { name: 'Nova nota', exact: true }).click();
  await page.getByLabel('Título da nota', { exact: true }).fill('Ortografia compacta');
  const compact = page.getByRole('textbox', { name: 'Descrição da nota', exact: true });
  // A bulk contenteditable fill does not reliably trigger Chromium's spelling pass.
  // Enter this word through real key events, as in the notebook above.
  await compact.click();
  await compact.pressSequentially('corassão teste');
  await compact.press('Space');
  await compact.press('Backspace');
  await correct(compact, 'corassão', 'coração');
  await page.getByRole('button', { name: 'Salvar nota', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.load()).reminders.some(note => note.description === 'coração teste'));
  const saved = validateData(await page.evaluate(() => window.desktop.load()));
  if (process.argv.includes('--compact-only')) { assert.deepEqual(errors, []); console.log('PASS: compact editor correction persisted in isolated profile.'); return; }
  assert.equal(saved.plans[0].notes[0].text, 'coração teste');
  assert.deepEqual(documentImages(saved.plans[0].notes[0]), [png]);
  assert.equal(saved.plans[0].notes[0].document.content[0].content[0].marks[0].type, 'bold');
  assert.deepEqual(errors, []);
  console.log('PASS: real pt-BR suggestions and replacement in notebook and compact editor; bold, image, undo/redo and persisted document preserved. Native popup appearance requires manual preview validation.');
})().catch(error => { console.error(error); if (runtime.length) console.error('Diagnóstico do Electron:\n' + runtime.join('\n')); process.exitCode = 1; }).finally(async () => { if (app) await app.close().catch(() => {}); });
