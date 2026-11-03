const { createHash } = require('node:crypto');
const { AnkiMedia } = require('./anki-media.cjs');
const AVATAR_LIMIT = 128 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function profileFields(value) {
  if (!value || typeof value.name !== 'string' || typeof value.nickname !== 'string' || value.name.length > 80 || value.nickname.length > 40) throw new Error('Informe um nome de até 80 caracteres e um apelido de até 40 caracteres.');
  return { name: value.name.trim(), nickname: value.nickname.trim() };
}
function avatarBytes(src) {
  if (typeof src !== 'string' || src.length > 175000 || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(src)) throw new Error('Escolha uma foto válida para o perfil.');
  const bytes = Buffer.from(src.split(',')[1], 'base64');
  checkAvatar(bytes, digest(bytes)); return bytes;
}
function checkAvatar(bytes, hash) {
  if (bytes.length > AVATAR_LIMIT) throw new Error('A foto do perfil deve ter até 128 KiB.');
  AnkiMedia.prototype.check(bytes, { hash, size: bytes.length, mime: 'image/webp' });
}
module.exports = { profileFields, avatarBytes, checkAvatar, AVATAR_LIMIT };
