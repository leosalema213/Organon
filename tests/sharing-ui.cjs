// Real shell, synthetic authenticated server, temporary profile; no personal data.
const { _electron: electron } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-sharing-ui-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
(async () => {
  const { seed } = await import('../src/model.js'), { basicModel, newCard } = await import('../src/anki.js');
  const fixture = { ...seed(), onboardingCompleted: true }, deckId = crypto.randomUUID(), noteId = crypto.randomUUID();
  const localBookId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  fixture.books = [{ id: localBookId, title: 'Livro pessoal para publicar', format: 'pdf', hash: 'a'.repeat(64), size: 10, planIds: [], page: 1, furthestPage: 0, pageCount: null, completedAt: null, importedAt: new Date().toISOString(), view: { spread: 1, zoom: 1, contrast: 'paper' } }];
  fixture.anki.models = [basicModel]; fixture.anki.decks = [{ id: deckId, name: 'Revisões', presetId: 'default' }];
  fixture.anki.notes = [{ id: noteId, modelId: basicModel.id, fields: ['Frente', 'Verso'], tags: [] }];
  fixture.anki.cards = [2, 1, 0].map(state => ({ ...newCard(noteId, deckId), state, due: Date.now() - 10000 }));
  fs.writeFileSync(path.join(profile, 'compasso.json'), JSON.stringify(fixture));
  app = await electron.launch({ args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await page.locator('.sidebar nav button').first().waitFor();
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*','https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const owner = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Dono', nickname: 'Dono' }, guest = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Convidado', nickname: 'Convidado' };
    const workspace = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Espaço', owner_id: owner.id };
    const otherSpace = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccd', name: 'Outro espaço', owner_id: owner.id };
    const grants = { books: { mode: 'all', ids: [], write: false } };
    const state = globalThis.sharingUi = { owner, guest, workspace, user: owner, grants, downloaded: [], saves: [], resources: [{ org_id: workspace.id, module: 'books', resource_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', published_by: owner.id, revision: 1, content: { title: 'Livro publicado' } }] };
    const status = () => ({ enabled: true, promptSeen: true, user: state.user, busy: false, pending: false });
    for (const name of ['status','sync','skip']) { ipcMain.removeHandler(`cloud:${name}`); ipcMain.handle(`cloud:${name}`, status); }
    ipcMain.removeHandler('modules:watch'); ipcMain.handle('modules:watch', () => ({ connected: true, realtime: false }));
    ipcMain.removeHandler('modules:call'); ipcMain.handle('modules:call', (_event, module, action, payload) => {
      if (module === 'teams') {
        if (action === 'list') return [workspace, otherSpace];
        if (action === 'inbox') return { notifications: [], invitations: [], unreadCount: 0 };
        if (action === 'roster') return [{ id: 'member', user_id: guest.id, name: guest.name, status: 'accepted', role: 'member', revision: 1, grants: state.grants }];
        if (action === 'catalog') return { books: [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Livro pessoal para publicar' }], notebooks: [] };
        if (action === 'resources') return state.resources;
        if (action === 'permissions') { state.grants = payload.grants; return {}; }
        if (action === 'downloadBook') { state.downloaded.push(payload.resourceId); return {}; }
        if (action === 'publish') { state.saves.push({ ...payload, user: state.user.id }); return {}; }
      }
      throw new Error(`Ação inesperada: ${module}/${action}`);
    });
  });
  await page.reload(); const nav = page.locator('.sidebar nav');
  await page.locator('.sidebar .nav-count[aria-label="2 cartas a revisar"]').waitFor();
  await nav.getByRole('button', { name: 'Livros', exact: true }).click();
  const heading = page.locator('.content .page-heading');
  assert.equal(await heading.getByRole('button', { name: 'Livros compartilhados', exact: true }).count(), 1);
  assert.equal(await heading.getByRole('button', { name: 'Importar livros', exact: true }).count(), 1);
  assert.equal(await page.getByText('MEUS PLANOS', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Opções de Livro pessoal para publicar', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Compartilhar livro', exact: true }).click();
  const shareBook = page.getByRole('dialog', { name: 'Compartilhar livro', exact: true });
  await shareBook.getByRole('checkbox', { name: 'Espaço', exact: true }).check();
  await shareBook.getByRole('checkbox', { name: 'Outro espaço', exact: true }).check();
  await shareBook.getByRole('button', { name: 'Compartilhar', exact: true }).click();
  await shareBook.waitFor({ state: 'hidden' });
  const publications = await app.evaluate(() => globalThis.sharingUi.saves);
  assert.deepEqual(publications.map(({ orgId, module, resourceId, revision }) => [orgId, module, resourceId, revision]), [
    ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'books', localBookId, 0],
    ['cccccccc-cccc-4ccc-8ccc-cccccccccccd', 'books', localBookId, 0],
  ]);
  await heading.getByRole('button', { name: 'Livros compartilhados', exact: true }).click();
  await page.getByRole('button', { name: 'Livro publicado', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const state = globalThis.sharingUi;
    state.resources.push({ ...state.resources[0], resource_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', content: { title: 'Novo livro recebido' } });
    BrowserWindow.getAllWindows()[0].webContents.send('modules:changed', { module: 'teams', type: 'invalidate' });
  });
  await page.getByRole('button', { name: 'Novo livro recebido', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Sincronizar compartilhados', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.shared-page .page-heading button:last-child')?.textContent === 'Sincronizar compartilhados');
  assert.equal(await app.evaluate(() => globalThis.sharingUi.downloaded.length), 2);
  await nav.getByRole('button', { name: 'Equipes', exact: true }).click();
  await page.getByRole('button', { name: 'Rever permissões', exact: true }).click();
  const permissions = page.getByRole('dialog', { name: 'Rever permissões', exact: true });
  await permissions.getByLabel('Escopo de Livros', { exact: true }).selectOption('selected');
  await permissions.getByRole('checkbox', { name: 'Livro publicado', exact: true }).check();
  assert.equal(await permissions.getByRole('checkbox', { name: 'Livro pessoal para publicar', exact: true }).count(), 0, 'Only published resources belong in access selection.');
  await permissions.getByRole('button', { name: 'Salvar permissões', exact: true }).click(); await permissions.waitFor({ state: 'hidden' });
  assert.equal(await app.evaluate(() => globalThis.sharingUi.grants.books.mode), 'selected');
  await app.evaluate(({ BrowserWindow }) => {
    const state = globalThis.sharingUi; state.user = state.guest;
    BrowserWindow.getAllWindows()[0].webContents.send('cloud:status', { enabled: true, promptSeen: true, user: state.user, busy: false });
  });
  await page.getByRole('button', { name: 'Compartilhamento', exact: true }).click();
  await page.getByRole('button', { name: 'Publicar cópia', exact: true }).click();
  await page.waitForFunction(() => globalThis.desktop && document.querySelector('.teams-page')?.getAttribute('aria-busy') === 'false');
  assert.equal(await app.evaluate(() => globalThis.sharingUi.saves.at(-1)?.user), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.equal(await page.getByRole('button', { name: 'Convidar pessoa', exact: true }).count(), 0);
  console.log('Contador Anki, ações de Livros, recebimento por evento, sincronização, Livros selecionados e publicação pelo convidado aprovados. Perfil temporário e servidor simulado; SQL remoto não validado.');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close();
  const target = path.resolve(profile);
  if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('organon-sharing-ui-')) fs.rmSync(target, { recursive: true, force: true });
});
