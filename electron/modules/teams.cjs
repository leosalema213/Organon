const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODULES = ['notebooks', 'books', 'kanban', 'financeiro'];
const { createHash } = require('node:crypto');
const { privateDownloadPath, downloadHeaders, uploadHeaders } = require('../shared-storage.cjs');
const { checkAvatar } = require('../cloud-profile.cjs');
const { bucket } = require('../cloud-config.cjs');
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Identificador inválido.'); return value; }
function grants(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !MODULES.includes(k))) throw new Error('Permissão inválida.');
  return Object.fromEntries(MODULES.map(module => {
    const g = value[module] || { mode: 'none' };
    if (!['none', 'all', ...(module !== 'financeiro' ? ['selected'] : [])].includes(g.mode)) throw new Error('Escopo inválido.');
    const ids = g.mode === 'selected' ? [...new Set((g.ids || []).map(uuid))] : [];
    if (ids.length > 500 || (g.mode === 'selected' && !ids.length)) throw new Error('Selecione os recursos.');
    const excludedIds = g.excludedIds === undefined ? [] : [...new Set(g.excludedIds.map(uuid))];
    if (excludedIds.length > 500 || (excludedIds.length && (!['books', 'notebooks'].includes(module) || g.mode !== 'all'))) throw new Error('Exceções de acesso inválidas.');
    const writeOverrides = g.writeOverrides;
    if (writeOverrides !== undefined && (!['books', 'notebooks'].includes(module) || !writeOverrides || typeof writeOverrides !== 'object' || Array.isArray(writeOverrides) || Object.keys(writeOverrides).length > 500 || Object.entries(writeOverrides).some(([id, write]) => !UUID.test(id) || typeof write !== 'boolean'))) throw new Error('Exceções de edição inválidas.');
    return [module, { mode: g.mode, ids, write: g.mode !== 'none' && g.write === true, ...(excludedIds.length ? { excludedIds } : {}), ...(writeOverrides ? { writeOverrides } : {}) }];
  }));
}
function createService({ cloud, realtimeClient, emit = () => {}, serializeResource, prepareAssets, getResourceCatalog, validateSharedResource, readData, readBook, kanbanCatalog } = {}) {
  if (readData) {
    const adapters = createLocalAdapters({ cloud, readData, readBook, kanbanCatalog });
    serializeResource ||= adapters.serializeResource; prepareAssets ||= adapters.prepareAssets; getResourceCatalog ||= adapters.getResourceCatalog;
  }
  let channel = null, generation = 0;
  async function stop() { generation++; const old = channel; channel = null; if (old) await realtimeClient.removeChannel(old); }
  async function start() {
    await stop(); await cloud.ready;
    if (!cloud.enabled) throw new Error('A nuvem está desabilitada.');
    await cloud.token();
    const userId = uuid(cloud.status().user?.id);
    if (!realtimeClient) return { available: false };
    const current = generation;
    channel = realtimeClient.channel(`teams:user:${userId}`, { config: { private: true } })
      .on('broadcast', { event: 'invalidate' }, () => { if (generation === current) emit({ type: 'invalidate' }); })
      .subscribe(status => { if (generation === current) emit({ type: status === 'SUBSCRIBED' ? 'resync' : 'connection', status }); });
    return { available: true };
  }
  async function dispatch(action, input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Dados inválidos.');
    await cloud.ready;
    if (!cloud.enabled) throw new Error('Entre para usar equipes.');
    const token = await cloud.token();
    const p = {};
    switch (action) {
      case 'shareRecipients': case 'setRecipients':
        p.orgId = uuid(input.orgId); p.resourceId = uuid(input.resourceId); p.module = input.module;
        if (!['notebooks', 'books'].includes(p.module)) throw new Error('Recurso inválido.');
        if (action === 'setRecipients') { p.revision = revision(input.revision); }
        break;
      case 'catalog':
        p.orgId = uuid(input.orgId);
        // Verify accepted membership remotely before touching the personal catalog.
        await cloud.request('/rest/v1/rpc/organon_teams', { method: 'POST', token, body: { p_action: 'roster', p_payload: p } });
        if (!getResourceCatalog) throw new Error('O catálogo local ainda precisa ser conectado.');
        return getResourceCatalog({ orgId: p.orgId });
      case 'list': case 'notifications': case 'inbox': case 'readAll': case 'deleteAllNotices': break;
      case 'create': p.name = String(input.name || '').trim(); if (!p.name || p.name.length > 100) throw new Error('Informe o nome do espaço.'); break;
      case 'search': p.query = String(input.query || '').trim(); if (p.query.length < 3 || p.query.length > 100) throw new Error('Digite de 3 a 100 caracteres.'); break;
      case 'members': case 'roster': case 'resources': p.orgId = uuid(input.orgId); break;
      case 'invite': p.orgId = uuid(input.orgId); p.recipientId = uuid(input.recipientId); p.grants = grants(input.grants); break;
      case 'respond': p.id = uuid(input.id); if (!['accepted', 'declined'].includes(input.response)) throw new Error('Resposta inválida.'); p.response = input.response; p.revision = revision(input.revision); break;
      case 'permissions': p.grants = grants(input.grants); // fall through
      case 'revoke': p.id = uuid(input.id); p.orgId = uuid(input.orgId); p.revision = revision(input.revision); break;
      case 'read': case 'deleteNotice': p.id = uuid(input.id); break;
      case 'editResource':
        p.orgId = uuid(input.orgId); p.resourceId = uuid(input.resourceId); p.module = input.module; p.revision = revision(input.revision);
        if (!['notebooks', 'books'].includes(p.module) || !validateSharedResource) throw new Error('O editor compartilhado ainda precisa ser conectado.');
        p.content = await validateSharedResource({ ...p, content: input.content });
        if (Buffer.byteLength(JSON.stringify(p)) > 8 * 1024 * 1024) throw new Error('Recurso muito grande.');
        break;
      case 'publish': {
        p.orgId = uuid(input.orgId); p.resourceId = uuid(input.resourceId);
        if (!['notebooks', 'books'].includes(input.module)) throw new Error('Recurso não compartilhável.');
        if (!serializeResource || !prepareAssets) throw new Error('O compartilhamento individual ainda precisa ser conectado ao catálogo local.');
        p.module = input.module; p.revision = revision(input.revision);
        await cloud.request('/rest/v1/rpc/organon_teams', { method: 'POST', token, body: { p_action: 'roster', p_payload: { orgId: p.orgId } } });
        // Serializer resolves one resource by ID in the trusted main, never accepts renderer snapshots.
        const resource = await serializeResource({ module: p.module, resourceId: p.resourceId });
        const prepared = await prepareAssets({ orgId: p.orgId, module: p.module, resourceId: p.resourceId, resource });
        p.content = prepared.content; p.assets = prepared.assets;
        if (!Array.isArray(p.assets) || Buffer.byteLength(JSON.stringify(p)) > 8 * 1024 * 1024) throw new Error('Recurso compartilhado inválido ou muito grande.');
        break;
      }
      case 'unpublish': p.orgId = uuid(input.orgId); p.module = input.module; if (!['notebooks', 'books'].includes(p.module)) throw new Error('Recurso inválido.'); p.resourceId = uuid(input.resourceId); p.revision = revision(input.revision); break;
      default: throw new Error('Ação de equipes inválida.');
    }
    if (['publish', 'setRecipients'].includes(action) && input.recipientIds !== undefined) {
      if (!Array.isArray(input.recipientIds) || input.recipientIds.length > 500) throw new Error('Destinatários inválidos.');
      p.recipientIds = [...new Set(input.recipientIds.map(uuid))];
      if (typeof input.audienceToken !== 'string' || !/^[a-f0-9]{32}$/.test(input.audienceToken)) throw new Error('Consulte os destinatários novamente.');
      p.audienceToken = input.audienceToken;
    }
    if (action === 'setRecipients' && !p.recipientIds) throw new Error('Escolha os destinatários.');
    if (['publish', 'setRecipients'].includes(action) && input.recipientWrites !== undefined) {
      const writes = input.recipientWrites;
      if (!p.recipientIds || !writes || typeof writes !== 'object' || Array.isArray(writes) || Object.keys(writes).length > 500 || Object.entries(writes).some(([id, write]) => !UUID.test(id) || !p.recipientIds.includes(id) || typeof write !== 'boolean')) throw new Error('Permissões dos destinatários inválidas.');
      p.recipientWrites = writes;
    }
    let result;
    try { result = await cloud.request('/rest/v1/rpc/organon_teams', { method: 'POST', token, body: { p_action: action, p_payload: p } }); }
    catch (error) {
      if (error.code === 'PT409' || error.code === '40001') { emit({ type: 'invalidate' }); throw new Error('Este registro mudou. Atualize e reveja as alterações antes de salvar.'); }
      throw error;
    }
    if (action === 'roster') {
      const avatars = new Map();
      // Only fetch paths authorized by the roster RPC; never accept avatar URLs from the renderer.
      let next = 0, attempted = false;
      async function loadAvatars() {
        while (next < result.length) {
          const member = result[next++];
          if (!UUID.test(member.user_id || '') || !/^[a-f0-9]{64}$/.test(member.avatar_hash || '')) continue;
          attempted = true;
          try {
            const bytes = await cloud.request(privateDownloadPath(bucket, `${member.user_id}/${member.avatar_hash}`), { token, binary: true, headers: downloadHeaders });
            checkAvatar(bytes, member.avatar_hash);
            avatars.set(`${member.user_id}:${member.avatar_hash}`, 'data:image/webp;base64,' + bytes.toString('base64'));
          } catch { /* Missing, inaccessible or corrupt photos use the placeholder. */ }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, result.length) }, loadAvatars));
      // Recheck membership and hashes after asynchronous downloads, including revocation.
      if (attempted) result = await cloud.request('/rest/v1/rpc/organon_teams', { method: 'POST', token, body: { p_action: action, p_payload: p } });
      return result.map(member => {
        const { avatar_hash, ...fields } = member;
        return { ...fields, avatar: avatars.get(`${member.user_id}:${avatar_hash}`) || null };
      });
    }
    if (!['list', 'notifications', 'inbox', 'search', 'members', 'roster', 'resources', 'shareRecipients'].includes(action)) emit({ type: 'invalidate' });
    return result;
  }
  return { dispatch, start, stop };
}
function revision(value) { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Revisão inválida. Atualize a lista.'); return value; }
function extractResource(data, module, resourceId) {
  if (!['notebooks', 'books'].includes(module)) throw new Error('Recurso não compartilhável.');
  const source = data?.[module]?.find(item => item.id === resourceId);
  if (!source) throw new Error('Recurso local não encontrado.');
  const pick = (object, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(object, key)).map(key => [key, structuredClone(object[key])]));
  if (module === 'books') return pick(source, ['id', 'title', 'format', 'hash', 'size']);
  return { ...pick(source, ['id', 'name', 'icon', 'color', 'cover']), pages: (source.pages || []).map(page => pick(page, ['id', 'title', 'date', 'text', 'images', 'document', 'kind', 'board'])) };
}
function createLocalAdapters({ cloud, readData, readBook, kanbanCatalog = async () => [] }) {
  return {
    serializeResource: async ({ module, resourceId }) => extractResource(await readData(), module, resourceId),
    getResourceCatalog: async ({ orgId }) => {
      const data = await readData();
      return { notebooks: (data.notebooks || []).map(({ id, name }) => ({ id, name })), books: (data.books || []).map(({ id, title }) => ({ id, name: title })), kanban: await kanbanCatalog({ orgId }) };
    },
    prepareAssets: async ({ orgId, module, resourceId, resource }) => {
      const assets = new Set();
      async function upload(bytes, mime, expectedHash) {
        const hash = createHash('sha256').update(bytes).digest('hex');
        if (expectedHash && hash !== expectedHash) throw new Error('O arquivo local não corresponde ao hash do livro.');
        const object = `${uuid(orgId)}/${module}/${uuid(resourceId)}/${hash}`;
        if (!assets.has(object)) {
          const token = await cloud.token();
          try { await cloud.request('/storage/v1/object/organon-shared/' + object, { method: 'POST', token, body: bytes, headers: { ...uploadHeaders, 'Content-Type': mime } }); }
          catch (error) {
            if (error.status !== 409 && error.code !== 'Duplicate') throw error;
            const existing = await cloud.request(privateDownloadPath('organon-shared', object), { binary: true, token, headers: downloadHeaders });
            if (createHash('sha256').update(existing).digest('hex') !== hash) throw new Error('Asset remoto corrompido.');
          }
          assets.add(object);
        }
        // Opaque object reference: coordinator resolves through authenticated main, never public URLs.
        return { bucket: 'organon-shared', object };
      }
      async function images(value, field = '') {
        if (['src', 'images', 'cover', 'dataURL'].includes(field) && typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(value)) {
          const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
          if (!match) throw new Error('Imagem local inválida.');
          return upload(Buffer.from(match[2], 'base64'), match[1]);
        }
        if (Array.isArray(value)) return Promise.all(value.map(item => images(item, field)));
        if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await images(v, k)])));
        return value;
      }
      let content;
      if (module === 'books') {
        if (!readBook || !/^[a-f0-9]{64}$/.test(resource.hash)) throw new Error('A leitura privada dos arquivos de livros precisa ser conectada.');
        const bytes = await readBook(resource.hash);
        if (!Buffer.isBuffer(bytes) || bytes.length !== resource.size) throw new Error('Arquivo de livro inválido.');
        content = { ...resource, file: await upload(bytes, 'application/octet-stream', resource.hash) };
      } else content = await images(resource);
      return { content, assets: [...assets] };
    },
  };
}
module.exports = { createService, grants, extractResource, createLocalAdapters };
