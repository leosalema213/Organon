// Run explicitly in the user's terminal. Real server, two new synthetic accounts only.
// No personal snapshot, imported workspace, migration rows or source project is queried.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
const config = require('../electron/cloud-config.cjs');
const { createClient } = require('../electron/vendor/supabase.cjs');
const teamsModule = require('../electron/modules/teams.cjs');
const kanbanModule = require('../electron/modules/kanban.cjs');
const financeiroModule = require('../electron/modules/financeiro.cjs');
const meiModule = require('../electron/modules/mei.cjs');
const { createBusiness } = require('../electron/business.cjs');
const { BookFiles } = require('../electron/books.cjs');
const { privateDownloadPath, downloadHeaders } = require('../electron/shared-storage.cjs');
const run = randomUUID(), fixtureName = 'Teste módulos ' + run;
const report = { ok: false, realServer: true, project: 'qbkuruzzmxgvkiquacol', run, accounts: [], checks: [],
  fixture: { name: fixtureName, orgId: null, memberId: null, boards: [], resources: [], storageObjects: [] }, cleanup: { sessionsRevoked: [], administrativeRemovalRequired: true } };
const accounts = [], feeds = [], businesses = [], temporaryProfiles = [];
const hashOf = bytes => createHash('sha256').update(bytes).digest('hex');
const noAccess = error => error?.status === 401 || error?.status === 403 || error?.code === '42501' || /não tem permissão/.test(error?.message || '');
const conflict = error => error?.code === 'PT409' || error?.code === '40001' || error?.code === 'CONFLICT' || /registro mudou|alterado por outra pessoa/.test(error?.message || '');
function assertSignal(signal, expected) {
  // realtime.send adds its own message UUID to the application payload.
  const hasId = Object.hasOwn(signal, 'id');
  assert.deepEqual(Object.keys(signal).sort(), [...Object.keys(expected), ...(hasId ? ['id'] : [])].sort());
  if (hasId) assert.match(signal.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const { id, ...content } = signal;
  assert.deepEqual(content, expected);
}

async function request(endpoint, { token = null, method = 'GET', body, binary = false, headers = {} } = {}) {
  const response = await fetch(config.url + endpoint, { method, headers: { apikey: config.key,
    ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: Buffer.isBuffer(body) ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) }).catch(error => {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error(`Tempo limite em ${method} ${endpoint.split('?')[0]}${body?.p_action ? ' (' + body.p_action + ')' : ''}`);
      throw error;
    });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const code = String(detail.code || detail.error_code || detail.error || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    // Do not log request bodies, SDK contexts, headers, passwords, sessions or tokens.
    const error = new Error(`Servidor real: HTTP ${response.status}${code ? ' (' + code + ')' : ''} em ${endpoint.split('?')[0]}`);
    error.status = response.status; error.code = code; throw error;
  }
  if (binary) return Buffer.from(await response.arrayBuffer());
  const text = await response.text(); return text ? JSON.parse(text) : null;
}

async function signup(suffix) {
  const email = `organon-modules-test-${run}-${suffix}@example.com`, password = randomUUID() + 'aA1!';
  const session = await request('/auth/v1/signup', { method: 'POST', body: { email, password } });
  if (session?.user?.id) report.accounts.push({ id: session.user.id, email });
  assert(session?.access_token && session?.refresh_token && session?.user?.id, 'Cadastro sintético deve retornar sessão imediata; confirme a configuração Confirm email.');
  const cloud = { ready: Promise.resolve(), enabled: true,
    status: () => ({ user: { id: session.user.id, email } }),
    token: async () => session.access_token,
    request: (endpoint, options = {}) => request(endpoint, { ...options, token: Object.hasOwn(options, 'token') ? options.token : session.access_token }) };
  let client;
  try {
    client = createClient(config.url, config.key, { accessToken: async () => session.access_token,
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { timeout: 20000, logger: () => {} } });
    await client.realtime.setAuth(session.access_token);
  } catch (error) {
    await request('/auth/v1/logout?scope=global', { method: 'POST', token: session.access_token }).catch(() => {});
    throw error;
  }
  const account = { id: session.user.id, email, session, cloud, client,
    teams: teamsModule.createService({ cloud }), kanban: kanbanModule.createService({ cloud }),
    financeiro: financeiroModule.createService({ cloud }), mei: meiModule.createService({ cloud }) };
  accounts.push(account);
  await cloud.request('/rest/v1/organon_profiles?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: { user_id: account.id, name: 'Pessoa sintética ' + suffix + ' ' + run.slice(0, 8), nickname: 'Teste ' + suffix } });
  return account;
}

async function privateFeed(account, topic, expectDenied = false) {
  const channel = account.client.channel(topic, { config: { private: true } }), waiters = new Set();
  const feed = { channel, account, closed: false,
    next(event, predicate = () => true) {
      return new Promise((resolve, reject) => {
        const waiter = { event, predicate, resolve: payload => { clearTimeout(waiter.timer); waiters.delete(waiter); resolve(payload); },
          reject: error => { clearTimeout(waiter.timer); waiters.delete(waiter); reject(error); } };
        waiter.timer = setTimeout(() => waiter.reject(new Error('Nenhum evento privado real foi recebido no prazo.')), 20000);
        waiters.add(waiter);
      });
    },
    async close() {
      if (feed.closed) return; feed.closed = true;
      for (const waiter of [...waiters]) waiter.reject(new Error('Assinatura de teste encerrada.'));
      await account.client.removeChannel(channel);
    } };
  feeds.push(feed);
  for (const event of ['changed', 'invalidate']) channel.on('broadcast', { event }, message => {
    if (feed.closed) return;
    for (const waiter of [...waiters]) if (waiter.event === event && waiter.predicate(message.payload)) waiter.resolve(message.payload);
  });
  await new Promise((resolve, reject) => {
    let done = false;
    const finish = error => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => finish(new Error('Não foi possível confirmar a assinatura privada real.')), 25000);
    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') finish(expectDenied ? new Error('Canal privado concedido sem autorização.') : null);
      else if (status === 'CHANNEL_ERROR') {
        const message = String(error?.message || '').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]').slice(0, 600);
        const authorizationDenied = /(?:not authorized|unauthorized|permissions? to (?:read|access)|permission denied|not allowed to (?:read|access))/i.test(message);
        finish(expectDenied && authorizationDenied ? null : new Error(`Canal privado ${topic}: ${message || 'erro sem detalhe do servidor'}`));
      }
      else if (status === 'TIMED_OUT' || status === 'CLOSED') finish(new Error('A conexão Realtime encerrou antes de confirmar a autorização.'));
    });
  });
  if (expectDenied) await feed.close();
  return feed;
}

