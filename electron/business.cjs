const { createHash } = require('node:crypto');
const { privateDownloadPath, downloadHeaders, uploadHeaders } = require('./shared-storage.cjs');
const teamsModule = require('./modules/teams.cjs');
const kanbanModule = require('./modules/kanban.cjs');
const financeiroModule = require('./modules/financeiro.cjs');
const meiModule = require('./modules/mei.cjs');
const { LIMIT: BOOK_LIMIT } = require('./books.cjs');

const CHUNK_SIZE = 4 * 1024 * 1024;
const IMAGE_LIMIT = 20 * 1024 * 1024;
const MODULES = new Set(['teams', 'kanban', 'financeiro', 'mei']);
const OPTIONAL = new Set(['financeiro', 'mei']);
const EVENT_TYPES = new Set(['changed', 'invalidate', 'resync', 'connection']);
const CONNECTION_STATUSES = new Set(['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED', 'CONNECTING', 'UNAVAILABLE']);
const TEAM_ACTIONS = new Set(['list', 'create', 'search', 'members', 'roster', 'invite', 'respond', 'permissions', 'revoke', 'notifications', 'inbox', 'read', 'readAll', 'deleteNotice', 'deleteAllNotices', 'catalog', 'resources', 'publish', 'unpublish', 'editResource', 'openResource', 'downloadBook']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Identificador inválido.'); return value.toLowerCase(); }
function imageMime(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > IMAGE_LIMIT) throw new Error('Imagem compartilhada inválida ou muito grande.');
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new Error('Formato de imagem compartilhada inválido.');
}
function resourceScope(payload) {
  if (!payload || typeof payload !== 'object' || !['notebooks', 'books'].includes(payload.module)) throw new Error('Recurso compartilhado inválido.');
  return { orgId: uuid(payload.orgId), module: payload.module, resourceId: uuid(payload.resourceId) };
}
function objectName(scope, reference) {
  const prefix = `${scope.orgId}/${scope.module}/${scope.resourceId}/`;
  if (!reference || reference.bucket !== 'organon-shared' || typeof reference.object !== 'string' || !reference.object.startsWith(prefix) || !HASH.test(reference.object.slice(prefix.length))) throw new Error('Referência de arquivo fora do recurso compartilhado.');
  return reference.object;
}

