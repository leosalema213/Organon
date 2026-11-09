const fs = require('node:fs');
const path = require('node:path');
const { packDocument, unpackDocument, hash, canonical } = require('./cloud-document.cjs');
const config = require('./cloud-config.cjs');
const { CloudFiles } = require('./cloud-files.cjs');
const { profileFields, avatarBytes, checkAvatar } = require('./cloud-profile.cjs');
const { mapTransfers } = require('./cloud-transfer.cjs');
const PLUGIN_IDS = ['financeiro', 'mei'];

class CloudSync {
  constructor({ directory, safeStorage, fetchImpl = fetch, readData, readPlugins, restorePlugins, emit = () => {}, skipPrompt = false, enabled = true }) {
    Object.assign(this, { directory, safeStorage, fetch: fetchImpl, readData, readPlugins, restorePlugins, emit, enabled });
    this.files = new CloudFiles(directory);
    this.metaFile = path.join(directory, 'cloud-state.json');
    this.sessionFile = path.join(directory, 'cloud-session.enc');
    this.meta = { promptSeen: skipPrompt, ownerId: null, revision: 0, checksum: null, lastSync: null, pending: false };
    this.session = null; this.error = ''; this.conflict = null; this.busy = false;
    this.progress = null; this.profileError = ''; this.pluginError = '';
    this.queue = Promise.resolve();
    this.ready = this.initialize();
  }
  async initialize() {
    try { this.meta = { ...this.meta, ...JSON.parse(fs.readFileSync(this.metaFile, 'utf8')) }; } catch {}
    if (!this.enabled) return;
    try {
      if (fs.existsSync(this.sessionFile)) {
        const decrypted = await this.safeStorage.decryptStringAsync(fs.readFileSync(this.sessionFile));
        this.session = JSON.parse(decrypted.result);
        if (decrypted.shouldReEncrypt) await this.saveSession(this.session);
      }
    } catch { this.error = 'Entre novamente para conectar a nuvem. Seus dados locais estão preservados.'; }
  }
  status() {
    const profile = this.meta.profile?.userId === this.session?.user?.id ? this.meta.profile : null;
    return { enabled: this.enabled, promptSeen: this.meta.promptSeen, user: this.session?.user ? { id: this.session.user.id, email: this.session.user.email, name: profile?.name || '', nickname: profile?.nickname || '', avatar: profile?.avatar || null } : null,
      busy: this.busy, progress: this.progress, profileError: this.profileError, pluginError: this.pluginError, pending: this.meta.pending, lastSync: this.meta.lastSync, error: this.error,
      conflict: this.conflict ? { updatedAt: this.conflict.updated_at, differentAccount: this.conflict.differentAccount === true } : null };
  }
  publish() { const status = this.status(); this.emit(status); return status; }
  reportProgress(stage, completed = 0, total = 0) { this.progress = { stage, completed, total }; this.publish(); }
  async snapshot() {
    const data = this.readData();
    if (!data || !this.readPlugins) return data;
    const installed = await this.readPlugins();
    const pending = this.meta.pluginRestore?.userId === this.session?.user?.id ? this.meta.pluginRestore.ids : [];
    return { ...data, organonPlugins: [...new Set([...installed, ...pending])].filter(id => PLUGIN_IDS.includes(id)).sort() };
  }
  async resumePlugins() {
    const pending = this.meta.pluginRestore;
    if (!this.restorePlugins || pending?.userId !== this.session?.user?.id) return;
    try {
      this.reportProgress('plugins');
      await this.restorePlugins(pending.ids, (completed, total) => this.reportProgress('plugins', completed, total));
      delete this.meta.pluginRestore; this.pluginError = ''; this.saveMeta();
    } catch (error) { this.pluginError = 'Seus dados foram preservados, mas faltam plugins. Sincronize novamente para tentar: ' + error.message; this.publish(); }
  }
  saveMeta() { fs.mkdirSync(this.directory, { recursive: true }); fs.writeFileSync(this.metaFile + '.tmp', JSON.stringify(this.meta)); fs.renameSync(this.metaFile + '.tmp', this.metaFile); }
  async saveSession(session, expectedSession) {
    if (!await this.safeStorage.isAsyncEncryptionAvailable()) throw new Error('O Windows não disponibilizou a proteção da sessão. Continue offline e tente novamente.');
    const encrypted = await this.safeStorage.encryptStringAsync(JSON.stringify(session));
    if (expectedSession && this.session !== expectedSession) throw new Error('A conta mudou. Entre novamente para continuar.');
    fs.writeFileSync(this.sessionFile + '.tmp', encrypted); fs.renameSync(this.sessionFile + '.tmp', this.sessionFile);
    this.session = session;
  }
  async run(action) {
    const job = this.queue.catch(() => {}).then(async () => {
      await this.ready; this.busy = true; this.error = ''; this.publish();
      let result;
      try { result = await action(); }
      catch (error) { this.error = error.userMessage || error.message || 'Não foi possível conectar. Seus dados continuam no computador.'; throw new Error(this.error); }
      finally { this.busy = false; this.progress = null; this.publish(); }
      return result && Object.hasOwn(result, 'promptSeen') ? this.status() : result;
    });
    this.queue = job; return job;
  }
  async request(endpoint, { method = 'GET', body, binary = false, token = this.session?.access_token, headers = {} } = {}) {
    let response;
    try {
      response = await this.fetch(config.url + endpoint, { method, headers: { apikey: config.key, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body && !Buffer.isBuffer(body) ? JSON.stringify(body) : body, signal: AbortSignal.timeout(15000) });
    } catch { throw new Error('Sem conexão com a nuvem. Seus dados continuam salvos neste computador.'); }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      const error = new Error(response.status === 401 ? 'Sessão expirada. Entre novamente.' : response.status === 413 ? 'Este arquivo ultrapassa o limite da nuvem.' : detail.error_code === 'email_not_confirmed' ? 'A confirmação de e-mail ainda está habilitada no servidor.' : response.status === 429 ? 'Muitas tentativas. Aguarde um pouco e tente novamente.' : response.status >= 500 ? 'A nuvem está temporariamente indisponível. Tente novamente.' : endpoint.startsWith('/auth/') ? 'Não foi possível entrar. Confira o e-mail e a senha; ao criar conta, use pelo menos 8 caracteres.' : 'Não foi possível sincronizar. Tente novamente.');
      error.status = response.status; error.code = detail.error || detail.code; throw error;
    }
    if (binary) return Buffer.from(await response.arrayBuffer());
    const text = await response.text(); return text ? JSON.parse(text) : null;
  }
  async token() {
    if (!this.session) throw new Error('Entre para conectar a nuvem.');
    const active = this.session;
    if ((active.expires_at || 0) * 1000 >= Date.now() + 60000) return active.access_token;
    if (this.refreshing?.session === active) return this.refreshing.promise;
    const refresh = { session: active };
    refresh.promise = (async () => {
      const session = await this.request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', token: null, body: { refresh_token: active.refresh_token } });
      await this.saveSession({ ...session, expires_at: Math.floor(Date.now() / 1000) + session.expires_in }, active);
      return this.session.access_token;
    })();
    this.refreshing = refresh;
    try { return await refresh.promise; } finally { if (this.refreshing === refresh) this.refreshing = null; }
  }
  authenticate(mode, email, password, profile) {
    return this.run(async () => {
      if (!this.enabled) throw new Error('A conexão com a nuvem está indisponível nesta versão.');
      this.reportProgress('auth');
      if (!['login', 'signup'].includes(mode) || typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || password.length > 256 || (mode === 'signup' && password.length < 8)) throw new Error('Informe seu e-mail e uma senha válida de pelo menos 8 caracteres.');
      const fields = mode === 'signup' ? profileFields(profile) : null;
      if (fields && (!fields.name || !fields.nickname)) throw new Error('Informe seu nome e apelido para criar a conta.');
      if (fields && profile.avatar != null) avatarBytes(profile.avatar);
      const session = await this.request(mode === 'signup' ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password', { method: 'POST', token: null, body: { email: email.trim(), password, ...(fields ? { data: fields } : {}) } });
      if (!session?.access_token) throw new Error('A confirmação de e-mail ainda está habilitada no servidor. Seus dados locais foram preservados.');
      await this.saveSession({ ...session, expires_at: Math.floor(Date.now() / 1000) + session.expires_in });
      this.downloaded = null;
      if (fields) {
        this.meta.signupProfile = { userId: session.user.id, ...fields, ...(profile.avatar ? { avatar: profile.avatar } : {}) };
        this.meta.profile = { userId: session.user.id, ...fields, avatar: profile.avatar || null };
        this.saveMeta();
        try { await this.loadProfile(); } catch (error) { this.profileError = 'Conta criada. O perfil será reenviado ao sincronizar. ' + error.message; }
      }
      this.meta.promptSeen = true; this.meta.pending = true; if (!this.meta.signupProfile) this.profileError = ''; this.saveMeta(); this.publish();
      return this.status();
    });
  }
  skip() { return this.run(async () => { this.meta.promptSeen = true; this.saveMeta(); return this.status(); }); }
  signOut() {
    return this.run(async () => {
      // Local sign-out must work offline. Revocation is attempted without delaying local removal.
      if (this.session) this.request('/auth/v1/logout', { method: 'POST' }).catch(() => {});
      this.session = null; this.downloaded = null; this.conflict = null; this.profileError = ''; this.pluginError = '';
      if (fs.existsSync(this.sessionFile)) fs.unlinkSync(this.sessionFile);
      this.meta.promptSeen = true; this.saveMeta(); return this.status();
    });
  }
  markDirty() {
    if (!this.session || this.meta.pending) return;
    this.meta.pending = true; this.saveMeta(); this.publish();
  }
  async remote() {
    await this.token();
    const rows = await this.request('/rest/v1/organon_sync_state?select=revision,checksum,updated_at&user_id=eq.' + this.session.user.id);
    return rows?.[0] || null;
  }
  sync() { return this.run(async () => {
    if (!this.enabled || !this.session) return this.status();
    this.reportProgress('checking');
    try { await this.loadProfile(); this.profileError = ''; } catch (error) { this.profileError = 'Não foi possível atualizar o perfil. ' + error.message; }
    await this.resumePlugins();
    return this.syncNow();
  }); }
  async loadProfile() {
    await this.token();
    const userId = this.session.user.id;
    const pending = this.meta.signupProfile;
    if (pending?.userId === userId) {
      await this.saveProfile(pending);
      delete this.meta.signupProfile; this.saveMeta();
    }
    const rows = await this.request('/rest/v1/organon_profiles?select=name,nickname,avatar_hash&user_id=eq.' + userId);
    let row = rows?.[0];
    const metadata = this.session.user.user_metadata;
    if (!row && typeof metadata?.name === 'string' && metadata.name.trim() && typeof metadata?.nickname === 'string' && metadata.nickname.trim()) {
      // Identity metadata is display-only, never used to authorize access.
      const initial = profileFields(metadata);
      await this.saveProfile(initial); row = initial;
    }
    const fields = profileFields(row || { name: '', nickname: '' });
    let avatar = null;
    if (row?.avatar_hash) {
      if (!/^[a-f0-9]{64}$/.test(row.avatar_hash)) throw new Error('Foto do perfil inválida.');
      const cached = this.meta.profile;
      if (cached?.userId === userId && cached.avatarHash === row.avatar_hash && cached.avatar) {
        const bytes = avatarBytes(cached.avatar); checkAvatar(bytes, row.avatar_hash); avatar = cached.avatar;
      } else {
        const bytes = await this.request('/storage/v1/object/authenticated/' + config.bucket + '/' + userId + '/' + row.avatar_hash, { binary: true });
        checkAvatar(bytes, row.avatar_hash); avatar = 'data:image/webp;base64,' + bytes.toString('base64');
      }
    }
    this.meta.profile = { userId, ...fields, avatarHash: row?.avatar_hash || null, avatar };
    this.saveMeta(); this.publish();
  }
  updateProfile(value) {
    return this.run(async () => {
      if (!this.enabled || !this.session) throw new Error('Entre para editar seu perfil.');
      await this.saveProfile(value);
      if (this.meta.signupProfile?.userId === this.session.user.id) { delete this.meta.signupProfile; this.saveMeta(); }
      await this.loadProfile(); this.profileError = ''; return this.status();
    });
  }
  async saveProfile(value) {
      const fields = profileFields(value); this.reportProgress('profile'); await this.token();
      let avatarHash;
      if (Object.hasOwn(value, 'avatar')) {
        avatarHash = null;
        if (value.avatar !== null) {
          const bytes = avatarBytes(value.avatar); avatarHash = hash(bytes);
          await this.uploadAsset(avatarHash, bytes, 'image/webp');
        }
      }
      await this.request('/rest/v1/organon_profiles?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
        body: { user_id: this.session.user.id, ...fields, ...(avatarHash !== undefined ? { avatar_hash: avatarHash } : {}), updated_at: new Date().toISOString() } });
  }
  async uploadAsset(digest, bytes, type) {
    await this.token();
    const object = '/' + config.bucket + '/' + this.session.user.id + '/' + digest;
    try { await this.request('/storage/v1/object' + object, { method: 'POST', body: bytes, headers: { 'Content-Type': type } }); }
    catch (error) {
      if (error.status !== 409 && error.code !== 'Duplicate') throw error;
      const existing = await this.request('/storage/v1/object/authenticated' + object, { binary: true });
      if (hash(existing) !== digest) throw new Error('Arquivo online corrompido. O envio não foi confirmado.');
    }
  }
  async syncNow({ replace = false, link = false } = {}) {
    if (!this.enabled || !this.session) return this.status();
    this.markDirty();
    this.reportProgress('checking');
    if (this.meta.ownerId && this.meta.ownerId !== this.session.user.id && !link) {
      this.conflict = { differentAccount: true }; return this.publish();
    }
    const remote = await this.remote(), local = await this.snapshot();
    if (!local) return this.status();
    if (replace && this.conflict?.revision && remote?.revision !== this.conflict.revision) { this.conflict = remote; return this.publish(); }
    this.reportProgress('preparing');
    const packed = packDocument(local, this.files);
    if (remote?.checksum === packed.checksum) { this.ack(remote); return this.status(); }
    if (remote && !replace && (this.meta.ownerId !== this.session.user.id || remote.revision !== this.meta.revision)) {
      this.conflict = remote; return this.publish();
    }
    if (remote && !replace && packed.checksum === this.meta.checksum) {
      this.conflict = remote; return this.publish();
    }
    const user = this.session.user.id;
    const known = new Set();
    for (let offset = 0; ; offset += 1000) {
      const uploaded = await this.request('/storage/v1/object/list/' + config.bucket, { method: 'POST', body: { prefix: user + '/', limit: 1000, offset } });
      for (const item of uploaded || []) known.add(item.name);
      if (!uploaded || uploaded.length < 1000) break;
    }
    const pending = [...packed.assets].filter(([digest]) => !known.has(digest));
    let completed = 0; this.reportProgress('uploading', completed, pending.length);
    await mapTransfers(pending, async ([digest, asset]) => {
      const bytes = asset.load ? asset.load() : asset.bytes;
      await this.uploadAsset(digest, bytes, asset.type);
      this.reportProgress('uploading', ++completed, pending.length);
    });
    this.reportProgress('committing');
    const result = await this.request('/rest/v1/rpc/organon_commit_snapshot', { method: 'POST', body: { p_expected_revision: remote?.revision || 0, p_checksum: packed.checksum, p_payload: packed.payload } });
    if (!result?.ok) { this.conflict = result?.current || { updated_at: null }; return this.publish(); }
    this.ack(result.current);
    // Changes made during the upload remain pending for the next sync.
    if (canonical(await this.snapshot()) !== canonical(local)) { this.meta.pending = true; this.saveMeta(); }
    return this.status();
  }
  ack(remote) {
    this.meta = { ...this.meta, ownerId: this.session.user.id, revision: remote.revision, checksum: remote.checksum, lastSync: new Date().toISOString(), pending: false };
    this.conflict = null; this.saveMeta(); this.publish();
  }
  chooseLocal() { return this.run(() => this.syncNow({ replace: true, link: true })); }
  download() {
    return this.run(async () => {
      this.downloaded = null; this.reportProgress('downloading');
      await this.token();
      const rows = await this.request('/rest/v1/organon_sync_state?select=*&user_id=eq.' + this.session.user.id);
      const row = rows?.[0]; if (!row) throw new Error('Esta conta ainda não tem uma cópia online.');
      if (hash(canonical(row.payload)) !== row.checksum) throw new Error('O backup online não passou na verificação de integridade.');
      const { organonPlugins, ...payload } = row.payload;
      if (organonPlugins !== undefined && (!Array.isArray(organonPlugins) || organonPlugins.length > PLUGIN_IDS.length || new Set(organonPlugins).size !== organonPlugins.length || organonPlugins.some(id => !PLUGIN_IDS.includes(id)))) throw new Error('Lista de plugins online inválida.');
      const digests = new Set();
      function collect(value) {
        if (!value || typeof value !== 'object') return;
        if (typeof value.organonAsset === 'string') digests.add(value.organonAsset);
        for (const item of Object.values(value)) collect(item);
      }
      collect(payload);
      for (const group of Object.values(payload.organonFiles || {})) {
        if (group && typeof group === 'object') for (const item of Object.values(group)) for (const digest of item?.chunks || []) digests.add(digest);
      }
      const received = new Set(); this.reportProgress('downloading', 0, digests.size);
      const data = await unpackDocument(payload, async digest => {
        await this.token();
        const bytes = await this.request('/storage/v1/object/authenticated/' + config.bucket + '/' + this.session.user.id + '/' + digest, { binary: true });
        received.add(digest); this.reportProgress('downloading', received.size, digests.size);
        return bytes;
      }, this.files, name => { this.progress = { ...this.progress, receivedItem: name }; this.publish(); });
      const local = this.readData();
      if (local) {
        const recovery = path.join(this.directory, 'recovery'); fs.mkdirSync(recovery, { recursive: true });
        fs.writeFileSync(path.join(recovery, `before-cloud-${Date.now()}.json`), JSON.stringify(local));
      }
      this.reportProgress('restoring');
      this.downloaded = { userId: this.session.user.id, revision: row.revision, checksum: row.checksum, plugins: organonPlugins };
      return data;
    });
  }
  acceptDownload() { return this.run(async () => {
    if (!this.downloaded || this.downloaded.userId !== this.session?.user?.id) throw new Error('Nenhum backup foi carregado para esta conta.');
    if (this.downloaded.plugins) this.meta.pluginRestore = { userId: this.session.user.id, ids: this.downloaded.plugins };
    this.ack(this.downloaded); this.downloaded = null;
    await this.resumePlugins(); return this.status();
  }); }
}
module.exports = { CloudSync };
