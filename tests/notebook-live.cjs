// Two real app windows, two synthetic identities and one local server. No real accounts.
const { _electron: electron } = require('playwright');
const http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), apps = [], profiles = [], errors = [];
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', guest = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', orgId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let server;
(async () => {
  const { seed, newNotebook } = await import('../src/model.js');
  const notebook = { ...newNotebook(), name: 'Caderno ao vivo' };
  const row = { org_id: orgId, module: 'notebooks', resource_id: notebook.id, published_by: owner, revision: 1, content: notebook };
  const state = { dropEvents: false, guestWrite: true, writes: [] };
  const space = { id: orgId, owner_id: owner, name: 'Equipe ao vivo' };
  async function invalidate() {
    if (!state.dropEvents) await Promise.all(apps.map(app => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('modules:changed', { module: 'teams', type: 'invalidate' }))));
  }
  server = http.createServer(async (request, response) => {
    try {
      let bytes = ''; for await (const chunk of request) bytes += chunk;
      const { actor, action, payload } = JSON.parse(bytes);
      if (![owner, guest].includes(actor)) throw new Error('Identidade inválida');
      let result;
      const canWrite = actor === owner || state.guestWrite;
      if (action === 'list') result = [space];
      else if (action === 'inbox') result = { notifications: [], invitations: [], unreadCount: 0 };
      else if (action === 'roster') result = [{ user_id: owner, name: 'Autor' }, { user_id: guest, name: 'Convidado' }];
      else {
        if (payload.orgId !== orgId) throw new Error('Espaço inválido');
        if (action === 'resources') result = [row];
        else {
          if (payload.resourceId !== notebook.id || payload.module !== 'notebooks') throw new Error('Recurso inválido');
          if (action === 'resourceVersion') result = { revision: row.revision, canWrite };
          else if (action === 'openResource') result = { ...row, canWrite };
          else if (action === 'resourceCover') result = { cover: row.content.cover };
          else if (action === 'editResource') {
            if (!canWrite) throw new Error('Write denied');
            if (payload.revision !== row.revision) throw new Error('Este registro mudou. Atualize e reveja as alterações antes de salvar.');
            row.content = payload.content; row.revision++; row.last_edited_by = actor; row.last_edited_at = new Date().toISOString();
            state.writes.push(actor); result = row;
          } else throw new Error(`Ação inesperada: ${action}`);
        }
      }
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ result }));
      if (action === 'editResource') invalidate().catch(error => errors.push(error.message));
    } catch (error) { response.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const pages = [];
  for (const actor of [owner, guest]) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-notebook-live-')); profiles.push(profile);
    fs.writeFileSync(path.join(profile, 'compasso.json'), JSON.stringify({ ...seed(), onboardingCompleted: true, notebooks: actor === owner ? [notebook] : [] }));
    const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env }); apps.push(app);
    const page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
    await page.locator('.sidebar nav').waitFor();
    await app.evaluate(({ ipcMain, BrowserWindow }, { actor, port }) => {
      const user = { id: actor, name: actor.startsWith('a') ? 'Autor' : 'Convidado' };
      for (const name of ['status', 'sync', 'skip']) { ipcMain.removeHandler(`cloud:${name}`); ipcMain.handle(`cloud:${name}`, () => ({ enabled: true, promptSeen: true, user, busy: false })); }
      ipcMain.removeHandler('modules:watch'); ipcMain.handle('modules:watch', () => ({ connected: true, realtime: true }));
      ipcMain.removeHandler('modules:call'); ipcMain.handle('modules:call', async (_event, module, action, payload) => {
        if (module !== 'teams') throw new Error('Módulo inesperado');
        const value = await new Promise((resolve, reject) => {
          const request = process.getBuiltinModule('http').request(`http://127.0.0.1:${port}`, { method: 'POST' }, response => {
            let bytes = ''; response.on('data', chunk => { bytes += chunk; }); response.on('end', () => { try { resolve(JSON.parse(bytes)); } catch (error) { reject(error); } });
          });
          request.on('error', reject); request.end(JSON.stringify({ actor, action, payload }));
        });
        if (value.error) throw new Error(value.error); return value.result;
      });
      BrowserWindow.getAllWindows()[0].webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    }, { actor, port });
    await page.reload(); await page.locator('.sidebar nav').getByRole('button', { name: 'Cadernos', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir caderno Caderno ao vivo', exact: true }).click();
    await page.locator('.journal-shared-reader .journal-layout').waitFor(); pages.push(page);
  }
  const [author, recipient] = pages;
  const title = page => page.getByRole('textbox', { name: 'Título da página', exact: true });
  const text = page => page.getByRole('textbox', { name: 'Texto da anotação', exact: true });
  const waitText = (page, expected) => page.waitForFunction(expected => document.querySelector('[aria-label="Texto da anotação"]')?.textContent.includes(expected), expected);
  await author.getByRole('button', { name: 'Nova página', exact: true }).first().click();
  await title(author).fill('Página criada pelo autor');
  await text(author).fill('Texto inicial');
  await recipient.locator('.journal-page-row').filter({ hasText: 'Página criada pelo autor' }).getByRole('button').first().click();
  await waitText(recipient, 'Texto inicial');
  await recipient.getByRole('status').filter({ hasText: 'Autor editando' }).waitFor();

  await text(author).click(); await author.keyboard.press('End');
  let typingDone = false;
  const typing = author.keyboard.type(' live-1234567890-abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ-continua-digitando', { delay: 45 }).finally(() => { typingDone = true; });
  await waitText(recipient, 'live-123');
  assert.equal(typingDone, false, 'O destinatário deve ver texto antes de o autor parar de digitar'); await typing;
  await waitText(recipient, 'continua-digitando');
  await text(recipient).fill('Resposta enviada pelo convidado');
  await waitText(author, 'Resposta enviada pelo convidado');
  await author.getByRole('status').filter({ hasText: 'Convidado editando' }).waitFor();

  const image = path.join(profiles[1], 'fixture.png');
  fs.writeFileSync(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
  await text(recipient).click();
  const chooser = recipient.waitForEvent('filechooser');
  await recipient.getByRole('button', { name: 'Imagem', exact: true }).click();
  await (await chooser).setFiles(image);
  await author.locator('.journal-sheet .note-document-image img').waitFor();
  await recipient.getByRole('button', { name: 'Remover imagem', exact: true }).click();
  await author.locator('.journal-sheet .note-document-image img').waitFor({ state: 'hidden' });

  await recipient.getByRole('button', { name: 'Editar caderno', exact: true }).click();
  const modal = recipient.getByRole('dialog', { name: 'Editar caderno', exact: true });
  await modal.getByRole('textbox', { name: 'Nome do caderno', exact: true }).fill('Título atualizado ao vivo');
  await modal.getByLabel('Imagem de capa', { exact: true }).setInputFiles(image);
  await modal.getByRole('button', { name: 'Salvar', exact: true }).click();
  await author.getByRole('heading', { name: 'Título atualizado ao vivo', exact: true }).waitFor();
  await author.locator('.journal-heading .journal-cover img').waitFor();

  state.dropEvents = true;
  await text(recipient).fill('Recuperado mesmo sem aviso de tempo real');
  await waitText(author, 'Recuperado mesmo sem aviso de tempo real');
  state.dropEvents = false;
  state.guestWrite = false; await invalidate();
  await recipient.waitForFunction(() => document.querySelector('input[aria-label="Título da página"]')?.disabled === true);
  assert(state.writes.includes(owner) && state.writes.includes(guest)); assert.deepEqual(errors, []);
  console.log('Duas janelas na mesma versão: página, texto durante digitação, imagens, capa, título, autoria recente, recuperação de aviso perdido e permissão de leitura aprovados. Servidor local sintético; Supabase real pendente.');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => {
  await Promise.allSettled(apps.map(app => app.close()));
  if (server) await new Promise(resolve => server.close(resolve));
  for (const profile of profiles) {
    const target = fs.realpathSync(profile), temporary = fs.realpathSync(os.tmpdir());
    if (path.dirname(target) === temporary && path.basename(target).startsWith('organon-notebook-live-')) fs.rmSync(target, { recursive: true, force: true });
  }
});
