export const BOARD_COLORS = ['#fecaca','#fed7aa','#fef08a','#d9f99d','#a7f3d0','#a5f3fc','#bae6fd','#c7d2fe','#ddd6fe','#f0abfc','#fecdd3','#fbbf24','#94a3b8','#e5e7eb','#1e293b','#0f172a','#164e63','#14532d','#431407'];
export const LIST_COLORS = ['#b91c1c','#c2410c','#b45309','#4d7c0f','#15803d','#0f766e','#0e7490','#1d4ed8','#4338ca','#6d28d9','#a21caf','#be185d','#475569','#1e293b'];
export const ICON_NAMES = ['Tag','AlertTriangle','AlertCircle','Flag','Star','Bookmark','Heart','Zap','Bell','Flame','Award','Target','Rocket','Lightbulb','ThumbsUp','ThumbsDown','Eye','Lock','Shield','Gift','DollarSign','ShoppingCart','Truck','Package','Wrench','Code','Bug','Coffee','Music','Camera','Phone','Mail','MessageCircle','User','Users','Home','MapPin','Globe','Cloud','Sun','Moon','Clock','Calendar','CheckCircle','XCircle','Pin','Sparkles'];
export function plainText(value = '') { return String(value).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
export function matchesCard(card, query, tagIds, links) {
  const q = query.trim().toLocaleLowerCase('pt-BR');
  return (!q || `${card.title}\n${plainText(card.description)}`.toLocaleLowerCase('pt-BR').includes(q)) &&
    (!tagIds.length || links.some(link => link.card_id === card.id && tagIds.includes(link.tag_id)));
}
export function ordered(rows) { return [...rows].sort((a, b) => Number(a.position) - Number(b.position) || a.id.localeCompare(b.id)); }
export function editorContent(description = '') {
  if (/<[a-z][\s\S]*>/i.test(description)) return description;
  return `<p>${description.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</p>`;
}
export async function prepareImage(file, kind) {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 25 * 1024 * 1024) throw new Error('Use PNG, JPEG ou WebP de até 25 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const edge = kind === 'background' ? 1920 : 1280, limit = kind === 'background' ? 1024 * 1024 : 500 * 1024;
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob;
    for (const quality of [0.9, 0.75, 0.6, 0.45]) { blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality)); if (blob && blob.size <= limit) break; }
    if (!blob || blob.size > limit) throw new Error('A imagem não pôde ser reduzida. Escolha uma imagem menor.');
    return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Não foi possível ler a imagem.')); reader.readAsDataURL(blob); });
  } finally { bitmap.close(); }
}
