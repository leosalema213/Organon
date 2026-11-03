import { optimizeImage } from './images.js';

export async function prepareProfileImage(file) {
  const src = await optimizeImage(file), encoded = src.split(',')[1];
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: src.slice(5, src.indexOf(';')) }));
  try {
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/webp', 0.85);
    if (!result.startsWith('data:image/webp;base64,') || result.length > 174787) throw new Error('Não foi possível preparar a foto do perfil. Escolha outra imagem.');
    return result;
  } finally { bitmap.close(); }
}
