// Focused shell test with synthetic IPC and a temporary profile; no real account.
const { _electron: electron } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-notebook-sharing-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
(async () => {
  const { seed, newNotebook } = await import('../src/model.js');
  const personal = ['Pessoal um', 'Pessoal dois'].map(name => ({ ...newNotebook(), name }));
  const received = ['Recebido', 'Editável'].map(name => ({ ...newNotebook(), name }));
  received[0].cover = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const books = [1, 2].map(index => ({ id: crypto.randomUUID(), title: `Livro ${index}`, hash: String(index).repeat(64), size: 10, format: 'pdf', planIds: [], page: 1, pageCount: null, furthestPage: 0, completedAt: null, importedAt: new Date().toISOString(), view: { spread: 1, zoom: 1, contrast: 'paper' } }));
  fs.writeFileSync(path.join(profile, 'compasso.json'), JSON.stringify({ ...seed(), onboardingCompleted: true, notebooks: personal, books }));
  app = await electron.launch({ args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env });
  const page = await app.firstWindow(), errors = []; page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.locator('.sidebar nav button').first().waitFor();
  await app.evaluate(({ ipcMain, BrowserWindow }, { personal, received, books }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => callback({ cancel: true }));
    const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Autor', nickname: 'Autor' };
    const spaces = [1, 2].map(i => ({ id: `cccccccc-cccc-4ccc-8ccc-ccccccccccc${i}`, name: `Equipe ${i}`, owner_id: user.id }));
    const state = globalThis.notebookSharing = { personal, received, books, spaces, rows: [], calls: [], failPublish: true, failDelete: false, conflict: false };
    for (const content of received) for (const space of spaces) state.rows.push({ module: 'notebooks', org_id: space.id, resource_id: content.id, content: content.cover ? { ...content, cover: { bucket: 'organon-shared', object: 'private-cover-reference' } } : content, published_by: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', revision: 1 });
    const invalidate = () => win.webContents.send('modules:changed', { module: 'teams', type: 'invalidate' });
    for (const action of ['status', 'sync', 'skip']) {
      ipcMain.removeHandler(`cloud:${action}`); ipcMain.handle(`cloud:${action}`, () => ({ enabled: true, promptSeen: true, user, busy: false }));
    }
    ipcMain.removeHandler('modules:watch'); ipcMain.handle('modules:watch', () => ({ connected: true }));
    ipcMain.removeHandler('modules:call'); ipcMain.handle('modules:call', (_event, module, action, payload) => {
      if (module !== 'teams') throw new Error('Módulo inesperado');
      if (action === 'list') return spaces;
      if (action === 'inbox') return { notifications: [], invitations: [], unreadCount: 0 };
      if (action === 'shareRecipients') {
        const copy = state.rows.find(row => row.org_id === payload.orgId && row.module === payload.module && row.resource_id === payload.resourceId);
        return { permissionsVersion: 1, token: 'a'.repeat(32), members: [{ user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Destinatário', write: copy?.recipientWrites?.['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'] === true, selected: !copy?.recipientIds || copy.recipientIds.includes('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') }], revision: copy?.revision || 0 };
      }
      if (action === 'resources') return state.rows.filter(row => row.org_id === payload.orgId);
      const row = state.rows.find(row => row.org_id === payload.orgId && row.module === payload.module && row.resource_id === payload.resourceId);
      if (action === 'resourceVersion') { if (!row) throw new Error('Acesso removido'); return { revision: row.revision, canWrite: row.published_by === user.id || row.content.name === 'Editável' }; }
      if (action === 'roster') return [{ user_id: user.id, name: 'Autor' }, { user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Destinatário' }];
      if (action === 'resourceCover') { state.calls.push({ action, ...payload }); return { cover: received.find(item => item.id === payload.resourceId)?.cover || null }; }
      if (action === 'openResource') { if (!row) throw new Error('Acesso removido'); return { ...row, content: row.content.cover?.bucket ? { ...row.content, cover: received.find(item => item.id === payload.resourceId).cover } : row.content, canWrite: row.published_by === user.id || row.content.name === 'Editável' }; }
      if (action === 'setRecipients') {
        if (!row || row.revision !== payload.revision) throw new Error('Conflito');
        row.recipientIds = payload.recipientIds; row.recipientWrites = { ...row.recipientWrites, ...payload.recipientWrites }; row.revision++; state.calls.push({ action, ...payload }); invalidate(); return row;
      }
      if (action === 'publish') {
        if (state.failPublish && payload.module === 'books' && payload.resourceId === books[1].id) { state.failPublish = false; throw new Error('Falha parcial de teste'); }
        if (row) throw new Error('Publicação duplicada');
        const content = payload.module === 'books' ? books.find(item => item.id === payload.resourceId) : personal.find(item => item.id === payload.resourceId);
        state.rows.push({ org_id: payload.orgId, module: payload.module, resource_id: payload.resourceId, content, published_by: user.id, revision: 1, recipientIds: payload.recipientIds, recipientWrites: payload.recipientWrites });
        state.calls.push({ action, ...payload }); invalidate(); return {};
      }
      if (action === 'unpublish') {
        if (state.failDelete) { state.failDelete = false; throw new Error('Falha de retirada'); }
        if (!row || row.published_by !== user.id || row.revision !== payload.revision) throw new Error('Sem permissão ou revisão alterada');
        state.rows.splice(state.rows.indexOf(row), 1); state.calls.push({ action, ...payload }); invalidate(); return {};
      }
      if (action === 'editResource') {
        if (state.conflict || !row || row.revision !== payload.revision) throw new Error('Este registro mudou. Atualize e reveja as alterações antes de salvar.');
        row.content = payload.content; row.revision++; invalidate(); return row;
      }
      throw new Error(`Ação inesperada: ${action}`);
    });
  }, { personal, received, books });
  await page.reload();
  const nav = page.locator('.sidebar nav'), card = name => page.locator('.journal-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await nav.getByRole('button', { name: 'Cadernos', exact: true }).click();
  await card('Recebido').waitFor();
  assert.equal(await card('Recebido').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Cadernos compartilhados', exact: true }).count(), 0);
  await card('Recebido').getByRole('img', { name: 'Caderno compartilhado' }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.journal-card')].find(card => card.textContent.includes('Recebido'))?.querySelector('.journal-cover img')?.naturalWidth > 0);
  assert(await app.evaluate(() => globalThis.notebookSharing.calls.some(call => call.action === 'resourceCover')));
  await card('Pessoal um').getByRole('button', { name: 'Editar caderno Pessoal um', exact: true }).click();
  await page.getByRole('dialog', { name: 'Editar caderno', exact: true }).getByRole('button', { name: 'Compartilhar caderno', exact: true }).click();
  let modal = page.getByRole('dialog', { name: 'Compartilhar caderno', exact: true });
  await modal.getByRole('checkbox', { name: 'Equipe 2', exact: true }).check();
  await modal.getByRole('combobox', { name: 'Acesso de Destinatário em Equipe 2', exact: true }).selectOption('true');
  await modal.getByRole('button', { name: 'Compartilhar', exact: true }).click(); await modal.waitFor({ state: 'hidden' });
  assert.deepEqual(await app.evaluate(() => globalThis.notebookSharing.calls.find(call => call.action === 'publish').recipientWrites), { 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb': true });
  await card('Pessoal um').getByRole('img', { name: 'Caderno compartilhado' }).waitFor();
  assert.equal(await card('Pessoal um').count(), 1);
  await card('Pessoal um').getByRole('button', { name: 'Editar caderno Pessoal um', exact: true }).click();
  const editing = page.getByRole('dialog', { name: 'Editar caderno', exact: true });
  assert.equal(await editing.locator('.modal-heading-actions').getByRole('button', { name: 'Compartilhar caderno', exact: true }).count(), 1);
  assert.equal(await editing.getByRole('button', { name: 'Salvar', exact: true }).count(), 1);
  await editing.getByRole('button', { name: 'Compartilhar caderno', exact: true }).click();
  modal = page.getByRole('dialog', { name: 'Compartilhar caderno', exact: true });
  await modal.getByRole('checkbox', { name: 'Destinatário', exact: true }).uncheck();
  await modal.getByRole('button', { name: 'Salvar alterações', exact: true }).click(); await modal.waitFor({ state: 'hidden' });
  assert.deepEqual(await app.evaluate(() => globalThis.notebookSharing.calls.find(call => call.action === 'setRecipients').recipientIds), []);

  await page.getByRole('button', { name: 'Compartilhar cadernos', exact: true }).click();
  modal = page.getByRole('dialog', { name: 'Compartilhar cadernos', exact: true });
  await modal.getByRole('checkbox', { name: 'Todos os cadernos', exact: true }).check();
  await modal.getByRole('checkbox', { name: 'Equipe 1', exact: true }).check();
  await modal.getByRole('button', { name: 'Salvar alterações', exact: true }).click(); await modal.waitFor({ state: 'hidden' });
  await card('Pessoal dois').getByRole('img', { name: 'Caderno compartilhado' }).waitFor();
  await card('Pessoal um').getByRole('button', { name: 'Abrir caderno Pessoal um', exact: true }).click();
  await page.locator('.journal-shared-reader .journal-heading').waitFor();
  await page.getByRole('textbox', { name: 'Título da página', exact: true }).fill('Alteração do autor');
  await page.getByRole('button', { name: 'Todos os cadernos', exact: true }).click();
  await card('Pessoal um').waitFor();
  assert(await app.evaluate(() => globalThis.notebookSharing.rows.some(row => row.content.pages[0]?.title === 'Alteração do autor')));
  await page.getByRole('button', { name: 'Abrir caderno Pessoal um', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Título da página', exact: true }).inputValue(), 'Alteração do autor');
  await page.getByRole('button', { name: 'Todos os cadernos', exact: true }).click();
  await nav.getByRole('button', { name: 'Livros', exact: true }).click();
  await page.getByRole('button', { name: 'Compartilhar livros', exact: true }).click();
  modal = page.getByRole('dialog', { name: 'Compartilhar livros', exact: true });
  await modal.getByRole('checkbox', { name: 'Todos os livros', exact: true }).check();
  await modal.getByRole('checkbox', { name: 'Equipe 2', exact: true }).check();
  console.log('Cenário esperado: simulando uma falha no Livro 2 para conferir a recuperação na nova tentativa.');
  await modal.getByRole('button', { name: 'Compartilhar', exact: true }).click();
  await modal.getByRole('alert').waitFor();
  assert.match(await modal.getByRole('alert').innerText(), /Livro 2.*Falha parcial de teste/);
  assert.equal(await app.evaluate(() => globalThis.notebookSharing.calls.filter(call => call.action === 'publish' && call.module === 'books').length), 1);
  await modal.getByRole('button', { name: 'Salvar alterações', exact: true }).click(); await modal.waitFor({ state: 'hidden' });
  assert.equal(await app.evaluate(() => globalThis.notebookSharing.calls.filter(call => call.action === 'publish' && call.module === 'books').length), 2);
  console.log('Recuperação conferida: Livro 2 compartilhado na nova tentativa, sem duplicar o Livro 1.');
  await nav.getByRole('button', { name: 'Cadernos', exact: true }).click();
  await card('Recebido').getByRole('button', { name: 'Abrir caderno Recebido', exact: true }).click();
  await page.locator('.journal-shared-reader .journal-layout').waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Título da página', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Editar caderno compartilhado', exact: true }).count(), 0);
  assert.equal(await page.locator('.journal-heading').getByRole('button', { name: 'Todos os cadernos', exact: true }).count(), 1);
  assert.equal(await page.locator('.journal-shared-toolbar').count(), 0);
  await page.getByRole('button', { name: 'Baixar cópia', exact: true }).click();
  await page.getByText('Cópia salva nos seus cadernos.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Todos os cadernos', exact: true }).click();
  assert.equal(await card('Recebido').count(), 1);
  await card('Editável').getByRole('button', { name: 'Abrir caderno Editável', exact: true }).click();
  await page.getByRole('button', { name: 'Editar caderno', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Nova página', exact: true }).first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'Salvar alterações', exact: true }).count(), 0);
  await page.getByRole('textbox', { name: 'Título da página', exact: true }).fill('Salvo sem botão');
  await page.waitForFunction(() => document.querySelector('.journal-page-tools')?.textContent.includes('Salvo automaticamente'));
  await app.evaluate(() => { const state = globalThis.notebookSharing; if (!state.rows.some(row => row.content.pages[0]?.title === 'Salvo sem botão')) throw new Error('Autosave ausente'); });
  await app.evaluate(({ BrowserWindow }) => { const state = globalThis.notebookSharing; const row = state.rows.find(row => row.content.name === 'Editável'); row.content.pages[0].title = 'Mudança remota'; row.revision++; BrowserWindow.getAllWindows()[0].webContents.send('modules:changed', { module: 'teams', type: 'invalidate' }); });
  await page.waitForFunction(() => document.querySelector('input[aria-label="Título da página"]')?.value === 'Mudança remota');
  await app.evaluate(() => { globalThis.notebookSharing.conflict = true; });
  await page.getByRole('textbox', { name: 'Título da página', exact: true }).fill('Rascunho preservado');
  await page.getByRole('alert').filter({ hasText: 'Este registro mudou' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Título da página', exact: true }).inputValue(), 'Rascunho preservado');
  await page.getByRole('button', { name: 'Baixar cópia do rascunho', exact: true }).click();
  await page.getByText('Rascunho salvo nos seus cadernos.', { exact: true }).waitFor();
  await page.locator('.journal-shared-reader .journal-layout').waitFor();
  await page.getByRole('button', { name: 'Todos os cadernos', exact: true }).first().click();
  await app.evaluate(({ BrowserWindow }) => {
    const state = globalThis.notebookSharing; state.rows = state.rows.filter(row => !state.received.some(item => item.id === row.resource_id));
    BrowserWindow.getAllWindows()[0].webContents.send('modules:changed', { module: 'teams', type: 'invalidate' });
  });
  await card('Editável').waitFor({ state: 'hidden' });
  await card('Recebido').getByRole('img', { name: 'Caderno compartilhado' }).waitFor({ state: 'hidden' });
  assert.equal(await card('Recebido').count(), 1);
  await card('Pessoal um').getByRole('button', { name: 'Editar caderno Pessoal um', exact: true }).click();
  await page.getByRole('dialog', { name: 'Editar caderno', exact: true }).getByRole('button', { name: 'Excluir caderno', exact: true }).click();
  modal = page.getByRole('dialog', { name: 'Excluir caderno?', exact: true });
  await app.evaluate(() => { globalThis.notebookSharing.failDelete = true; });
  await modal.getByRole('button', { name: 'Excluir caderno', exact: true }).click();
  await modal.getByRole('alert').waitFor();
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'compasso.json'))).notebooks.some(item => item.id === personal[0].id), true);
  await modal.getByRole('button', { name: 'Excluir caderno', exact: true }).click(); await modal.waitFor({ state: 'hidden' });
  await card('Pessoal um').waitFor({ state: 'hidden' });
  assert.equal(await app.evaluate((_electron, id) => globalThis.notebookSharing.rows.some(row => row.resource_id === id), personal[0].id), false);
  await page.reload(); await nav.getByRole('button', { name: 'Cadernos', exact: true }).click();
  await card('Recebido').waitFor();
  assert.equal(await card('Recebido').count(), 1);
  assert.deepEqual(errors, []);
  console.log('Cadernos unificados, edição por revisão, cópia independente, lotes de livros/cadernos e recuperação de falhas aprovados. IPC simulado; servidor real não validado.');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close();
  const target = fs.realpathSync(profile), temporary = fs.realpathSync(os.tmpdir());
  if (path.dirname(target) === temporary && path.basename(target).startsWith('organon-notebook-sharing-')) fs.rmSync(target, { recursive: true, force: true });
});
