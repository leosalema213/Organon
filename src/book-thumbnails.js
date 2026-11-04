const jobs = new Map(), memory = new Map();
let queue = Promise.resolve();

// Only visible cards request work; PDFs are parsed one at a time, outside React state.
export function requestThumbnail(hash, prepare) {
  if (memory.has(hash)) return { result: Promise.resolve(memory.get(hash)), release() {} };
  let job = jobs.get(hash);
  if (!job) {
    job = { users: 0 };
    job.result = queue.catch(() => {}).then(async () => {
      if (!job.users) return null;
      let src = await window.desktop.books.thumbnail(hash).catch(() => null);
      if (!src && job.users) {
        await prepare?.();
        if (job.users) src = await renderThumbnail(hash);
      }
      if (src) {
        if (memory.size >= 64) memory.delete(memory.keys().next().value);
        memory.set(hash, src);
      }
      return src;
    }).finally(() => jobs.delete(hash));
    queue = job.result.catch(() => {}); jobs.set(hash, job);
  }
  job.users++;
  let released = false;
  return { result: job.result, release() { if (!released) { released = true; job.users--; } } };
}

async function renderThumbnail(hash) {
  const { loadPdf } = await import('./pdf-runtime.js');
  const bytes = await window.desktop.books.read(hash, 'pdf');
  const task = loadPdf(bytes);
  task.onPassword = () => task.destroy().catch(() => {});
  let canvas;
  try {
    const pdf = await task.promise, page = await pdf.getPage(1), base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(240 / base.width, 320 / base.height, 1) });
    canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' }).promise;
    let src = canvas.toDataURL('image/webp', 0.8);
    if (src.length > 87000) src = canvas.toDataURL('image/webp', 0.55);
    if (src.length > 87000) return null;
    // The cache is optional: a full disk must not prevent using an already rendered cover.
    await window.desktop.books.cacheThumbnail(hash, src).catch(() => {});
    return src;
  } finally { await task.destroy(); if (canvas) { canvas.width = 0; canvas.height = 0; } }
}