const rpc = (account, name, body) => account.cloud.request('/rest/v1/rpc/' + name, { method: 'POST', body });
function assertSyntheticScope(account, orgId) {
  assert(account?.email?.startsWith('organon-modules-test-' + run + '-'));
  assert(orgId && orgId === report.fixture.orgId, 'Só o espaço criado nesta execução pode ser acessado.');
}
function syntheticPdf() {
  const stream = 'BT /F1 12 Tf 24 120 Td (Organon synthetic live test) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let text = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}
function localBusiness(account, data) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-modules-live-'));
  temporaryProfiles.push(directory);
  const snapshot = path.join(directory, 'compasso.json'), original = JSON.stringify(data);
  fs.writeFileSync(snapshot, original);
  const books = new BookFiles(directory);
  const business = createBusiness({ cloud: account.cloud, books, readData: () => JSON.parse(fs.readFileSync(snapshot, 'utf8')),
    plugins: { list: async () => ({ plugins: [] }) } });
  businesses.push(business);
  return { business, books, assertPreserved() { assert.equal(fs.readFileSync(snapshot, 'utf8'), original, 'Compartilhamento não pode alterar o snapshot pessoal.'); } };
}
async function cleanup() {
  for (const business of businesses) await business.dispose().catch(() => {});
  for (const feed of feeds) await feed.close().catch(() => {});
  const owner = accounts[0], orgId = report.fixture.orgId;
  if (owner && orgId) {
    assertSyntheticScope(owner, orgId);
    try {
      const spaces = await owner.teams.dispatch('list');
      assert(spaces.some(space => space.id === orgId && space.owner_id === owner.id && space.name === fixtureName), 'Limpeza interrompida: identidade do espaço sintético não confere.');
      for (const resource of report.fixture.resources) {
        const rows = await owner.cloud.request(`/rest/v1/organon_shared_resources?org_id=eq.${orgId}&module=eq.${resource.module}&resource_id=eq.${resource.id}&select=revision`);
        if (rows.length === 1) await owner.teams.dispatch('unpublish', { orgId, module: resource.module, resourceId: resource.id, revision: rows[0].revision });
      }
      for (const board of await owner.kanban.dispatch('getBoards', { orgId })) {
        if (!report.fixture.boards.includes(board.id)) throw new Error('Quadro fora da lista sintética; limpeza administrativa necessária.');
        await owner.kanban.dispatch('deleteBoard', { orgId, boardId: board.id, id: board.id, expectedRevision: board.revision });
      }
      const snapshot = await owner.financeiro.dispatch('snapshot', { orgId });
      if (snapshot.entries.length > 20) throw new Error('Quantidade fora da fixture; limpeza administrativa necessária.');
      for (const entry of snapshot.entries) await owner.financeiro.dispatch('deleteEntry', { orgId, id: entry.id, expectedRevision: entry.revision });
      const members = await owner.teams.dispatch('members', { orgId });
      for (const member of members) {
        if (!report.accounts.some(a => a.id === member.user_id)) throw new Error('Membro fora da fixture; limpeza administrativa necessária.');
        if (member.status !== 'revoked') await owner.teams.dispatch('revoke', { orgId, id: member.id, revision: member.revision });
      }
      report.cleanup.boardsAndEntriesRemoved = true;
      // Settings/types, request journal, revoked membership, notices, org and Auth accounts
      // are retained for a finite administrator cleanup by these recorded synthetic IDs.
    } catch (error) { report.cleanup.issue = error.message; }
  }
  for (const account of accounts) {
    await account.client.removeAllChannels().catch(() => {});
    await account.client.realtime.disconnect();
    try { await account.cloud.request('/auth/v1/logout?scope=global', { method: 'POST' }); report.cleanup.sessionsRevoked.push(account.id); }
    catch { report.cleanup.sessionsPending = true; }
    account.session.access_token = ''; account.session.refresh_token = '';
  }
  for (const directory of temporaryProfiles) {
    // Only exact mkdtemp fixtures underneath the OS temporary root may be removed.
    const resolved = fs.realpathSync(directory), temporaryRoot = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved).toLowerCase(), temporaryRoot.toLowerCase());
    assert(path.basename(resolved).startsWith('organon-modules-live-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

async function main() {
  assert.equal(new URL(config.url).hostname, report.project + '.supabase.co', 'Este teste não pode usar o projeto de origem ou outro servidor.');
  const settings = await request('/auth/v1/settings');
  if (!settings?.mailer_autoconfirm) throw new Error('Confirm email precisa estar desativado antes de criar as duas contas sintéticas.');
  // Read-only anonymous probes fail closed before any test account is created.
  const probeId = randomUUID();
  for (const [name, body] of [
    ['organon_teams', { p_action: 'list', p_payload: {} }],
    ['organon_kanban', { p_action: 'getBoards', p_org_id: probeId, p_payload: {} }],
    ['financeiro_snapshot', { p_org_id: probeId }], ['mei_snapshot', { p_org_id: probeId }],
  ]) await assert.rejects(request('/rest/v1/rpc/' + name, { method: 'POST', body }), noAccess, `A RPC ${name} deve existir e negar acesso anônimo; aplique o contrato antes do teste.`);
  const a = await signup('a'), b = await signup('b');
  report.checks.push('Duas contas novas com sessão transitória e RPCs negadas a anônimos');
  const space = await a.teams.dispatch('create', { name: fixtureName });
  assert.equal(space.owner_id, a.id); report.fixture.orgId = space.id;
  const orgId = space.id; assertSyntheticScope(a, orgId); assertSyntheticScope(b, orgId);
  const bookId = randomUUID(), notebookId = randomUUID(), hiddenNotebookId = randomUUID();
  const pdf = syntheticPdf(), pdfHash = hashOf(pdf);
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/wAAAABJRU5ErkJggg==', 'base64');
  const imageSrc = 'data:image/png;base64,' + image.toString('base64');
  const ownerLocal = localBusiness(a, { books: [{ id: bookId, title: 'Livro sintético ' + run, format: 'pdf', hash: pdfHash, size: pdf.length,
    page: 19, planIds: ['plano pessoal sintético'], completedAt: '2026-01-01' }],
    notebooks: [{ id: notebookId, name: 'Caderno sintético compartilhado', pages: [{ id: randomUUID(), title: 'Página sintética', text: 'Texto sintético', images: [imageSrc] }] },
      { id: hiddenNotebookId, name: 'Caderno sintético privado', pages: [] }],
    plans: [{ id: 'plano pessoal sintético' }], records: { private: 'histórico sintético' }, notes: ['nota pessoal sintética'] });
  ownerLocal.books.put(pdf, pdfHash, 'pdf');
  const memberLocal = localBusiness(b, { books: [], notebooks: [], plans: [{ id: 'plano do membro sintético' }], notes: ['preservar'] });
  const bookScope = { orgId, module: 'books', resourceId: bookId }, notebookScope = { orgId, module: 'notebooks', resourceId: notebookId };
  report.fixture.resources.push({ module: 'books', id: bookId }, { module: 'notebooks', id: notebookId }, { module: 'notebooks', id: hiddenNotebookId });
  report.fixture.storageObjects.push(`${orgId}/books/${bookId}/${pdfHash}`, `${orgId}/notebooks/${notebookId}/${hashOf(image)}`);
  const publishedBook = await ownerLocal.business.dispatch('teams', 'publish', { ...bookScope, revision: 0 });
  const publishedNotebook = await ownerLocal.business.dispatch('teams', 'publish', { ...notebookScope, revision: 0 });
  await ownerLocal.business.dispatch('teams', 'publish', { orgId, module: 'notebooks', resourceId: hiddenNotebookId, revision: 0 });
  assert.equal(publishedBook.content.file.version, 1); assert.equal(publishedBook.content.file.chunks.length, 1);
  assert.equal(publishedBook.content.file.chunks[0].sha256, pdfHash);
  assert.equal(publishedNotebook.content.pages[0].images[0].bucket, 'organon-shared');
  assert(!Object.hasOwn(publishedBook.content, 'planIds')); assert(!Object.hasOwn(publishedBook.content, 'page'));
  ownerLocal.assertPreserved(); memberLocal.assertPreserved();
  const unavailable = error => noAccess(error) || /indisponível|sem permissão|acesso.*removido/.test(error?.message || '');
  await assert.rejects(memberLocal.business.dispatch('teams', 'downloadBook', bookScope), unavailable);
  await assert.rejects(memberLocal.business.dispatch('teams', 'openResource', notebookScope), unavailable);
  const boardInput = name => ({ orgId, name, bg_type: 'none', bg_color: null, bg_image_url: null, bg_size: 'cover' });
  const visible = await a.kanban.dispatch('saveBoard', boardInput('Quadro sintético compartilhado'));
  report.fixture.boards.push(visible.id);
  const hidden = await a.kanban.dispatch('saveBoard', boardInput('Quadro sintético privado'));
  report.fixture.boards.push(hidden.id);
  const list = await a.kanban.dispatch('saveList', { orgId, boardId: visible.id, name: 'Coluna sintética', color: '#94a3b8' });
  const cardData = { orgId, boardId: visible.id, listId: list.id, title: 'Cartão sintético', description: 'Conteúdo criado apenas pelo teste', price: '0.30', thumbnail_url: null, tagIds: [] };
  const card = await a.kanban.dispatch('saveCard', cardData);
  const categoryName = 'Casa teste ' + run.slice(0, 8);
  const type = await a.financeiro.dispatch('createType', { orgId, name: '  ' + categoryName + '  ' });
  const duplicateType = await a.financeiro.dispatch('createType', { orgId, name: categoryName.toUpperCase() });
  assert.equal(type.type.id, duplicateType.type.id);
  const newEntry = (description, value, extra = {}) => ({ orgId, description, value, typeId: type.type.id,
    entryType: 'entrada', entryDate: '2026-01-31', countForMei: true, requestId: randomUUID(), ...extra });
  const firstPayload = newEntry('Entrada sintética A', '0.10');
  const first = await a.financeiro.dispatch('createEntry', firstPayload);
  const replay = await a.financeiro.dispatch('createEntry', firstPayload); assert.equal(replay.id, first.id);
  await a.financeiro.dispatch('createEntry', newEntry('Entrada sintética B', '1.001'));
  await a.mei.dispatch('createEntry', newEntry('Projeção sintética', '0.05', { entryType: 'projetado', countForMei: false }));
  await a.financeiro.dispatch('createEntry', newEntry('Precisão sintética', '9007199254740993.01', { entryType: 'gasto', countForMei: false }));
  const meiSettings = await a.mei.dispatch('saveSettings', { orgId, year: 2026, meiLimit: '100.00' });
  const snapshot = await a.financeiro.dispatch('snapshot', { orgId });
  assert.equal(snapshot.types.length, 1); assert.equal(snapshot.entries.length, 4);
  assert(snapshot.entries.every(entry => typeof entry.value === 'string'));
  assert.equal(snapshot.entries.find(entry => entry.description === 'Precisão sintética').value, '9007199254740993.01');
  assert.equal(snapshot.entries.find(entry => entry.description === 'Entrada sintética B').value, '1.001');
  const mei = await a.mei.dispatch('load', { orgId, year: 2026, month: 'all' });
  assert.equal(mei.recebido, '1.101'); assert.equal(mei.projetado, '0.05'); assert.equal(mei.totalAno, '1.151'); assert.equal(mei.restante, '98.849');
  assert.equal(meiSettings.meiLimit, '100.00');
  for (const name of ['financeiro_mutate', 'mei_mutate']) {
    await assert.rejects(rpc(a, name, { p_org_id: orgId, p_action: null, p_payload: {} }),
      error => error?.code === 'P0001', 'Ação nula deve ser rejeitada pela guarda da RPC.');
  }
  // Even the owner must use revision-aware RPCs; direct REST cannot bypass CAS.
  for (const [table, id, body, patch] of [
    ['financeiro_types', type.type.id, { org_id: orgId, name: 'Categoria REST bloqueada', created_by: a.id }, { name: 'Alteração REST bloqueada' }],
    ['financeiro_entries', first.id, { org_id: orgId, description: 'Entrada REST bloqueada', value: '1.001', entry_type: 'entrada', entry_date: '2026-01-01', count_for_mei: false, created_by: a.id }, { value: '999.99' }],
    ['financeiro_settings', meiSettings.id, { org_id: orgId, owner_id: a.id, year: 2028, mei_limit: '1.001', created_by: a.id }, { mei_limit: '999.99' }],
  ]) {
    await assert.rejects(a.cloud.request('/rest/v1/' + table, { method: 'POST', body }), noAccess);
    const endpoint = `/rest/v1/${table}?org_id=eq.${orgId}&id=eq.${id}`;
    await assert.rejects(a.cloud.request(endpoint, { method: 'PATCH', body: patch }), noAccess);
    await assert.rejects(a.cloud.request(endpoint, { method: 'DELETE' }), noAccess);
  }
  const duplicatePayload = { orgId, entries: [{ id: first.id, expectedRevision: first.revision }], targetMonth: '2027-02', requestId: randomUUID() };
  const copied = await a.financeiro.dispatch('duplicateEntries', duplicatePayload), copiedReplay = await a.financeiro.dispatch('duplicateEntries', duplicatePayload);
  assert.deepEqual(copied.ids, copiedReplay.ids); assert.equal(copied.ids.length, 1);
  const afterCopy = await a.financeiro.dispatch('snapshot', { orgId }); assert.equal(afterCopy.entries.length, 5);
  assert.equal(afterCopy.entries.find(entry => entry.id === copied.ids[0]).entryDate, '2027-02-28');
  report.checks.push('Categorias sem duplicação; operações idempotentes; decimal 1.001 e MEI exatos; ação nula e escrita REST direta negadas');

  assert.deepEqual(await b.kanban.dispatch('getBoards', { orgId }), []);
  await assert.rejects(b.financeiro.dispatch('snapshot', { orgId }), noAccess);
  const found = await a.teams.dispatch('search', { query: b.email });
  assert.equal(found.length, 1); assert.equal(found[0].id, b.id); assert(!Object.hasOwn(found[0], 'email'));
  const inbox = await privateFeed(b, 'teams:user:' + b.id);
  const grants = { notebooks: { mode: 'selected', ids: [notebookId], write: false }, books: { mode: 'all', ids: [], write: false },
    kanban: { mode: 'selected', ids: [visible.id], write: true }, financeiro: { mode: 'all', ids: [], write: true } };
  const invitationNotice = inbox.next('invalidate');
  const [invitation, invitationSignal] = await Promise.all([a.teams.dispatch('invite', { orgId, recipientId: b.id, grants }), invitationNotice]);
  assertSignal(invitationSignal, { type: 'invalidate' });
  report.fixture.memberId = invitation.id; assert.equal(invitation.status, 'pending');
  const notices = await b.teams.dispatch('notifications');
  assert(notices.some(notice => notice.member_id === invitation.id && notice.status === 'pending'));
  await assert.rejects(b.financeiro.dispatch('snapshot', { orgId }), noAccess);
  assert.deepEqual(await b.kanban.dispatch('getBoards', { orgId }), []);
  await assert.rejects(memberLocal.business.dispatch('teams', 'downloadBook', bookScope), unavailable);
  await assert.rejects(memberLocal.business.dispatch('teams', 'openResource', notebookScope), unavailable);
  await assert.rejects(rpc(a, 'organon_teams', { p_action: 'respond', p_payload: { id: invitation.id, revision: invitation.revision, response: 'accepted' } }), noAccess);
  await assert.rejects(rpc(b, 'organon_teams', { p_action: 'respond', p_payload: { id: invitation.id, revision: invitation.revision + 1, response: 'accepted' } }), conflict);
  const accepted = await b.teams.dispatch('respond', { id: invitation.id, revision: invitation.revision, response: 'accepted' });
  assert.equal(accepted.status, 'accepted');
  const openedNotebook = await memberLocal.business.dispatch('teams', 'openResource', notebookScope);
  assert.equal(openedNotebook.revision, publishedNotebook.revision); assert.equal(openedNotebook.canWrite, false);
  assert.equal(openedNotebook.content.pages[0].images[0], imageSrc);
  await assert.rejects(memberLocal.business.dispatch('teams', 'openResource', { orgId, module: 'notebooks', resourceId: hiddenNotebookId }), unavailable);
  const downloadedBook = await memberLocal.business.dispatch('teams', 'downloadBook', bookScope);
  assert.equal(downloadedBook.fileReady, true); assert.equal(downloadedBook.revision, publishedBook.revision);
  assert.equal(hashOf(memberLocal.books.read(pdfHash, 'pdf')), pdfHash);
  assert.deepEqual(memberLocal.books.read(pdfHash, 'pdf'), pdf);
  assert.deepEqual(downloadedBook.book.planIds, []); assert.equal(downloadedBook.book.page, 1);
  // Cached path must still obtain fresh server authorization, without adding personal metadata.
  assert.equal((await memberLocal.business.dispatch('teams', 'downloadBook', bookScope)).fileReady, true);
  ownerLocal.assertPreserved(); memberLocal.assertPreserved();
  const bookObject = report.fixture.storageObjects[0], imageObject = report.fixture.storageObjects[1];
  assert.deepEqual(await b.cloud.request(privateDownloadPath('organon-shared', imageObject), { binary: true, headers: downloadHeaders }), image);
  report.checks.push('Publicação real de PDF e caderno/imagem privados; seleção de caderno, hash do download e cache BookFiles sem alterar snapshots pessoais');
  assert.deepEqual((await b.kanban.dispatch('getBoards', { orgId })).map(board => board.id), [visible.id]);
  await assert.rejects(b.kanban.dispatch('getBoard', { orgId, boardId: hidden.id }), noAccess);
  await privateFeed(b, `kanban:${orgId}:${hidden.id}`, true);
  report.checks.push('Convite e notificação interna reais; pendência não libera acesso; aceite libera apenas o quadro selecionado');

  const memberView = await b.kanban.dispatch('getBoard', { orgId, boardId: visible.id });
  assert.equal(memberView.canWrite, true);
  const changed = await b.kanban.dispatch('saveCard', { ...cardData, id: card.id, expectedRevision: card.revision, title: 'Alteração sintética do membro' });
  await assert.rejects(a.kanban.dispatch('saveCard', { ...cardData, id: card.id, expectedRevision: card.revision, title: 'Não deve substituir' }), conflict);
  const boardFeed = await privateFeed(b, `kanban:${orgId}:${visible.id}`);
  const changedEvent = boardFeed.next('changed', payload => payload?.orgId === orgId && payload?.boardId === visible.id);
  const realTimeTitle = 'Alteração Realtime ' + run;
  const [realTimeCard, signal] = await Promise.all([a.kanban.dispatch('saveCard', { ...cardData, id: card.id, expectedRevision: changed.revision, title: realTimeTitle }), changedEvent]);
  assertSignal(signal, { orgId, boardId: visible.id });
  const afterEvent = await b.kanban.dispatch('getBoard', { orgId, boardId: visible.id });
  assert.equal(afterEvent.cards.find(item => item.id === card.id).title, realTimeTitle);
  report.checks.push('CAS impede edição antiga; evento Broadcast privado real no segundo usuário e reconsulta do cartão confirmado');
  // Deliberately close the actual WebSocket, mutate while disconnected, then rejoin a
  // private channel. Refetch recovers the missed state; a subsequent event proves the new feed.
  await boardFeed.close(); await b.client.realtime.disconnect();
  const gapTitle = 'Alteração durante desconexão ' + run;
  const gapCard = await a.kanban.dispatch('saveCard', { ...cardData, id: card.id, expectedRevision: realTimeCard.revision, title: gapTitle });
  b.client.realtime.connect();
  const reconnectedFeed = await privateFeed(b, `kanban:${orgId}:${visible.id}`);
  const refetched = await b.kanban.dispatch('getBoard', { orgId, boardId: visible.id });
  assert.equal(refetched.cards.find(item => item.id === card.id).title, gapTitle);
  const afterReconnectEvent = reconnectedFeed.next('changed', payload => payload?.orgId === orgId && payload?.boardId === visible.id);
  const reconnectTitle = 'Evento após reconexão ' + run;
  const [, reconnectSignal] = await Promise.all([a.kanban.dispatch('saveCard', { ...cardData, id: card.id, expectedRevision: gapCard.revision, title: reconnectTitle }), afterReconnectEvent]);
  assertSignal(reconnectSignal, { orgId, boardId: visible.id });
  assert.equal((await b.kanban.dispatch('getBoard', { orgId, boardId: visible.id })).cards.find(item => item.id === card.id).title, reconnectTitle);
  report.checks.push('WebSocket real reconectado: reconsulta recupera mudança perdida e um novo evento privado confirma a assinatura restaurada');

  const memberCategory = await b.financeiro.dispatch('createType', { orgId, name: categoryName.toUpperCase() }); assert.equal(memberCategory.type.id, type.type.id);
  const memberSnapshot = await b.financeiro.dispatch('snapshot', { orgId }); assert.equal(memberSnapshot.entries.length, 5);
  const memberEntry = await b.financeiro.dispatch('createEntry', newEntry('Gasto sintético do membro', '0.04', { entryType: 'gasto', countForMei: false }));
  const latestFirst = memberSnapshot.entries.find(entry => entry.id === first.id);
  await b.financeiro.dispatch('updateEntry', { ...firstPayload, id: first.id, expectedRevision: latestFirst.revision, description: 'Descrição sintética atualizada' });
  await assert.rejects(a.financeiro.dispatch('updateEntry', { ...firstPayload, id: first.id, expectedRevision: latestFirst.revision, value: '999.99' }), conflict);
  await assert.rejects(rpc(b, 'mei_snapshot', { p_org_id: orgId }), noAccess);
  await assert.rejects(rpc(b, 'mei_mutate', { p_org_id: orgId, p_action: 'saveSettings', p_payload: { year: 2026, meiLimit: '1.00' } }), noAccess);
  await assert.rejects(b.mei.dispatch('load', { orgId, year: 2026, month: 'all' }), /pessoal|proprietário/);
  const memberSettings = await b.cloud.request('/rest/v1/financeiro_settings?select=id&org_id=eq.' + orgId); assert.deepEqual(memberSettings, []);
  const afterFinance = await a.financeiro.dispatch('snapshot', { orgId });
  assert.equal(afterFinance.types.length, 1); assert.equal(afterFinance.entries.find(entry => entry.id === first.id).value, '0.10');
  assert.equal(afterFinance.entries.find(entry => entry.id === memberEntry.id).createdBy, b.id);
  const ownerReport = await a.mei.dispatch('load', { orgId, year: 2026, month: 'all' }); assert.equal(ownerReport.totalAno, '1.151');
  report.checks.push('Financeiro compartilhado com autoria e CAS; MEI e configurações continuam privados do proprietário');

  await reconnectedFeed.close();
  const revokeNotice = inbox.next('invalidate');
  const [, revokedSignal] = await Promise.all([a.teams.dispatch('revoke', { orgId, id: invitation.id, revision: accepted.revision }), revokeNotice]);
  assertSignal(revokedSignal, { type: 'invalidate' });
  await assert.rejects(b.financeiro.dispatch('snapshot', { orgId }), noAccess);
  await assert.rejects(b.financeiro.dispatch('createEntry', newEntry('Não autorizado', '1.00')), noAccess);
  await assert.rejects(b.kanban.dispatch('getBoard', { orgId, boardId: visible.id }), noAccess);
  assert.deepEqual(await b.kanban.dispatch('getBoards', { orgId }), []);
  await privateFeed(b, `kanban:${orgId}:${visible.id}`, true);
  await assert.rejects(memberLocal.business.dispatch('teams', 'downloadBook', bookScope), unavailable);
  await assert.rejects(memberLocal.business.dispatch('teams', 'openResource', notebookScope), unavailable);
  const storageDenied = error => [400, 401, 403, 404].includes(error?.status);
  for (const object of [bookObject, imageObject]) {
    await assert.rejects(b.cloud.request(privateDownloadPath('organon-shared', object), { binary: true, headers: downloadHeaders }), storageDenied);
  }
  // Revocation cannot erase the offline bytes already obtained, but cannot grant a new open.
  assert.deepEqual(memberLocal.books.read(pdfHash, 'pdf'), pdf);
  ownerLocal.assertPreserved(); memberLocal.assertPreserved();
  assert((await b.teams.dispatch('notifications')).some(notice => notice.member_id === invitation.id && notice.status === 'revoked'));
  report.checks.push('Revogação notifica e bloqueia leituras/escritas, canal privado, nova consulta sem cache ao Storage e reabertura do livro mesmo com binário local');
  report.ok = true;
}

(async () => {
  try { await main(); }
  catch (error) { report.error = error.message; process.exitCode = 1; }
  finally {
    await cleanup().catch(error => { report.cleanup.issue = error.message; });
    fs.mkdirSync(path.join(output, 'modules-live', run), { recursive: true });
    const recorded = { run, project: report.project, accounts: report.accounts, fixture: report.fixture, cleanup: report.cleanup };
    fs.writeFileSync(path.join(output, 'modules-live', run, 'accounts.json'), JSON.stringify(recorded, null, 2));
    fs.writeFileSync(path.join(output, 'modules-live-accounts.json'), JSON.stringify(recorded, null, 2));
    fs.writeFileSync(path.join(output, 'modules-live-audit.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log('IDs/e-mails exclusivamente sintéticos registrados para limpeza administrativa. Senhas/tokens ficaram só em memória. Nenhum dado pessoal ou de migração foi usado.');
  }
})();