function createBusiness({ cloud, plugins, readData, books, emit = () => {}, createRealtimeClient, validateSharedResource } = {}) {
  if (!cloud || typeof readData !== 'function' || !books) throw new Error('Integração dos módulos incompleta.');
  let disposed = false, identity = null, generation = 0, client = null, services = null;
  let sessionChange = null, lastToken = null, activeOrg = null, watchChange = Promise.resolve(), watchScheduled = false;
  const channels = new Map();
  const currentUser = () => cloud.enabled && cloud.status().user?.id || null;
  const assertSession = epoch => { if (disposed || epoch !== generation || !identity || currentUser() !== identity) throw new Error('A conta mudou. Abra o recurso novamente.'); };
  function publish(module, type, extra = {}) {
    if (disposed || !identity || currentUser() !== identity) return;
    // Do not forward remote payloads, raw errors, records or credentials to the renderer.
    emit({ module, type: EVENT_TYPES.has(type) ? type : 'changed', ...(extra.orgId && UUID.test(extra.orgId) ? { orgId: extra.orgId } : {}), ...(extra.boardId && UUID.test(extra.boardId) ? { boardId: extra.boardId } : {}), ...(extra.status ? { status: CONNECTION_STATUSES.has(extra.status) ? extra.status : 'CONNECTING' } : {}) });
  }
  async function installed(id) {
    const status = await plugins?.list?.();
    return !!status?.plugins?.some(plugin => plugin.id === id && plugin.installed === true);
  }
  function sessionCloud(epoch) {
    return {
      ready: cloud.ready,
      get enabled() { assertSession(epoch); return cloud.enabled; },
      status() { assertSession(epoch); return cloud.status(); },
      async token() { assertSession(epoch); const token = await cloud.token(); assertSession(epoch); return token; },
      async request(path, options) { assertSession(epoch); const value = await cloud.request(path, options); assertSession(epoch); return value; },
    };
  }
  async function removeDomainChannels() {
    const old = [...channels.values()]; channels.clear();
    if (client) await Promise.allSettled(old.map(channel => client.removeChannel(channel)));
  }
  function scheduleWatch() {
    if (watchScheduled || disposed || !activeOrg) return;
    watchScheduled = true;
    queueMicrotask(() => {
      watchScheduled = false;
      if (!disposed && activeOrg) watchWorkspace(activeOrg).catch(() => publish('teams', 'connection', { status: 'UNAVAILABLE' }));
    });
  }
  function onDomainEvent(module, event = {}) {
    publish(module, event.type || 'changed', event);
    if (module === 'financeiro') publish('mei', event.type || 'changed', event);
    if (module === 'teams' || module === 'kanban') scheduleWatch();
  }
  async function stopSession() {
    const oldServices = services, oldClient = client;
    services = null; identity = null; lastToken = null;
    await removeDomainChannels();
    await oldServices?.teams?.stop?.().catch(() => {});
    if (oldClient) {
      await Promise.resolve(oldClient.removeAllChannels?.()).catch(() => {});
      oldClient.realtime?.disconnect?.();
    }
    client = null;
  }
  async function syncSession() {
    await cloud.ready;
    if (disposed) return { connected: false };
    if (sessionChange) { await sessionChange; return syncSession(); }
    const next = currentUser();
    if (next === identity && services) {
      const token = await cloud.token();
      if (token !== lastToken) { await client?.realtime?.setAuth?.(token); lastToken = token; }
      return { connected: true, realtime: !!client };
    }
    if (!next && !identity) return { connected: false };
    sessionChange = (async () => {
      generation++;
      if (identity && identity !== next) activeOrg = null;
      await stopSession();
      if (!next || disposed || currentUser() !== next) return;
      identity = uuid(next);
      const epoch = generation, guarded = sessionCloud(epoch);
      try {
        client = createRealtimeClient ? await createRealtimeClient({ cloud: guarded }) : null;
        assertSession(epoch);
        const token = await guarded.token(); await client?.realtime?.setAuth?.(token); lastToken = token;
        const kanban = kanbanModule.createService({ cloud: guarded, emit: event => onDomainEvent('kanban', event) });
        const adapters = teamsModule.createLocalAdapters({ cloud: guarded, readData,
          readBook: hash => readLocalBook(hash), kanbanCatalog: ({ orgId }) => kanban.dispatch('getBoards', { orgId }) });
        const teams = teamsModule.createService({ cloud: guarded, realtimeClient: client,
          emit: event => onDomainEvent('teams', event), serializeResource: adapters.serializeResource, getResourceCatalog: adapters.getResourceCatalog,
          prepareAssets: input => prepareSharedAssets(input, guarded, epoch, adapters), validateSharedResource });
        services = { teams, kanban,
          financeiro: financeiroModule.createService({ cloud: guarded, emit: event => onDomainEvent('financeiro', event) }),
          mei: meiModule.createService({ cloud: guarded, emit: event => onDomainEvent(event.module === 'financeiro' ? 'financeiro' : 'mei', event) }) };
        const realtime = await teams.start();
        if (!realtime.available) publish('teams', 'connection', { status: 'UNAVAILABLE' });
      } catch (error) { generation++; await stopSession(); throw error; }
    })();
    try { await sessionChange; } finally { sessionChange = null; }
    if (currentUser() !== identity && !disposed) return syncSession();
    return { connected: !!identity, realtime: !!client };
  }
  async function allowed(orgId, module, resourceId, write = false, epoch = generation) {
    assertSession(epoch); const token = await cloud.token(); assertSession(epoch);
    const result = await cloud.request('/rest/v1/rpc/organon_can_access_resource', { method: 'POST', token,
      body: { p_org_id: orgId, p_module: module, p_resource_id: resourceId, p_write: write } });
    assertSession(epoch); return result === true;
  }
  async function addChannel(topic, module, event, epoch, orgId) {
    if (!client || channels.has(topic)) return;
    assertSession(epoch);
    const channel = client.channel(topic, { config: { private: true } });
    channels.set(topic, channel);
    channel.on('broadcast', { event }, () => {
      if (epoch !== generation || channels.get(topic) !== channel) return;
      publish(module, 'changed', { orgId }); if (module === 'financeiro') publish('mei', 'changed', { orgId });
      if (module === 'kanban') scheduleWatch();
    }).subscribe(status => {
      if (epoch !== generation || channels.get(topic) !== channel) return;
      const safeStatus = ['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status) ? status : 'CONNECTING';
      publish(module, status === 'SUBSCRIBED' ? 'resync' : 'connection', { orgId, status: safeStatus });
      if (module === 'financeiro') publish('mei', status === 'SUBSCRIBED' ? 'resync' : 'connection', { orgId, status: safeStatus });
    });
  }
  async function watchWorkspace(orgId) {
    const next = orgId === null || orgId === undefined ? null : uuid(orgId);
    activeOrg = next;
    await syncSession();
    if (next !== null && !identity) throw new Error('Entre na sua conta para selecionar um espaço.');
    activeOrg = next;
    const epoch = generation;
    const job = watchChange.catch(() => {}).then(async () => {
      await removeDomainChannels();
      if (!next || next !== activeOrg || !identity || disposed) return { realtime: !!client };
      assertSession(epoch);
      const spaces = await services.teams.dispatch('list');
      if (!Array.isArray(spaces) || !spaces.some(space => space.id === next)) {
        if (activeOrg === next) activeOrg = null;
        publish('teams', 'resync'); throw new Error('O acesso ao espaço mudou. Selecione outro espaço.');
      }
      if (!client) return { realtime: false };
      const boards = await services.kanban.dispatch('getBoards', { orgId: next });
      if (await allowed(next, 'kanban', null, false, epoch)) await addChannel(`kanban:${next}`, 'kanban', 'changed', epoch, next);
      else for (const board of boards || []) { if (UUID.test(board.id)) await addChannel(`kanban:${next}:${board.id}`, 'kanban', 'changed', epoch, next); }
      if ((await installed('financeiro') || await installed('mei')) && await allowed(next, 'financeiro', null, false, epoch)) await addChannel(`financeiro:${next}`, 'financeiro', 'changed', epoch, next);
      assertSession(epoch); return { realtime: true };
    });
    watchChange = job; return job;
  }
  function readLocalBook(hash) {
    const data = readData();
    if (data?.then) return data.then(value => { const book = value?.books?.find(item => item.hash === hash); if (!book) throw new Error('Livro local não encontrado.'); return books.read(hash, book.format); });
    const book = data?.books?.find(item => item.hash === hash); if (!book) throw new Error('Livro local não encontrado.'); return books.read(hash, book.format);
  }
  async function prepareSharedAssets(input, guarded, epoch, adapters) {
    if (input.module !== 'books') {
      function validateImages(value, field = '', depth = 0) {
        if (depth > 100) throw new Error('Caderno compartilhado muito complexo.');
        if (['src', 'images', 'cover'].includes(field) && typeof value === 'string' && value.startsWith('data:image/')) {
          const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
          if (!match || match[2].length > Math.ceil(IMAGE_LIMIT / 3) * 4) throw new Error('Imagem local inválida ou muito grande.');
          if (imageMime(Buffer.from(match[2], 'base64')) !== match[1]) throw new Error('O conteúdo não corresponde à imagem declarada.');
        }
        if (Array.isArray(value)) value.forEach(item => validateImages(item, field, depth + 1));
        else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) validateImages(item, key, depth + 1);
      }
      validateImages(input.resource); assertSession(epoch);
      return adapters.prepareAssets(input);
    }
    const scope = resourceScope(input), resource = input.resource;
    const bytes = await readLocalBook(resource.hash); assertSession(epoch);
    books.check(bytes, resource.hash, resource.size, resource.format);
    const chunks = [], assets = new Set();
    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
      const chunk = bytes.subarray(offset, offset + CHUNK_SIZE), sha256 = digest(chunk);
      const object = `${scope.orgId}/books/${scope.resourceId}/${sha256}`;
      if (!assets.has(object)) {
        const token = await guarded.token();
        try { await guarded.request('/storage/v1/object/organon-shared/' + object, { method: 'POST', token, body: chunk, headers: { ...uploadHeaders, 'Content-Type': 'application/octet-stream' } }); }
        catch (error) {
          if (error.status !== 409 && error.code !== 'Duplicate') throw error;
          const existing = await guarded.request(privateDownloadPath('organon-shared', object), { token, binary: true, headers: downloadHeaders });
          if (digest(existing) !== sha256) throw new Error('Parte remota de livro corrompida.');
        }
        assets.add(object);
      }
      chunks.push({ bucket: 'organon-shared', object, size: chunk.length, sha256 });
    }
    return { content: { ...resource, file: { version: 1, hash: resource.hash, size: bytes.length, chunks } }, assets: [...assets] };
  }
  async function sharedRow(payload, epoch) {
    const scope = resourceScope(payload), token = await cloud.token(); assertSession(epoch);
    const rows = await cloud.request(`/rest/v1/organon_shared_resources?org_id=eq.${scope.orgId}&module=eq.${scope.module}&resource_id=eq.${scope.resourceId}&select=org_id,module,resource_id,content,revision`, { token });
    assertSession(epoch);
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].org_id !== scope.orgId || rows[0].module !== scope.module || rows[0].resource_id !== scope.resourceId || !rows[0].content || rows[0].content.id !== scope.resourceId || !Number.isSafeInteger(rows[0].revision) || rows[0].revision < 1 || Buffer.byteLength(JSON.stringify(rows[0].content)) > 8 * 1024 * 1024) throw new Error('Recurso indisponível ou sem permissão.');
    return { scope, row: rows[0] };
  }
  async function downloadReference(scope, reference, epoch, maxSize = CHUNK_SIZE) {
    const object = objectName(scope, reference), token = await cloud.token(); assertSession(epoch);
    const bytes = await cloud.request(privateDownloadPath('organon-shared', object), { token, binary: true, headers: downloadHeaders });
    assertSession(epoch);
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maxSize || digest(bytes) !== object.split('/').at(-1)) throw new Error('Arquivo compartilhado incompleto ou corrompido.');
    return bytes;
  }
  async function openResource(payload, epoch) {
    const { scope, row } = await sharedRow(payload, epoch);
    const canWrite = await allowed(scope.orgId, scope.module, scope.resourceId, true, epoch);
    if (scope.module === 'books') {
      if (!await allowed(scope.orgId, 'books', scope.resourceId, false, epoch)) throw new Error('O acesso ao livro foi removido.');
      const { file, ...content } = row.content;
      return { ...row, content, canWrite };
    }
    const cache = new Map(); let totalBytes = 0, nodes = 0;
    async function resolve(value, depth = 0) {
      if (++nodes > 100000 || depth > 100) throw new Error('Caderno compartilhado muito complexo.');
      if (value && typeof value === 'object' && Object.hasOwn(value, 'bucket')) {
        const object = objectName(scope, value);
        if (!cache.has(object)) {
          const bytes = await downloadReference(scope, value, epoch, IMAGE_LIMIT); totalBytes += bytes.length;
          if (totalBytes > 32 * 1024 * 1024) throw new Error('Este caderno excede o limite de imagens por abertura.');
          cache.set(object, `data:${imageMime(bytes)};base64,${bytes.toString('base64')}`);
        }
        return cache.get(object);
      }
      if (Array.isArray(value)) { const result = []; for (const item of value) result.push(await resolve(item, depth + 1)); return result; }
      if (value && typeof value === 'object') { const result = {}; for (const [key, item] of Object.entries(value)) Object.defineProperty(result, key, { value: await resolve(item, depth + 1), enumerable: true, writable: true, configurable: true }); return result; }
      return value;
    }
    const content = await resolve(row.content);
    if (!await allowed(scope.orgId, scope.module, scope.resourceId, false, epoch)) throw new Error('O acesso ao caderno foi removido.');
    return { ...row, content, canWrite };
  }
  async function downloadBook(payload, epoch) {
    const { scope, row } = await sharedRow({ ...payload, module: 'books' }, epoch), book = row.content;
    if (!HASH.test(book.hash || '') || !Number.isInteger(book.size) || book.size < 5 || book.size > BOOK_LIMIT || typeof book.title !== 'string' || !book.title.trim() || book.title.length > 300 || !['pdf', 'epub', 'mobi', 'azw', 'azw3'].includes(book.format)) throw new Error('Livro compartilhado inválido.');
    let bytes;
    try { bytes = books.read(book.hash, book.format); books.check(bytes, book.hash, book.size, book.format); } catch { bytes = null; }
    if (!bytes) {
      if (book.file?.version === 1) {
        const file = book.file;
        if (file.hash !== book.hash || file.size !== book.size || !Array.isArray(file.chunks) || file.chunks.length !== Math.ceil(book.size / CHUNK_SIZE)) throw new Error('Manifesto do livro compartilhado inválido.');
        bytes = Buffer.alloc(book.size);
        for (let index = 0; index < file.chunks.length; index++) {
          const item = file.chunks[index], expectedSize = Math.min(CHUNK_SIZE, book.size - index * CHUNK_SIZE);
          if (item.size !== expectedSize || !HASH.test(item.sha256 || '') || item.object?.split('/').at(-1) !== item.sha256) throw new Error('Parte do livro inválida.');
          const chunk = await downloadReference(scope, item, epoch);
          if (chunk.length !== expectedSize) throw new Error('Parte do livro incompleta.'); chunk.copy(bytes, index * CHUNK_SIZE);
        }
      } else bytes = await downloadReference(scope, book.file, epoch, BOOK_LIMIT); // compatibility with early single-file copies
      books.check(bytes, book.hash, book.size, book.format);
      if (!await allowed(scope.orgId, 'books', scope.resourceId, false, epoch)) throw new Error('O acesso ao livro foi removido.');
      assertSession(epoch); books.put(bytes, book.hash, book.format);
    }
    if (!await allowed(scope.orgId, 'books', scope.resourceId, false, epoch)) throw new Error('O acesso ao livro foi removido.');
    const content = { id: book.id, title: book.title, format: book.format, hash: book.hash, size: book.size };
    return { ...row, content, book: { ...content, planIds: [], page: 1, pageCount: null, furthestPage: 0, completedAt: null, importedAt: new Date().toISOString(), view: { spread: 1, zoom: 1, contrast: 'paper' } }, fileReady: true };
  }
  async function dispatch(module, action, payload = {}) {
    if (!MODULES.has(module) || typeof action !== 'string' || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Ação de módulo inválida.');
    if (Buffer.byteLength(JSON.stringify(payload)) > 8 * 1024 * 1024) throw new Error('Operação de módulo muito grande.');
    if (module === 'teams' && !TEAM_ACTIONS.has(action)) throw new Error('Ação de equipes inválida.');
    await syncSession();
    if (!identity || !services) throw new Error('Entre na sua conta para usar este recurso.');
    const epoch = generation;
    if (OPTIONAL.has(module) && !await installed(module)) throw new Error('Instale este adicional em Preferências → Plugins.');
    assertSession(epoch);
    let result;
    if (module === 'teams' && action === 'openResource') result = await openResource(payload, epoch);
    else if (module === 'teams' && action === 'downloadBook') result = await downloadBook(payload, epoch);
    else result = await services[module].dispatch(action, payload);
    assertSession(epoch); return result;
  }
  async function dispose() { if (disposed) return; disposed = true; generation++; activeOrg = null; await stopSession(); }
  return { dispatch, watchWorkspace, syncSession, dispose };
}

module.exports = { createBusiness, CHUNK_SIZE, resourceScope, objectName, imageMime };
