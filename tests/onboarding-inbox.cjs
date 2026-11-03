// Focused UI validation: isolated profile, synthetic accounts and RPC responses.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-onboarding-inbox-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
(async () => {
  const { seed } = await import('../src/model.js');
  const fixture = { ...seed(), onboardingCompleted: true };
  fs.writeFileSync(path.join(profile, 'compasso.json'), JSON.stringify(fixture));
  app = await electron.launch({ args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(async ({ app, ipcMain, safeStorage, BrowserWindow }) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const fs = require('node:fs'), path = require('node:path');
    const { CloudSync } = require('./electron/cloud.cjs');
    const { createService } = require('./electron/modules/teams.cjs');
    const win = BrowserWindow.getAllWindows()[0];
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ownerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', orgId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', memberId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', noticeId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const state = globalThis.onboardingInboxTest = { authCalls: 0, profile: null, notices: [{ id: noticeId, member_id: memberId, org_name: 'Equipe sintética', kind: 'invitation', created_at: new Date().toISOString(), read_at: null }], pending: true, accepted: false, requests: [] };
    state.notices.push({ ...state.notices[0], id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', kind: 'permissions' });
    const workspace = { id: orgId, owner_id: ownerId, name: 'Equipe sintética' };
    const avatarBytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
    const avatarHash = require('node:crypto').createHash('sha256').update(avatarBytes).digest('hex');
    const cloud = new CloudSync({ directory: app.getPath('userData'), safeStorage, skipPrompt: true,
      readData: () => JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'compasso.json'))),
      emit: value => win.webContents.send('cloud:status', value),
      fetchImpl: async (url, options) => {
        const endpoint = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : null;
        const reply = value => new Response(JSON.stringify(value));
        if (endpoint === '/auth/v1/signup') { state.authCalls++; state.authMetadata = body.data; return reply({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, user: { id, email: body.email, user_metadata: body.data } }); }
        if (endpoint === '/rest/v1/organon_profiles') { if (body) state.profile = body; return reply(state.profile ? [state.profile] : []); }
        if (endpoint === '/rest/v1/organon_sync_state') return reply(state.snapshot ? [state.snapshot] : []);
        if (endpoint.includes('/storage/v1/object/list/')) return reply([]);
        if (endpoint.startsWith('/storage/v1/object/authenticated/organon-assets/')) return new Response(avatarBytes);
        if (endpoint === '/rest/v1/rpc/organon_commit_snapshot') { state.snapshot = { revision: 1, checksum: body.p_checksum, payload: body.p_payload }; return reply({ ok: true, current: state.snapshot }); }
        if (endpoint === '/rest/v1/rpc/organon_teams') {
          const action = body.p_action, p = body.p_payload; state.requests.push(action);
          if (action === 'list') return reply(state.accepted ? [workspace] : []);
          if (action === 'inbox') return reply({ notifications: state.notices, invitations: state.pending ? [{ member_id: memberId, org_name: workspace.name, revision: 1, grants: {} }] : [], unreadCount: state.notices.filter(n => !n.read_at).length });
          if (action === 'readAll') { state.notices.forEach(n => { n.read_at = new Date().toISOString(); }); return reply({}); }
          if (action === 'deleteNotice') { state.notices = state.notices.filter(n => n.id !== p.id); return reply({}); }
          if (action === 'deleteAllNotices') { state.notices = []; return reply({}); }
          if (action === 'respond') { state.pending = false; state.accepted = p.response === 'accepted'; return reply({}); }
          if (action === 'roster') return reply([{ id: orgId, user_id: ownerId, name: 'Admin sintético', nickname: 'Admin', avatar_hash: avatarHash, status: 'accepted', role: 'owner' }, { id: memberId, user_id: id, name: state.profile.name, nickname: state.profile.nickname, avatar_hash: null, status: 'accepted', role: 'member' }]);
        }
        throw new Error('Endpoint sintético inesperado: ' + endpoint);
      } });
    await cloud.ready;
    const teams = createService({ cloud, emit: () => win.webContents.send('modules:changed', { module: 'teams', type: 'invalidate' }) });
    for (const [name, fn] of Object.entries({ status: () => cloud.status(), sync: () => cloud.sync(), authenticate: (...args) => cloud.authenticate(...args), skip: () => cloud.skip() })) {
      ipcMain.removeHandler('cloud:' + name); ipcMain.handle('cloud:' + name, (_event, ...args) => fn(...args));
    }
    ipcMain.removeHandler('modules:call'); ipcMain.handle('modules:call', (_event, module, action, payload) => { if (module !== 'teams') throw new Error('Módulo inesperado'); return teams.dispatch(action, payload); });
    ipcMain.removeHandler('modules:watch'); ipcMain.handle('modules:watch', () => ({ available: false }));
  });
  await page.getByRole('button', { name: 'Preferências', exact: true }).click();
  await page.getByRole('tab', { name: 'Conta', exact: true }).click();
  await page.getByRole('button', { name: 'Entrar ou criar conta', exact: true }).click();
  await page.getByRole('tab', { name: 'Criar conta', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Continuar', exact: true }).isDisabled(), true);
  await page.getByLabel('Nome', { exact: true }).fill('Pessoa sintética');
  await page.getByLabel('Apelido', { exact: true }).fill('Teste');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('E-mail', { exact: true }).fill('synthetic@example.invalid');
  await page.getByLabel('Senha', { exact: true }).fill('synthetic-password-123');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.onboardingInboxTest.authCalls), 0, 'A conta só é criada após a etapa opcional da foto.');
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  assert.equal(await page.getByLabel('E-mail', { exact: true }).inputValue(), 'synthetic@example.invalid');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Pular foto e criar conta', exact: true }).click();
  await page.getByRole('dialog', { name: 'Sua conta', exact: true }).waitFor({ state: 'hidden' });
  assert.deepEqual(await app.evaluate(() => globalThis.onboardingInboxTest.authMetadata), { name: 'Pessoa sintética', nickname: 'Teste' });
  await page.getByRole('button', { name: 'Concluir', exact: true }).click();
  const bell = page.getByRole('button', { name: /^Notificações/ });
  await bell.click(); const inbox = page.getByRole('dialog', { name: /^Notificações/ });
  await inbox.getByRole('button', { name: 'Marcar todas como lidas', exact: true }).click();
  await page.waitForFunction(() => globalThis.document.querySelector('.notification-inbox')?.getAttribute('aria-busy') === 'false');
  assert.equal(await app.evaluate(() => globalThis.onboardingInboxTest.notices.every(n => n.read_at)), true);
  await inbox.getByRole('button', { name: 'Excluir notificação de Equipe sintética', exact: true }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('.notification-item').length === 1);
  assert.equal(await app.evaluate(() => globalThis.onboardingInboxTest.notices.length), 1);
  await inbox.getByRole('button', { name: 'Excluir todas', exact: true }).click();
  await inbox.getByRole('button', { name: 'Confirmar exclusão', exact: true }).click();
  await inbox.getByText('Nenhuma notificação.', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.onboardingInboxTest.pending), true);
  await inbox.getByRole('button', { name: 'Convites (1)', exact: true }).click();
  await inbox.getByRole('button', { name: 'Aceitar', exact: true }).click();
  await inbox.getByText('Nenhum convite pendente.', { exact: true }).waitFor();
  await page.keyboard.press('Escape'); await inbox.waitFor({ state: 'hidden' });
  assert.equal(await bell.evaluate(element => element === document.activeElement), true);
  await page.locator('.sidebar nav').getByRole('button', { name: 'Equipes', exact: true }).click();
  await page.locator('.teams-row').getByText('Admin sintético', { exact: true }).waitFor();
  await page.locator('.teams-row').getByText('Pessoa sintética', { exact: true }).waitFor();
  await page.locator('.teams-row').filter({ hasText: 'Admin sintético' }).locator('.teams-avatar img').waitFor();
  assert.equal(await page.locator('.teams-row').filter({ hasText: 'Pessoa sintética' }).locator('.teams-avatar svg').count(), 1);
  assert.equal(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i.test(await page.locator('.teams-row').allTextContents().then(rows => rows.join(' '))), false, 'IDs não aparecem nos membros.');
  assert.equal(await page.getByRole('button', { name: 'Convidar pessoa', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Rever permissões', exact: true }).count(), 0);
  assert.equal(await page.getByRole('heading', { name: 'Notificações e convites', exact: true }).count(), 0);
  const saved = JSON.parse(fs.readFileSync(path.join(profile, 'compasso.json'), 'utf8'));
  assert.deepEqual(saved.plans, fixture.plans);
  assert.deepEqual(errors, []);
  console.log('Cadastro em etapas, perfil obrigatório, foto opcional, sininho, leitura/exclusão, convite preservado e membros para convidado aprovados. Perfil temporário e rede simulada; não valida o SQL remoto.');
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close();
  const target = path.resolve(profile);
  if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('organon-onboarding-inbox-')) fs.rmSync(target, { recursive: true, force: true });
});
