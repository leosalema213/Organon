// Explicit live validation, run by the user. Uses synthetic accounts and isolated profiles only.
const { _electron: electron } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..'), config = require('../electron/cloud-config.cjs');
const output = path.join(root, 'test-output');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app, profile;
(async () => {
  const response = await fetch(config.url + '/auth/v1/settings', { headers: { apikey: config.key } });
  if (!response.ok) throw new Error('Não foi possível consultar o Auth real.');
  const settings = await response.json();
  if (!settings.mailer_autoconfirm) throw new Error('Desative Confirm email no painel do Organon e salve antes deste teste.');
  const { seed, validateData } = await import('../src/model.js');
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-live-'));
  app = await electron.launch({ args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env });
  const report = await app.evaluate(async ({ app, net, safeStorage }, fixture) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
    const { randomUUID } = require('node:crypto');
    const { CloudSync } = require('./electron/cloud.cjs');
    const { CHUNK_SIZE } = require('./electron/cloud-files.cjs');
    const { hash, packDocument } = require('./electron/cloud-document.cjs');
    const run = randomUUID(), password = randomUUID() + 'aA1!', accounts = [], checks = [];
    const profile = app.getPath('userData'), controllers = [], directories = [];
    function controller(name, readData) {
      const directory = path.join(profile, name); fs.mkdirSync(directory, { recursive: true }); directories.push(directory);
      const cloud = new CloudSync({ directory, safeStorage, fetchImpl: net.fetch.bind(net), readData });
      controllers.push(cloud); return cloud;
    }
    let local = structuredClone(fixture), downloaded = structuredClone(fixture);
    const a = controller('a', () => local), b = controller('b', () => null);
    // Valid synthetic PDF/audio, with a book crossing the chunk boundary.
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(CHUNK_SIZE + 21, 7)]), digest = hash(pdf);
    a.files.books.put(pdf, digest);
    local.books = [{ id: randomUUID(), title: 'Teste de sincronização', format: 'pdf', hash: digest, size: pdf.length,
      planIds: [], page: 1, pageCount: null, furthestPage: 0, completedAt: null, importedAt: new Date().toISOString(), view: { spread: 1, zoom: 1, contrast: 'paper' } }];
    local.anki.media['teste.mp3'] = a.files.books.ankiMedia.put(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(128, 2)]), 'teste.mp3');
    const emailA = `organon-sync-test-${run}-a@example.com`, emailB = `organon-sync-test-${run}-b@example.com`;
    async function signup(cloud, email) {
      const status = await cloud.authenticate('signup', email, password);
      if (status.user) accounts.push({ id: status.user.id, email });
      assert(status.user, 'Cadastro real deve retornar sessão'); assert.equal(status.error, '');
      assert.equal(cloud.meta.revision, 0, 'Cadastro não deve aguardar/enviarem os estudos');
      await cloud.sync(); assert.equal(cloud.status().error, ''); assert.equal(cloud.status().profileError, '');
    }
    try {
      await signup(a, emailA); assert.equal(a.meta.revision, 1); assert.equal(a.meta.pending, false);
      checks.push('Cadastro real, upload de livro em partes, áudio e commit');
      const revision = a.meta.revision; await a.sync(); assert.equal(a.meta.revision, revision);
      checks.push('Conteúdo igual não cria nova revisão');
      const c = controller('c', () => downloaded);
      await c.authenticate('login', emailA, password); await c.sync(); assert(c.status().conflict);
      downloaded = await c.download(); await c.acceptDownload();
      assert.deepEqual(downloaded, local);
      assert.deepEqual(c.files.books.read(digest), pdf);
      assert.deepEqual(c.files.books.ankiMedia.read(local.anki.media['teste.mp3']), a.files.books.ankiMedia.read(local.anki.media['teste.mp3']));
      const backup = path.join(profile, 'portable.json'); c.files.books.export(backup, downloaded);
      const verified = c.files.books.verifyBackup(JSON.parse(fs.readFileSync(backup, 'utf8')));
      assert.equal(verified.files.size, 1); assert.equal(verified.ankiFiles.size, 1);
      checks.push('Login em outro perfil, conflito explícito, download íntegro e backup portátil');
      const restarted = new CloudSync({ directory: c.directory, safeStorage, fetchImpl: net.fetch.bind(net), readData: () => downloaded });
      controllers.push(restarted); await restarted.ready; assert.equal(restarted.session.user.id, a.session.user.id);
      assert(!fs.readFileSync(restarted.sessionFile, 'utf8').includes(restarted.session.refresh_token));
      await restarted.sync(); assert.equal(restarted.meta.revision, 1);
      checks.push('Reabertura com sessão protegida pelo Windows e conteúdo preservado');
      // Exercise actual refresh against Auth, not a simulated service.
      restarted.session.expires_at = 0; await restarted.token(); assert(restarted.session.expires_at * 1000 > Date.now());
      const packed = packDocument(local, a.files);
      const stale = await a.request('/rest/v1/rpc/organon_commit_snapshot', { method: 'POST', body: { p_expected_revision: 0, p_checksum: packed.checksum, p_payload: packed.payload } });
      assert.equal(stale.ok, false); assert.equal(stale.current.revision, 1);
      checks.push('Refresh real da sessão e rejeição de revisão desatualizada');
      const photo = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
      await a.updateProfile({ name: 'Pessoa de teste', nickname: 'Apelido de teste', avatar: photo });
      assert.equal(a.status().user.nickname, 'Apelido de teste'); assert.equal(a.status().user.avatar, photo);
      await restarted.sync(); assert.equal(restarted.status().user.nickname, 'Apelido de teste'); assert.equal(restarted.status().user.avatar, photo);
      const cached = new CloudSync({ directory: restarted.directory, safeStorage, fetchImpl: net.fetch.bind(net), readData: () => downloaded });
      controllers.push(cached); await cached.ready; assert.equal(cached.status().user.avatar, photo);
      checks.push('Perfil separado: nome/apelido/foto privados, atualização em outro perfil e cache na reabertura');
      await signup(b, emailB);
      assert.deepEqual(await b.request('/rest/v1/organon_profiles?select=*'), []);
      await assert.rejects(b.request('/rest/v1/organon_profiles', { method: 'POST', body: { user_id: a.session.user.id, name: 'Não permitido', nickname: '' } }));
      await assert.rejects(b.request('/rest/v1/organon_profiles?select=*', { token: null }));
      const avatarHash = a.meta.profile.avatarHash;
      await assert.rejects(b.request('/storage/v1/object/authenticated/organon-assets/' + a.session.user.id + '/' + avatarHash, { binary: true }));
      await a.updateProfile({ name: 'Pessoa de teste', nickname: '', avatar: null });
      assert.equal(a.status().user.avatar, null); assert.equal(a.status().user.nickname, '');
      assert.deepEqual(await b.request('/rest/v1/organon_sync_state?select=*'), []);
      const asset = packed.assets.keys().next().value, userA = a.session.user.id;
      await assert.rejects(b.request('/storage/v1/object/authenticated/organon-assets/' + userA + '/' + asset, { binary: true }));
      await assert.rejects(b.request('/storage/v1/object/organon-assets/' + userA + '/' + hash(Buffer.from('forbidden')), { method: 'POST', body: Buffer.from('forbidden'), headers: { 'Content-Type': 'application/octet-stream' } }));
      await assert.rejects(b.request('/rest/v1/organon_sync_state', { method: 'POST', body: { user_id: userA, revision: 2, checksum: packed.checksum, payload: packed.payload } }));
      const changed = await b.request('/rest/v1/organon_sync_state?user_id=eq.' + userA, { method: 'PATCH', body: { revision: 2 }, headers: { Prefer: 'return=representation' } });
      assert.deepEqual(changed, []); assert.equal((await a.remote()).revision, 1);
      await assert.rejects(b.request('/rest/v1/organon_sync_state?select=*', { token: null }));
      await assert.rejects(b.request('/rest/v1/rpc/organon_commit_snapshot', { method: 'POST', token: null, body: { p_expected_revision: 0, p_checksum: packed.checksum, p_payload: packed.payload } }));
      checks.push('Duas contas isoladas por RLS no banco/Storage; acesso anônimo negado');
      return { ok: true, realServer: true, run, accounts, checks, restored: downloaded };
    } finally {
      // Remove only the synthetic users' snapshots/objects through their own authenticated API.
      for (const cloud of [a, b]) {
        if (!cloud.session) continue;
        try {
          await cloud.token();
          await cloud.request('/rest/v1/organon_sync_state?user_id=eq.' + cloud.session.user.id, { method: 'DELETE' });
          await cloud.request('/rest/v1/organon_profiles?user_id=eq.' + cloud.session.user.id, { method: 'DELETE' });
          const objects = await cloud.request('/storage/v1/object/list/organon-assets', { method: 'POST', body: { prefix: cloud.session.user.id + '/', limit: 1000 } });
          if (objects?.length) await cloud.request('/storage/v1/object/organon-assets', { method: 'DELETE', body: { prefixes: objects.map(item => cloud.session.user.id + '/' + item.name) } });
        } catch { checks.push('Limpeza dos arquivos de teste pendente: conferir no painel'); }
      }
      for (const cloud of controllers) {
        if (!cloud.session) continue;
        try { await cloud.request('/auth/v1/logout?scope=global', { method: 'POST' }); } catch {}
        cloud.session = null;
      }
      fs.mkdirSync(path.join(app.getAppPath(), 'test-output'), { recursive: true });
      fs.writeFileSync(path.join(app.getAppPath(), 'test-output', 'cloud-live-accounts.json'), JSON.stringify({ run, accounts }, null, 2));
    }
  }, seed());
  validateData(report.restored); delete report.restored;
  fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'cloud-live-audit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log('Contas sintéticas registradas em test-output/cloud-live-accounts.json para remoção administrativa após a conferência. Nenhum dado pessoal foi usado.');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close().catch(() => {});
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
});
