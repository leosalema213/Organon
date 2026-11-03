const { randomUUID } = require('node:crypto');
const { privateDownloadPath, downloadHeaders, uploadHeaders } = require('../shared-storage.cjs');

const ACTIONS = Object.freeze(['getBoards', 'getTags', 'getBoard', 'saveBoard', 'deleteBoard', 'saveList', 'deleteList', 'moveList', 'saveCard', 'deleteCard', 'moveCard', 'saveTag', 'deleteTag', 'uploadAsset', 'getAsset']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function id(value, label = 'Identificador') { if (!UUID.test(value || '')) throw new Error(`${label} inválido.`); return value; }
function text(value, limit, required = false) { if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw new Error('Texto inválido ou muito longo.'); return value; }
function revision(value) { if (!Number.isSafeInteger(value) || value < 1) throw new Error('Recarregue o registro antes de editar.'); return value; }
function color(value) { if (!/^#[\da-f]{6}$/i.test(value || '')) throw new Error('Cor inválida.'); return value; }
function price(value) {
  if (value === '' || value == null) return null;
  const raw = String(value).replace(',', '.');
  if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(raw)) throw new Error('Informe um valor com até duas casas decimais.');
  return raw;
}
function assetReference(value, orgId, boardId) {
  if (!value) return null;
  // Retain legacy URLs verbatim during editing; never fetch arbitrary URLs in main.
  if (typeof value === 'string' && /^https:\/\/[^\s]{1,2000}$/.test(value)) return value;
  const pattern = new RegExp(`^${orgId}/${boardId}/[a-f0-9-]{36}\\.(png|jpg|webp)$`, 'i');
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error('Imagem inválida para este quadro.');
  return value;
}
function validate(action, payload) {
  if (!ACTIONS.includes(action)) throw new Error('Ação de quadro não permitida.');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Dados inválidos.');
  const p = { orgId: id(payload.orgId, 'Espaço') };
  if (action === 'getBoards' || action === 'getTags') return p;
  if (['saveTag', 'deleteTag'].includes(action)) { if (payload.boardId) p.boardId = id(payload.boardId, 'Quadro'); }
  else if (action !== 'saveBoard' || payload.id) p.boardId = id(payload.boardId, 'Quadro');
  if (/^(save|delete|move)/.test(action) && payload.id) { p.id = id(payload.id); p.expectedRevision = revision(payload.expectedRevision); }
  if (/^(delete|move)/.test(action) && !p.id) throw new Error('Registro obrigatório.');
  if (action === 'saveBoard') {
    p.name = text(payload.name, 300, true);
    if (!['none', 'color', 'image'].includes(payload.bg_type) || !['cover', 'repeat'].includes(payload.bg_size)) throw new Error('Fundo inválido.');
    p.bg_type = payload.bg_type; p.bg_size = payload.bg_size;
    p.bg_color = payload.bg_color ? color(payload.bg_color) : null;
    p.bg_image_url = assetReference(payload.bg_image_url, p.orgId, p.boardId);
    if (!p.id && p.bg_image_url) throw new Error('Crie o quadro antes de enviar a imagem.');
  }
  if (action === 'saveList') { p.name = text(payload.name, 300, true); p.color = color(payload.color); }
  if (action === 'saveTag') { p.name = text(payload.name, 150, true); p.color = color(payload.color); p.icon = text(payload.icon, 80, true); }
  if (action === 'saveCard') {
    p.listId = id(payload.listId, 'Coluna'); p.title = text(payload.title, 1000, true);
    p.description = text(payload.description ?? '', 200000); p.price = price(payload.price);
    p.thumbnail_url = assetReference(payload.thumbnail_url, p.orgId, p.boardId);
    if (!Array.isArray(payload.tagIds) || payload.tagIds.length > 100) throw new Error('Marcadores inválidos.');
    p.tagIds = [...new Set(payload.tagIds.map(value => id(value, 'Marcador')))];
  }
  if (action === 'moveCard' || action === 'moveList') {
    if (action === 'moveCard') p.listId = id(payload.listId, 'Coluna');
    p.beforeId = payload.beforeId ? id(payload.beforeId) : null;
    if (p.beforeId === p.id) throw new Error('Destino inválido.');
  }
  if (action === 'uploadAsset') {
    if (!['background', 'thumbnail'].includes(payload.kind)) throw new Error('Tipo de imagem inválido.');
    p.kind = payload.kind; p.data = payload.data;
  }
  if (action === 'getAsset') p.reference = assetReference(payload.reference, p.orgId, p.boardId);
  return p;
}
function imageBytes(data) {
  if (typeof data !== 'string' || data.length > 8 * 1024 * 1024) throw new Error('Imagem muito grande (máximo 5 MB).');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!match) throw new Error('Use uma imagem PNG, JPEG ou WebP.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('Imagem muito grande (máximo 5 MB).');
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new Error('O conteúdo não corresponde ao tipo da imagem.');
  return { bytes, mime: `image/${match[1]}`, ext: match[1] === 'jpeg' ? 'jpg' : match[1] };
}
function createService({ cloud, emit = () => {} }) {
  async function dispatch(action, payload) {
    const p = validate(action, payload);
    await cloud.ready;
    if (cloud.enabled === false) throw new Error('A conexão com a nuvem está desabilitada.');
    const token = await cloud.token();
    if (action === 'uploadAsset' || action === 'getAsset') {
      // RLS checks the board, org and write/read grant again in Storage policies.
      const boards = await cloud.request(`/rest/v1/kanban_boards?select=id&id=eq.${p.boardId}&org_id=eq.${p.orgId}`, { token });
      if (!boards?.length) throw new Error('Quadro indisponível ou sem permissão.');
      if (action === 'uploadAsset') {
        const { bytes, mime, ext } = imageBytes(p.data);
        const reference = `${p.orgId}/${p.boardId}/${randomUUID()}.${ext}`;
        await cloud.request('/storage/v1/object/organon-kanban/' + reference, { method: 'POST', token, body: bytes, headers: { ...uploadHeaders, 'Content-Type': mime, 'x-upsert': 'false' } });
        return { reference };
      }
      if (!p.reference || p.reference.startsWith('https:')) return { data: null, legacy: !!p.reference };
      const bytes = await cloud.request(privateDownloadPath('organon-kanban', p.reference), { token, binary: true, headers: downloadHeaders });
      const ext = p.reference.split('.').at(-1), mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return { data: `data:${mime};base64,${bytes.toString('base64')}` };
    }
    try {
      const result = await cloud.request('/rest/v1/rpc/organon_kanban', { method: 'POST', token, body: { p_action: action, p_org_id: p.orgId, p_payload: p } });
      if (!action.startsWith('get')) emit({ module: 'kanban', orgId: p.orgId, boardId: p.boardId || (action === 'saveBoard' ? result?.id : undefined), type: 'changed' });
      return result;
    } catch (error) {
      if (error.code === 'PT409' || error.code === '40001') throw Object.assign(new Error('Este registro mudou em outro dispositivo. Recarregue o quadro e revise suas alterações.'), { code: 'CONFLICT' });
      if (error.code === '42501') throw new Error('Você não tem permissão para esta alteração.');
      throw error;
    }
  }
  return { dispatch };
}
module.exports = { createService, ACTIONS, validate, imageBytes, price };
