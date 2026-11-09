const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-kinds-'));
const file = path.join(profile, 'compasso.json'), output = path.join(root, 'test-output'); fs.mkdirSync(output, { recursive: true });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const options = (process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE) ? { executablePath: path.resolve((process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE)), args: [`--user-data-dir=${profile}`, '--skip-account-prompt'], env } : { args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env };
let app;
(async () => {
  const { firstPlan, seed, validateData } = await import('../src/model.js');
  fs.writeFileSync(file, JSON.stringify({ ...seed(), onboardingCompleted: true, plans: [{ ...firstPlan(), name: 'Plano de tipos', days: [0, 1, 2, 3, 4, 5, 6] }] }));
  app = await electron.launch(options); let page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: 'Planos de estudo', exact: true }).click();
  await page.getByRole('button', { name: 'Editar Plano de tipos', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Editar plano de estudo', exact: true });
  assert.equal(await page.getByRole('button', { name: 'Todos os tipos de atividade', exact: true }).count(), 0);
  async function create(name, chooseIcon = false) {
    await editor.getByRole('button', { name: 'Criar tipo de atividade', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Novo tipo de atividade', exact: true });
    await modal.getByLabel('Nome do tipo de atividade', { exact: true }).fill(name);
    if (chooseIcon) {
      await modal.getByRole('button', { name: 'Escolher ícone do tipo de atividade', exact: true }).click();
      const picker = page.getByRole('dialog', { name: 'Escolher ícone', exact: true });
      await picker.getByRole('textbox', { name: 'Buscar ícones', exact: true }).fill('estudos');
      await picker.getByRole('button', { name: 'Estudos', exact: true }).click();
    }
    await modal.getByRole('button', { name: 'Criar tipo', exact: true }).click();
  }
  await create('Revisão', true);
  assert.equal(await editor.getByRole('textbox', { name: 'Nome do bloco 4', exact: true }).inputValue(), 'Revisão');
  assert.equal(await editor.locator('.editor-block').last().locator('.lucide-graduation-cap').count(), 1);
  await create('revisao');
  await page.getByRole('alert').filter({ hasText: 'Use um nome único' }).waitFor();
  await page.getByRole('dialog', { name: 'Novo tipo de atividade', exact: true }).getByRole('button', { name: 'Cancelar', exact: true }).click();
  for (const name of ['Exercícios', 'Leitura', 'Prática', 'Simulado', 'Pesquisa', 'Atividade', 'Resumo com um título comprido']) await create(name);
  await page.getByRole('button', { name: 'Todos os tipos de atividade', exact: true }).waitFor();
  async function checkGeometry() {
    assert.equal(await editor.locator('.block-kind-toolbar').evaluate(node => node.scrollWidth > node.clientWidth), false);
    const rows = await editor.locator('.block-kind-chip').evaluateAll(nodes => new Set(nodes.map(node => Math.round(node.getBoundingClientRect().top))).size);
    assert(rows <= 2);
    assert.equal(await editor.locator('.block-kind-grid').evaluate(node => node.scrollWidth > node.clientWidth), false);
  }
  await checkGeometry(); await editor.locator('.block-kind-toolbar').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'block-types.png') });
  await page.getByRole('button', { name: 'Todos os tipos de atividade', exact: true }).click();
  const all = page.getByRole('dialog', { name: 'Tipos de atividade', exact: true });
  assert.equal(await all.locator('.block-kind-list button').count(), 10);
  await page.screenshot({ path: path.join(output, 'block-types-all.png') });
  await all.getByRole('button', { name: 'Adicionar pesquisa', exact: true }).click();
  assert.equal(await editor.getByRole('textbox', { name: 'Nome do bloco 12', exact: true }).inputValue(), 'Pesquisa');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(840, 620));
  await page.waitForTimeout(150); await checkGeometry();
  await editor.locator('.block-kind-toolbar').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'block-types-small.png') });
  await editor.getByRole('button', { name: 'Salvar plano', exact: true }).click();
  await page.getByRole('button', { name: /^Meu dia/ }).click();
  await page.getByRole('button', { name: 'Iniciar Revisão', exact: true }).click();
  await page.waitForTimeout(1100); await page.getByRole('button', { name: 'Pausar Revisão', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Concluir Revisão', exact: true }).click();
  await page.waitForTimeout(250);
  const saved = validateData(JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.equal(saved.blockKinds.length, 8); assert.equal(saved.plans[0].blocks[3].kind.icon, 'study');
  assert.equal(saved.active.kind.name, 'Revisão');
  assert(Object.values(saved.records).some(record => record.kind?.name === 'Revisão' && record.done));
  await app.close(); app = null; app = await electron.launch(options); page = await app.firstWindow();
  await page.getByRole('button', { name: 'Planos de estudo', exact: true }).click(); await page.getByRole('button', { name: 'Editar Plano de tipos', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Nome do bloco 4', exact: true }).inputValue(), 'Revisão');
  await page.getByRole('button', { name: 'Todos os tipos de atividade', exact: true }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Tipos de atividade', exact: true }).locator('.block-kind-list button').count(), 10);
  assert.deepEqual(errors, []);
  console.log('PASS: custom type creation/icon, duplicate rejection, two-row responsive toolbar, overflow list, adding blocks, focus timer/history and restart.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (app) await app.close(); });
