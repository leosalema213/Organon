// Real Kanban component and drag events; synthetic IPC and temporary profile only.
const { _electron: electron } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-list-drag-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
(async () => {
  const { seed } = await import('../src/model.js');
  fs.writeFileSync(path.join(directory, 'compasso.json'), JSON.stringify({ ...seed(), onboardingCompleted: true }));
  app = await electron.launch({ args: [root, `--user-data-dir=${directory}`, '--skip-account-prompt'], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(12000);
  await page.locator('.sidebar nav button').first().waitFor();
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Teste', nickname: 'Teste' };
    const workspace = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', owner_id: user.id, name: 'Espaço de teste', role: 'owner', kind: 'team' };
    const board = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Quadro de teste', revision: 1 };
    const state = globalThis.listDragTest = { lists: ['a', 'b', 'c', 'd', 'e', 'f'].map((id, position) => ({ id, name: `Lista ${id}`, position, revision: 1 })), calls: [], reject: false };
    state.cards = ['b', 'c', 'd', 'e', 'f', 'c'].map((listId, position) => ({ id: `card-${position}`, list_id: listId, title: `Cartão ${position}`, position, revision: 1 }));
    state.cardCalls = [];
    const status = { enabled: true, promptSeen: true, user, pending: false, busy: false, error: '', conflict: null };
    for (const name of ['status', 'sync', 'skip']) {
      ipcMain.removeHandler(`cloud:${name}`); ipcMain.handle(`cloud:${name}`, () => status);
    }
    ipcMain.removeHandler('modules:watch'); ipcMain.handle('modules:watch', () => ({ connected: true, realtime: false }));
    ipcMain.removeHandler('modules:call');
    ipcMain.handle('modules:call', async (_event, module, action, payload) => {
      if (module === 'teams') {
        if (action === 'list') return [workspace];
        if (action === 'inbox') return { notifications: [], invitations: [], unreadCount: 0 };
        return [];
      }
      if (module === 'kanban') {
        if (action === 'getBoards') return [board];
        if (action === 'getTags') return { tags: [], canManageTags: true, canCreateBoard: true };
        if (action === 'getBoard') return { board, lists: state.lists, cards: state.cards, tags: [], cardTags: [], canWrite: true };
        if (action === 'moveCard') {
          state.cardCalls.push(payload);
          if (state.reject) throw new Error('Conflito de cartão simulado');
          const moving = state.cards.find(card => card.id === payload.id);
          if (moving.revision !== payload.expectedRevision) throw new Error('Revisão incorreta');
          const others = state.cards.filter(card => card !== moving);
          const destination = others.filter(card => card.list_id === payload.listId).sort((a, b) => a.position - b.position);
          destination.splice(payload.beforeId === null ? destination.length : destination.findIndex(card => card.id === payload.beforeId), 0, { ...moving, list_id: payload.listId, revision: moving.revision + 1 });
          state.cards = [...others.filter(card => card.list_id !== payload.listId), ...destination.map((card, position) => ({ ...card, position }))];
          return { ok: true };
        }
        if (action === 'moveList') {
          state.calls.push(payload);
          await new Promise(resolve => setTimeout(resolve, 200));
          if (state.reject) throw new Error('Conflito simulado');
          const moving = state.lists.find(list => list.id === payload.id);
          if (moving.revision !== payload.expectedRevision) throw new Error('Revisão incorreta');
          const next = state.lists.filter(list => list.id !== payload.id);
          next.splice(payload.beforeId === null ? next.length : next.findIndex(list => list.id === payload.beforeId), 0, moving);
          state.lists = next.map((list, position) => ({ ...list, position, revision: list.revision + 1 }));
          return { ok: true };
        }
      }
      throw new Error(`Comando inesperado: ${module}/${action}`);
    });
  });
  await page.reload();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Quadros', exact: true }).click();
  const board = page.locator('.kanban-board'), columns = board.locator('[data-list-id]');
  await columns.first().waitFor();
  async function order(expected) {
    await page.waitForFunction(expected => [...document.querySelectorAll('[data-list-id]')].map(node => node.dataset.listId).join(',') === expected, expected);
    await page.waitForFunction(() => document.querySelector('.kanban-board')?.getAttribute('aria-busy') === 'false');
  }
  async function beginDrag(id, targetId, after) {
    // Synthetic native events exercise bubbling through cards and browser DataTransfer.
    await page.evaluate(({ id, targetId, after }) => {
      const source = document.querySelector(`[data-list-id="${id}"]>header`), target = document.querySelector(`[data-list-id="${targetId}"] .kanban-card`);
      const bounds = target.getBoundingClientRect(), transfer = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer, clientX: source.getBoundingClientRect().left + 40, clientY: source.getBoundingClientRect().top + 12 }));
      const options = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: after ? bounds.right - 12 : bounds.left + 12, clientY: bounds.top + 15 };
      target.dispatchEvent(new DragEvent('dragover', options));
      window.listDragGesture = { source, target, options, transfer };
    }, { id, targetId, after });
  }
  async function finishDrag(cancel = false) {
    await page.evaluate(cancel => {
      const { source, target, options, transfer } = window.listDragGesture;
      if (cancel) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else target.dispatchEvent(new DragEvent('drop', options));
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
      delete window.listDragGesture;
    }, cancel);
  }
  async function drag(id, targetId, after, cancel = false) { await beginDrag(id, targetId, after); await finishDrag(cancel); }
  await beginDrag('a', 'b', true);
  await page.waitForFunction(() => {
    const source = document.querySelector('[data-list-id="a"]'), next = document.querySelector('[data-list-id="b"]');
    return source.classList.contains('is-dragging-list') && source.getBoundingClientRect().left > next.getBoundingClientRect().left;
  });
  assert.equal(await app.evaluate(() => globalThis.listDragTest.calls.length), 0, 'Preview must not save while dragging.');
  assert.deepEqual(await app.evaluate(() => globalThis.listDragTest.lists.map(list => list.id)), ['a', 'b', 'c', 'd', 'e', 'f']);
  const transforms = await columns.evaluateAll(nodes => nodes.map(node => node.style.transform));
  await page.evaluate(() => {
    const { target, options } = window.listDragGesture;
    for (let i = 0; i < 20; i++) target.dispatchEvent(new DragEvent('dragover', options));
  });
  assert.deepEqual(await columns.evaluateAll(nodes => nodes.map(node => node.style.transform)), transforms, 'A stationary pointer must not oscillate between slots.');
  await finishDrag(); await order('b,a,c,d,e,f');
  await drag('c', 'b', false); await order('c,b,a,d,e,f');
  const count = await app.evaluate(() => globalThis.listDragTest.calls.length);
  await drag('c', 'b', false); await order('c,b,a,d,e,f');
  await drag('c', 'b', true, true); await order('c,b,a,d,e,f');
  assert(await columns.evaluateAll(nodes => nodes.every(node => !node.style.transform)), 'Cancel must clear all preview transforms.');
  assert.equal(await app.evaluate(() => globalThis.listDragTest.calls.length), count, 'No-op and Esc must not write.');
  await board.evaluate(element => {
    const source = element.querySelector('[data-list-id]>header'), bounds = element.getBoundingClientRect(), transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer, clientX: bounds.left + 40, clientY: bounds.top + 20 }));
    element.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: bounds.right - 5, clientY: bounds.top + 40 }));
  });
  await page.waitForFunction(() => document.querySelector('.kanban-board').scrollLeft > 30);
  await page.keyboard.press('Escape');
  await page.locator('.is-sorting-lists').waitFor({ state: 'hidden' });
  await board.evaluate(element => { element.scrollLeft = 0; });
  assert.equal(await app.evaluate(() => globalThis.listDragTest.calls.length), count);
  await app.evaluate(() => { globalThis.listDragTest.reject = true; });
  await drag('c', 'b', true); await page.getByRole('alert').filter({ hasText: 'Conflito simulado' }).waitFor();
  await order('c,b,a,d,e,f');
  assert.deepEqual(await app.evaluate(() => globalThis.listDragTest.lists.map(list => list.id)), ['c', 'b', 'a', 'd', 'e', 'f']);
  console.log('Listas: encaixe visual durante o arraste sem gravação, posição estável, destinos antes/depois, ordem persistida, rolagem na borda, Esc e restauração após conflito aprovados. Perfil temporário e servidor simulado.');
  await app.evaluate(() => { globalThis.listDragTest.reject = false; });
  async function beginCardDrag(id, selector, after = false) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.evaluate(({ id, selector, after }) => {
      const source = document.querySelector(`[data-card-id="${id}"]`), target = document.querySelector(selector);
      const origin = source.getBoundingClientRect(), bounds = target.getBoundingClientRect(), transfer = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer, clientX: origin.left + 20, clientY: origin.top + 10 }));
      const options = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: bounds.left + 25, clientY: after ? bounds.bottom - 5 : bounds.top + 5 };
      target.dispatchEvent(new DragEvent('dragover', options));
      window.listDragGesture = { source, target, options, transfer };
    }, { id, selector, after });
    await page.locator('.is-sorting-cards .kanban-card-placeholder').waitFor();
  }
  async function cardOrder(listId, expected) {
    await page.waitForFunction(({ listId, expected }) => {
      const board = document.querySelector('.kanban-board');
      const cards = board.querySelectorAll(`[data-list-id="${listId}"] [data-card-id]`);
      return board.getAttribute('aria-busy') === 'false' && [...cards].map(card => card.dataset.cardId).join(',') === expected;
    }, { listId, expected });
  }
  await beginCardDrag('card-1', '[data-card-id="card-5"]', true);
  await page.waitForFunction(() => document.querySelector('[data-list-id="c"] .kanban-card-placeholder').getBoundingClientRect().top > document.querySelector('[data-card-id="card-5"]').getBoundingClientRect().top);
  assert.equal(await app.evaluate(() => globalThis.listDragTest.cardCalls.length), 0);
  await finishDrag(); await cardOrder('c', 'card-5,card-1');
  await beginCardDrag('card-1', '[data-card-id="card-0"]');
  await page.waitForFunction(() => document.querySelector('[data-list-id="b"] .kanban-card-placeholder').getBoundingClientRect().top < document.querySelector('[data-card-id="card-0"]').getBoundingClientRect().top);
  await finishDrag(); await cardOrder('b', 'card-1,card-0'); await cardOrder('c', 'card-5');
  await beginCardDrag('card-1', '[data-list-id="a"] .kanban-cards');
  await finishDrag(true); await cardOrder('b', 'card-1,card-0');
  assert.equal(await page.locator('.kanban-card-placeholder').count(), 0);
  assert.equal(await app.evaluate(() => globalThis.listDragTest.cardCalls.length), 2);
  await beginCardDrag('card-1', '[data-list-id="a"] .kanban-cards');
  await finishDrag(); await cardOrder('a', 'card-1');
  await app.evaluate(() => { globalThis.listDragTest.reject = true; });
  await beginCardDrag('card-1', '[data-card-id="card-0"]');
  await finishDrag(); await page.getByRole('alert').filter({ hasText: 'Conflito de cartão simulado' }).waitFor();
  await cardOrder('a', 'card-1'); await cardOrder('b', 'card-0');
  console.log('Cartões: encaixe antes de soltar, movimento na mesma coluna e entre colunas, destino vazio, Esc e restauração após conflito aprovados.');
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close();
  const target = path.resolve(directory);
  if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('organon-list-drag-')) fs.rmSync(target, { recursive: true, force: true });
});
