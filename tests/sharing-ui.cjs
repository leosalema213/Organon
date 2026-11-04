// Real shell, synthetic authenticated server, temporary profile; no personal data.
const { _electron: electron } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-sharing-ui-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
(async () => {
  const { seed } = await import('../src/model.js'), { basicModel, newCard } = await import('../src/anki.js');
  const fixture = { ...seed(), onboardingCompleted: true }, deckId = crypto.randomUUID(), noteId = crypto.randomUUID();
  const localBookId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const pdf = fs.readFileSync(path.join(root, 'tests/fixtures/reading.pdf'));
  const pdfHash = createHash('sha256').update(pdf).digest('hex');
  fs.mkdirSync(path.join(profile, 'books'));
  fs.writeFileSync(path.join(profile, 'books', pdfHash + '.pdf'), pdf);
  fixture.books = [{ id: localBookId, title: 'Livro pessoal para publicar', format: 'pdf', hash: 'a'.repeat(64), size: 10, planIds: [], page: 4, furthestPage: 4, pageCount: 20, completedAt: null, importedAt: new Date().toISOString(), view: { spread: 1, zoom: 1, contrast: 'paper' } }];
  fixture.anki.models = [basicModel]; fixture.anki.decks = [{ id: deckId, name: 'Revisões', presetId: 'default' }];
  fixture.anki.notes = [{ id: noteId, modelId: basicModel.id, fields: ['Frente', 'Verso'], tags: [] }];
  fixture.anki.cards = [2, 1, 0].map(state => ({ ...newCard(noteId, deckId), state, due: Date.now() - 10000 }));
  fs.writeFileSync(path.join(profile, 'compasso.json'), JSON.stringify(fixture));
  app = await electron.launch({ args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await page.locator('.sidebar nav button').first().waitFor();
  await app.evaluate(({ ipcMain, BrowserWindow }, { pdfHash, size }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*','https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const owner = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Dono', nickname: 'Dono' }, guest = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Convidado', nickname: 'Convidado' };
    const workspace = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Espaço', owner_id: owner.id };
    const otherSpace = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccd', name: 'Outro espaço', owner_id: owner.id };
    const grants = { books: { mode: 'all', ids: [], write: false } };
    const state = globalThis.sharingUi = { owner, guest, workspace, otherSpace, user: owner, grants, downloaded: [], saves: [], resources: [{ org_id: workspace.id, module: 'books', resource_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', published_by: owner.id, revision: 1, content: { title: 'Livro publicado', hash: pdfHash, size, format: 'pdf' } }] };
    const status = () => ({ enabled: true, promptSeen: true, user: state.user, busy: false, pending: !!state.pending });
    for (const name of ['status','sync','skip']) {
      ipcMain.removeHandler(`cloud:${name}`);
      ipcMain.handle(`cloud:${name}`, () => {
        if (name === 'sync' && state.pending) {
          state.pending = false;
          state.manualSyncs = (state.manualSyncs || 0) + 1;
        }
        return status();
      });
    }
    ipcMain.removeHandler('modules:watch'); ipcMain.handle('modules:watch', () => ({ connected: true, realtime: false }));
    ipcMain.removeHandler('modules:call'); ipcMain.handle('modules:call', (_event, module, action, payload) => {
      if (module === 'teams') {
        if (action === 'list') return [workspace, otherSpace];
        if (action === 'inbox') return { notifications: [], invitations: [], unreadCount: 0 };
        if (action === 'roster') return [{ id: 'member', user_id: guest.id, name: guest.name, status: 'accepted', role: 'member', revision: 1, grants: state.grants }];
        if (action === 'catalog') return { books: [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Livro pessoal para publicar' }, { id: '99999999-9999-4999-8999-999999999999', name: 'Livro sem publicação' }], notebooks: [] };
        if (action === 'resources') return state.resources.filter(row => row.org_id === payload.orgId);
        if (action === 'permissions') { state.grants = payload.grants; return {}; }
        if (action === 'downloadBook') {
          state.downloaded.push(payload.resourceId);
          const row = state.resources.find(row => row.org_id === payload.orgId && row.resource_id === payload.resourceId);
          return { book: row.content };
        }
        if (action === 'unpublish') {
          if (state.failNextUnpublish) { state.failNextUnpublish = false; throw new Error('Falha de teste'); }
          const index = state.resources.findIndex(row => row.org_id === payload.orgId && row.resource_id === payload.resourceId && row.published_by === state.user.id && row.revision === payload.revision);
          if (index === -1) throw new Error('Publicação ou revisão inválida');
          state.resources.splice(index, 1);
          window.webContents.send('modules:changed', { module: 'teams', type: 'invalidate' });
          return {};
        }
        if (action === 'publish') {
          state.saves.push({ ...payload, user: state.user.id });
          if (state.user.id === owner.id) {
            state.resources.push({ org_id: payload.orgId, module: 'books', resource_id: payload.resourceId, published_by: owner.id, revision: 1,
              content: { title: 'Livro pessoal para publicar', hash: 'a'.repeat(64), size: 10, format: 'pdf' } });
            window.webContents.send('modules:changed', { module: 'teams', type: 'invalidate' });
          }
          return {};
        }
      }
      throw new Error(`Ação inesperada: ${module}/${action}`);
    });
  }, { pdfHash, size: pdf.length });
  await page.reload(); const nav = page.locator('.sidebar nav');
  await page.locator('.sidebar .nav-count[aria-label="2 cartas a revisar"]').waitFor();
  await nav.getByRole('button', { name: 'Livros', exact: true }).click();
  const heading = page.locator('.content .page-heading');
  assert.equal(await heading.getByRole('button', { name: 'Importar livros', exact: true }).count(), 1);
  await page.locator('.topbar').getByRole('button', { name: 'Abrir preferências', exact: true }).click();
  const preferences = page.getByRole('dialog', { name: 'Preferências', exact: true });
  await preferences.waitFor();
  await page.keyboard.press('Escape');
  await preferences.waitFor({ state: 'hidden' });
  await app.evaluate(({ BrowserWindow }) => {
    const state = globalThis.sharingUi;
    state.pending = true;
    BrowserWindow.getAllWindows()[0].webContents.send('cloud:status', { enabled: true, promptSeen: true, user: state.user, busy: false, pending: true });
  });
  await page.locator('.topbar').getByRole('button', { name: 'ENVIO PENDENTE', exact: true }).click();
  await page.locator('.topbar .local-pill').filter({ hasText: /^CONECTADO$/ }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.sharingUi.manualSyncs), 1);
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
  const personalCard = page.locator('.reading-card').filter({ has: page.getByRole('heading', { name: 'Livro pessoal para publicar', exact: true }) });
  await personalCard.getByTitle('Compartilhado · Espaço, Outro espaço', { exact: true }).waitFor();
  assert.equal(await personalCard.count(), 1);
  await personalCard.getByText('Retomar na página 4 de 20', { exact: true }).waitFor();
  await personalCard.getByRole('button', { name: 'Opções de Livro pessoal para publicar', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Compartilhar livro', exact: true }).click();
  for (const space of ['Espaço', 'Outro espaço']) {
    const alreadyShared = shareBook.getByRole('checkbox', { name: space, exact: true });
    await alreadyShared.waitFor();
    assert.equal(await alreadyShared.isChecked(), true);
    assert.equal(await alreadyShared.isEnabled(), true);
  }
  const saveShares = shareBook.getByRole('button', { name: 'Salvar alterações', exact: true });
  assert.equal(await saveShares.isDisabled(), true);
  await shareBook.getByRole('checkbox', { name: 'Outro espaço', exact: true }).uncheck();
  await saveShares.click();
  await shareBook.waitFor({ state: 'hidden' });
  await personalCard.getByTitle('Compartilhado · Espaço', { exact: true }).waitFor();
  assert.deepEqual(await app.evaluate((_electron, id) => globalThis.sharingUi.resources.filter(row => row.resource_id === id).map(row => row.org_id), localBookId), ['cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
  assert.equal(await app.evaluate(() => globalThis.sharingUi.saves.length), 2);
  const sharedCard = page.locator('.reading-card').filter({ has: page.getByRole('heading', { name: 'Livro publicado', exact: true }) });
  await sharedCard.locator('.book-thumbnail img').waitFor();
  await sharedCard.getByTitle('Compartilhado · Espaço', { exact: true }).waitFor();
  const origin = page.getByLabel('Origem dos livros', { exact: true });
  await origin.selectOption('personal');
  await sharedCard.waitFor({ state: 'hidden' });
  await origin.selectOption('shared');
  await sharedCard.waitFor();
  assert.equal(await personalCard.count(), 1);
  await personalCard.getByText('Retomar na página 4 de 20', { exact: true }).waitFor();
  await sharedCard.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('document', { name: 'Página 1', exact: true }).waitFor();
  await page.getByLabel('Ir para página').fill('3');
  await page.getByRole('button', { name: 'Ir', exact: true }).click();
  await page.getByRole('document', { name: 'Página 3', exact: true }).locator('.textLayer span').first().waitFor();
  await page.getByRole('button', { name: 'Fechar leitor', exact: true }).click();
  await sharedCard.getByText(/Retomar na página 3/).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const state = globalThis.sharingUi;
    state.resources.push({ ...state.resources[0], org_id: state.otherSpace.id, resource_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', content: { ...state.resources[0].content, hash: 'b'.repeat(64), format: 'epub', title: 'Novo livro recebido' } });
    state.resources.push({ ...state.resources[0], org_id: state.otherSpace.id, resource_id: '77777777-7777-4777-8777-777777777777', content: { ...state.resources[0].content, hash: 'c'.repeat(64), format: 'epub', title: 'Publicação sem original' } });
    BrowserWindow.getAllWindows()[0].webContents.send('modules:changed', { module: 'teams', type: 'invalidate' });
  });
  await page.getByRole('heading', { name: 'Novo livro recebido', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Opções de Publicação sem original', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Excluir compartilhamento', exact: true }).click();
  const deleteShare = page.getByRole('dialog', { name: 'Excluir compartilhamento?', exact: true });
  await deleteShare.getByRole('button', { name: 'Excluir compartilhamento', exact: true }).click();
  await deleteShare.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'Publicação sem original', exact: true }).waitFor({ state: 'hidden' });
  await nav.getByRole('button', { name: 'Equipes', exact: true }).click();
  await page.getByRole('button', { name: 'Rever permissões', exact: true }).click();
  const permissions = page.getByRole('dialog', { name: 'Rever permissões', exact: true });
  await permissions.getByLabel('Escopo de Livros', { exact: true }).selectOption('selected');
  await permissions.getByRole('checkbox', { name: 'Livro publicado', exact: true }).check();
  await permissions.getByRole('checkbox', { name: 'Livro pessoal para publicar', exact: true }).waitFor();
  assert.equal(await permissions.getByRole('checkbox', { name: 'Livro sem publicação', exact: true }).count(), 0, 'Only published resources belong in access selection.');
  await permissions.getByRole('button', { name: 'Salvar permissões', exact: true }).click(); await permissions.waitFor({ state: 'hidden' });
  assert.equal(await app.evaluate(() => globalThis.sharingUi.grants.books.mode), 'selected');
  await nav.getByRole('button', { name: 'Livros', exact: true }).click();
  await personalCard.getByRole('button', { name: 'Opções de Livro pessoal para publicar', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Excluir livro', exact: true }).click();
  const deleteBook = page.getByRole('dialog', { name: 'Excluir este livro?', exact: true });
  await app.evaluate(() => { globalThis.sharingUi.failNextUnpublish = true; });
  await deleteBook.getByRole('button', { name: 'Excluir livro', exact: true }).click();
  await deleteBook.getByRole('alert').filter({ hasText: 'Não foi possível retirar todos' }).waitFor();
  assert.equal(await personalCard.count(), 1);
  await deleteBook.getByRole('button', { name: 'Excluir livro', exact: true }).click();
  await deleteBook.waitFor({ state: 'hidden' });
  await personalCard.waitFor({ state: 'hidden' });
  assert.equal(await app.evaluate((_electron, id) => globalThis.sharingUi.resources.some(row => row.resource_id === id), localBookId), false);
  await nav.getByRole('button', { name: 'Equipes', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => {
    const state = globalThis.sharingUi; state.user = state.guest;
    BrowserWindow.getAllWindows()[0].webContents.send('cloud:status', { enabled: true, promptSeen: true, user: state.user, busy: false });
  });
  await page.getByRole('button', { name: 'Compartilhamento', exact: true }).click();
  await page.locator('.teams-row').filter({ hasText: 'Livro sem publicação' }).getByRole('button', { name: 'Publicar cópia', exact: true }).click();
  await page.waitForFunction(() => globalThis.desktop && document.querySelector('.teams-page')?.getAttribute('aria-busy') === 'false');
  assert.equal(await app.evaluate(() => globalThis.sharingUi.saves.at(-1)?.user), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.equal(await page.getByRole('button', { name: 'Convidar pessoa', exact: true }).count(), 0);
  await nav.getByRole('button', { name: 'Livros', exact: true }).click();
  await sharedCard.getByText('Pronto para começar', { exact: true }).waitFor();
  await sharedCard.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('document', { name: 'Página 1', exact: true }).locator('.textLayer span').first().waitFor();
  await page.getByRole('button', { name: 'Fechar leitor', exact: true }).click();
  await sharedCard.getByRole('button', { name: 'Opções de Livro publicado', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Baixar cópia', exact: true }).click();
  await page.getByText('Cópia salva na sua biblioteca.', { exact: true }).waitFor();
  assert.equal(await sharedCard.count(), 1);
  await sharedCard.getByTitle('Compartilhado · Espaço', { exact: true }).waitFor();
  const savedCopy = JSON.parse(fs.readFileSync(path.join(profile, 'compasso.json'), 'utf8')).books.find(book => book.hash === pdfHash);
  assert(savedCopy && savedCopy.id !== 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' && !savedCopy.orgId);
  await page.getByRole('heading', { name: 'Novo livro recebido', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.sharingUi.resources = [];
    BrowserWindow.getAllWindows()[0].webContents.send('modules:changed', { module: 'teams', type: 'invalidate' });
  });
  await page.getByRole('heading', { name: 'Novo livro recebido', exact: true }).waitFor({ state: 'hidden' });
  await sharedCard.getByRole('img', { name: 'Livro compartilhado', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await sharedCard.count(), 1);
  await sharedCard.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('document', { name: 'Página 1', exact: true }).locator('.textLayer span').first().waitFor();
  await page.getByRole('button', { name: 'Fechar leitor', exact: true }).click();
  console.log('Biblioteca e ciclo de compartilhamento aprovados: retirada por espaço, exclusão com nova tentativa e cópia pessoal preservada após revogação. Servidor simulado.');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close();
  const target = path.resolve(profile);
  if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('organon-sharing-ui-')) fs.rmSync(target, { recursive: true, force: true });
});
