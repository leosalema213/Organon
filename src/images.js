let worker, sequence = 0, queue = Promise.resolve();
let pending = 0;
const waiting = new Map();
export const waitForImages = async () => { let current; do { current = queue; await current.catch(() => {}); } while (current !== queue); };
export const pendingImages = () => pending;
const notifyPending = () => { window.desktop?.imagesPending?.(pending); window.dispatchEvent(new CustomEvent('organon:images', { detail: pending })); };
// Register conversions performed by specialized editors in the same close/backup barrier.
export function trackImageTask(task) {
  pending++; notifyPending();
  const tracked = Promise.resolve(task).finally(() => { pending--; notifyPending(); });
  queue = Promise.allSettled([queue, tracked]);
  tracked.catch(() => {});
  return tracked;
}
export function optimizeImage(input) {
  pending++; notifyPending();
  const task = queue.catch(() => {}).then(async () => {
    let blob = input;
    if (typeof input === 'string') {
      const [header, encoded] = input.split(',');
      blob = new Blob([Uint8Array.from(atob(encoded), character => character.charCodeAt(0))], { type: header.match(/data:([^;]+)/)[1] });
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) throw new Error('Use imagens PNG, JPG ou WebP.');
    if (blob.size > 20 * 1024 * 1024) throw new Error('Escolha uma imagem de até 20 MB.');
    if (!worker) {
      worker = new Worker(new URL('./image-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        const task = waiting.get(data.id); waiting.delete(data.id);
        if (data.error) task?.reject(new Error(data.error)); else task?.resolve(data.blob);
      };
      worker.onerror = () => { for (const task of waiting.values()) task.reject(new Error('Não foi possível processar a imagem.')); waiting.clear(); worker.terminate(); worker = null; };
    }
    const result = await new Promise((resolve, reject) => { const id = ++sequence; waiting.set(id, { resolve, reject }); worker.postMessage({ id, blob }); });
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Não foi possível ler esta imagem.')); reader.readAsDataURL(result); });
  });
  queue = task.finally(() => { pending--; notifyPending(); });
  // Consumers handle errors; the queue must not create an unhandled rejection.
  queue.catch(() => {});
  return task;
}
